'use strict'

// Plan 0023: zones drawn as shapes on a schematic page (migration 14).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Database } = require('../src/db')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

function setup () {
  const store = new Store(':memory:')
  const zone = store.create('zone', { name: 'Engine room' })
  const other = store.create('zone', { name: 'Saloon' })
  const page = store.create('schematic', { name: 'P' })
  return { store, zone, other, page }
}
const rect = (zoneId, extra = {}) => ({ zoneId, kind: 'rect', x: 10, y: 20, width: 240, height: 160, ...extra })
const tri = (zoneId) => ({ zoneId, kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 120, y: 200 }] })

test('shapes are stored with the page and read back, a polygon with its corners and box', () => {
  const { store, zone, other, page } = setup()
  const saved = store.update('schematic', page.id, { zone_shapes: [rect(zone.id), { ...tri(other.id) }] })
  assert.deepEqual(saved.zone_shapes[0], rect(zone.id))
  assert.deepEqual(saved.zone_shapes[1], { zoneId: other.id, kind: 'polygon', x: 0, y: 0, width: 240, height: 200, points: tri(other.id).points })
  assert.deepEqual(store.get('schematic', page.id).zone_shapes, saved.zone_shapes)
  const oval = store.update('schematic', page.id, { zone_shapes: [{ ...rect(zone.id), kind: 'oval', x: 1.5 }] })
  assert.equal(oval.zone_shapes[0].kind, 'oval')
  assert.equal(oval.zone_shapes[0].x, 1.5)
  // not given: left alone; an empty list clears
  assert.equal(store.update('schematic', page.id, { name: 'Q' }).zone_shapes.length, 1)
  assert.deepEqual(store.update('schematic', page.id, { zone_shapes: [] }).zone_shapes, [])
})

test('a new page can be created with shapes; moving a shape is layout, not a logged change', () => {
  const { store, zone } = setup()
  const page = store.create('schematic', { name: 'P2', zone_shapes: [rect(zone.id)] })
  assert.equal(page.zone_shapes.length, 1)
  const before = store.changeLog('schematic', page.id).length
  store.update('schematic', page.id, { zone_shapes: [rect(zone.id, { x: 99 })] })
  assert.equal(store.changeLog('schematic', page.id).length, before)
})

test('shapes are validated', () => {
  const { store, zone, page } = setup()
  const put = (list) => () => store.update('schematic', page.id, { zone_shapes: list })
  assert.throws(put('x'), /must be a list/)
  assert.throws(put([rect('nope')]), /zone not found/)
  assert.throws(put([rect(zone.id), rect(zone.id)]), /listed twice/)
  assert.throws(put([rect(zone.id, { kind: 'star' })]), /kind must be one of/)
  assert.throws(put([rect(zone.id, { width: 0 })]), /above zero/)
  assert.throws(put([rect(zone.id, { height: -4 })]), /above zero/)
  assert.throws(put([rect(zone.id, { x: 'a' })]), /x must be a number/)
  assert.throws(put([rect(zone.id, { width: null })]), /width must be a number/)
  assert.throws(put([{ zoneId: zone.id, kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]), /at least three corners/)
  assert.throws(put([{ zoneId: zone.id, kind: 'polygon' }]), /at least three corners/)
  assert.throws(put([{ zoneId: zone.id, kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 'a', y: 2 }] }]), /x must be a number/)
  assert.throws(put([{ zoneId: zone.id, kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: Infinity, y: 2 }] }]), /must be a number/)
})

test('one shape per zone per page, but the same zone can have a shape on another page', () => {
  const { store, zone, page } = setup()
  const second = store.create('schematic', { name: 'P2' })
  store.update('schematic', page.id, { zone_shapes: [rect(zone.id)] })
  store.update('schematic', second.id, { zone_shapes: [rect(zone.id)] })
  assert.throws(() => store.db.prepare(
    "INSERT INTO schematic_zones (id, schematic_id, position, zone_id, kind, x, y, width, height) VALUES ('z', ?, 5, ?, 'rect', 0, 0, 1, 1)").run(page.id, zone.id), /UNIQUE/)
})

test('purging a page, deleting or merging a zone cleans the shapes', () => {
  const { store, zone, other, page } = setup()
  const n = () => store.db.prepare('SELECT COUNT(*) n FROM schematic_zones').get().n
  const second = store.create('schematic', { name: 'P2' })
  store.update('schematic', page.id, { zone_shapes: [rect(zone.id), rect(other.id)] })
  store.update('schematic', second.id, { zone_shapes: [rect(zone.id)] })
  // merging Saloon into Engine room: the page that has both keeps the target's shape
  store.mergeZones(other.id, zone.id)
  assert.deepEqual(store.get('schematic', page.id).zone_shapes.map((s) => s.zoneId), [zone.id])
  assert.equal(n(), 2)
  store.remove('schematic', second.id)
  store.purgeSchematic(second.id)
  assert.equal(n(), 1)
  store.deleteZone(zone.id)
  assert.equal(n(), 0)
  assert.deepEqual(store.get('schematic', page.id).zone_shapes, [])
})

test('merging moves a shape to the target zone when the page has none for it', () => {
  const { store, zone, other, page } = setup()
  store.update('schematic', page.id, { zone_shapes: [rect(other.id)] })
  store.mergeZones(other.id, zone.id)
  assert.deepEqual(store.get('schematic', page.id).zone_shapes.map((s) => s.zoneId), [zone.id])
})

test('the resource carries zoneShapes', async () => {
  const store = new Store(':memory:')
  const provider = createResourceProvider(store, 'schematic', 'wiringSchematics')
  const zone = store.create('zone', { name: 'Bilge' })
  await provider.methods.setResource('s1', { name: 'Page', zoneShapes: [rect(zone.id), { ...tri(zone.id), zoneId: store.create("zone", { name: "Deck" }).id }] })
  const got = await provider.methods.getResource('s1')
  assert.equal(got.zoneShapes.length, 2)
  assert.equal(got.zoneShapes[1].kind, 'polygon')
  assert.equal(got.zoneShapes[1].points.length, 3)
  await provider.methods.setResource('s1', { name: 'Page' })
  assert.equal((await provider.methods.getResource('s1')).zoneShapes.length, 2)
  store.close()
})

test('migration 14: a version 13 database gains the table, twice over', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-m14-')), 'wiring.db')
  const first = new Store(file)
  first.close()
  const raw = new Database(file)
  raw.exec('DROP TABLE schematic_zones')
  raw.pragma('user_version = 13')
  raw.close()
  for (let i = 0; i < 2; i++) {
    const store = new Store(file)
    assert.equal(store.db.pragma('user_version', { simple: true }), 17)
    const zone = store.ensureZone('Z')
    const page = store.create('schematic', { name: 'P', zone_shapes: [rect(zone.id)] })
    assert.equal(store.get('schematic', page.id).zone_shapes.length, 1)
    store.close()
    if (i === 0) { const r = new Database(file); r.pragma('user_version = 13'); r.close() }
  }
})
