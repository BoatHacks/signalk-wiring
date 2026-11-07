import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceFieldVisible, acConsumerIds, cleanTerminals, portNames, describeTerminal } from '../public/deviceFields.js'

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
