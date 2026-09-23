import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateCircuitLoad } from '../public/loadSummary.js'

function device (id, ratedPowerW, status = 'active') {
  return { id, ratedPowerW, status }
}

function wireRun (circuitId, toEndpoint, status = 'active') {
  return { circuitId, toEndpoint, status }
}

test('sums rated power across distinct devices connected via active wire runs', () => {
  const circuit = { id: 'c1', voltage: 12, breakerRating: 10 }
  const wireRuns = [wireRun('c1', 'd1'), wireRun('c1', 'd2')]
  const deviceById = new Map([['d1', device('d1', 20)], ['d2', device('d2', 40)]])

  const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
  assert.equal(load.totalWatts, 60)
  assert.equal(load.deviceCount, 2)
  assert.equal(load.amps, 5) // 60W / 12V
})

test('ignores wire runs belonging to a different circuit', () => {
  const circuit = { id: 'c1', voltage: 12 }
  const wireRuns = [wireRun('c1', 'd1'), wireRun('c2', 'd2')]
  const deviceById = new Map([['d1', device('d1', 20)], ['d2', device('d2', 999)]])

  const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
  assert.equal(load.totalWatts, 20)
  assert.equal(load.deviceCount, 1)
})

test('ignores removed wire runs and removed devices', () => {
  const circuit = { id: 'c1', voltage: 12 }
  const wireRuns = [
    wireRun('c1', 'd1', 'removed'),
    wireRun('c1', 'd2'),
    wireRun('c1', 'd3')
  ]
  const deviceById = new Map([
    ['d1', device('d1', 100)],
    ['d2', device('d2', 20, 'removed')],
    ['d3', device('d3', 30)]
  ])

  const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
  assert.equal(load.totalWatts, 30)
  assert.equal(load.deviceCount, 1)
})

test('does not double-count a device wired in twice within the same circuit', () => {
  const circuit = { id: 'c1', voltage: 12 }
  const wireRuns = [wireRun('c1', 'd1'), wireRun('c1', 'd1')]
  const deviceById = new Map([['d1', device('d1', 20)]])

  const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
  assert.equal(load.totalWatts, 20)
  assert.equal(load.deviceCount, 1)
})

test('amps is null when voltage is not set, rather than a wrong number', () => {
  const circuit = { id: 'c1', voltage: null }
  const wireRuns = [wireRun('c1', 'd1')]
  const deviceById = new Map([['d1', device('d1', 20)]])

  const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
  assert.equal(load.amps, null)
  assert.equal(load.missingVoltage, true)
})

test('overRating is true only when amps exceeds a known breaker rating', () => {
  const overCircuit = { id: 'c1', voltage: 12, breakerRating: 5 }
  const underCircuit = { id: 'c1', voltage: 12, breakerRating: 100 }
  const noRatingCircuit = { id: 'c1', voltage: 12, breakerRating: null }
  const wireRuns = [wireRun('c1', 'd1')]
  const deviceById = new Map([['d1', device('d1', 120)]]) // 10A @ 12V

  assert.equal(calculateCircuitLoad(overCircuit, wireRuns, deviceById).overRating, true)
  assert.equal(calculateCircuitLoad(underCircuit, wireRuns, deviceById).overRating, false)
  const noRatingLoad = calculateCircuitLoad(noRatingCircuit, wireRuns, deviceById)
  assert.equal(noRatingLoad.overRating, false)
  assert.equal(noRatingLoad.missingRating, true)
})

test('tracks devices with unknown (null) rated power separately from zero-watt totals', () => {
  const circuit = { id: 'c1', voltage: 12 }
  const wireRuns = [wireRun('c1', 'd1'), wireRun('c1', 'd2')]
  const deviceById = new Map([
    ['d1', device('d1', 20)],
    ['d2', device('d2', null)]
  ])

  const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
  assert.equal(load.totalWatts, 20)
  assert.equal(load.deviceCount, 2)
  assert.equal(load.unknownWattageCount, 1)
})

test('a wire run to an endpoint that is not a known device is ignored (e.g. a splice/source label)', () => {
  const circuit = { id: 'c1', voltage: 12 }
  const wireRuns = [wireRun('c1', 'splice-1'), wireRun('c1', 'd1')]
  const deviceById = new Map([['d1', device('d1', 20)]])

  const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
  assert.equal(load.totalWatts, 20)
  assert.equal(load.deviceCount, 1)
})
