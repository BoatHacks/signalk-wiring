'use strict'

// Plan 0020: golden cases for the pure bank derivation.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveBanks } = require('../src/banks')
const { Store } = require('../src/store')

const batt = (id, extra = {}) => ({ id, name: id, role: 'storage', status: 'active', nominalVoltage: 12, capacityAh: 100, usableFraction: 0.5, chemistry: 'agm', ...extra })
let n = 0
const link = (a, b, kind, extra = {}) => ({ id: `c${String(++n).padStart(3, '0')}`, fromDeviceId: a, toDeviceId: b, status: 'active', link: kind, ...extra })
const codes = (bank) => bank.warnings.map((w) => w.code)

test('one battery is a bank of one', () => {
  const [bank] = deriveBanks({ devices: [batt('a', { capacityAh: 200 })], cables: [] })
  assert.deepEqual(bank.batteryIds, ['a'])
  assert.deepEqual(bank.cableIds, [])
  assert.deepEqual(bank.strings, [['a']])
  assert.deepEqual(bank.layout, { series: 1, parallel: 1, label: '1S1P' })
  assert.equal(bank.voltage, 12)
  assert.equal(bank.capacityAh, 200)
  assert.equal(bank.usableAh, 100)
  assert.equal(bank.energyWh, 2400)
  assert.equal(bank.usableEnergyWh, 1200)
  assert.equal(bank.complete, true)
  assert.deepEqual(bank.warnings, [])
})

test('a Battery bank device is also just a bank of one', () => {
  const [bank] = deriveBanks({ devices: [batt('big', { capacityAh: 400, nominalVoltage: 24 })], cables: [] })
  assert.equal(bank.voltage, 24)
  assert.equal(bank.capacityAh, 400)
})

test('two in parallel, with a plain cable counting as parallel', () => {
  for (const kind of ['parallel', null]) {
    const [bank, ...rest] = deriveBanks({ devices: [batt('a'), batt('b', { capacityAh: 150 })], cables: [link('a', 'b', kind)] })
    assert.equal(rest.length, 0)
    assert.deepEqual(bank.strings, [['a'], ['b']])
    assert.equal(bank.layout.label, '1S2P')
    assert.equal(bank.voltage, 12)
    assert.equal(bank.capacityAh, 250)
    assert.equal(bank.usableAh, 125)
    assert.equal(bank.cableIds.length, 1)
  }
})

test('two in series', () => {
  const [bank] = deriveBanks({ devices: [batt('a'), batt('b', { capacityAh: 80 })], cables: [link('b', 'a', 'series')] })
  assert.deepEqual(bank.strings, [['a', 'b']])
  assert.equal(bank.layout.label, '2S1P')
  assert.equal(bank.voltage, 24)
  assert.equal(bank.capacityAh, 80)
  assert.equal(bank.energyWh, 24 * 80)
})

test('2S2P', () => {
  const devices = ['a1', 'a2', 'b1', 'b2'].map((id) => batt(id))
  const cables = [link('a1', 'a2', 'series'), link('b1', 'b2', 'series'), link('a1', 'b1', 'parallel'), link('a2', 'b2', 'parallel')]
  const [bank] = deriveBanks({ devices, cables })
  assert.deepEqual(bank.strings, [['a1', 'a2'], ['b1', 'b2']])
  assert.deepEqual(bank.layout, { series: 2, parallel: 2, label: '2S2P' })
  assert.equal(bank.voltage, 24)
  assert.equal(bank.capacityAh, 200)
  assert.equal(bank.usableAh, 100)
  assert.equal(bank.cableIds.length, 4)
  assert.deepEqual(bank.warnings, [])
})

test('4P', () => {
  const devices = ['a', 'b', 'c', 'd'].map((id) => batt(id, { capacityAh: 50 }))
  const cables = [link('a', 'b'), link('b', 'c', 'parallel'), link('c', 'd', 'parallel'), link('a', 'd', 'parallel')]
  const [bank] = deriveBanks({ devices, cables })
  assert.equal(bank.layout.label, '1S4P')
  assert.equal(bank.capacityAh, 200)
  assert.equal(bank.voltage, 12)
})

test('uneven strings: layout null with a warning, totals still given', () => {
  const devices = [batt('a1'), batt('a2'), batt('b1', { nominalVoltage: 24 })]
  const cables = [link('a1', 'a2', 'series'), link('a1', 'b1', 'parallel')]
  const [bank] = deriveBanks({ devices, cables })
  assert.equal(bank.layout, null)
  assert.ok(codes(bank).includes('uneven-strings'))
  assert.ok(codes(bank).includes('parallel-voltage-mismatch'))
  assert.equal(bank.voltage, 24)
  assert.equal(bank.capacityAh, 200)
})

test('strings that differ in voltage give the lowest and a warning', () => {
  const devices = [batt('a1'), batt('a2'), batt('b1'), batt('b2'), batt('b3')]
  const cables = [link('a1', 'a2', 'series'), link('b1', 'b2', 'series'), link('b2', 'b3', 'series'), link('a1', 'b1', 'parallel')]
  const [bank] = deriveBanks({ devices, cables })
  assert.equal(bank.voltage, 24)
  assert.ok(codes(bank).includes('strings-differ-in-voltage'))
  assert.ok(codes(bank).includes('uneven-strings'))
})

