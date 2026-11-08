import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateCircuitLoad, incompleteReason, BADGE_HELP, LEGEND } from '../public/loadSummary.js'

function device (id, ratedPowerW, extra = {}) {
  return { id, ratedPowerW, status: 'active', ...extra }
}

function circuit (endDeviceIds, derived = {}) {
  return { id: 'c1', derived: { endDeviceIds, deviceIds: endDeviceIds, ac: false, ratingA: 10, voltage: 12, ...derived } }
}

const byId = (...devices) => new Map(devices.map((d) => [d.id, d]))

test('sums rated power across the consumers a circuit ends at and divides by the voltage', () => {
  const load = calculateCircuitLoad(circuit(['d1', 'd2']), byId(device('d1', 20), device('d2', 40)))
  assert.equal(load.totalWatts, 60)
  assert.equal(load.deviceCount, 2)
  assert.equal(load.amps, 5)
  assert.equal(load.overRating, false)
})

const measured = (avgW, peakW, extra = {}) => ({ avgW, peakW, dutyCycle: 1, confidence: 'high', estimate: false, group: null, ...extra })

test('a measured peak replaces the rating for the breaker check, and the measured average is kept for energy', () => {
  const load = calculateCircuitLoad(
    circuit(['d1', 'd2'], { ratingA: 3 }),
    byId(device('d1', 100, { measured: measured(20, 24) }), device('d2', 10))
  )
  assert.equal(load.totalWatts, 34) // 24 measured peak + 10 rated
  assert.equal(load.averageWatts, 30) // 20 measured average + 10 rated
  assert.equal(load.measuredCount, 1)
  assert.equal(load.source, 'mixed')
  assert.ok(Math.abs(load.amps - 34 / 12) < 1e-9)
  assert.equal(load.overRating, false) // 2.8 A against 3 A; the nameplate 110 W would have flagged it
})

test('a circuit of only measured devices is labelled measured, and estimates are counted', () => {
  const load = calculateCircuitLoad(
    circuit(['d1', 'd2']),
    byId(device('d1', 100, { measured: measured(20, 24, { estimate: true }) }), device('d2', null, { measured: measured(5, 6) }))
  )
  assert.equal(load.source, 'measured')
  assert.equal(load.estimateCount, 1)
  assert.equal(load.unknownWattageCount, 0)
})

test('a device with no rating but a measurement is known; with neither it stays unknown; all-rated stays rated', () => {
  const rated = calculateCircuitLoad(circuit(['d1']), byId(device('d1', 40)))
  assert.equal(rated.source, 'rated')
  assert.equal(rated.averageWatts, 40)
  const unknown = calculateCircuitLoad(circuit(['d1']), byId(device('d1', null)))
  assert.equal(unknown.unknownWattageCount, 1)
})

test('a group figure measured on a shared switch is counted once per circuit', () => {
  const group = { switchDeviceId: 'relay', consumerIds: ['a', 'b'] }
  const load = calculateCircuitLoad(
    circuit(['a', 'b', 'c']),
    byId(
      device('a', 18, { measured: measured(36, 37, { group }) }),
      device('b', 18, { measured: measured(36, 37, { group }) }),
      device('c', 10)
    )
  )
  assert.equal(load.totalWatts, 47) // 37 once, plus 10
  assert.equal(load.averageWatts, 46)
  assert.equal(load.groupCount, 1)
  assert.equal(load.deviceCount, 3)
})

test('a measured figure ignores the power factor on an AC circuit; a rated one still divides by it', () => {
  const ac = { ac: true, voltage: 230, ratingA: 16 }
  const m = calculateCircuitLoad(circuit(['d1'], ac), byId(device('d1', 1000, { powerFactor: 0.5, measured: measured(800, 900) })))
  assert.equal(m.amps, 900 / 230)
  const r = calculateCircuitLoad(circuit(['d1'], ac), byId(device('d1', 1000, { powerFactor: 0.5 })))
  assert.equal(r.amps, 2000 / 230)
})

test('flags a load over the rating of the protecting device', () => {
  const load = calculateCircuitLoad(circuit(['d1'], { ratingA: 3 }), byId(device('d1', 60)))
  assert.equal(load.amps, 5)
  assert.equal(load.overRating, true)
})

