'use strict'

// Plan 0021: permanent deletion of devices, conduits and schematic pages.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')

const count = (store, sql, ...args) => store.db.prepare(sql).get(...args).n
const cable = (store, from, to, extra = {}) =>
  store.create('wireRun', { from_device_id: from.id, to_device_id: to.id, conductors: [{ conductor: 'positive' }], ...extra })

test('purgeDevice only takes a removed device and erases everything of it', () => {
  const store = new Store(':memory:')
  const dev = store.create('device', {
    name: 'Lamp', terminals: [{ name: 'L+', conductor: 'positive' }], rated_dc_a: 10
  })
  const other = store.create('device', { name: 'Other' })
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: dev.id, x: 1, y: 2 }, { deviceId: other.id, x: 5, y: 5 }] })
  const att = store.createAttachment({ owner_type: 'device', owner_id: dev.id, filename: 'a.jpg', mime_type: 'image/jpeg', uploaded_at: 'now' })
  const run = store.createRun({ device_id: dev.id, method: 'delta', started_at: '2026-11-01T10:00:00Z' })
  assert.throws(() => store.purgeDevice(dev.id), /only a removed device/)
  assert.throws(() => store.purgeDevice('nope'), (e) => e.notFound === true)
  store.remove('device', dev.id)
  assert.ok(store.changeLog('device', dev.id).length >= 2)

  const files = store.purgeDevice(dev.id)
  assert.deepEqual(files.map((a) => a.id), [att.id])
  assert.equal(store.get('device', dev.id), null)
  assert.equal(store.getAttachment(att.id), null)
  assert.equal(store.changeLog('device', dev.id).length, 0)
  assert.equal(count(store, 'SELECT COUNT(*) n FROM device_terminals WHERE device_id = ?', dev.id), 0)
  assert.equal(count(store, 'SELECT COUNT(*) n FROM schematic_devices WHERE device_id = ?', dev.id), 0)
  assert.equal(store.getRun(run.id), null)
  assert.ok(store.get('device', other.id))
  assert.equal(store.list('schematic').find((s) => s.id === page.id).devices.length, 1)
  store.close()
})

test('purgeDevice is refused while any cable, live or removed, still ends on the device', () => {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'Battery', role: 'storage' })
  const b = store.create('device', { name: 'Lamp' })
  const c = cable(store, a, b, { cable_label: 'lamp feed' })
  store.remove('device', b.id)
  assert.throws(() => store.purgeDevice(b.id), /Delete these cables first: lamp feed/)
  store.remove('wireRun', c.id)
  assert.throws(() => store.purgeDevice(b.id), /Delete these cables first: lamp feed/)
  assert.ok(store.get('device', b.id))
  store.purgeCable(c.id)
  store.purgeDevice(b.id)
  assert.equal(store.get('device', b.id), null)
  store.close()
})

test('purgeDevice is also refused for a conductor that lands on the device', () => {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'Fuse', role: 'distribution' })
  const b = store.create('device', { name: 'Lamp' })
  const bus = store.create('device', { name: 'Neg bus' })
  cable(store, a, b, { conductors: [{ conductor: 'positive' }, { conductor: 'negative', fromDeviceId: bus.id }] })
  store.remove('device', bus.id)
  assert.throws(() => store.purgeDevice(bus.id), /Delete these cables first: Fuse to Lamp/)
  store.close()
})

test('purgeDevice clears the monitor link of a battery and logs it there', () => {
  const store = new Store(':memory:')
  const shunt = store.create('device', { name: 'Shunt' })
  const bat = store.create('device', { name: 'Bat', role: 'storage', monitor_device_id: shunt.id })
  store.remove('device', shunt.id)
  const before = store.changeLog('device', bat.id).length
  store.purgeDevice(shunt.id)
  const fresh = store.get('device', bat.id)
  assert.equal(fresh.monitor_device_id, null)
  const log = store.changeLog('device', bat.id)
  assert.equal(log.length, before + 1)
  assert.match(log[log.length - 1].diff_json, /monitor_device_id/)
  store.close()
})

test('purgeConduit erases a removed conduit, its assignments, attachments and history', () => {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'A' })
  const b = store.create('device', { name: 'B' })
  const c = cable(store, a, b)
  const hose = store.create('conduit', { name: 'Hose' })
  store.setCableConduits(c.id, [hose.id])
  const att = store.createAttachment({ owner_type: 'conduit', owner_id: hose.id, filename: 'h.jpg', mime_type: 'image/jpeg', uploaded_at: 'now' })
  assert.throws(() => store.purgeConduit(hose.id), /only a removed conduit/)
  store.remove('conduit', hose.id)
  assert.deepEqual(store.purgeConduit(hose.id).map((x) => x.id), [att.id])
  assert.equal(store.get('conduit', hose.id), null)
  assert.equal(store.getAttachment(att.id), null)
  assert.equal(store.changeLog('conduit', hose.id).length, 0)
  assert.equal(count(store, 'SELECT COUNT(*) n FROM wire_run_conduits WHERE conduit_id = ?', hose.id), 0)
  assert.ok(store.get('wireRun', c.id))
  assert.throws(() => store.purgeConduit(hose.id), (e) => e.notFound === true)
  store.close()
})

test('purgeSchematic erases a removed page with its devices, wires and history', () => {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'A' })
  const b = store.create('device', { name: 'B' })
  const c = cable(store, a, b)
  const page = store.create('schematic', {
    name: 'Page', devices: [{ deviceId: a.id, x: 0, y: 0 }, { deviceId: b.id, x: 9, y: 9 }],
    wires: [{ wireRunId: c.id, points: [{ x: 4, y: 4 }] }]
  })
  assert.throws(() => store.purgeSchematic(page.id), /only a removed schematic/)
  store.remove('schematic', page.id)
  store.purgeSchematic(page.id)
  assert.equal(store.get('schematic', page.id), null)
  assert.equal(store.changeLog('schematic', page.id).length, 0)
  assert.equal(count(store, 'SELECT COUNT(*) n FROM schematic_devices WHERE schematic_id = ?', page.id), 0)
  assert.equal(count(store, 'SELECT COUNT(*) n FROM schematic_wires WHERE schematic_id = ?', page.id), 0)
  assert.ok(store.get('device', a.id) && store.get('wireRun', c.id))
  store.close()
})
