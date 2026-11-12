import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as N from '../public/snapGrid.js'
import { moveSegment, STUB } from '../public/schematic.js'

test('snapValue and snapPoint round to the 16 unit grid', () => {
  assert.equal(N.GRID, 16)
  assert.equal(N.snapValue(0), 0)
  assert.equal(N.snapValue(7), 0)
  assert.equal(N.snapValue(8), 16)
  assert.equal(N.snapValue(23), 16)
  assert.equal(N.snapValue(-7), 0)
  assert.ok(Object.is(N.snapValue(-3), 0))
  assert.equal(N.snapValue(-9), -16)
  assert.equal(N.snapValue(50, 10), 50)
  assert.deepEqual(N.snapPoint({ x: 101, y: 37 }), { x: 96, y: 32 })
})

test('snapActive: Alt flips the choice', () => {
  assert.equal(N.snapActive(true, false), true)
  assert.equal(N.snapActive(true, true), false)
  assert.equal(N.snapActive(false, false), false)
  assert.equal(N.snapActive(false, true), true)
  assert.equal(N.snapActive(true, undefined), true)
})

const store = (initial = {}) => {
  const m = { ...initial }
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, m }
}

test('snap setting: default on, round trip, storage that throws', () => {
  assert.equal(N.readSnap(store()), true)
  const s = store()
  N.writeSnap(false, s)
  assert.equal(N.readSnap(s), false)
  N.writeSnap(true, s)
  assert.equal(N.readSnap(s), true)
  const bad = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } }
  assert.equal(N.readSnap(bad), true)
  assert.doesNotThrow(() => N.writeSnap(false, bad))
  // no storage at all (Node has none): default on, writing is harmless
  assert.equal(N.readSnap(), true)
  assert.doesNotThrow(() => N.writeSnap(false))
})

test('snapCorner snaps the top-left corner, not the pointer', () => {
  // pointer at 205, 117, grabbed 70 right and 20 below the corner: corner at 135, 97
  assert.deepEqual(N.snapCorner({ x: 205, y: 117 }, 70, 20), { x: 128, y: 96 })
})

test('snapSegmentDelta puts a dragged segment on the grid', () => {
  assert.equal(N.snapSegmentDelta(50, 30), 30) // 80 is on the grid
  assert.equal(N.snapSegmentDelta(50, 20), 14) // 70 -> 64
  assert.equal(N.snapSegmentDelta(48, -7), 0) // 41 -> 48
})

test('a snapped segment move stays orthogonal and lands on the grid', () => {
  const P = (l) => l.map(([x, y]) => ({ x, y }))
  const path = P([[0, 0], [30, 0], [30, 50], [100, 50], [100, 20], [150, 20]])
  const out = moveSegment(path, 2, N.snapSegmentDelta(50, 19))
  assert.equal(out[2].y, 64)
  assert.equal(out[3].y, 64)
  for (let i = 0; i < out.length - 1; i++) assert.ok(out[i].x === out[i + 1].x || out[i].y === out[i + 1].y)
  const vert = P([[0, 0], [20, 0], [20, 60], [80, 60], [80, 100], [100, 100]])
  const v = moveSegment(vert, 1, N.snapSegmentDelta(20, 13))
  assert.equal(v[1].x, 32)
  assert.equal(v[2].x, 32)
  for (let i = 0; i < v.length - 1; i++) assert.ok(v[i].x === v[i + 1].x || v[i].y === v[i + 1].y)
  // an end segment (leg) moves too and stays orthogonal
  const end = moveSegment(P([[0, 0], [200, 0]]), 0, N.snapSegmentDelta(0, 11))
  assert.ok(STUB > 0)
  for (let i = 0; i < end.length - 1; i++) assert.ok(end[i].x === end[i + 1].x || end[i].y === end[i + 1].y)
})

test('snapMoveShape lands the box top-left on the grid, a polygon follows', () => {
  const rect = { zoneId: 'z', kind: 'rect', x: 10, y: 10, width: 240, height: 160 }
  const m = N.snapMoveShape(rect, 21, 5)
  assert.deepEqual([m.x, m.y, m.width, m.height], [32, 16, 240, 160])
  const poly = { zoneId: 'z', kind: 'polygon', x: 10, y: 10, width: 100, height: 100, points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 60, y: 110 }] }
  const pm = N.snapMoveShape(poly, 21, 5)
  assert.deepEqual([pm.x, pm.y], [32, 16])
  assert.deepEqual(pm.points[0], { x: 32, y: 16 })
})

test('snapResizeShape snaps the dragged edges', () => {
  const s = { zoneId: 'z', kind: 'rect', x: 32, y: 32, width: 240, height: 160 }
  const r = N.snapResizeShape(s, 'se', 301, 219)
  assert.deepEqual([r.x, r.y, r.width, r.height], [32, 32, 272, 192])
  const w = N.snapResizeShape(s, 'w', 5, 100)
  assert.deepEqual([w.x, w.width], [0, 272])
})

test('snapResizeShape with Shift keeps a square and follows the shorter side', () => {
  const s = { zoneId: 'z', kind: 'rect', x: 32, y: 32, width: 96, height: 96 }
  const r = N.snapResizeShape(s, 'se', 300, 200, true)
  assert.equal(r.width, r.height)
  assert.equal(r.width, 176) // shorter side: snapped 208 - 32
  const nw = N.snapResizeShape(s, 'nw', 0, 16, true)
  assert.equal(nw.width, nw.height)
  assert.equal(nw.x + nw.width, 128)
})
