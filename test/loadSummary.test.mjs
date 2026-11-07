import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateCircuitLoad } from '../public/loadSummary.js'

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
