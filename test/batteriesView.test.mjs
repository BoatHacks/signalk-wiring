import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bankTitle, fmtNumber, fmtVolts, fmtAh, fmtKwh, incompleteText, stringsText, singleBatteryBanks, allBanks
} from '../public/batteries.js'

const dev = (id, name, extra = {}) => ({ id, name, role: 'storage', status: 'active', ...extra })
const byId = (list) => new Map(list.map((d) => [d.id, d]))

test('bankTitle: one name, joined names, capped', () => {
  const d = byId([dev('a', 'A'), dev('b', 'B'), dev('c', 'C'), dev('d', 'D'), dev('e', 'E')])
  assert.equal(bankTitle({ batteryIds: ['a'] }, d), 'A')
  assert.equal(bankTitle({ batteryIds: ['a', 'b'] }, d), 'A + B')
  assert.equal(bankTitle({ batteryIds: ['a', 'b', 'c', 'd', 'e'] }, d), 'A + B + C + 2 more')
  assert.equal(bankTitle({ batteryIds: ['zz'] }, d), 'zz')
})

test('number formatting shows a dash for null', () => {
  assert.equal(fmtNumber(null), '-')
  assert.equal(fmtNumber(NaN), '-')
  assert.equal(fmtVolts(25.6), '25.6 V')
  assert.equal(fmtVolts(null), '-')
  assert.equal(fmtAh(400), '400 Ah')
  assert.equal(fmtAh(null), '-')
  assert.equal(fmtKwh(10240), '10.2 kWh')
  assert.equal(fmtKwh(null), '-')
})

test('incompleteText names the battery and the missing field', () => {
  const d = byId([dev('a', 'Cabin battery'), dev('b', 'Bow battery')])
  assert.equal(incompleteText({ missing: [] }, d), '')
  assert.equal(incompleteText({ missing: [{ deviceId: 'a', fields: ['capacityAh'] }] }, d), 'Cabin battery has no capacity set')
  assert.equal(
    incompleteText({ missing: [{ deviceId: 'a', fields: ['capacityAh', 'nominalVoltage'] }, { deviceId: 'b', fields: ['nominalVoltage'] }] }, d),
    'Cabin battery has no capacity or voltage set. Bow battery has no voltage set')
})

test('stringsText: empty for one battery, names per string otherwise', () => {
  const d = byId([dev('a', 'A'), dev('b', 'B'), dev('c', 'C'), dev('d', 'D')])
  assert.equal(stringsText({ strings: [['a']] }, d), '')
  assert.equal(stringsText({ strings: [['a', 'b'], ['c', 'd']] }, d), 'A + B | C + D')
  assert.equal(stringsText({ strings: [] }, d), '')
})

test('singleBatteryBanks: only storage devices in no bank, with their own numbers', () => {
  const devices = [
    dev('a', 'A', { capacityAh: 100, nominalVoltage: 12, usableFraction: 0.5, chemistry: 'agm', monitorDeviceId: 'm' }),
    dev('b', 'B', { capacityAh: 200 }),
    dev('c', 'C', { status: 'removed' }),
    { id: 'x', name: 'X', role: 'consumer', status: 'active' },
    dev('in', 'In bank')
  ]
  const out = singleBatteryBanks(devices, [{ batteryIds: ['in'] }])
  assert.deepEqual(out.map((b) => b.batteryIds), [['a'], ['b']])
  assert.equal(out[0].capacityAh, 100)
  assert.equal(out[0].usableAh, 50)
  assert.equal(out[0].energyWh, 1200)
  assert.equal(out[0].usableEnergyWh, 600)
  assert.equal(out[0].complete, true)
  assert.deepEqual(out[0].chemistries, ['agm'])
  assert.deepEqual(out[0].monitorDeviceIds, ['m'])
  assert.equal(out[1].complete, false)
  assert.equal(out[1].energyWh, null)
  assert.equal(out[1].usableAh, null)
  assert.deepEqual(out[1].missing, [{ deviceId: 'b', fields: ['nominalVoltage'] }])
})

test('allBanks sorts served and single banks together', () => {
  const out = allBanks([dev('a', 'A')], [{ batteryIds: ['b'] }])
  assert.deepEqual(out.map((b) => b.batteryIds[0]), ['a', 'b'])
})
