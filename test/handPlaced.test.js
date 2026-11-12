'use strict'

// Plan 0028: the hand-placed mark on a page placement.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

function setup () {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'A' })
  const b = store.create('device', { name: 'B' })
  return { store, a, b }
}

const columns = (store) => store.db.prepare('PRAGMA table_info(schematic_devices)').all().map((c) => c.name)

test('hand-placed marks are stored with the page and read back; free devices carry no mark', () => {
  const { store, a, b } = setup()
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: a.id, x: 1, y: 2, handPlaced: true }, { deviceId: b.id, x: 3, y: 4 }] })
  assert.deepEqual(page.devices, [{ deviceId: a.id, x: 1, y: 2, handPlaced: true }, { deviceId: b.id, x: 3, y: 4 }])
  // the mark can be cleared and set again by a write
  const cleared = store.update('schematic', page.id, { devices: [{ deviceId: a.id, x: 1, y: 2 }, { deviceId: b.id, x: 3, y: 4, handPlaced: true }] })
  assert.deepEqual(cleared.devices, [{ deviceId: a.id, x: 1, y: 2 }, { deviceId: b.id, x: 3, y: 4, handPlaced: true }])
  // a write of the mark alone changes the stored page
  const same = store.update('schematic', page.id, { devices: [{ deviceId: a.id, x: 1, y: 2, handPlaced: true }, { deviceId: b.id, x: 3, y: 4, handPlaced: true }] })
  assert.equal(same.devices.every((d) => d.handPlaced === true), true)
  // a page written without the list keeps its marks
  assert.equal(store.update('schematic', page.id, { name: 'Q' }).devices[0].handPlaced, true)
  // only true marks a device
  const odd = store.update('schematic', page.id, { devices: [{ deviceId: a.id, x: 1, y: 2, handPlaced: 'yes' }] })
  assert.deepEqual(odd.devices, [{ deviceId: a.id, x: 1, y: 2 }])
  store.close()
})

test('the schematic resource carries handPlaced per placement', async () => {
  const store = new Store(':memory:')
  const provider = createResourceProvider(store, 'schematic', 'wiringSchematics')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  await devices.methods.setResource('d1', { name: 'A' })
  await devices.methods.setResource('d2', { name: 'B' })
  await provider.methods.setResource('s1', { name: 'P', devices: [{ deviceId: 'd1', x: 1, y: 2, handPlaced: true }, { deviceId: 'd2', x: 3, y: 4 }] })
  const one = await provider.methods.getResource('s1')
  assert.deepEqual(one.devices, [{ deviceId: 'd1', x: 1, y: 2, handPlaced: true }, { deviceId: 'd2', x: 3, y: 4 }])
  const all = await provider.methods.listResources()
  assert.equal(all.s1.devices[0].handPlaced, true)
  store.close()
})

test('migration 16 adds hand_placed, is safe to run twice, and old rows read as free', () => {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'A' })
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: a.id, x: 5, y: 6, handPlaced: true }] })
  assert.ok(columns(store).includes('hand_placed'))
  // go back to a database from before the migration
  store.db.exec('ALTER TABLE schematic_devices DROP COLUMN hand_placed')
  assert.equal(columns(store).includes('hand_placed'), false)
  store.db.pragma('user_version = 15')
  store._migrate()
  assert.equal(store.db.pragma('user_version', { simple: true }), 16)
  assert.ok(columns(store).includes('hand_placed'))
  assert.deepEqual(store.get('schematic', page.id).devices, [{ deviceId: a.id, x: 5, y: 6 }])
  // running it again, with the column already there, changes nothing
  store.db.pragma('user_version = 15')
  assert.doesNotThrow(() => store._migrate())
  assert.equal(store.db.pragma('user_version', { simple: true }), 16)
  assert.equal(columns(store).filter((c) => c === 'hand_placed').length, 1)
  store.update('schematic', page.id, { devices: [{ deviceId: a.id, x: 5, y: 6, handPlaced: true }] })
  assert.equal(store.get('schematic', page.id).devices[0].handPlaced, true)
  store.close()
})
