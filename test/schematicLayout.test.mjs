import { test } from 'node:test'
import assert from 'node:assert/strict'
import dagre from '../public/vendor/dagre.esm.js'
import * as L from '../public/schematicLayout.js'

const r = (id, x, y, w = 150, h = 46) => ({ id, x, y, w, h })
const clash = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y

test('resolveOverlaps: a box dropped on another moves to a free spot with the margin', () => {
  const moved = L.resolveOverlaps([r('a', 0, 0), r('b', 20, 10)])
  assert.deepEqual(Object.keys(moved), ['b'])
  assert.equal(clash({ ...r('b'), ...moved.b }, r('a', 0, 0), L.OVERLAP_MARGIN), false)
  assert.ok(Math.hypot(moved.b.x - 20, moved.b.y - 10) < 220)
})

test('resolveOverlaps: a box on a stub tab moves; its own tab is ignored; several at once', () => {
  const tab = { x: 0, y: 0, w: 130, h: 20, deviceId: 'z' }
  assert.ok(L.resolveOverlaps([r('a', 10, 5)], [tab]).a)
  assert.equal(L.resolveOverlaps([r('a', 10, 5)], [{ ...tab, deviceId: 'a' }]).a, undefined)
  const boxes = [r('a', 0, 0), r('b', 0, 0), r('c', 0, 0), r('d', 0, 0)]
  const moved = L.resolveOverlaps(boxes)
  const final = boxes.map((b) => ({ ...b, ...(moved[b.id] || {}) }))
  for (let i = 0; i < final.length; i++) for (let j = i + 1; j < final.length; j++) assert.equal(clash(final[i], final[j], L.OVERLAP_MARGIN), false)
})

test('resolveOverlaps: movable limits what moves, clean layouts stay put', () => {
  const moved = L.resolveOverlaps([r('a', 0, 0), r('b', 10, 10)], [], 24, ['a'])
  assert.deepEqual(Object.keys(moved), ['a'])
  assert.deepEqual(L.resolveOverlaps([r('a', 0, 0), r('b', 400, 0)]), {})
  assert.equal(L.findOverlaps([r('a', 0, 0), r('b', 10, 10), r('c', 500, 0)]).length, 1)
})

test('rankGap: ordered by length, clamped, default for no length', () => {
  assert.ok(L.rankGap(0.3) < L.rankGap(10))
  assert.equal(L.rankGap(0), L.GAP_MIN)
  assert.equal(L.rankGap(1e6), L.GAP_MAX)
  assert.equal(L.rankGap(null), L.rankGap(1))
})

const dev = (id) => ({ id, role: 'consumer', terminals: [] })

test('autoLayout: longer cables give wider rank gaps, no overlaps', () => {
  const devices = ['a', 'b', 'c'].map(dev)
  const gap = (len) => {
    const pos = L.autoLayout(dagre, devices, [
      { id: '1', fromDeviceId: 'a', toDeviceId: 'b', length: 0.3 },
      { id: '2', fromDeviceId: 'b', toDeviceId: 'c', length: len }
    ])
    return pos.c.x - (pos.b.x + 150)
  }
  assert.ok(gap(10) > gap(0.3))
  assert.ok(gap(1000) <= L.GAP_MAX)
  const pos = L.autoLayout(dagre, devices, [{ id: '1', fromDeviceId: 'a', toDeviceId: 'b' }, { id: '2', fromDeviceId: 'a', toDeviceId: 'c' }])
  assert.equal(pos.b.x - (pos.a.x + 150), L.rankGap(null))
  const boxes = devices.map((d) => ({ id: d.id, x: pos[d.id].x, y: pos[d.id].y, w: 150, h: 46 }))
  assert.deepEqual(L.findOverlaps(boxes), [])
})