test('ignores removed devices and counts a device once', () => {
  const load = calculateCircuitLoad(circuit(['d1', 'd1', 'd2']), byId(device('d1', 30), { ...device('d2', 99), status: 'removed' }))
  assert.equal(load.totalWatts, 30)
  assert.equal(load.deviceCount, 1)
})

test('an unrated device counts but adds no watts', () => {
  const load = calculateCircuitLoad(circuit(['d1', 'd2']), byId(device('d1', 20), device('d2', null)))
  assert.equal(load.totalWatts, 20)
  assert.equal(load.deviceCount, 2)
  assert.equal(load.unknownWattageCount, 1)
})

test('only consumers add to a circuit load; a device with no role counts as one', () => {
  const load = calculateCircuitLoad(
    circuit(['light', 'solar', 'battery', 'panel', 'inverter', 'old']),
    byId(
      device('light', 24, { role: 'consumer' }), device('solar', 400, { role: 'source' }),
      device('battery', 100, { role: 'storage' }), device('panel', null, { role: 'distribution' }),
      device('inverter', 1500, { role: 'converter' }), device('old', 6)
    )
  )
  assert.equal(load.totalWatts, 30)
  assert.equal(load.deviceCount, 2)
})

test('unknown voltage or rating is reported, not guessed', () => {
  const noVoltage = calculateCircuitLoad(circuit(['d1'], { voltage: null }), byId(device('d1', 20)))
  assert.equal(noVoltage.amps, null)
  assert.equal(noVoltage.missingVoltage, true)
  const noRating = calculateCircuitLoad(circuit(['d1'], { ratingA: null }), byId(device('d1', 20)))
  assert.equal(noRating.missingRating, true)
  assert.equal(noRating.overRating, false)
})

test('the power factor applies on AC circuits only, and a blank one counts as 1', () => {
  const devices = byId(device('a', 230, { powerFactor: 0.5 }), device('b', 230))
  const ac = calculateCircuitLoad(circuit(['a', 'b'], { ac: true, voltage: 230, ratingA: 10 }), devices)
  assert.equal(ac.totalWatts, 460)
  assert.equal(ac.amps, 3) // (230 / 0.5 + 230) / 230
  const dc = calculateCircuitLoad(circuit(['a', 'b'], { ac: false, voltage: 230 }), devices)
  assert.equal(dc.amps, 2)
})

test('a circuit that no longer exists has an empty load', () => {
  const load = calculateCircuitLoad({ id: 'x', derived: null }, byId())
  assert.equal(load.deviceCount, 0)
  assert.equal(load.amps, null)
})

test('incompleteReason says what is missing and what to do', () => {
  const noVoltage = calculateCircuitLoad(circuit(['d1'], { voltage: null }), byId(device('d1', 20)))
  assert.equal(incompleteReason(noVoltage), 'No voltage: set the nominal voltage on the supply')
  const noRating = calculateCircuitLoad(circuit(['d1'], { ratingA: null }), byId(device('d1', 20)))
  assert.equal(incompleteReason(noRating), 'No rating: set the trip rating of the fuse or breaker')
  const both = calculateCircuitLoad(circuit(['d1'], { ratingA: null, voltage: null }), byId(device('d1', 20)))
  assert.equal(incompleteReason(both),
    'No voltage: set the nominal voltage on the supply. No rating: set the trip rating of the fuse or breaker')
  const fine = calculateCircuitLoad(circuit(['d1']), byId(device('d1', 20)))
  assert.equal(incompleteReason(fine), null)
})

test('every badge has a short tooltip and a legend entry', () => {
  for (const name of ['over rating', 'ok', 'measured', 'estimate']) assert.ok(BADGE_HELP[name], name)
  assert.deepEqual(LEGEND.map(([n]) => n), ['over rating', 'ok', 'incomplete', 'measured', 'estimate'])
  for (const text of [...Object.values(BADGE_HELP), ...LEGEND.map(([, t]) => t)]) assert.ok(!/[\u2013\u2014]/.test(text))
})
