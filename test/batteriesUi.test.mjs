import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  batteryFieldVisible, fractionToPercent, percentToFraction, deviceToFormValues, formPayloadToDevice,
  timeRemainingSuggestion, chemistryFill, typeBatteryFill, socPathFill, installedAgeText, bankOfBattery, describeBank
} from '../public/batteries.js'

test('field visibility by role and type', () => {
  assert.equal(batteryFieldVisible('chemistry', { role: 'storage' }), true)
  assert.equal(batteryFieldVisible('chemistry', { role: 'consumer', type: 'Shunt' }), false)
  assert.equal(batteryFieldVisible('socPath', { role: 'consumer', type: 'Battery monitor' }), true)
  assert.equal(batteryFieldVisible('voltagePath', { role: 'distribution', type: 'BMS' }), true)
  assert.equal(batteryFieldVisible('socPath', { role: 'consumer', type: 'Bilge pump' }), false)
  assert.equal(batteryFieldVisible('monitorDeviceId', { role: 'storage' }), true)
  assert.equal(batteryFieldVisible('name', { role: 'consumer' }), true)
})

test('percent conversion', () => {
  assert.equal(fractionToPercent(0.8), '80')
  assert.equal(fractionToPercent(0.333), '33.3')
  assert.equal(fractionToPercent(null), '')
  assert.equal(percentToFraction('50'), 0.5)
  assert.equal(percentToFraction(33.3), 0.333)
  assert.equal(percentToFraction(''), null)
  assert.equal(deviceToFormValues({ usableFraction: 0.5 }).usablePercent, '50')
  assert.deepEqual(formPayloadToDevice({ name: 'a', usablePercent: 80 }), { name: 'a', usableFraction: 0.8 })
  assert.deepEqual(formPayloadToDevice({ name: 'a', usablePercent: null }), { name: 'a', usableFraction: null })
  assert.deepEqual(formPayloadToDevice({ name: 'a' }), { name: 'a' })
})

test('time remaining suggestion from the state of charge path', () => {
  assert.equal(timeRemainingSuggestion('electrical.batteries.house.capacity.stateOfCharge'),
    'electrical.batteries.house.capacity.timeRemaining')
  assert.equal(timeRemainingSuggestion('electrical.batteries.house.soc'), null)
  assert.equal(timeRemainingSuggestion(''), null)
  assert.equal(timeRemainingSuggestion(null), null)
})

test('socPathFill fills while empty and untouched, never over a hand value', () => {
  const soc = 'a.b.capacity.stateOfCharge'
  assert.deepEqual(socPathFill(soc, { timeRemainingPath: '' }, {}), { timeRemainingPath: 'a.b.capacity.timeRemaining' })
  assert.equal(socPathFill(soc, { timeRemainingPath: '' }, { timeRemainingPath: true }), null)
  assert.equal(socPathFill(soc, { timeRemainingPath: 'my.own.path' }, {}), null)
  assert.deepEqual(socPathFill('a.b.capac', { timeRemainingPath: 'a.b.capacity.timeRemaining' }, {}), { timeRemainingPath: '' })
})

test('chemistryFill sets voltage and usable percent while untouched', () => {
  assert.deepEqual(chemistryFill('lifepo4', { nominalVoltage: '', usablePercent: '' }, {}),
    { nominalVoltage: '12.8', usablePercent: '80' })
  assert.deepEqual(chemistryFill('agm', { nominalVoltage: '12.8', usablePercent: '80' }, {}),
    { nominalVoltage: '12', usablePercent: '50' })
  assert.deepEqual(chemistryFill('lithium', { nominalVoltage: '', usablePercent: '' }, {}),
    { nominalVoltage: '', usablePercent: '80' })
})

test('chemistryFill leaves touched and hand-set values alone', () => {
  assert.deepEqual(chemistryFill('lifepo4', { nominalVoltage: '13.2', usablePercent: '' }, {}), { usablePercent: '80' })
  assert.deepEqual(chemistryFill('lifepo4', { nominalVoltage: '', usablePercent: '' }, { nominalVoltage: true, usablePercent: true }), {})
  assert.deepEqual(chemistryFill('agm', { nominalVoltage: '24', usablePercent: '65' }, {}), {})
})

test('chemistryFill does nothing when the chemistry is cleared', () => {
  assert.deepEqual(chemistryFill('', { nominalVoltage: '12', usablePercent: '50' }, {}), {})
})

test('typeBatteryFill presets chemistry and purpose from the type while untouched', () => {
  const v = { nominalVoltage: '', usablePercent: '' }
  assert.deepEqual(typeBatteryFill('LiFePO4 battery', v, {}),
    { chemistry: 'lifepo4', nominalVoltage: '12.8', usablePercent: '80' })
  assert.deepEqual(typeBatteryFill('Starter battery', v, {}), { purpose: 'starter' })
  assert.deepEqual(typeBatteryFill('LiFePO4 battery', v, { chemistry: true }), {})
  assert.deepEqual(typeBatteryFill('Shunt', v, {}), {})
})

test('installedAgeText', () => {
  const now = new Date('2026-11-08T12:00:00Z')
  assert.equal(installedAgeText('2023-11-08', now), 'installed 3 years ago')
  assert.equal(installedAgeText('2023-11-09', now), 'installed 2 years ago')
  assert.equal(installedAgeText('2025-11-08', now), 'installed 1 year ago')
  assert.equal(installedAgeText('2026-06-01', now), 'installed 5 months ago')
  assert.equal(installedAgeText('2026-10-10', now), 'installed 29 days ago')
  assert.equal(installedAgeText('2026-11-08', now), 'installed today')
  assert.equal(installedAgeText('2027-01-01', now), 'installed in the future')
  assert.equal(installedAgeText('', now), null)
  assert.equal(installedAgeText(null, now), null)
})

test('bank of a battery and its description', () => {
  const banks = [{ batteryIds: ['a', 'b'], layout: { label: '2S1P' }, voltage: 24, capacityAh: 100, usableAh: 50 }]
  assert.equal(bankOfBattery(banks, 'b'), banks[0])
  assert.equal(bankOfBattery(banks, 'z'), null)
  assert.deepEqual(describeBank(banks[0]), ['Bank of 2, 2S1P', '24 V, 100 Ah, 50 Ah usable'])
  assert.deepEqual(describeBank({ batteryIds: ['a'] }), ['Bank of one'])
  assert.deepEqual(describeBank(null), [])
})
