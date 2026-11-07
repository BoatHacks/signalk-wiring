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

test('a wire run route round-trips as an array through the provider', async () => {
  const store = new Store(':memory:')
  const circuits = createResourceProvider(store, 'circuit', 'wiringCircuits')
  const runs = createResourceProvider(store, 'wireRun', 'wiringWireRuns')
  await circuits.methods.setResource('c1', { name: 'C' })

  const route = [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0.5, z: 1 }]
  await runs.methods.setResource('r1', { circuitId: 'c1', route })

  assert.deepEqual((await runs.methods.getResource('r1')).route, route)
  assert.deepEqual((await runs.methods.listResources()).r1.route, route)
  assert.equal(store.get('wireRun', 'r1').route, JSON.stringify(route))

  store.close()
})

test('a plan calibration round-trips as an object and a null route stays null', async () => {
  const store = new Store(':memory:')
  const plans = createResourceProvider(store, 'plan', 'wiringPlans')
  const runs = createResourceProvider(store, 'wireRun', 'wiringWireRuns')
  const circuits = createResourceProvider(store, 'circuit', 'wiringCircuits')

  const calibration = { originPx: [10, 20], pxPerMeter: 42 }
  await plans.methods.setResource('p1', { name: 'Main deck', view: 'top', calibration })
  assert.deepEqual((await plans.methods.getResource('p1')).calibration, calibration)

  await circuits.methods.setResource('c1', { name: 'C' })
  await runs.methods.setResource('r1', { circuitId: 'c1' })
  assert.equal((await runs.methods.getResource('r1')).route, null)

  store.close()
})
