'use strict'

// Plan 0017: switch and meter paths, safety flags, calibration runs.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

const freshStore = () => new Store(':memory:')

function boat (store) {
  const battery = store.create('device', { name: 'House battery', role: 'storage', nominal_voltage: 12 })
  const fuse = store.create('device', { name: 'Lamp fuse', role: 'distribution', trip_rating_a: 10 })
  const lamp = store.create('device', { name: 'Cabin lamp' })
  const cable = (from, to) => store.create('wireRun', { from_device_id: from.id, to_device_id: to.id })
  return { battery, fuse, lamp, cable }
}

test('devices: switch path, flags and meter fields are stored, and flags are booleans in and 0/1 out', () => {
  const store = freshStore()
  const relay = store.create('device', {
    name: 'Cabin relay', role: 'distribution', switch_path: 'electrical.switches.bank.0.3.state',
    confirm_switching: true, never_remote: false, meter_path: 'electrical.switches.bank.0.3.current', meter_unit: 'A'
  })
  assert.equal(relay.switch_path, 'electrical.switches.bank.0.3.state')
  assert.equal(relay.confirm_switching, 1)
  assert.equal(relay.never_remote, 0)
  assert.equal(relay.meter_unit, 'A')
  const changed = store.update('device', relay.id, { never_remote: true, meter_unit: 'W' })
  assert.equal(changed.never_remote, 1)
  const entry = store.changeLog('device', relay.id).pop()
  assert.deepEqual(JSON.parse(entry.diff_json).never_remote, { before: 0, after: 1 })
  store.close()
})

test('devices: the meter unit must be A or W, and a path is trimmed or cleared', () => {
  const store = freshStore()
  assert.throws(() => store.create('device', { name: 'x', meter_unit: 'V' }), /meter_unit/)
  const d = store.create('device', { name: 'x', switch_path: '  a.b.state  ', meter_path: '   ' })
  assert.equal(d.switch_path, 'a.b.state')
  assert.equal(d.meter_path, null)
  assert.throws(() => store.update('device', d.id, { meter_unit: 'kW' }), /meter_unit/)
  store.close()
})

test('devices: critical-looking types start with confirm before switching, others do not', () => {
  const store = freshStore()
  for (const type of ['Bilge pump', 'refrigerator', 'AUTOPILOT', 'Navigation light', 'Anchor Windlass']) {
    assert.equal(store.create('device', { name: type, type }).confirm_switching, 1, type)
  }
  assert.equal(store.create('device', { name: 'Reading lamp', type: 'Cabin light' }).confirm_switching, 0)
  assert.equal(store.create('device', { name: 'No type' }).confirm_switching, 0)
  // An explicit choice always wins, and nothing starts as never remote.
  const off = store.create('device', { name: 'Bilge', type: 'Bilge pump', confirm_switching: false })
  assert.equal(off.confirm_switching, 0)
  assert.equal(store.create('device', { name: 'Bilge 2', type: 'Bilge pump' }).never_remote, 0)
  // Changing the type later never flips the flag on its own.
  const lamp = store.create('device', { name: 'Lamp', type: 'Cabin light' })
  assert.equal(store.update('device', lamp.id, { type: 'Bilge pump' }).confirm_switching, 0)
  store.close()
})

test('circuits: a meter path and unit can be set on the record', () => {
  const store = freshStore()
  const { battery, fuse, lamp, cable } = boat(store)
  cable(battery, fuse)
  cable(fuse, lamp)
  const [circuit] = store.list('circuit')
  const updated = store.update('circuit', circuit.id, { meter_path: 'electrical.shunt.current', meter_unit: 'A' })
  assert.equal(updated.meter_path, 'electrical.shunt.current')
  assert.throws(() => store.update('circuit', circuit.id, { meter_unit: 'x' }), /meter_unit/)
  store.close()
})

function runBoat (store) {
  const lamp = store.create('device', { name: 'Cabin lamp', rated_power_w: 10 })
  const relay = store.create('device', { name: 'Relay', role: 'distribution', switch_path: 'a.state' })
  return { lamp, relay }
}

