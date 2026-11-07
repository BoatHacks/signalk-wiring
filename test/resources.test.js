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
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  await devices.methods.setResource('d1', { name: 'Fuse' })
  await devices.methods.setResource('d2', { name: 'Bilge pump' })

  await provider.methods.setResource('wr-1', {
    fromDeviceId: 'd1',
    toDeviceId: 'd2',
    conductors: [{ conductor: 'positive', color: 'red' }],
    gauge: 14,
    gaugeUnit: 'AWG'
  })

  const all = await provider.methods.listResources()
  assert.deepEqual(Object.keys(all), ['wr-1'])
  assert.equal(all['wr-1'].fromDeviceId, 'd1')
  assert.deepEqual(all['wr-1'].conductors, [{ conductor: 'positive', color: 'red', fromDeviceId: null, toDeviceId: null, fromTerminal: null, toTerminal: null }])
  assert.equal(all['wr-1'].gaugeUnit, 'AWG')

  store.close()
})

test('getResource on an unknown id throws', async () => {
  const { store, provider } = freshProvider('circuit', 'wiringCircuits')
  await assert.rejects(() => provider.methods.getResource('nope'))
  store.close()
})

test('deleteResource soft-deletes: record stays readable with status removed', async () => {
  const { store, provider } = freshProvider('device', 'wiringDevices')
  await provider.methods.setResource('d1', { name: 'Bilge pump' })

  await provider.methods.deleteResource('d1')

  const resource = await provider.methods.getResource('d1')
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
  const runs = createResourceProvider(store, 'wireRun', 'wiringWireRuns')

  const route = [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0.5, z: 1 }]
  await runs.methods.setResource('r1', { route })

  assert.deepEqual((await runs.methods.getResource('r1')).route, route)
  assert.deepEqual((await runs.methods.listResources()).r1.route, route)
  assert.equal(store.get('wireRun', 'r1').route, JSON.stringify(route))

  store.close()
})

test('a plan calibration round-trips as an object and a null route stays null', async () => {
  const store = new Store(':memory:')
  const plans = createResourceProvider(store, 'plan', 'wiringPlans')
  const runs = createResourceProvider(store, 'wireRun', 'wiringWireRuns')

  const calibration = { originPx: [10, 20], pxPerMeter: 42 }
  await plans.methods.setResource('p1', { name: 'Main deck', view: 'top', calibration })
  assert.deepEqual((await plans.methods.getResource('p1')).calibration, calibration)

  await runs.methods.setResource('r1', {})
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

test('deleting a plan through the provider marks it removed and keeps the record', async () => {
  const store = new Store(':memory:')
  const plans = createResourceProvider(store, 'plan', 'wiringPlans')
  await plans.methods.setResource('p1', { name: 'Deck', view: 'top' })

  await plans.methods.deleteResource('p1')

  assert.equal((await plans.methods.getResource('p1')).status, 'removed')
  assert.equal(store.changeLog('plan', 'p1').length, 2)
  store.close()
})

test('clearing a device position through the provider sets every axis to null', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  await devices.methods.setResource('d1', { name: 'Pump', posX: 1, posY: 2, posZ: 3 })

  await devices.methods.setResource('d1', { name: 'Pump', posX: null, posY: null, posZ: null })

  const device = await devices.methods.getResource('d1')
  assert.deepEqual([device.posX, device.posY, device.posZ], [null, null, null])
  store.close()
})

test('a device icon attachment id round-trips through the provider', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  await devices.methods.setResource('d1', { name: 'Plotter' })
  const attachment = store.createAttachment({
    owner_type: 'device', owner_id: 'd1', filename: 'a.png', mime_type: 'image/png', uploaded_at: 't'
  })
  await devices.methods.setResource('d1', { name: 'Plotter', iconAttachmentId: attachment.id })
  assert.equal((await devices.methods.getResource('d1')).iconAttachmentId, attachment.id)
  store.close()
})

