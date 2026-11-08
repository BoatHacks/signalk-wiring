import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultTimings, warningText, describeResult, progressPercent, buildStartBody, meterLabel } from '../public/calibrate.js'

test('default timings per method, with the watch longer than a delta measurement', () => {
  assert.deepEqual(defaultTimings('delta'), { baselineS: 5, settleS: 5, measureS: 5, repeats: 3 })
  assert.deepEqual(defaultTimings('watch'), { baselineS: 5, watchS: 120 })
})

test('warnings are explained in words, and an unknown code is shown as is', () => {
  assert.match(warningText('drift'), /resting reading moved/)
  assert.match(warningText('small-step'), /noise/)
  assert.equal(warningText('mystery'), 'mystery')
})

test('a result is described with confidence, estimate and group notes', () => {
  const lines = describeResult({ method: 'delta', avgW: 36.04, peakW: 38.4, dutyCycle: 1, confidence: 'high', estimate: true, meterUnit: 'A', details: { spread: 0.12 }, consumerIds: ['a', 'b'] })
  assert.equal(lines[0], 'Average 36 W, peak 38.4 W')
  assert.ok(lines.includes('Spread between repeats: 0.1 A'))
  assert.ok(lines.includes('Confidence: high'))
  assert.ok(lines.some((l) => /amps times the circuit voltage/.test(l)))
  assert.ok(lines.some((l) => /whole group|every consumer/.test(l)))
  const kettle = describeResult({ method: 'watch', avgW: 1000, peakW: 2000, dutyCycle: 0.5, confidence: 'medium', estimate: false })
  assert.ok(kettle.includes('On 50% of the time'))
  assert.deepEqual(describeResult(null), [])
})

test('progress is a clamped percentage', () => {
  assert.equal(progressPercent({ progress: { done: 3, total: 12 } }), 25)
  assert.equal(progressPercent({ progress: { done: 20, total: 12 } }), 100)
  assert.equal(progressPercent(null), 0)
  assert.equal(progressPercent({ progress: { done: 1, total: 0 } }), 0)
})

test('the start request carries only numeric timings and a voltage when one is given', () => {
  const body = buildStartBody({
    deviceId: 'd1', method: 'delta', hand: false, meter: { path: 'm.current', unit: 'A', source: 'device' },
    voltage: '12.4', timings: { baselineS: '5', settleS: '', measureS: 'x', repeats: 3 }, autoContinue: true, confirmed: true
  })
  assert.deepEqual(body.timings, { baselineS: 5, repeats: 3 })
  assert.equal(body.voltage, 12.4)
  assert.equal(body.confirmed, true)
  assert.deepEqual(body.meter, { path: 'm.current', unit: 'A', source: 'device' })
  assert.equal(buildStartBody({ deviceId: 'd', method: 'watch', meter: { path: 'p', unit: 'W' }, voltage: '', timings: {} }).voltage, undefined)
})

test('a meter is listed with where it is and how trustworthy', () => {
  const nameOf = (id) => ({ r: 'Cabin relay' })[id] || id
  assert.equal(meterLabel({ source: 'device', deviceId: 'r', path: 'a.power', unit: 'W', lowConfidence: false }, nameOf), 'Cabin relay: a.power (watts)')
  assert.match(meterLabel({ source: 'device', deviceId: 'bat', path: 'b.current', unit: 'A', lowConfidence: true }, nameOf), /less accurate/)
  assert.match(meterLabel({ source: 'circuit', circuitId: 'c', path: 'c.power', unit: 'W' }, nameOf), /^circuit meter/)
})
