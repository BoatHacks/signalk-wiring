import { test } from 'node:test'
import assert from 'node:assert/strict'
import dagre from '../public/vendor/dagre.esm.js'
import * as L from '../public/schematicLayout.js'
import * as S from '../public/schematic.js'

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

// ---- Plan 0025: two-stage Auto-arrange ----

test('arrangeStage: the first click arranges and arms, the second is the full arrange and clears bends and tabs', () => {
  const first = L.arrangeStage({ armed: false }, 'click')
  assert.deepEqual(first, { armed: true, label: 'Arrange everything', full: false, clear: { bends: false, tabs: false } })
  const second = L.arrangeStage(first, 'click')
  assert.equal(second.full, true)
  assert.deepEqual(second.clear, { bends: true, tabs: true })
  assert.equal(second.armed, false)
  assert.equal(second.label, 'Auto-arrange')
  assert.equal(L.arrangeStage(undefined, 'click').full, false)
})

test('arrangeStage: any edit puts the label back and the next click is stage one again', () => {
  const armed = L.arrangeStage({ armed: false }, 'click')
  const edited = L.arrangeStage(armed, 'edit')
  assert.deepEqual(edited, { armed: false, label: 'Auto-arrange', full: false, clear: { bends: false, tabs: false } })
  assert.equal(L.arrangeStage(edited, 'click').full, false)
})

// ---- Hand-placed devices and Auto-arrange stage one (plan 0028) ----

test('arrangeFree: hand-placed devices keep their spot, the others follow the layout in their frame', () => {
  const auto = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, c: { x: 300, y: 100 }, d: { x: 600, y: 0 } }
  const current = { a: { x: 1000, y: 500 }, b: { x: 40, y: 40 }, c: { x: 40, y: 40 }, d: { x: 7, y: 7 } }
  const out = L.arrangeFree(auto, current, ['a'])
  assert.deepEqual(out.a, { x: 1000, y: 500 })
  // the others move by the same shift as a (1000, 500)
  assert.deepEqual(out.b, { x: 1300, y: 500 })
  assert.deepEqual(out.c, { x: 1300, y: 600 })
  assert.deepEqual(out.d, { x: 1600, y: 500 })
})

test('arrangeFree: nothing fixed gives the auto layout, a fixed id that is not on the page is ignored', () => {
  const auto = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }
  assert.deepEqual(L.arrangeFree(auto, { a: { x: 9, y: 9 }, b: { x: 9, y: 9 } }, []), auto)
  assert.deepEqual(L.arrangeFree(auto, { a: { x: 9, y: 9 } }, ['gone']), auto)
  const all = L.arrangeFree(auto, { a: { x: 9, y: 9 }, b: { x: 5, y: 5 } }, ['a', 'b'])
  assert.deepEqual(all, { a: { x: 9, y: 9 }, b: { x: 5, y: 5 } })
})

test('stage one of Auto-arrange keeps marked devices fixed through the overlap pass too', () => {
  const dev = (id, role) => ({ id, role, terminals: [] })
  const devices = [dev('a', 'source'), dev('b', 'consumer'), dev('c', 'consumer')]
  const auto = L.autoLayout(dagre, devices, [{ id: 'k1', fromDeviceId: 'a', toDeviceId: 'b', status: 'active' }, { id: 'k2', fromDeviceId: 'a', toDeviceId: 'c', status: 'active' }])
  const current = { a: { x: 500, y: 500 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } }
  const merged = L.arrangeFree(auto, current, ['b'])
  const boxes = devices.map((d) => ({ ...S.deviceBox(d, merged[d.id]) }))
  const moved = L.resolveOverlaps(boxes, [], L.OVERLAP_MARGIN, ['a', 'c'])
  assert.equal(moved.b, undefined)
  assert.deepEqual(merged.b, { x: 0, y: 0 })
})
