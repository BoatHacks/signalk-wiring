import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  axesForView, calibrationFromClicks, pxToMeters, metersToPx, applyClick,
  waypointFromClick, routeLength, resolveRouteStart, planShowsPoint, parseSvgSize,
  conduitRoutePoints, unroutedCables, conduitMembers, effectiveCableRoute
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

test('route start: the from-device when placed, else nothing', () => {
  assert.deepEqual(resolveRouteStart({ fromDeviceId: 'pump' }, null, devices), { x: 1, y: 2, z: 0.5 })
  assert.equal(resolveRouteStart({ fromDeviceId: 'F12' }, null, devices), null)
})

test('route start: a removed or unplaced device gives nothing', () => {
  assert.equal(resolveRouteStart({ fromDeviceId: 'gone' }, null, devices), null)
  assert.equal(resolveRouteStart({ fromDeviceId: 'loose' }, null, devices), null)
  assert.equal(resolveRouteStart({}, null, devices), null)
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
  const run = { fromDeviceId: 'pump', route: [{ x: 2, y: 2, z: 0.5 }] }
  assert.deepEqual(routePoints(run, null, devices), [{ x: 1, y: 2, z: 0.5 }, { x: 2, y: 2, z: 0.5 }])
  assert.deepEqual(routePoints({ fromDeviceId: 'F12' }, null, devices), [])
  assert.deepEqual(routePoints({ fromDeviceId: 'F12', route: [{ x: 1 }] }, null, devices), [{ x: 1, y: null, z: null }])
})

test('circuitMembers takes the derived cables and devices, skipping removed runs', () => {
  const circuit = { id: 'c1', derived: { cableIds: ['r1', 'r2'], returnCableIds: ['r4'], deviceIds: ['F12', 'pump', 'panel'] } }
  const runs = [
    { id: 'r1', fromDeviceId: 'F12', toDeviceId: 'pump', status: 'active' },
    { id: 'r2', fromDeviceId: 'pump', toDeviceId: 'old', status: 'removed' },
    { id: 'r3', fromDeviceId: 'x', toDeviceId: 'y', status: 'active' },
    { id: 'r4', fromDeviceId: 'bus', toDeviceId: 'pump', status: 'active' }
  ]
  const m = circuitMembers(circuit, runs)
  assert.deepEqual([...m.runIds].sort(), ['r1', 'r4'])
  assert.deepEqual([...m.deviceIds].sort(), ['F12', 'bus', 'panel', 'pump'])
  assert.equal(circuitMembers({ derived: null }, runs).runIds.size, 0)
})

test('metersToLengthUnit converts to feet and rounds', () => {
  assert.equal(metersToLengthUnit(3.14159, 'm'), 3.14)
  assert.equal(metersToLengthUnit(3.14159, undefined), 3.14)
  assert.equal(metersToLengthUnit(1, 'ft'), 3.28)
})

import { lengthDirection } from '../public/floorplan.js'

test('lengthDirection says which way x (toward the bow) points on the drawing', () => {
  assert.equal(lengthDirection(calibrationFromClicks([0, 100], [200, 100], 10)), 'right')
  assert.equal(lengthDirection(calibrationFromClicks([200, 100], [0, 100], 10)), 'left')
  assert.equal(lengthDirection(calibrationFromClicks([50, 200], [50, 0], 10)), 'up')
  assert.equal(lengthDirection(calibrationFromClicks([50, 0], [50, 200], 10)), 'down')
  // A slightly tilted drawing still reads by its dominant direction.
  assert.equal(lengthDirection(calibrationFromClicks([0, 0], [-200, 10], 10)), 'left')
})

import { arrowHeadPoints } from '../public/floorplan.js'

test('arrowHeadPoints puts the tip at the end of the line, pointing along it', () => {
  const [tip, left, right] = arrowHeadPoints([0, 0], [10, 0], 4)
  assert.deepEqual(tip, [10, 0])
  // The base sits back along the line, symmetric about it.
  assert.ok(left[0] < 10 && right[0] < 10)
  near(left[0], right[0])
  near(left[1], -right[1])
  // The base is `size` back from the tip and `size` wide.
  near(left[0], 6)
  near(Math.abs(left[1]), 2)
})

test('arrowHeadPoints follows a diagonal line and survives a zero-length one', () => {
  const [tip] = arrowHeadPoints([0, 0], [3, 4], 2)
  assert.deepEqual(tip, [3, 4])
  assert.deepEqual(arrowHeadPoints([5, 5], [5, 5], 2).flat(), [5, 5, 5, 5, 5, 5])
})

// Conduits (plan 0015)

const pt = (x, y, z = null) => ({ x, y, z })

test('a conduit route is just its stored points, with no derived start', () => {
  assert.deepEqual(conduitRoutePoints({ route: [pt(0, 0), { x: 1 }] }), [pt(0, 0), pt(1, null)])
  assert.deepEqual(conduitRoutePoints({ route: null }), [])
  assert.deepEqual(conduitRoutePoints({}), [])
})