test('calibration runs: create, update, list, and the latest accepted run per device', () => {
  const store = freshStore()
  const { lamp } = runBoat(store)
  const run = store.createRun({ device_id: lamp.id, method: 'delta', meter_path: 'm.current', meter_unit: 'A', started_at: '2026-11-01T10:00:00Z' })
  assert.equal(run.status, 'running')
  assert.equal(run.review, 'pending')
  assert.equal(store.latestAcceptedRun(lamp.id), null)

  store.updateRun(run.id, { status: 'done', ended_at: '2026-11-01T10:05:00Z', avg_w: 9.5, peak_w: 10.1, duty_cycle: 1, confidence: 'high', samples: [[0, 0.1], [1, 0.9]], details: { repeats: 3 } })
  const done = store.getRun(run.id)
  assert.deepEqual(done.samples, [[0, 0.1], [1, 0.9]])
  assert.deepEqual(done.details, { repeats: 3 })

  store.reviewRun(run.id, 'accepted')
  assert.equal(store.latestAcceptedRun(lamp.id).id, run.id)
  const log = store.changeLog('device', lamp.id)
  assert.equal(log[log.length - 1].summary, 'calibration accepted')

  const second = store.createRun({ device_id: lamp.id, method: 'watch', started_at: '2026-11-02T10:00:00Z' })
  store.updateRun(second.id, { status: 'done', ended_at: '2026-11-02T10:05:00Z', avg_w: 8, peak_w: 9 })
  store.reviewRun(second.id, 'accepted')
  assert.equal(store.latestAcceptedRun(lamp.id).id, second.id)
  store.reviewRun(second.id, 'rejected')
  assert.equal(store.latestAcceptedRun(lamp.id).id, run.id)
  assert.equal(store.listRuns({ deviceId: lamp.id }).length, 2)
  store.close()
})

test('calibration runs: only finished runs can be reviewed; method and review are checked', () => {
  const store = freshStore()
  const { lamp } = runBoat(store)
  assert.throws(() => store.createRun({ device_id: lamp.id, method: 'guess' }), /method/)
  assert.throws(() => store.createRun({ device_id: 'nope', method: 'delta' }), /device not found/)
  const run = store.createRun({ device_id: lamp.id, method: 'delta' })
  assert.throws(() => store.reviewRun(run.id, 'accepted'), /finished/)
  store.updateRun(run.id, { status: 'failed', error: 'switch did not respond' })
  assert.throws(() => store.reviewRun(run.id, 'accepted'), /finished/)
  store.updateRun(run.id, { status: 'done', avg_w: 1 })
  assert.throws(() => store.reviewRun(run.id, 'maybe'), /review/)
  store.close()
})

test('calibration runs: a group run on a switch covers its consumers', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'Lamp A' })
  const b = store.create('device', { name: 'Lamp B' })
  const relay = store.create('device', { name: 'Cabin relay', role: 'distribution', switch_path: 'a.state' })
  const run = store.createRun({ device_id: relay.id, switch_device_id: relay.id, consumer_ids: [a.id, b.id], method: 'delta' })
  store.updateRun(run.id, { status: 'done', avg_w: 36, peak_w: 37 })
  store.reviewRun(run.id, 'accepted')
  assert.equal(store.latestAcceptedRun(a.id).id, run.id)
  assert.equal(store.latestAcceptedRun(b.id).id, run.id)
  assert.equal(store.latestAcceptedRun(relay.id).id, run.id)
  store.close()
})

