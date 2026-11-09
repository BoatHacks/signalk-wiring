'use strict'

// Plan 0021: AC and DC ratings on devices, migration 12.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

test('ratings are stored, validated, cleared and logged like any field', () => {
  const store = new Store(':memory:')
  const sw = store.create('device', {
    name: 'Main switch', role: 'distribution', type: 'Switch', rated_dc_a: 300, rated_dc_v: '58'
  })
  assert.equal(sw.rated_dc_a, 300)
  assert.equal(sw.rated_dc_v, 58)
  assert.equal(sw.rated_ac_a, null)
  const up = store.update('device', sw.id, { rated_ac_a: 16, rated_ac_v: 230 })
  assert.equal(up.rated_ac_a, 16)
  assert.equal(up.rated_ac_v, 230)
  for (const bad of [0, -5, 'big', NaN, Infinity]) {
    assert.throws(() => store.update('device', sw.id, { rated_dc_a: bad }), /rated_dc_a must be a positive number/)
  }
  assert.throws(() => store.create('device', { name: 'x', rated_ac_v: -1 }), /rated_ac_v must be a positive number/)
  assert.equal(store.update('device', sw.id, { rated_dc_a: '' }).rated_dc_a, null)
  assert.equal(store.update('device', sw.id, { rated_dc_v: null }).rated_dc_v, null)
  const log = store.changeLog('device', sw.id)
  assert.ok(log.length >= 3)
  assert.match(log[1].diff_json, /rated_ac_a/)
  store.close()
})

test('ratings never change how circuits are derived: only the trip rating protects', () => {
  const store = new Store(':memory:')
  const bat = store.create('device', { name: 'Bat', role: 'storage', type: 'Battery' })
  const sw = store.create('device', { name: 'Sw', role: 'distribution', type: 'Switch', rated_dc_a: 300, rated_dc_v: 58 })
  const load = store.create('device', { name: 'Load', role: 'consumer' })
  const c = (from, to) => store.create('wireRun', { from_device_id: from, to_device_id: to, conductors: [{ conductor: 'positive' }] })
  c(bat.id, sw.id)
  c(sw.id, load.id)
  const derived = store.deriveAll()
  assert.ok(derived.circuits.length > 0)
  for (const circuit of derived.circuits) assert.ok(!circuit.protector, 'a rated switch is not a protector')
  store.close()
})

test('the resource provider exposes ratedAcA, ratedAcV, ratedDcA and ratedDcV', async () => {
  const store = new Store(':memory:')
  const provider = createResourceProvider(store, 'device', 'wiringDevices')
  await provider.methods.setResource('s1', { name: 'Breaker', role: 'distribution', ratedAcA: 16, ratedAcV: 230, ratedDcA: 16, ratedDcV: 48 })
  const got = await provider.methods.getResource('s1')
  assert.equal(got.ratedAcA, 16)
  assert.equal(got.ratedAcV, 230)
  assert.equal(got.ratedDcA, 16)
  assert.equal(got.ratedDcV, 48)
  await assert.rejects(provider.methods.setResource('s1', { name: 'Breaker', ratedDcA: -2 }), /rated_dc_a/)
  store.close()
})

test('migration 12 adds the rating columns to an older database, safe to run twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'))
  const file = path.join(dir, 'w.db')
  const s = new Store(file)
  s.create('device', { name: 'Old switch', role: 'distribution' })
  s.close()
  const raw = new Database(file)
  for (const c of ['rated_ac_a', 'rated_ac_v', 'rated_dc_a', 'rated_dc_v']) raw.exec(`ALTER TABLE devices DROP COLUMN ${c}`)
  raw.pragma('user_version = 11')
  raw.close()
  for (let i = 0; i < 2; i++) {
    const store = new Store(file)
    assert.equal(store.db.pragma('user_version', { simple: true }), 14)
    const d = store.list('device')[0]
    assert.equal(d.name, 'Old switch')
    assert.equal(d.rated_dc_a, i === 0 ? null : 300)
    store.update('device', d.id, { rated_dc_a: 300 })
    assert.equal(store.get('device', d.id).rated_dc_a, 300)
    store.db.pragma('user_version = 11')
    store.close()
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