test('wiringConduits: a conduit resource carries its cable ids and a cable its conduit ids', async () => {
  const store = new Store(':memory:')
  const conduits = createResourceProvider(store, 'conduit', 'wiringConduits')
  const runs = createResourceProvider(store, 'wireRun', 'wiringWireRuns')
  await runs.methods.setResource('w1', {})
  await runs.methods.setResource('w2', {})
  await conduits.methods.setResource('k1', { name: 'Galley', kind: 'conduit', innerDiameter: 25, diameterUnit: 'mm', cableIds: ['w1', 'w2'] })
  await conduits.methods.setResource('k2', { name: 'Mast', route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }] })

  const all = await conduits.methods.listResources()
  assert.deepEqual(all.k1.cableIds, ['w1', 'w2'])
  assert.equal(all.k1.innerDiameter, 25)
  assert.deepEqual(all.k2.cableIds, [])
  assert.deepEqual(all.k2.route, [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }])
  assert.deepEqual((await runs.methods.getResource('w1')).conduitIds, ['k1'])

  // A write without the list leaves assignments alone; with it, replaces them.
  await conduits.methods.setResource('k1', { name: 'Galley 2' })
  assert.deepEqual((await conduits.methods.getResource('k1')).cableIds, ['w1', 'w2'])
  await runs.methods.setResource('w1', { conduitIds: ['k2', 'k1'] })
  assert.deepEqual((await runs.methods.getResource('w1')).conduitIds, ['k2', 'k1'])
  await conduits.methods.setResource('k1', { name: 'Galley 2', cableIds: ['w2'] })
  assert.deepEqual((await runs.methods.getResource('w1')).conduitIds, ['k2'])

  await conduits.methods.deleteResource('k1')
  assert.equal((await conduits.methods.getResource('k1')).status, 'removed')
  store.close()
})

test('wiringWireRuns: a new wire run written with conduitIds is assigned in order', async () => {
  const store = new Store(':memory:')
  const conduits = createResourceProvider(store, 'conduit', 'wiringConduits')
  const runs = createResourceProvider(store, 'wireRun', 'wiringWireRuns')
  await conduits.methods.setResource('k1', { name: 'One' })
  await conduits.methods.setResource('k2', { name: 'Two' })

  await runs.methods.setResource('w1', { conduitIds: ['k2', 'k1'] })

  assert.deepEqual((await runs.methods.getResource('w1')).conduitIds, ['k2', 'k1'])
  assert.deepEqual((await conduits.methods.getResource('k1')).cableIds, ['w1'])
  store.close()
})

test('circuits: the resource carries what the cables imply, and cannot be made or removed by hand', async () => {
  const store = new Store(':memory:')
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  const runs = createResourceProvider(store, 'wireRun', 'wiringWireRuns')
  const circuits = createResourceProvider(store, 'circuit', 'wiringCircuits')
  await devices.methods.setResource('bat', { name: 'Battery', role: 'storage', nominalVoltage: 12 })
  await devices.methods.setResource('fuse', { name: 'Fuse', role: 'distribution', tripRatingA: 15 })
  await devices.methods.setResource('pump', { name: 'Pump', ratedPowerW: 60 })
  await runs.methods.setResource('w1', { fromDeviceId: 'bat', toDeviceId: 'fuse' })
  await runs.methods.setResource('w2', { fromDeviceId: 'fuse', toDeviceId: 'pump' })

  const all = await circuits.methods.listResources()
  const [circuit] = Object.values(all)
  assert.equal(circuit.name, 'Fuse')
  assert.equal(circuit.derived.ratingA, 15)
  assert.equal(circuit.derived.voltage, 12)
  assert.equal(circuit.derived.ac, false)
  assert.deepEqual(circuit.derived.endDeviceIds, ['pump'])

  await circuits.methods.setResource(circuit.id, { name: 'Bilge pump', notes: 'n', voltage: 24, status: 'removed', cableIds: [] })
  const renamed = await circuits.methods.getResource(circuit.id)
  assert.equal(renamed.name, 'Bilge pump')
  assert.equal(renamed.status, 'active') // not settable
  assert.equal(renamed.derived.voltage, 24) // the override wins
  assert.equal(renamed.derived.derivedVoltage, 12)

  await assert.rejects(() => circuits.methods.setResource('new', { name: 'By hand' }), /cannot be created by hand/)
  await assert.rejects(() => circuits.methods.deleteResource(circuit.id), /follow the cables/)
  store.close()
})