test('unrouted cables: no own route and no drawn conduit', () => {
  const drawn = { id: 'k1', status: 'active', route: [pt(0, 0), pt(1, 0)] }
  const bare = { id: 'k2', status: 'active', route: null }
  const removedDrawn = { id: 'k3', status: 'removed', route: [pt(0, 0), pt(1, 0)] }
  const runs = [
    { id: 'own', status: 'active', route: [pt(0, 0)], conduitIds: [] },
    { id: 'inDrawn', status: 'active', route: null, conduitIds: ['k1'] },
    { id: 'inBare', status: 'active', route: null, conduitIds: ['k2'] },
    { id: 'inRemoved', status: 'active', route: [], conduitIds: ['k3'] },
    { id: 'nothing', status: 'active' },
    { id: 'gone', status: 'removed', route: null, conduitIds: [] }
  ]
  assert.deepEqual(unroutedCables(runs, [drawn, bare, removedDrawn]).map((r) => r.id), ['inBare', 'inRemoved', 'nothing'])
})

test('conduit members are its live cables and their ends, for highlighting', () => {
  const conduit = { id: 'k1', cableIds: ['a', 'b', 'c'] }
  const runs = [
    { id: 'a', status: 'active', fromDeviceId: 'd1', toDeviceId: 'd2' },
    { id: 'b', status: 'removed', fromDeviceId: 'd3', toDeviceId: 'd4' },
    { id: 'z', status: 'active', fromDeviceId: 'd9', toDeviceId: 'd8' }
  ]
  const { runIds, deviceIds } = conduitMembers(conduit, runs)
  assert.deepEqual([...runIds], ['a'])
  assert.deepEqual([...deviceIds].sort(), ['d1', 'd2'])
})

// Effective route of a cable (plan 0015)

const conduitMap = (...list) => new Map(list.map((c) => [c.id, c]))
const straight = (id, x1, x2, extra = {}) =>
  ({ id, status: 'active', route: [pt(x1, 0, 0), pt(x2, 0, 0)], ...extra })

test('effective route: a cable wholly in one conduit follows it, with its length', () => {
  const k1 = straight('k1', 0, 4)
  const result = effectiveCableRoute({ id: 'w', conduitIds: ['k1'] }, null, new Map(), conduitMap(k1))
  assert.equal(result.source, 'conduits')
  assert.deepEqual(result.points, [pt(0, 0, 0), pt(4, 0, 0)])
  near(result.length, 4)
  assert.equal(result.complete, true)
})

test('effective route: two conduits in sequence are chained, the second turned to meet the first', () => {
  const k1 = straight('k1', 0, 4)
  const k2 = straight('k2', 10, 5) // drawn the other way round
  const result = effectiveCableRoute({ id: 'w', conduitIds: ['k1', 'k2'] }, null, new Map(), conduitMap(k1, k2))
  assert.deepEqual(result.points.map((p) => p.x), [0, 4, 5, 10])
  near(result.length, 4 + 1 + 5) // two conduits plus the 1 m link between them
  assert.equal(result.source, 'conduits')
})

test('effective route: the first conduit is turned toward the cable start device or the second conduit', () => {
  const k1 = straight('k1', 4, 0) // drawn away from the start
  const devices = new Map([['d1', { id: 'd1', status: 'active', posX: 0, posY: 0, posZ: 0 }]])
  const byDevice = effectiveCableRoute({ id: 'w', fromDeviceId: 'd1', conduitIds: ['k1'] }, null, devices, conduitMap(k1))
  assert.deepEqual(byDevice.points.map((p) => p.x), [0, 4])

  const k2 = straight('k2', 10, 20)
  const byNext = effectiveCableRoute({ id: 'w', conduitIds: ['k1', 'k2'] }, null, new Map(), conduitMap(k1, k2))
  assert.deepEqual(byNext.points.map((p) => p.x), [0, 4, 10, 20])
})

test('effective route: a cable with its own route keeps it, whatever conduits it is in', () => {
  const k1 = straight('k1', 0, 4)
  const run = { id: 'w', route: [pt(1, 1, 0), pt(2, 1, 0)], conduitIds: ['k1'] }
  const result = effectiveCableRoute(run, null, new Map(), conduitMap(k1))
  assert.equal(result.source, 'own')
  assert.deepEqual(result.points, [pt(1, 1, 0), pt(2, 1, 0)])
  near(result.length, 1)
})

test('effective route: a cable in no drawn conduit and with no route has nothing', () => {
  const bare = { id: 'k2', status: 'active', route: null }
  const removed = straight('k3', 0, 5, { status: 'removed' })
  for (const run of [{ id: 'w' }, { id: 'w', conduitIds: ['k2', 'k3', 'missing'] }]) {
    const result = effectiveCableRoute(run, null, new Map(), conduitMap(bare, removed))
    assert.equal(result.source, 'none')
    assert.deepEqual(result.points, [])
    assert.equal(result.length, 0)
  }
})

test('effective route: an undrawn conduit is skipped and the route is marked incomplete', () => {
  const k1 = straight('k1', 0, 4)
  const bare = { id: 'k2', status: 'active', route: [] }
  const result = effectiveCableRoute({ id: 'w', conduitIds: ['k1', 'k2'] }, null, new Map(), conduitMap(k1, bare))
  assert.equal(result.source, 'conduits')
  assert.equal(result.complete, false)
  near(result.length, 4)
})

test('effective route: unset heights make the length a lower bound', () => {
  const k1 = { id: 'k1', status: 'active', route: [pt(0, 0), pt(3, 4)] }
  const result = effectiveCableRoute({ id: 'w', conduitIds: ['k1'] }, null, new Map(), conduitMap(k1))
  near(result.length, 5)
  assert.equal(result.complete, false)
})
