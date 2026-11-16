import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  circuitsBehind, calculateBehindLoad, loadFindings, loadSummaryLine, isShownCircuit, calculateCircuitLoad
} from '../public/loadCalc.js'

const dev = (id, role, extra = {}) => ({ id, name: id, role, status: 'active', ...extra })
const cable = (id, from, to) => ({ id, fromDeviceId: from, toDeviceId: to, status: 'active', conductors: [{ conductor: 'positive' }] })
const circuit = (id, cableIds, derived = {}) => ({
  id, name: id, status: 'active',
  derived: { cableIds, endDeviceIds: [], deviceIds: [], ratingA: 100, voltage: 12, unprotected: false, supplyDeviceIds: ['bat'], busLoads: [], ...derived }
})

// battery -> main fuse -> bus ; bus -> branch1 fuse -> fridge ; bus -> branch2 fuse -> pump, fridge
const devices = [
  dev('bat', 'storage', { type: 'Battery' }), dev('main', 'distribution'), dev('bus', 'distribution'),
  dev('f1', 'distribution'), dev('f2', 'distribution'),
  dev('fridge', 'consumer', { ratedPowerW: 60 }), dev('pump', 'consumer', { ratedPowerW: 120 })
]
const deviceById = new Map(devices.map((d) => [d.id, d]))
const cables = [
  cable('c1', 'bat', 'main'), cable('c2', 'main', 'bus'),
  cable('c3', 'bus', 'f1'), cable('c4', 'f1', 'fridge'),
  cable('c5', 'bus', 'f2'), cable('c6', 'f2', 'pump'), cable('c7', 'f2', 'fridge')
]
const A = circuit('A', ['c1', 'c2'], { ratingA: 10 })
const B1 = circuit('B1', ['c3', 'c4'], { endDeviceIds: ['fridge'] })
const B2 = circuit('B2', ['c5', 'c6', 'c7'], { endDeviceIds: ['pump', 'fridge'] })
const circuits = [A, B1, B2]

test('circuitsBehind: the branch circuits are behind the main fuse circuit, not the other way', () => {
  const behind = circuitsBehind(circuits, cables, deviceById)
  assert.deepEqual(behind.get('A').sort(), ['B1', 'B2'])
  assert.deepEqual(behind.get('B1'), [])
  assert.deepEqual(behind.get('B2'), [])
})

test('circuitsBehind: further circuits behind a branch count behind the main fuse too', () => {
  const extra = [...cables, cable('c8', 'pump', 'sub')]
  const sub = circuit('S', ['c8'], { endDeviceIds: [] })
  const b = circuitsBehind([A, B1, B2, sub], extra, deviceById)
  assert.deepEqual(b.get('B2'), ['S'])
  assert.deepEqual(b.get('A').sort(), ['B1', 'B2', 'S'])
})

test('circuitsBehind: a charging source feed has nothing behind it', () => {
  const alt = dev('alt', 'source', { type: 'Alternator' })
  const map = new Map([...deviceById, ['alt', alt]])
  const altCircuit = circuit('ALT', ['c9', 'c10'])
  const more = [...cables, cable('c9', 'alt', 'altfuse'), cable('c10', 'altfuse', 'bus')]
  const b = circuitsBehind([A, B1, B2, altCircuit], more, map)
  assert.deepEqual(b.get('ALT'), [])
  assert.deepEqual(b.get('A').sort(), ['B1', 'B2'])
})

test('circuitsBehind: a loop is cut and a circuit is never behind itself', () => {
  const loopCables = [cable('l1', 'x', 'y'), cable('l2', 'y', 'x')]
  const p = circuit('P', ['l1']); const q = circuit('Q', ['l2'])
  const b = circuitsBehind([p, q], loopCables, new Map())
  assert.deepEqual(b.get('P'), ['Q'])
  assert.deepEqual(b.get('Q'), ['P'])
})

test('circuitsBehind: removed cables and circuits without derived data are ignored', () => {
  const gone = cables.map((c) => (c.id === 'c3' ? { ...c, status: 'removed' } : c))
  const b = circuitsBehind([A, B1, B2, { id: 'N', name: 'N', status: 'active' }], gone, deviceById)
  assert.deepEqual(b.get('A'), ['B2'])
  assert.deepEqual(b.get('N'), [])
})

test('calculateBehindLoad: each device once, at the fuse voltage, with the fuse rating', () => {
  const load = calculateBehindLoad(A, [B1, B2], deviceById)
  assert.equal(load.deviceCount, 2)
  assert.equal(load.totalWatts, 180)
  assert.equal(load.circuitCount, 2)
  assert.ok(Math.abs(load.amps - 15) < 1e-9)
  assert.equal(load.ratingA, 10)
  assert.equal(load.overRating, true)
  assert.equal(calculateCircuitLoad(A, deviceById).totalWatts, 0, 'the own load of the fuse is unchanged')
})

test('calculateBehindLoad: a fuse with nothing behind it has its own figures', () => {
  const load = calculateBehindLoad(B1, [], deviceById)
  assert.equal(load.totalWatts, 60)
  assert.equal(load.circuitCount, 0)
})

test('loadFindings: over on its own, over only with what is behind it, incomplete, or fine', () => {
  const own = { overRating: true, missingVoltage: false, missingRating: false }
  const ok = { overRating: false, missingVoltage: false, missingRating: false }
  assert.deepEqual(loadFindings(own, null), { overOwn: true, overBehind: false, over: true, incomplete: false })
  assert.deepEqual(loadFindings(ok, { overRating: true }), { overOwn: false, overBehind: true, over: true, incomplete: false })
  assert.deepEqual(loadFindings({ ...ok, missingRating: true, unprotected: true }, null), { overOwn: false, overBehind: false, over: false, incomplete: true })
  assert.deepEqual(loadFindings(ok, { overRating: false }), { overOwn: false, overBehind: false, over: false, incomplete: false })
})

test('loadSummaryLine counts over rating, incomplete and ok across all circuits', () => {
  const f = [{ over: false, incomplete: false }, { over: false, incomplete: true }, { over: true, incomplete: false }, { over: false, incomplete: false }]
  assert.equal(loadSummaryLine(f), '4 circuits: 1 over rating, 1 incomplete, 2 ok')
  assert.equal(loadSummaryLine([{ over: false, incomplete: false }]), '1 circuit: 0 over rating, 0 incomplete, 1 ok')
  assert.equal(loadSummaryLine([]), null)
})

test('isShownCircuit: a consumer, a consumer behind it or a finding keeps a row; the rest fold', () => {
  const none = { deviceCount: 0, busWatts: 0 }
  const noFinding = { over: false, incomplete: false }
  assert.equal(isShownCircuit({ deviceCount: 1 }, null, noFinding), true)
  assert.equal(isShownCircuit(none, { deviceCount: 2 }, noFinding), true)
  assert.equal(isShownCircuit(none, { deviceCount: 0, busWatts: 5 }, noFinding), true)
  assert.equal(isShownCircuit(none, { deviceCount: 0 }, { over: false, incomplete: true }), true)
  assert.equal(isShownCircuit(none, { deviceCount: 0 }, noFinding), false)
})
