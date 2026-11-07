import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  axesForView, calibrationFromClicks, pxToMeters, metersToPx, applyClick,
  waypointFromClick, routeLength, resolveRouteStart, planShowsPoint, parseSvgSize
} from '../public/floorplan.js'

const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not near ${expected}`)

test('axes per view', () => {
  assert.deepEqual(axesForView('top'), ['x', 'y'])
  assert.deepEqual(axesForView('side'), ['x', 'z'])
  assert.throws(() => axesForView('front'))
})

test('calibration: scale comes from the clicked distance', () => {
  const cal = calibrationFromClicks([100, 400], [300, 400], 10)
  assert.equal(cal.pxPerMeter, 20)
  assert.deepEqual(pxToMeters(cal, [100, 400]), [0, 0])
  const [a, b] = pxToMeters(cal, [300, 400])
  near(a, 10)
  near(b, 0)
})

test('calibration: the second axis points up the screen, flip reverses it', () => {
  const cal = calibrationFromClicks([100, 400], [300, 400], 10)
  const [, up] = pxToMeters(cal, [100, 300])
  near(up, 5)
  const flipped = calibrationFromClicks([100, 400], [300, 400], 10, { flip: true })
  const [, down] = pxToMeters(flipped, [100, 300])
  near(down, -5)
})

test('calibration: a drawing with the boat axis pointing down the page', () => {
  const cal = calibrationFromClicks([50, 50], [50, 250], 4) // 50 px per meter
  const [a, b] = pxToMeters(cal, [50, 150])
  near(a, 2)
  near(b, 0)
})

test('px to meters and back round-trips, both views and a rotated axis', () => {
  for (const [origin, axisPt, flip] of [
    [[10, 20], [110, 20], false],
    [[10, 20], [10, 220], true],
    [[200, 200], [260, 140], false]
  ]) {
    const cal = calibrationFromClicks(origin, axisPt, 3, { flip })
    const [a, b] = pxToMeters(cal, [123.4, 77.7])
    const [px, py] = metersToPx(cal, a, b)
    near(px, 123.4, 1e-6)
    near(py, 77.7, 1e-6)
  }
})

test('calibration rejects identical points and a non-positive distance', () => {
  assert.throws(() => calibrationFromClicks([5, 5], [5, 5], 3))
  assert.throws(() => calibrationFromClicks([0, 0], [5, 5], 0))
})

test('a click sets the view axes and leaves the third alone', () => {
  const pos = { x: 1, y: 2, z: 3 }
  assert.deepEqual(applyClick(pos, 'top', 9, 8), { x: 9, y: 8, z: 3 })
  assert.deepEqual(applyClick(pos, 'side', 9, 8), { x: 9, y: 2, z: 8 })
})

test('a click on an unplaced device half-places it', () => {
  assert.deepEqual(applyClick(null, 'top', 4, 1), { x: 4, y: 1, z: null })
  assert.deepEqual(applyClick({ x: null, y: null, z: null }, 'side', 4, 1), { x: 4, y: null, z: 1 })
})

test('a waypoint inherits the missing axis from the previous point', () => {
  assert.deepEqual(waypointFromClick({ x: 0, y: 0, z: 1.5 }, 'top', 2, 1), { x: 2, y: 1, z: 1.5 })
  assert.deepEqual(waypointFromClick(null, 'top', 2, 1), { x: 2, y: 1, z: null })
})

test('route length: 3D polyline', () => {
  const r = routeLength([{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 12 }])
  assert.equal(r.length, 17)
  assert.equal(r.complete, true)
})

test('route length: empty and one-point routes are zero and complete', () => {
  assert.deepEqual(routeLength([]), { length: 0, complete: true })
  assert.deepEqual(routeLength(null), { length: 0, complete: true })
  assert.deepEqual(routeLength([{ x: 1, y: 1, z: 1 }]), { length: 0, complete: true })
})

test('route length: unset axes give a lower bound and mark it incomplete', () => {
  const r = routeLength([{ x: 0, y: 0, z: null }, { x: 3, y: 4, z: null }])
  assert.equal(r.length, 5)
  assert.equal(r.complete, false)
})

const devices = new Map([
  ['pump', { id: 'pump', status: 'active', posX: 1, posY: 2, posZ: 0.5 }],
  ['gone', { id: 'gone', status: 'removed', posX: 9, posY: 9, posZ: 9 }],
  ['loose', { id: 'loose', status: 'active', posX: null, posY: null, posZ: null }],
  ['panel', { id: 'panel', status: 'active', posX: 5, posY: 0, posZ: 1 }]
])

test('route start: from-device first, then the circuit panel, then nothing', () => {
  const circuit = { panelDeviceId: 'panel' }
  assert.deepEqual(resolveRouteStart({ fromEndpoint: 'pump' }, circuit, devices), { x: 1, y: 2, z: 0.5 })
  assert.deepEqual(resolveRouteStart({ fromEndpoint: 'F12' }, circuit, devices), { x: 5, y: 0, z: 1 })
  assert.equal(resolveRouteStart({ fromEndpoint: 'F12' }, { panelDeviceId: null }, devices), null)
})

test('route start: a removed or unplaced device falls back cleanly', () => {
  const circuit = { panelDeviceId: 'panel' }
  assert.deepEqual(resolveRouteStart({ fromEndpoint: 'gone' }, circuit, devices), { x: 5, y: 0, z: 1 })
  assert.deepEqual(resolveRouteStart({ fromEndpoint: 'loose' }, circuit, devices), { x: 5, y: 0, z: 1 })
  assert.equal(resolveRouteStart({ fromEndpoint: 'loose' }, { panelDeviceId: 'gone' }, devices), null)
  assert.equal(resolveRouteStart({ fromEndpoint: 'loose' }, { panelDeviceId: 'missing' }, devices), null)
  assert.equal(resolveRouteStart({ fromEndpoint: 'loose' }, null, devices), null)
})

test('deck plans show only their height range', () => {
  const deck = { view: 'top', zMin: 0.5, zMax: 2.5 }
  assert.equal(planShowsPoint(deck, { z: 1 }), true)
  assert.equal(planShowsPoint(deck, { z: 0.5 }), true)
  assert.equal(planShowsPoint(deck, { z: 3 }), false)
  assert.equal(planShowsPoint(deck, { z: 0 }), false)
  assert.equal(planShowsPoint(deck, { z: null }), true)
  assert.equal(planShowsPoint({ view: 'top' }, { z: 99 }), true)
  assert.equal(planShowsPoint({ view: 'top', zMin: 1 }, { z: 99 }), true)
  assert.equal(planShowsPoint({ view: 'side', zMin: 1, zMax: 2 }, { z: 99 }), true)
})

test('svg size: viewBox, falling back to width and height, else null', () => {
  assert.deepEqual(parseSvgSize('<svg xmlns="x" viewBox="0 0 1200 400"></svg>'), { x: 0, y: 0, width: 1200, height: 400 })
  assert.deepEqual(parseSvgSize("<svg viewBox='-10,-5,100,50'>"), { x: -10, y: -5, width: 100, height: 50 })
  assert.deepEqual(parseSvgSize('<svg width="800px" height="300">'), { x: 0, y: 0, width: 800, height: 300 })
  assert.equal(parseSvgSize('<svg width="10cm" height="5cm">'), null)
  assert.equal(parseSvgSize('<svg viewBox="0 0 0 0">'), null)
  assert.equal(parseSvgSize('<svg>'), null)
  assert.equal(parseSvgSize('not svg'), null)
})

import {
  pointToPx, moveWaypoint, removeWaypoint, routePoints, circuitMembers, metersToLengthUnit
} from '../public/floorplan.js'

test('pointToPx needs both of the view axes', () => {
  const cal = calibrationFromClicks([0, 100], [100, 100], 10) // 10 px per meter, up is -y
  assert.deepEqual(pointToPx(cal, 'top', { x: 2, y: 1, z: null }).map(Math.round), [20, 90])
  assert.deepEqual(pointToPx(cal, 'side', { x: 2, y: null, z: 3 }).map(Math.round), [20, 70])
  assert.equal(pointToPx(cal, 'top', { x: 2, y: null, z: 3 }), null)
  assert.equal(pointToPx(cal, 'side', null), null)
})

test('moveWaypoint changes only the clicked axes of one point and does not mutate', () => {
  const route = [{ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }]
  const moved = moveWaypoint(route, 1, 'side', 5, 2)
  assert.deepEqual(moved, [{ x: 0, y: 0, z: 1 }, { x: 5, y: 1, z: 2 }])
  assert.deepEqual(route[1], { x: 1, y: 1, z: 1 })
})

test('removeWaypoint drops one point and tolerates the last index', () => {
  const route = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]
  assert.deepEqual(removeWaypoint(route, 1).map((p) => p.x), [0, 2])
  assert.equal(removeWaypoint(route, 2).length, 2)
  assert.deepEqual(removeWaypoint([], 0), [])
})

test('routePoints prepends the resolved start and copes with no route', () => {
  const circuit = { panelDeviceId: 'panel' }
  const run = { fromEndpoint: 'pump', route: [{ x: 2, y: 2, z: 0.5 }] }
  assert.deepEqual(routePoints(run, circuit, devices), [{ x: 1, y: 2, z: 0.5 }, { x: 2, y: 2, z: 0.5 }])
  assert.deepEqual(routePoints({ fromEndpoint: 'F12' }, { panelDeviceId: null }, devices), [])
  assert.deepEqual(routePoints({ fromEndpoint: 'F12', route: [{ x: 1 }] }, { panelDeviceId: null }, devices), [{ x: 1, y: null, z: null }])
})

test('circuitMembers collects devices and runs, skipping removed runs, adding the panel', () => {
  const circuit = { id: 'c1', panelDeviceId: 'panel' }
  const runs = [
    { id: 'r1', circuitId: 'c1', fromEndpoint: 'F12', toEndpoint: 'pump', status: 'active' },
    { id: 'r2', circuitId: 'c1', fromEndpoint: 'pump', toEndpoint: 'old', status: 'removed' },
    { id: 'r3', circuitId: 'c2', fromEndpoint: 'x', toEndpoint: 'y', status: 'active' }
  ]
  const m = circuitMembers(circuit, runs)
  assert.deepEqual([...m.runIds], ['r1'])
  assert.deepEqual([...m.deviceIds].sort(), ['F12', 'panel', 'pump'])
})

test('metersToLengthUnit converts to feet and rounds', () => {
  assert.equal(metersToLengthUnit(3.14159, 'm'), 3.14)
  assert.equal(metersToLengthUnit(3.14159, undefined), 3.14)
  assert.equal(metersToLengthUnit(1, 'ft'), 3.28)
})