test('calibration runs: a run left running when the plugin stopped is marked failed', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-runs-')), 'wiring.db')
  let store = new Store(dbPath)
  const { lamp } = runBoat(store)
  const run = store.createRun({ device_id: lamp.id, method: 'delta' })
  store.close()
  store = new Store(dbPath)
  assert.equal(store.abandonRunningRuns(), 1)
  const after = store.getRun(run.id)
  assert.equal(after.status, 'failed')
  assert.match(after.error, /stopped/)
  store.close()
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

function legacyV7Db (dbPath) {
  const oldDb = new Database(dbPath)
  oldDb.exec(`
    CREATE TABLE devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, role TEXT NOT NULL DEFAULT 'consumer',
      icon_attachment_id TEXT, zone TEXT, rated_power_w REAL, signalk_path TEXT, trip_rating_a REAL,
      nominal_voltage REAL, power_factor REAL, pos_x REAL, pos_y REAL, pos_z REAL,
      zone_id TEXT, tags TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    CREATE TABLE circuits (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT, cable_ids TEXT, voltage REAL,
      convention TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    INSERT INTO devices (id, name, type) VALUES ('d1', 'Bilge pump', 'Bilge pump');
    INSERT INTO circuits (id, name) VALUES ('c1', 'Old');
  `)
  oldDb.pragma('user_version = 7')
  oldDb.close()
}

test('the switching migration: a version 7 database gains the columns and the runs table, twice over', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')
  legacyV7Db(dbPath)
  for (let pass = 0; pass < 2; pass++) {
    const store = new Store(dbPath)
    assert.ok(store.db.pragma('user_version', { simple: true }) >= 9)
    const d = store.get('device', 'd1')
    assert.equal(d.switch_path, null)
    assert.equal(d.confirm_switching, 0) // existing devices are not retro-flagged
    assert.equal(d.never_remote, 0)
    assert.equal(store.get('circuit', 'c1').meter_path, null)
    assert.equal(store.listRuns({}).length, 0)
    store.close()
  }
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

// ---- Resources ----

function freshProvider (kind, type) {
  const store = new Store(':memory:')
  return { store, provider: createResourceProvider(store, kind, type) }
}

test('device resources expose the flags as booleans and the measured values of the latest accepted run', async () => {
  const { store, provider } = freshProvider('device', 'wiringDevices')
  await provider.methods.setResource('d1', {
    name: 'Bilge pump', type: 'Bilge pump', switchPath: 'a.state', neverRemote: false,
    meterPath: 'm.current', meterUnit: 'A'
  })
  let device = await provider.methods.getResource('d1')
  assert.equal(device.confirmSwitching, true)
  assert.equal(device.neverRemote, false)
  assert.equal(device.switchPath, 'a.state')
  assert.equal(device.measured, null)

  const run = store.createRun({ device_id: 'd1', method: 'delta', meter_path: 'm.current', meter_unit: 'A', voltage: 12, started_at: '2026-11-01T10:00:00Z' })
  store.updateRun(run.id, { status: 'done', ended_at: '2026-11-01T10:05:00Z', avg_w: 60, peak_w: 66, duty_cycle: 1, confidence: 'high', estimate: 1 })
  store.reviewRun(run.id, 'accepted')

  device = await provider.methods.getResource('d1')
  assert.deepEqual(device.measured, {
    runId: run.id, method: 'delta', at: '2026-11-01T10:05:00Z', avgW: 60, peakW: 66, dutyCycle: 1,
    confidence: 'high', estimate: true, group: null
  })
  const all = await provider.methods.listResources()
  assert.equal(all.d1.measured.avgW, 60)

  // Measured values are derived: writing them back is ignored, flags round-trip as booleans.
  await provider.methods.setResource('d1', { ...device, neverRemote: true })
  const after = await provider.methods.getResource('d1')
  assert.equal(after.neverRemote, true)
  assert.equal(after.measured.avgW, 60)
  store.close()
})

test('a group run is reported on each consumer with the group listed', async () => {
  const { store, provider } = freshProvider('device', 'wiringDevices')
  await provider.methods.setResource('a', { name: 'Lamp A' })
  await provider.methods.setResource('b', { name: 'Lamp B' })
  await provider.methods.setResource('r', { name: 'Relay', role: 'distribution', switchPath: 'x.state' })
  const run = store.createRun({ device_id: 'r', switch_device_id: 'r', consumer_ids: ['a', 'b'], method: 'delta' })
  store.updateRun(run.id, { status: 'done', avg_w: 36, peak_w: 37 })
  store.reviewRun(run.id, 'accepted')
  const a = await provider.methods.getResource('a')
  assert.deepEqual(a.measured.group, { switchDeviceId: 'r', consumerIds: ['a', 'b'] })
  assert.equal(a.measured.avgW, 36)
  store.close()
})

test('circuit resources can have a meter set from outside', async () => {
  const { store, provider } = freshProvider('circuit', 'wiringCircuits')
  const { battery, fuse, lamp, cable } = boat(store)
  cable(battery, fuse)
  cable(fuse, lamp)
  const [circuit] = store.list('circuit')
  await provider.methods.setResource(circuit.id, { meterPath: 'm.current', meterUnit: 'A' })
  const got = await provider.methods.getResource(circuit.id)
  assert.equal(got.meterPath, 'm.current')
  assert.equal(got.meterUnit, 'A')
  store.close()
})
