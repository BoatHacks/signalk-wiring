import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from '../public/polygon.js'
import * as Z from '../public/zoneShapes.js'

const tri = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 120, y: 200 }]

test('polygon: bounding box, midpoints, triangle', () => {
  assert.deepEqual(P.boundingBox(tri), { x: 0, y: 0, w: 240, h: 200 })
  assert.deepEqual(P.midpoints(tri), [{ x: 120, y: 0 }, { x: 180, y: 100 }, { x: 60, y: 100 }])
  const t = P.triangle(100, 100)
  assert.equal(t.length, 3)
  const b = P.boundingBox(t)
  assert.equal(b.w, 240)
  assert.ok(b.h > 190 && b.h < 220)
})

test('polygon: a corner is inserted at a midpoint, or where it was dragged, and removed while more than three remain', () => {
  const r = P.insertCorner(tri, 0)
  assert.equal(r.index, 1)
  assert.deepEqual(r.points, [tri[0], { x: 120, y: 0 }, tri[1], tri[2]])
  const last = P.insertCorner(tri, 2, { x: 5, y: 99 })
  assert.equal(last.index, 3)
  assert.deepEqual(last.points[3], { x: 5, y: 99 })
  assert.equal(last.points.length, 4)
  assert.deepEqual(P.removeCorner(r.points, 1), tri)
  assert.equal(P.removeCorner(tri, 0), tri)
})

test('polygon: point in polygon and distance to the outline', () => {
  assert.equal(P.pointInPolygon(tri, 120, 50), true)
  assert.equal(P.pointInPolygon(tri, 10, 150), false)
  assert.equal(P.distanceToOutline(tri, 120, 5), 5)
  assert.equal(P.distanceToOutline(tri, 120, -10), 10)
  assert.deepEqual(P.movePoints(tri, 5, -5)[0], { x: 5, y: -5 })
})

test('newShape: 240 by 160 at the centre, a polygon starts as a triangle', () => {
  assert.deepEqual(Z.newShape('z', 'rect', { x: 500, y: 300 }), { zoneId: 'z', kind: 'rect', x: 380, y: 220, width: 240, height: 160 })
  const p = Z.newShape('z', 'polygon', { x: 500, y: 300 })
  assert.equal(p.points.length, 3)
  assert.equal(p.width, 240)
  assert.equal(p.x, Math.min(...p.points.map((q) => q.x)))
})

test('moveShape and corner edits keep the box in step with the corners', () => {
  const p = Z.newShape('z', 'polygon', { x: 0, y: 0 })
  const m = Z.moveShape(p, 10, 20)
  assert.equal(m.x, p.x + 10)
  assert.equal(m.points[0].y, p.points[0].y + 20)
  const { shape, index } = Z.addCorner(p, 0)
  assert.equal(shape.points.length, 4)
  assert.equal(index, 1)
  assert.equal(Z.dropCorner(shape, 1).points.length, 3)
  assert.equal(Z.dropCorner(p, 0), p)
  const dragged = Z.withPoints(shape, shape.points.map((q, i) => (i === 1 ? { x: q.x, y: q.y - 300 } : q)))
  assert.ok(dragged.y < shape.y)
  assert.equal(Z.moveShape({ zoneId: 'z', kind: 'rect', x: 1, y: 2, width: 3, height: 4 }, 1, 1).x, 2)
})

test('handles: eight, hit testing and resizing against the opposite edge', () => {
  const s = { zoneId: 'z', kind: 'rect', x: 100, y: 100, width: 200, height: 100 }
  const hs = Z.handlePositions(s)
  assert.equal(hs.length, 8)
  assert.deepEqual(hs.find((h) => h.id === 'se'), { id: 'se', x: 300, y: 200 })
  assert.deepEqual(hs.find((h) => h.id === 'n'), { id: 'n', x: 200, y: 100 })
  assert.equal(Z.hitHandle(s, 302, 198), 'se')
  assert.equal(Z.hitHandle(s, 200, 150), null)
  assert.deepEqual(Z.resizeShape(s, 'se', 400, 300), { ...s, width: 300, height: 200 })
  assert.deepEqual(Z.resizeShape(s, 'nw', 50, 50), { ...s, x: 50, y: 50, width: 250, height: 150 })
  assert.deepEqual(Z.resizeShape(s, 'e', 260, 999), { ...s, width: 160 })
  assert.deepEqual(Z.resizeShape(s, 'n', 999, 120), { ...s, y: 120, height: 80 })
  // never smaller than the minimum, no flipping
  const tiny = Z.resizeShape(s, 'se', 0, 0)
  assert.equal(tiny.width, Z.MIN_SIZE)
  assert.equal(tiny.height, Z.MIN_SIZE)
  assert.equal(tiny.x, 100)
})

