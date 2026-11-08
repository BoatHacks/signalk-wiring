import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describeMeasured, describeGroup, loadFigures } from '../public/measured.js'
import { isCriticalType, CRITICAL_TYPE_WORDS } from '../public/deviceTypes.js'

const require = createRequire(import.meta.url)
const safety = require('../src/safety.js')

test('the browser and the store agree on which types look critical', () => {
  assert.deepEqual(CRITICAL_TYPE_WORDS, safety.CRITICAL_TYPE_WORDS)
  for (const t of ['Bilge pump', 'REFRIGERATOR', 'Autopilot', 'Navigation light', 'Anchor windlass', 'Cabin light', '', null, undefined, 42]) {
    assert.equal(isCriticalType(t), safety.isCriticalType(t), String(t))
  }
  assert.equal(isCriticalType('Bilge pump'), true)
  assert.equal(isCriticalType('Cabin light'), false)
})

test('a measured run is described beside the rated power', () => {
  const lines = describeMeasured({ avgW: 36, peakW: 38.4, dutyCycle: 1, method: 'delta', confidence: 'high', estimate: true, at: '2026-11-01T10:05:00Z' }, 40)
  assert.equal(lines[0], 'Measured: average 36 W, peak 38.4 W (rated 40 W)')
  assert.match(lines[1], /switched on and off, high confidence, estimate from amps/)
})

test('a cycling load says how much of the time it is on; nothing measured gives no lines', () => {
  const lines = describeMeasured({ avgW: 1000, peakW: 2000, dutyCycle: 0.5, method: 'watch' }, null)
  assert.equal(lines[0], 'Measured: average 1000 W, peak 2000 W, on 50% of the time')
  assert.match(lines[1], /watched/)
  assert.deepEqual(describeMeasured(null, 10), [])
})

test('a group figure names the consumers it covers', () => {
  const m = { group: { switchDeviceId: 'r', consumerIds: ['a', 'b'] } }
  assert.match(describeGroup(m, (id) => id.toUpperCase()), /A, B/)
  assert.equal(describeGroup({ group: null }, String), null)
})

test('load figures: measured when there is an accepted run, rated otherwise, none when neither', () => {
  assert.deepEqual(loadFigures({ ratedPowerW: 40, measured: { avgW: 30, peakW: 35, estimate: true, group: null } }),
    { avgW: 30, peakW: 35, source: 'measured', estimate: true, group: null })
  assert.deepEqual(loadFigures({ ratedPowerW: 40, measured: null }),
    { avgW: 40, peakW: 40, source: 'rated', estimate: false, group: null })
  assert.equal(loadFigures({ ratedPowerW: null, measured: null }).source, null)
})
