import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calibrationFromClicks, cornerArrows, routeEndAction, routeWithEnd, continuationMarks,
  escapeStep, deleteStep, effectiveCableRoute, routeLength
} from '../public/floorplan.js'

const cal = calibrationFromClicks([0, 100], [100, 100], 10) // 10 px per meter, x to the right, second axis up
const plan = (id, name, over = {}) => ({ id, name, view: 'top', calibration: cal, status: 'active', ...over })
const main = plan('main', 'Main deck', { zMin: 0, zMax: 2 })
const lower = plan('lower', 'Lower deck', { zMin: -3, zMax: 0 })
const lowest = plan('lowest', 'Another deck', { zMin: -6, zMax: 0 })

test('cornerArrows: unit directions scaled to the length, independent of any zoom', () => {
  const a = cornerArrows(cal, 20)
  assert.deepEqual(a.bow.to, [20, 0])
  assert.deepEqual(a.up.to, [0, -20])
  assert.equal(a.bow.head.length, 3)
  const flipped = cornerArrows(calibrationFromClicks([0, 0], [0, 50], 5), 10)
  assert.deepEqual(flipped.bow.to, [0, 10])
})

test('routeEndAction: no To device selects, the To device finishes, others hint', () => {
  const to = { id: 'b', name: 'Pump', posX: 3, posY: 1, posZ: 0.5 }
  const other = { id: 'c', name: 'Light', posX: 1, posY: 1, posZ: 0 }
  const map = new Map([['b', to], ['c', other]])
  assert.deepEqual(routeEndAction({ fromDeviceId: 'a' }, 'c', map), { kind: 'select' })
  assert.deepEqual(routeEndAction({ toDeviceId: 'b' }, 'b', map), { kind: 'finish', point: { x: 3, y: 1, z: 0.5 } })
  assert.deepEqual(routeEndAction({ toDeviceId: 'b' }, 'c', map), { kind: 'hint', message: 'This route ends at Pump' })
})

test('routeEndAction: a To device that is not placed gives a hint saying so; a missing one selects', () => {
  const unplaced = { id: 'b', name: 'Pump', posX: null, posY: null, posZ: null }
  const r = routeEndAction({ toDeviceId: 'b' }, 'b', new Map([['b', unplaced]]))
  assert.equal(r.kind, 'hint')
  assert.match(r.message, /not placed/)
  assert.deepEqual(routeEndAction({ toDeviceId: 'zz' }, 'c', new Map()), { kind: 'select' })
})

test('routeWithEnd and the measured length include the last stretch', () => {
  const from = { id: 'a', name: 'A', posX: 0, posY: 0, posZ: 0 }
  const to = { id: 'b', name: 'B', posX: 3, posY: 4, posZ: 0 }
  const map = new Map([['a', from], ['b', to]])
  const run = { fromDeviceId: 'a', toDeviceId: 'b', route: [{ x: 3, y: 0, z: 0 }] }
  const act = routeEndAction(run, 'b', map)
  const route = routeWithEnd(run.route, act.point)
  assert.equal(route.length, 2)
  assert.deepEqual(route[1], { x: 3, y: 4, z: 0 })
  const eff = effectiveCableRoute({ ...run, route }, null, map, new Map())
  assert.equal(eff.length, 3 + 4)
  assert.equal(routeLength(eff.points).length, 7)
  assert.equal(routeWithEnd(route, act.point).length, 2) // not repeated
})

test('continuationMarks: a stub where the route steps down a deck, linking to the plan that shows it', () => {
  const points = [{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: -1 }]
  const marks = continuationMarks(points, main, [main, lower])
  assert.equal(marks.length, 1)
  assert.equal(marks[0].index, 1)
  assert.deepEqual(marks[0].target, { id: 'lower', name: 'Lower deck' })
  assert.deepEqual(marks[0].dir, [1, 0])
  // seen from the lower deck the mark is at the first visible point, pointing back
  const back = continuationMarks(points, lower, [main, lower])
  assert.equal(back.length, 1)
  assert.equal(back[0].index, 2)
  assert.deepEqual(back[0].target, { id: 'main', name: 'Main deck' })
  assert.deepEqual(back[0].dir, [-1, 0])
})

test('continuationMarks: several plans show the next point, the first by name wins', () => {
  const points = [{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: -1 }]
  const marks = continuationMarks(points, main, [main, lower, lowest])
  assert.equal(marks[0].target.name, 'Another deck')
})

test('continuationMarks: points without a height are shown everywhere and never produce a mark', () => {
  const points = [{ x: 1, y: 0, z: null }, { x: 2, y: 0, z: null }, { x: 3, y: 0, z: 1 }]
  assert.deepEqual(continuationMarks(points, main, [main, lower]), [])
  const allNull = [{ x: 1, y: 0, z: null }, { x: 2, y: 0, z: null }]
  assert.deepEqual(continuationMarks(allNull, lower, [main, lower]), [])
})

test('continuationMarks: no mark without a calibration; no target when no plan shows the point; side plans do not link', () => {
  const points = [{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 5 }]
  assert.deepEqual(continuationMarks(points, { ...main, calibration: null }, [main, lower]), [])
  const marks = continuationMarks(points, main, [main, lower])
  assert.equal(marks.length, 1)
  assert.equal(marks[0].target, null)
  const side = plan('side', 'A side view', { view: 'side' })
  assert.equal(continuationMarks([{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: -1 }], main, [main, side])[0].target, null)
})

test('escapeStep: innermost first, then the tool, then nothing', () => {
  const base = { tool: 'route', finishing: null, connectActive: false, waypointIndex: null, runId: null, conduitId: null, deviceId: null }
  assert.equal(escapeStep({ ...base, tool: 'connect', finishing: {} }), 'close-finish')
  assert.equal(escapeStep({ ...base, tool: 'connect', connectActive: true }), 'reset-connect')
  assert.equal(escapeStep({ ...base, tool: 'connect' }), 'tool-select')
  assert.equal(escapeStep({ ...base, waypointIndex: 2, runId: 'r' }), 'clear-waypoint')
  assert.equal(escapeStep({ ...base, runId: 'r' }), 'clear-route-target')
  assert.equal(escapeStep({ ...base, conduitId: 'k' }), 'clear-route-target')
  assert.equal(escapeStep(base), 'tool-select')
  assert.equal(escapeStep({ ...base, tool: 'place', deviceId: 'd' }), 'tool-select')
  assert.equal(escapeStep({ ...base, tool: 'select', deviceId: 'd' }), 'clear-device')
  assert.equal(escapeStep({ ...base, tool: 'select' }), null)
})

test('deleteStep: waypoint first, else the placement of a placed selected device', () => {
  assert.equal(deleteStep({ waypointIndex: 0, deviceId: 'd', devicePlaced: true }), 'delete-waypoint')
  assert.equal(deleteStep({ waypointIndex: null, deviceId: 'd', devicePlaced: true }), 'clear-placement')
  assert.equal(deleteStep({ waypointIndex: null, deviceId: 'd', devicePlaced: false }), null)
  assert.equal(deleteStep({ waypointIndex: null, deviceId: null, devicePlaced: false }), null)
})
