import { test } from 'node:test'
import assert from 'node:assert/strict'
import { busRoutePoints, unroutedBuses, busTapMarks } from '../public/floorplan.js'

const dev = (id, x, y) => ({ id, posX: x, posY: y, posZ: 0 })
const devices = new Map([dev('a', 1, 1), dev('b', 9, 1), dev('c', 5, 1), { id: 'u' }].map((d) => [d.id, d]))
const bus = { id: 'bb', name: 'M', status: 'active', length: 8, lengthUnit: 'm', route: [{ x: 1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, { x: 9, y: 1, z: 0 }], taps: [
  { deviceId: 'a', along: 0 }, { deviceId: 'c', along: 4 }, { deviceId: 'b', along: 8 }] }

test('a backbone with no route has no points', () => {
  assert.deepEqual(busRoutePoints({ ...bus, route: null }, devices), { points: [], startOffset: 0, endDerived: false })
})

test('the ends follow the tap devices at 0 and at the full length', () => {
  const r = busRoutePoints({ ...bus, route: [{ x: 3, y: 3, z: 0 }] }, devices)
  assert.equal(r.startOffset, 1)
  assert.equal(r.endDerived, true)
  assert.equal(r.points.length, 3)
  assert.equal(r.points[0].x, 1)
  assert.equal(r.points[2].x, 9)
})

test('no derived end when the tap is not at an end or the device is not placed', () => {
  const mid = busRoutePoints({ ...bus, taps: [{ deviceId: 'a', along: 1 }, { deviceId: 'b', along: 7 }] }, devices)
  assert.equal(mid.startOffset, 0)
  assert.equal(mid.endDerived, false)
  const unplaced = busRoutePoints({ ...bus, taps: [{ deviceId: 'u', along: 0 }] }, devices)
  assert.equal(unplaced.startOffset, 0)
})

test('unrouted backbones are the live ones without a route', () => {
  const list = [bus, { id: 'x', status: 'active', route: [] }, { id: 'y', status: 'active' }, { id: 'z', status: 'removed', route: null }]
  assert.deepEqual(unroutedBuses(list).map((b) => b.id), ['x', 'y'])
})

test('tap marks sit at their fraction of the line, or are spread evenly', () => {
  const marks = busTapMarks(bus, [[0, 0], [100, 0]])
  assert.deepEqual(marks.map((m) => m.px), [[0, 0], [50, 0], [100, 0]])
  const bent = busTapMarks({ length: 20, taps: [{ deviceId: 'a', along: 10 }] }, [[0, 0], [10, 0], [10, 10]])
  assert.deepEqual(bent[0].px, [10, 0])
  const even = busTapMarks({ taps: [{ deviceId: 'a' }, { deviceId: 'b' }, { deviceId: 'c' }] }, [[0, 0], [20, 0]])
  assert.deepEqual(even.map((m) => m.px[0]), [0, 10, 20])
  assert.deepEqual(busTapMarks(bus, [[0, 0]]), [])
})
