'use strict'

// Plan 0020: battery details, the link type, migration 11.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')
const b = require('../src/batteries')

const freshStore = () => new Store(':memory:')
const battery = (store, extra = {}) => store.create('device', { name: 'B', type: 'Battery', role: 'storage', ...extra })

test('the chemistry table and the type name helpers', () => {
  assert.deepEqual(b.chemistryDefaults('flooded'), { nominalVoltage: 12, usableFraction: 0.5 })
  assert.deepEqual(b.chemistryDefaults('lifepo4'), { nominalVoltage: 12.8, usableFraction: 0.8 })
  assert.deepEqual(b.chemistryDefaults('lithium'), { nominalVoltage: null, usableFraction: 0.8 })
  assert.deepEqual(b.chemistryDefaults('other'), { nominalVoltage: null, usableFraction: null })
  assert.deepEqual(b.chemistryDefaults(null), { nominalVoltage: null, usableFraction: null })
  assert.equal(b.typeChemistry(' lead-ACID battery '), 'flooded')
  assert.equal(b.typeChemistry('AGM battery'), 'agm')
  assert.equal(b.typeChemistry('LiFePO4 battery'), 'lifepo4')
  assert.equal(b.typeChemistry('Battery'), null)
  assert.equal(b.typePurpose('starter BATTERY'), 'starter')
  assert.equal(b.typePurpose('House battery'), 'house')
  assert.equal(b.typePurpose(undefined), null)
})

test('every battery field is stored, logged and trimmed', () => {
  const store = freshStore()
  const mon = store.create('device', { name: 'Shunt', type: 'Shunt', role: 'distribution' })
  const d = battery(store, {
    chemistry: 'agm', purpose: 'house', capacity_ah: '100', usable_fraction: 0.5, make_model: ' Varta X ',
    installed_on: '2024-02-29', monitor_device_id: mon.id, voltage_path: ' a.v ', current_path: 'a.c',
    soc_path: 'a.soc', time_remaining_path: 'a.t'
  })
  assert.equal(d.capacity_ah, 100)
  assert.equal(d.make_model, 'Varta X')
  assert.equal(d.voltage_path, 'a.v')
  assert.equal(d.monitor_device_id, mon.id)
  const u = store.update('device', d.id, { chemistry: 'gel', capacity_ah: 200 })
  assert.equal(u.chemistry, 'gel')
  const log = store.db.prepare("SELECT diff_json FROM change_log WHERE record_id = ? AND summary = 'updated'").all(d.id)
  assert.equal(log.length, 1)
  assert.deepEqual(Object.keys(JSON.parse(log[0].diff_json)).sort(), ['capacity_ah', 'chemistry'])
  const cleared = store.update('device', d.id, { chemistry: '', capacity_ah: null, installed_on: '', monitor_device_id: '' })
  assert.equal(cleared.chemistry, null)
  assert.equal(cleared.capacity_ah, null)
  assert.equal(cleared.installed_on, null)
  assert.equal(cleared.monitor_device_id, null)
  store.close()
})

test('validation of every field', () => {
  const store = freshStore()
  const d = battery(store)
  const bad = (patch, re) => assert.throws(() => store.update('device', d.id, patch), re, JSON.stringify(patch))
  bad({ chemistry: 'nickel' }, /chemistry must be one of/)
  bad({ purpose: 'lights' }, /purpose must be one of/)
  bad({ capacity_ah: 0 }, /capacity_ah must be a positive number/)
  bad({ capacity_ah: -5 }, /capacity_ah/)
  bad({ capacity_ah: 'lots' }, /capacity_ah/)
  bad({ usable_fraction: 1.5 }, /usable_fraction/)
  bad({ usable_fraction: -0.1 }, /usable_fraction/)
  bad({ installed_on: '2025-02-30' }, /installed_on/)
  bad({ installed_on: '14.03.2025' }, /installed_on/)
  bad({ monitor_device_id: d.id }, /own monitor/)
  bad({ monitor_device_id: 'nope' }, /device not found/)
  assert.throws(() => store.create('device', { name: 'x', chemistry: 'zinc' }), /chemistry/)
  assert.throws(() => store.create('device', { id: 'self', name: 'x', monitor_device_id: 'self' }), /own monitor/)
  assert.equal(store.update('device', d.id, { usable_fraction: 0 }).usable_fraction, 0)
  assert.equal(store.update('device', d.id, { usable_fraction: 1 }).usable_fraction, 1)
  store.close()
})

test('link is only accepted between two storage devices', () => {
  const store = freshStore()
  const a = battery(store)
  const c = battery(store)
  const lamp = store.create('device', { name: 'Lamp', role: 'consumer' })
  const ok = store.create('wireRun', { from_device_id: a.id, to_device_id: c.id, link: 'series' })
  assert.equal(ok.link, 'series')
  assert.throws(() => store.create('wireRun', { from_device_id: a.id, to_device_id: lamp.id, link: 'parallel' }),
    /A link type only applies to a cable between two batteries/)
  assert.throws(() => store.update('wireRun', ok.id, { link: 'diagonal' }), /link must be one of/)
  // moving one end to a consumer while a link is set is refused too
  assert.throws(() => store.update('wireRun', ok.id, { to_device_id: lamp.id }), /between two batteries/)
  const plain = store.create('wireRun', { from_device_id: a.id, to_device_id: lamp.id })
  assert.throws(() => store.update('wireRun', plain.id, { link: 'series' }), /between two batteries/)
  assert.equal(store.update('wireRun', plain.id, { link: '' }).link, null)
  assert.equal(store.update('wireRun', ok.id, { link: null }).link, null)
  store.close()
})

