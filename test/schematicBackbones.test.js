'use strict'

// Plan 0037: a backbone placed on a schematic page (migration 19).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store, LATEST_SCHEMA_VERSION } = require('../src/store')

function setup () {
  const store = new Store(':memory:')
  const dev = store.create('device', { name: 'Plotter', role: 'consumer' })
  const bus = store.create('backbone', { name: 'Main', taps: [{ deviceId: dev.id, port: 'NMEA 2000' }] })
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: dev.id, x: 0, y: 0 }] })
  return { store, dev, bus, page }
}

test('the schema is at the latest version and the placement table exists', () => {
  const { store } = setup()
  assert.equal(store.db.pragma('user_version', { simple: true }), LATEST_SCHEMA_VERSION)
  assert.ok(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schematic_backbones'").get())
})

test('a placement is stored with the page and read back', () => {
  const { store, bus, page } = setup()
  assert.deepEqual(page.backbone_boxes || page.backboneBoxes || [], [])
  const placed = store.update('schematic', page.id, { backbone_boxes: [{ backboneId: bus.id, x: 40, y: 60.5, handPlaced: true }] })
  assert.deepEqual(placed.backbone_boxes, [{ backboneId: bus.id, x: 40, y: 60.5, handPlaced: true }])
  const moved = store.update('schematic', page.id, { backbone_boxes: [{ backboneId: bus.id, x: 1, y: 2 }] })
  assert.deepEqual(moved.backbone_boxes, [{ backboneId: bus.id, x: 1, y: 2 }])
  // a page written without the list keeps it; an empty list clears it
  assert.equal(store.update('schematic', page.id, { name: 'Q' }).backbone_boxes.length, 1)
  assert.deepEqual(store.update('schematic', page.id, { backbone_boxes: [] }).backbone_boxes, [])
})

test('validation: a list, a known backbone, once, numbers', () => {
  const { store, bus, page } = setup()
  assert.throws(() => store.update('schematic', page.id, { backbone_boxes: 'x' }), /backboneBoxes must be a list/)
  assert.throws(() => store.update('schematic', page.id, { backbone_boxes: [{ backboneId: 'nope', x: 1, y: 1 }] }), /backbone not found/)
  assert.throws(() => store.update('schematic', page.id, { backbone_boxes: [{ backboneId: bus.id, x: 1, y: 1 }, { backboneId: bus.id, x: 2, y: 2 }] }), /listed twice/)
  assert.throws(() => store.update('schematic', page.id, { backbone_boxes: [{ backboneId: bus.id, x: 'a', y: 1 }] }), /x must be a number/)
})

test('purging the backbone or the page removes the placements', () => {
  const { store, bus, page } = setup()
  store.update('schematic', page.id, { backbone_boxes: [{ backboneId: bus.id, x: 1, y: 2 }] })
  store.remove('backbone', bus.id)
  store.purgeBackbone(bus.id)
  assert.equal(store.get('schematic', page.id).backbone_boxes.length, 0)
  const { store: s2, bus: b2, page: p2 } = setup()
  s2.update('schematic', p2.id, { backbone_boxes: [{ backboneId: b2.id, x: 1, y: 2 }] })
  s2.remove('schematic', p2.id)
  s2.purgeSchematic(p2.id)
  assert.equal(s2.db.prepare('SELECT COUNT(*) AS n FROM schematic_backbones').get().n, 0)
})