test('resize with Shift keeps a circle or a square', () => {
  const s = { zoneId: 'z', kind: 'oval', x: 100, y: 100, width: 200, height: 100 }
  const c = Z.resizeShape(s, 'se', 350, 250, true)
  assert.equal(c.width, c.height)
  assert.equal(c.x, 100)
  assert.equal(c.y, 100)
  const nw = Z.resizeShape(s, 'nw', 40, 90, true)
  assert.equal(nw.width, nw.height)
  assert.equal(nw.x + nw.width, 300)
  assert.equal(nw.y + nw.height, 200)
  const e = Z.resizeShape(s, 'e', 400, 0, true)
  assert.equal(e.width, e.height)
  assert.equal(e.y + e.height / 2, 150)
})

test('hit testing: the outline and the label, the inside only when selected, the topmost shape wins', () => {
  const a = { zoneId: 'a', kind: 'rect', x: 0, y: 0, width: 300, height: 200 }
  const b = { zoneId: 'b', kind: 'oval', x: 100, y: 50, width: 300, height: 200 }
  const name = (id) => ({ a: 'Engine room', b: 'Saloon' }[id])
  assert.ok(Z.hitShape(a, 'Engine room', 150, 2))
  assert.equal(Z.hitShape(a, 'Engine room', 150, 100), false)
  assert.ok(Z.hitShape(a, 'Engine room', 150, 100, { inside: true }))
  assert.ok(Z.hitShape(a, 'Engine room', 20, 10))
  assert.equal(Z.pickShape([a, b], name, 250, 150), null)
  assert.equal(Z.pickShape([a, b], name, 250, 52).zoneId, 'b')
  assert.equal(Z.pickShape([a, b], name, 250, 150, 'b').zoneId, 'b')
  assert.equal(Z.pickShape([a, b], name, 5, 100).zoneId, 'a')
  assert.ok(Z.insideShape(b, 250, 150))
  assert.equal(Z.insideShape(b, 105, 55), false)
})

test('addableZones lists the zones without a shape; withShape replaces instead of duplicating', () => {
  const zones = [{ id: 'b', name: 'Bilge' }, { id: 'a', name: 'Aft' }, { id: 'c', name: 'Cabin' }]
  const shapes = [{ zoneId: 'c', kind: 'rect', x: 0, y: 0, width: 1, height: 1 }]
  assert.deepEqual(Z.addableZones(zones, shapes).map((z) => z.id), ['a', 'b'])
  const moved = { ...shapes[0], x: 9 }
  assert.deepEqual(Z.withShape(shapes, moved), [moved])
  assert.equal(Z.withShape(shapes, { ...moved, zoneId: 'a' }).length, 2)
})

test('the shape layer is below bands, wires, devices and tabs and the router never sees shapes', async () => {
  const { readFileSync } = await import('node:fs')
  const view = readFileSync(new URL('../public/schematicView.js', import.meta.url), 'utf8')
  const svg = view.slice(view.indexOf('<svg ref=${svgRef}'))
  const at = (s) => svg.indexOf(s)
  assert.ok(at('<${ZoneShapes') > 0 && at('<${ZoneShapes') < at('<${ConduitBand'))
  assert.ok(at('<${ConduitBand') < at('<${WireShape'))
  assert.ok(at('<${WireShape') < at('<${DeviceShape'))
  const routeCall = view.slice(view.indexOf('G.routeSchematicPage({'), view.indexOf('legacy: G.wirePath'))
  assert.ok(!/shape/i.test(routeCall))
})
