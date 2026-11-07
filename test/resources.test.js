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

test('tags round-trip as an array and zones are served as wiringZones', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  const zones = createResourceProvider(store, 'zone', 'wiringZones')

  await zones.methods.setResource('z1', { name: 'Salon' })
  await devices.methods.setResource('d1', { name: 'Speaker', zoneId: 'z1', tags: ['audio: main', 'audio: cockpit'] })

  const device = await devices.methods.getResource('d1')
  assert.deepEqual(device.tags, ['audio: main', 'audio: cockpit'])
  assert.equal(device.zone, 'Salon')
  assert.equal(device.zoneId, 'z1')

  // Renaming through the provider is an update of the existing zone.
  await zones.methods.setResource('z1', { name: 'Main salon' })
  assert.equal((await devices.methods.getResource('d1')).zone, 'Main salon')

  store.close()
})

test('deleting a zone through the provider removes it, but not while in use', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  const zones = createResourceProvider(store, 'zone', 'wiringZones')
  await zones.methods.setResource('z1', { name: 'Salon' })
  await devices.methods.setResource('d1', { name: 'Light', zoneId: 'z1' })

  await assert.rejects(zones.methods.deleteResource('z1'), /in use/)
  await devices.methods.setResource('d1', { name: 'Light', zoneId: null })
  await zones.methods.deleteResource('z1')
  assert.deepEqual(await zones.methods.listResources(), {})

  store.close()
})

test('a zone name written through the provider reuses a zone that differs only in case', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')

  await devices.methods.setResource('d1', { name: 'A', zone: 'Engine room' })
  await devices.methods.setResource('d2', { name: 'B', zone: 'engine ROOM' })
  await devices.methods.setResource('d3', { name: 'C', zone: 'Salon' })

  assert.equal(store.list('zone').length, 2)
  const a = await devices.methods.getResource('d1')
  const b = await devices.methods.getResource('d2')
  assert.equal(a.zoneId, b.zoneId)
  assert.equal(b.zone, 'Engine room')

  store.close()
})

test('a device role round-trips through the provider', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  await devices.methods.setResource('d1', { name: 'Shore power inlet', role: 'source', type: 'shore power' })
  const device = await devices.methods.getResource('d1')
  assert.equal(device.role, 'source')
  assert.equal(device.type, 'shore power')
  store.close()
})