test('the resource serves the camelCase fields end to end', async () => {
  const store = freshStore()
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  const cables = createResourceProvider(store, 'wireRun', 'wiringCables')
  await devices.methods.setResource('m', { name: 'BMV', type: 'Shunt', role: 'distribution' })
  await devices.methods.setResource('b1', {
    name: 'Bank 1', type: 'Battery', role: 'storage', chemistry: 'lifepo4', purpose: 'motor', capacityAh: 200,
    usableFraction: 0.8, makeModel: 'X 200', installedOn: '2025-05-01', monitorDeviceId: 'm',
    voltagePath: 'electrical.batteries.1.voltage', currentPath: 'electrical.batteries.1.current',
    socPath: 'electrical.batteries.1.capacity.stateOfCharge', timeRemainingPath: 'electrical.batteries.1.capacity.timeRemaining'
  })
  await devices.methods.setResource('b2', { name: 'Bank 2', type: 'Battery', role: 'storage' })
  const got = await devices.methods.getResource('b1')
  assert.equal(got.chemistry, 'lifepo4')
  assert.equal(got.purpose, 'motor')
  assert.equal(got.capacityAh, 200)
  assert.equal(got.usableFraction, 0.8)
  assert.equal(got.makeModel, 'X 200')
  assert.equal(got.installedOn, '2025-05-01')
  assert.equal(got.monitorDeviceId, 'm')
  assert.equal(got.voltagePath, 'electrical.batteries.1.voltage')
  assert.equal(got.currentPath, 'electrical.batteries.1.current')
  assert.equal(got.socPath, 'electrical.batteries.1.capacity.stateOfCharge')
  assert.equal(got.timeRemainingPath, 'electrical.batteries.1.capacity.timeRemaining')
  const bare = await devices.methods.getResource('b2')
  assert.ok(bare.chemistry == null && bare.capacityAh == null && bare.monitorDeviceId == null)
  await cables.methods.setResource('w', { fromDeviceId: 'b1', toDeviceId: 'b2', link: 'series' })
  assert.equal((await cables.methods.getResource('w')).link, 'series')
  await assert.rejects(cables.methods.setResource('w2', { fromDeviceId: 'b1', toDeviceId: 'm', link: 'series' }), /between two batteries/)
  await assert.rejects(devices.methods.setResource('b2', { name: 'Bank 2', chemistry: 'x' }), /chemistry/)
  store.close()
})

test('migration 11 fills chemistry and purpose once, never overrides, is safe twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'))
  const file = path.join(dir, 'w.db')
  const store = new Store(file)
  const mk = (name, type, extra) => store.create('device', { name, type, role: 'storage', ...extra }).id
  const ids = {
    lead: mk('L', 'Lead-acid battery'), agm: mk('A', 'agm battery'), lfp: mk('F', 'LiFePO4 battery'),
    start: mk('S', 'Starter battery'), house: mk('H', 'HOUSE BATTERY'), plain: mk('P', 'Battery'),
    marked: mk('M', 'AGM battery', { chemistry: 'gel', purpose: 'thruster' })
  }
  store.db.exec("UPDATE devices SET chemistry = NULL, purpose = NULL WHERE id != '" + ids.marked + "'")
  store.db.pragma('user_version = 10')
  store.close()
  for (let i = 0; i < 2; i++) {
    const again = new Store(file)
    assert.equal(again.db.pragma('user_version', { simple: true }), 11)
    const g = (k) => again.get('device', ids[k])
    assert.equal(g('lead').chemistry, 'flooded')
    assert.equal(g('agm').chemistry, 'agm')
    assert.equal(g('lfp').chemistry, 'lifepo4')
    assert.equal(g('start').purpose, 'starter')
    assert.equal(g('house').purpose, 'house')
    assert.equal(g('plain').chemistry, null)
    assert.equal(g('marked').chemistry, 'gel')
    assert.equal(g('marked').purpose, 'thruster')
    assert.equal(g('lead').type, 'Lead-acid battery')
    again.db.pragma('user_version = 10')
    again.close()
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('migration 11 adds the columns to a database that predates them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'))
  const file = path.join(dir, 'w.db')
  const s = new Store(file)
  s.create('device', { name: 'Old', type: 'AGM battery', role: 'storage' })
  s.close()
  const Database = require('better-sqlite3')
  const raw = new Database(file)
  for (const c of ['chemistry', 'purpose', 'capacity_ah', 'usable_fraction', 'make_model', 'installed_on',
    'monitor_device_id', 'voltage_path', 'current_path', 'soc_path', 'time_remaining_path']) {
    raw.exec(`ALTER TABLE devices DROP COLUMN ${c}`)
  }
  raw.exec('ALTER TABLE wire_runs DROP COLUMN link')
  raw.pragma('user_version = 10')
  raw.close()
  const store = new Store(file)
  assert.equal(store.list('device')[0].chemistry, 'agm')
  assert.equal(store.list('wireRun').length, 0)
  store.db.prepare('SELECT link FROM wire_runs').all()
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
