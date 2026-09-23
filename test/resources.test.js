'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

function freshProvider (kind, type) {
  const store = new Store(':memory:')
  return { store, provider: createResourceProvider(store, kind, type) }
}

test('setResource creates a new record when the id is unknown', async () => {
  const { store, provider } = freshProvider('device', 'wiringDevices')
  const id = 'device-1'

  await provider.methods.setResource(id, { name: 'Bilge pump', type: 'pump', zone: 'bilge' })

  const resource = await provider.methods.getResource(id)
  assert.equal(resource.name, 'Bilge pump')
  assert.equal(resource.zone, 'bilge')
  assert.equal(resource.status, 'active')

  store.close()
})

test('setResource updates an existing record in place', async () => {
  const { store, provider } = freshProvider('device', 'wiringDevices')
  const id = 'device-1'
  await provider.methods.setResource(id, { name: 'Bilge pump' })

  await provider.methods.setResource(id, { name: 'Bilge pump', zone: 'bilge' })

  const resource = await provider.methods.getResource(id)
  assert.equal(resource.zone, 'bilge')
  assert.equal((await store.list('device')).length, 1)

  store.close()
})

test('listResources returns an id-keyed map with camelCase fields', async () => {
  const { store, provider } = freshProvider('wireRun', 'wiringWireRuns')
  const circuits = createResourceProvider(store, 'circuit', 'wiringCircuits')
  await circuits.methods.setResource('c1', { name: 'Bilge pump circuit' })

  await provider.methods.setResource('wr-1', {
    circuitId: 'c1',
    fromEndpoint: 'breaker-4',
    toEndpoint: 'bilge-pump',
    gauge: 14,
    gaugeUnit: 'AWG'
  })

  const all = await provider.methods.listResources()
  assert.deepEqual(Object.keys(all), ['wr-1'])
  assert.equal(all['wr-1'].circuitId, 'c1')
  assert.equal(all['wr-1'].gaugeUnit, 'AWG')

  store.close()
})

test('getResource on an unknown id throws', async () => {
  const { store, provider } = freshProvider('circuit', 'wiringCircuits')
  await assert.rejects(() => provider.methods.getResource('nope'))
  store.close()
})

test('deleteResource soft-deletes: record stays readable with status removed', async () => {
  const { store, provider } = freshProvider('circuit', 'wiringCircuits')
  await provider.methods.setResource('c1', { name: 'Bilge pump circuit' })

  await provider.methods.deleteResource('c1')

  const resource = await provider.methods.getResource('c1')
  assert.equal(resource.status, 'removed')

  store.close()
})

test('deleteResource on an unknown id throws', async () => {
  const { store, provider } = freshProvider('circuit', 'wiringCircuits')
  await assert.rejects(() => provider.methods.deleteResource('nope'))
  store.close()
})
