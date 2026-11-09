import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceFieldVisible, acConsumerIds, cleanTerminals, portNames, describeTerminal, ratedLine } from '../public/deviceFields.js'

test('trip rating shows on distribution devices, nominal voltage on batteries and sources', () => {
  assert.equal(deviceFieldVisible('tripRatingA', { role: 'distribution' }), true)
  assert.equal(deviceFieldVisible('tripRatingA', { role: 'consumer' }), false)
  assert.equal(deviceFieldVisible('nominalVoltage', { role: 'storage' }), true)
  assert.equal(deviceFieldVisible('nominalVoltage', { role: 'source' }), true)
  assert.equal(deviceFieldVisible('nominalVoltage', { role: 'distribution' }), false)
  assert.equal(deviceFieldVisible('name', { role: 'consumer' }), true)
})

test('power factor shows only on a consumer whose circuit is AC', () => {
  const ctx = { deviceId: 'd1', acDeviceIds: new Set(['d1']) }
  assert.equal(deviceFieldVisible('powerFactor', { role: 'consumer' }, ctx), true)
  assert.equal(deviceFieldVisible('powerFactor', { role: 'consumer' }, { deviceId: 'd2', acDeviceIds: new Set(['d1']) }), false)
  assert.equal(deviceFieldVisible('powerFactor', { role: 'storage' }, ctx), false)
  assert.equal(deviceFieldVisible('powerFactor', { role: 'consumer' }, {}), false)
  assert.equal(deviceFieldVisible('powerFactor', { role: 'consumer' }, { acDeviceIds: new Set(['d1']) }), false) // not saved yet
})

test('terminals show for converters, batteries and distribution, and for others only if present', () => {
  assert.equal(deviceFieldVisible('terminals', { role: 'converter' }), true)
  assert.equal(deviceFieldVisible('terminals', { role: 'storage' }), true)
  assert.equal(deviceFieldVisible('terminals', { role: 'consumer' }), false)
  assert.equal(deviceFieldVisible('terminals', { role: 'consumer', terminals: [{ name: 'x' }] }), true)
})

test('AC consumer ids come from live AC circuits only', () => {
  const ids = acConsumerIds([
    { status: 'active', derived: { ac: true, endDeviceIds: ['a', 'b'] } },
    { status: 'active', derived: { ac: false, endDeviceIds: ['c'] } },
    { status: 'removed', derived: { ac: true, endDeviceIds: ['d'] } },
    { status: 'active', derived: null }
  ])
  assert.deepEqual([...ids].sort(), ['a', 'b'])
})

test('cleanTerminals trims, drops nameless rows and normalises numbers and ports', () => {
  assert.deepEqual(cleanTerminals([
    { name: ' DC + ', conductor: 'positive', voltage: '12', port: ' DC in ' },
    { name: '', conductor: 'negative' },
    { name: 'AC L', conductor: 'line', voltage: '', port: '' }
  ]), [
    { name: 'DC +', conductor: 'positive', voltage: 12, port: 'DC in' },
    { name: 'AC L', conductor: 'line', voltage: null, port: null }
  ])
  assert.deepEqual(cleanTerminals(undefined), [])
})

test('port names are distinct and in order; terminals describe themselves', () => {
  const t = [{ name: 'a', port: 'DC in' }, { name: 'b', port: 'AC out' }, { name: 'c', port: 'DC in' }, { name: 'd' }]
  assert.deepEqual(portNames(t), ['DC in', 'AC out'])
  assert.equal(describeTerminal({ name: 'DC +', conductor: 'positive', voltage: 12, port: 'DC in' }), 'DC +, positive, 12 V, port DC in')
})

import { terminalPreset } from '../public/deviceFields.js'

test('standard terminals: DC-DC converter and MultiPlus, none for a plain type', () => {
  const dcdc = terminalPreset('DC-DC converter')
  assert.deepEqual(dcdc.terminals.map((t) => t.name), ['DC in +', 'DC in -', 'DC out +', 'DC out -'])
  assert.deepEqual(dcdc.terminals.map((t) => t.port), ['DC in', 'DC in', 'DC out', 'DC out'])
  const multi = terminalPreset('Victron MultiPlus-II 48/5000')
  assert.deepEqual([...new Set(multi.terminals.map((t) => t.port))], ['DC in', 'AC in', 'AC out 1', 'AC out 2', 'VE.Bus', 'Relay 1', 'Relay 2'])
  assert.equal(new Set(multi.terminals.map((t) => t.name)).size, multi.terminals.length)
  assert.equal(terminalPreset('Bilge pump'), null)
  assert.equal(terminalPreset('MPPT charger').terminals[2].port, 'Battery')
})

test('rating fields show for the distribution role only', () => {
  for (const key of ['ratedAcA', 'ratedAcV', 'ratedDcA', 'ratedDcV']) {
    assert.equal(deviceFieldVisible(key, { role: 'distribution' }), true)
    for (const role of ['consumer', 'storage', 'source', 'converter']) {
      assert.equal(deviceFieldVisible(key, { role }), false)
    }
  }
})

test('ratedLine writes the AC and DC ratings as one line', () => {
  assert.equal(ratedLine({ ratedDcA: 300, ratedDcV: 58 }), 'Rated: DC 300 A, 58 V')
  assert.equal(ratedLine({ ratedAcA: 16, ratedAcV: 230, ratedDcA: 16, ratedDcV: 48 }), 'Rated: AC 16 A, 230 V; DC 16 A, 48 V')
  assert.equal(ratedLine({ ratedAcV: 230 }), 'Rated: AC 230 V')
  assert.equal(ratedLine({ ratedDcA: null, ratedAcA: null }), null)
  assert.equal(ratedLine({}), null)
})

test('an enclosure has no terminals, rated power or current field', () => {
  assert.equal(deviceFieldVisible('terminals', { role: 'enclosure', terminals: [{ name: 'x' }] }), false)
  assert.equal(deviceFieldVisible('ratedPowerW', { role: 'enclosure' }), false)
  assert.equal(deviceFieldVisible('current', { role: 'enclosure' }), false)
  assert.equal(deviceFieldVisible('ratedPowerW', { role: 'consumer' }), true)
  assert.equal(deviceFieldVisible('current', { role: 'distribution' }), true)
})