test('mixed voltages on a parallel link warn', () => {
  const [bank] = deriveBanks({ devices: [batt('a'), batt('b', { nominalVoltage: 6 })], cables: [link('a', 'b', 'parallel')] })
  assert.deepEqual(codes(bank), ['parallel-voltage-mismatch', 'strings-differ-in-voltage'])
  assert.equal(bank.voltage, 6)
})

test('a missing capacity or voltage makes the bank incomplete, never made up', () => {
  const [bank] = deriveBanks({ devices: [batt('a'), batt('b', { capacityAh: null })], cables: [link('a', 'b', 'parallel')] })
  assert.equal(bank.complete, false)
  assert.deepEqual(bank.missing, [{ deviceId: 'b', fields: ['capacityAh'] }])
  assert.equal(bank.capacityAh, 100)
  const [none] = deriveBanks({ devices: [batt('a', { capacityAh: null, nominalVoltage: null })], cables: [] })
  assert.equal(none.complete, false)
  assert.equal(none.capacityAh, null)
  assert.equal(none.voltage, null)
  assert.equal(none.usableAh, null)
  assert.equal(none.energyWh, null)
  assert.equal(none.usableEnergyWh, null)
})

test('mixed chemistries warn; chemistries and monitors are distinct lists', () => {
  const devices = [batt('a', { monitorDeviceId: 'm' }), batt('b', { chemistry: 'lifepo4', monitorDeviceId: 'm', usableFraction: 0.8 }), batt('c', { chemistry: null })]
  const [bank] = deriveBanks({ devices, cables: [link('a', 'b'), link('b', 'c')] })
  assert.deepEqual(bank.chemistries, ['agm', 'lifepo4'])
  assert.ok(codes(bank).includes('mixed-chemistries'))
  assert.deepEqual(bank.monitorDeviceIds, ['m'])
  assert.equal(bank.usableAh, 300 * 0.5)
})

test('a cycle or a branch cannot be reduced: no layout, no totals', () => {
  const ids = ['a', 'b', 'c']
  const [cycle] = deriveBanks({ devices: ids.map((i) => batt(i)), cables: [link('a', 'b', 'series'), link('b', 'c', 'series'), link('c', 'a', 'series')] })
  assert.ok(codes(cycle).includes('not-reducible'))
  assert.equal(cycle.layout, null)
  assert.equal(cycle.voltage, null)
  assert.equal(cycle.capacityAh, null)
  assert.equal(cycle.complete, false)
  const [branch] = deriveBanks({ devices: ['a', 'b', 'c', 'd'].map((i) => batt(i)), cables: [link('a', 'b', 'series'), link('a', 'c', 'series'), link('a', 'd', 'series')] })
  assert.ok(codes(branch).includes('not-reducible'))
  const [mixed] = deriveBanks({ devices: [batt('a'), batt('b')], cables: [link('a', 'b', 'series'), link('a', 'b', 'parallel')] })
  assert.ok(codes(mixed).includes('not-reducible'))
  assert.deepEqual(cycle.batteryIds, ['a', 'b', 'c'])
})

test('removed devices and cables are ignored; other roles are not batteries', () => {
  const devices = [batt('a'), batt('b', { status: 'removed' }), batt('c'), { id: 'x', role: 'consumer', status: 'active' }]
  const cables = [link('a', 'b', 'parallel'), link('a', 'c', 'parallel', { status: 'removed' }), link('a', 'x', 'parallel')]
  const banks = deriveBanks({ devices, cables })
  assert.deepEqual(banks.map((b) => b.batteryIds), [['a'], ['c']])
  assert.deepEqual(banks[0].cableIds, [])
})

test('protectors come from the circuits that a battery supplies', () => {
  const devices = [
    batt('a'), batt('b'),
    { id: 'f', name: 'Fuse', role: 'distribution', status: 'active', tripRatingA: 100, nominalVoltage: 12 },
    { id: 'l', name: 'Load', role: 'consumer', status: 'active', ratedPowerW: 100 }
  ]
  const cables = [
    link('a', 'b', 'parallel'),
    { id: 'w1', fromDeviceId: 'a', toDeviceId: 'f', status: 'active', conductors: [{ conductor: 'positive' }] },
    { id: 'w2', fromDeviceId: 'f', toDeviceId: 'l', status: 'active', conductors: [{ conductor: 'positive' }] }
  ]
  const [bank] = deriveBanks({ devices, cables })
  assert.deepEqual(bank.protectedBy, ['f'])
})

test('the store serves the richer banks, including a series link written through it', () => {
  const store = new Store(':memory:')
  const mk = (name) => store.create('device', { name, type: 'Battery', role: 'storage', nominal_voltage: 12, capacity_ah: 100, usable_fraction: 0.5, chemistry: 'agm' })
  const a = mk('A'); const b = mk('B')
  store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, link: 'series' })
  const lone = mk('C')
  const banks = store.deriveAll().banks
  assert.equal(banks.length, 2)
  const pair = banks.find((x) => x.batteryIds.length === 2)
  assert.equal(pair.layout.label, '2S1P')
  assert.equal(pair.voltage, 24)
  assert.equal(pair.capacityAh, 100)
  assert.equal(pair.cableIds.length, 1)
  assert.deepEqual(banks.find((x) => x.batteryIds[0] === lone.id).strings, [[lone.id]])
  store.close()
})
