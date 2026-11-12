'use strict'

// Plan 0030: device schematic box and icon colors.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

const columns = (store) => store.db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name)

test('migration 17 adds both color columns, twice over safely, old rows read null', () => {
  const store = new Store(':memory:')
  const d = store.create('device', { name: 'Old' })
  store.db.exec('ALTER TABLE devices DROP COLUMN schematic_box_color')
  store.db.exec('ALTER TABLE devices DROP COLUMN schematic_icon_color')
  store.db.pragma('user_version = 16')
  store._migrate()
  assert.equal(store.db.pragma('user_version', { simple: true }), 17)
  assert.ok(columns(store).includes('schematic_box_color'))
  assert.ok(columns(store).includes('schematic_icon_color'))
  assert.equal(store.get('device', d.id).schematic_box_color, null)
  store.db.pragma('user_version = 16')
  assert.doesNotThrow(() => store._migrate())
  assert.equal(columns(store).filter((c) => c === 'schematic_box_color').length, 1)
  store.close()
})

test('colors round trip, expand #rgb, lower-case, clear and are logged', () => {
  const store = new Store(':memory:')
  const d = store.create('device', { name: 'A' })
  assert.equal(d.schematic_box_color, null)
  const u = store.update('device', d.id, { schematic_box_color: '#ABC', schematic_icon_color: '#1A2B3C' })
  assert.equal(u.schematic_box_color, '#aabbcc')
  assert.equal(u.schematic_icon_color, '#1a2b3c')
  const diff = JSON.parse(store.changeLog('device', d.id).pop().diff_json)
  assert.deepEqual(diff.schematic_box_color, { before: null, after: '#aabbcc' })
  assert.equal(store.update('device', d.id, { schematic_box_color: '' }).schematic_box_color, null)
  assert.equal(store.update('device', d.id, { schematic_icon_color: null }).schematic_icon_color, null)
  assert.equal(store.create('device', { name: 'B', schematic_box_color: '#FFF' }).schematic_box_color, '#ffffff')
  store.close()
})

test('invalid colors are rejected with a clear message and nothing is saved', () => {
  const store = new Store(':memory:')
  const d = store.create('device', { name: 'A', schematic_box_color: '#112233' })
  for (const bad of ['red', '#12', '#12345', '#gggggg', '112233', '#1122334', 5]) {
    assert.throws(() => store.update('device', d.id, { schematic_box_color: bad }), /box color must be a hex color/)
  }
  assert.throws(() => store.update('device', d.id, { schematic_icon_color: 'blue' }), /icon color must be a hex color/)
  assert.equal(store.get('device', d.id).schematic_box_color, '#112233')
  store.close()
})

test('the device resource serves and accepts schematicBoxColor and schematicIconColor', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  await devices.methods.setResource('d1', { name: 'Plotter', schematicBoxColor: '#F80', schematicIconColor: '#00ff00' })
  const r = await devices.methods.getResource('d1')
  assert.equal(r.schematicBoxColor, '#ff8800')
  assert.equal(r.schematicIconColor, '#00ff00')
  await devices.methods.setResource('d1', { name: 'Plotter', schematicBoxColor: null })
  assert.equal((await devices.methods.getResource('d1')).schematicBoxColor, null)
  store.close()
})
