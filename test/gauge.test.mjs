import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AWG_SIZES, MM2_SIZES, gaugeLabel, formatGauge, gaugeOptions, keepGaugeForUnit, parseGauge, inGaugeList
} from '../public/gauge.js'

test('the lists are the agreed sizes', () => {
  assert.deepEqual(MM2_SIZES, [0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95])
  assert.deepEqual(AWG_SIZES, [18, 16, 14, 12, 10, 8, 6, 4, 2, 1, 0, -1, -2, -3])
})

test('gaugeLabel writes 0 to -3 as 1/0 to 4/0 in AWG only', () => {
  assert.equal(gaugeLabel(0, 'AWG'), '1/0')
  assert.equal(gaugeLabel(-1, 'AWG'), '2/0')
  assert.equal(gaugeLabel(-2, 'AWG'), '3/0')
  assert.equal(gaugeLabel(-3, 'AWG'), '4/0')
  assert.equal(gaugeLabel(14, 'AWG'), '14')
  assert.equal(gaugeLabel(2.5, 'mm2'), '2.5')
  assert.equal(gaugeLabel(null, 'AWG'), '')
  assert.equal(gaugeLabel('', 'AWG'), '')
})

test('formatGauge: zero is a gauge, only null and undefined mean none', () => {
  assert.equal(formatGauge(0, 'AWG'), '1/0 AWG')
  assert.equal(formatGauge(2.5, 'mm2'), '2.5 mm²')
  assert.equal(formatGauge(14, 'AWG'), '14 AWG')
  assert.equal(formatGauge(6, null), '6')
  assert.equal(formatGauge(null, 'AWG'), '-')
  assert.equal(formatGauge(undefined, 'mm2'), '-')
})

test('gaugeOptions: the list, a non-standard current value, then Other', () => {
  const awg = gaugeOptions('AWG', '')
  assert.deepEqual(awg.map((o) => o.label), ['18', '16', '14', '12', '10', '8', '6', '4', '2', '1', '1/0', '2/0', '3/0', '4/0', 'Other…'])
  assert.equal(awg.find((o) => o.label === '1/0').value, '0')
  const odd = gaugeOptions('mm2', 3)
  assert.deepEqual(odd.slice(-2).map((o) => o.label), ['3', 'Other…'])
  assert.equal(gaugeOptions('mm2', 2.5).length, MM2_SIZES.length + 1)
  assert.deepEqual(gaugeOptions('', ''), [{ value: 'other', label: 'Other…' }])
})

test('keepGaugeForUnit keeps a value only when the new list has it', () => {
  assert.equal(keepGaugeForUnit('1', 'mm2'), '1')
  assert.equal(keepGaugeForUnit(1, 'AWG'), '1')
  assert.equal(keepGaugeForUnit('14', 'mm2'), '')
  assert.equal(keepGaugeForUnit('2.5', 'AWG'), '')
  assert.equal(keepGaugeForUnit(0, 'AWG'), '0')
  assert.equal(keepGaugeForUnit(0, 'mm2'), '')
  assert.equal(keepGaugeForUnit('', 'AWG'), '')
  assert.ok(inGaugeList(-3, 'AWG'))
})

test('parseGauge reads aught notation, plain numbers and rejects the rest', () => {
  assert.equal(parseGauge('1/0'), 0)
  assert.equal(parseGauge('2/0'), -1)
  assert.equal(parseGauge('3/0', 'AWG'), -2)
  assert.equal(parseGauge('4/0'), -3)
  assert.equal(parseGauge('000'), -2)
  assert.equal(parseGauge('00'), -1)
  assert.equal(parseGauge('0000'), -3)
  assert.equal(parseGauge('0'), 0)
  assert.equal(parseGauge('14'), 14)
  assert.equal(parseGauge('2,5', 'mm2'), 2.5)
  assert.equal(parseGauge('2.5'), 2.5)
  assert.equal(parseGauge('1/0', 'mm2'), null)
  assert.equal(parseGauge('0', 'mm2'), null)
  assert.equal(parseGauge('5/0'), null)
  assert.equal(parseGauge('x'), null)
  assert.equal(parseGauge(''), null)
  assert.equal(parseGauge(null), null)
  assert.equal(parseGauge('-5'), null)
})
