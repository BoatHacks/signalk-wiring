import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uniqueCopyName, duplicateDevicePayload, duplicateCablePrefill } from '../public/duplicate.js'
import { cableToValues } from '../public/cableForm.js'
import { Store } from '../src/store.js'
import { createResourceProvider } from '../src/resources.js'

test('uniqueCopyName appends copy and a counter while the name is taken', () => {
  assert.equal(uniqueCopyName('Pump', ['Pump']), 'Pump copy')
  assert.equal(uniqueCopyName('Pump', ['Pump', 'pump copy']), 'Pump copy 2')
  assert.equal(uniqueCopyName('Pump', ['Pump copy', 'Pump copy 2']), 'Pump copy 3')
  assert.equal(uniqueCopyName(' Pump ', []), 'Pump copy')
})

test('a device copy keeps the kind and ratings, not position, icon, attachments or calibration', () => {
  const device = {
    id: 'd1', name: 'Bilge pump', status: 'active', role: 'consumer', type: 'pump', zoneId: 'z1', tags: ['a'],
    ratedPowerW: 60, tripRatingA: 10, nominalVoltage: 12, powerFactor: 0.9,
    terminals: [{ name: 'Pos', polarity: 'positive' }], signalkPath: 'electrical.switches.x', switchPath: 's',
    confirmSwitching: true, neverRemote: false, meterPath: 'm', meterUnit: 'A', notes: 'n',
    posX: 1, posY: 2, posZ: 3, parentId: 'enclosure', iconAttachmentId: 'att',
    attachments: [{ id: 'att' }], history: [{ summary: 'Created' }], measured: { avgW: 1 },
    calibration: { avgW: 1 }, contents: ['child'], allContents: ['child'], boundaryCables: ['cable']
  }
  const copy = duplicateDevicePayload(device, ['Bilge pump'])
  assert.equal(copy.name, 'Bilge pump copy')
  assert.equal(copy.type, 'pump')
  assert.equal(copy.tripRatingA, 10)
  assert.equal(copy.nominalVoltage, 12)
  assert.deepEqual(copy.terminals, device.terminals)
  assert.notEqual(copy.terminals, device.terminals)
  for (const key of ['id', 'status', 'posX', 'posY', 'posZ', 'parentId', 'iconAttachmentId',
    'attachments', 'history', 'measured', 'calibration', 'contents', 'allContents', 'boundaryCables']) assert.ok(!(key in copy), key)
  copy.terminals[0].name = 'Changed'
  copy.tags.push('copy only')
  assert.equal(device.terminals[0].name, 'Pos')
  assert.deepEqual(device.tags, ['a'])
})

test('a battery copy keeps its details and monitoring paths through the resource API', async (t) => {
  const store = new Store(':memory:')
  t.after(() => store.close())
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  await devices.methods.setResource('monitor', { name: 'Battery monitor', type: 'Shunt' })
  const battery = {
    name: 'House battery', role: 'storage', type: 'Battery', current: 'dc', nominalVoltage: 12.8,
    chemistry: 'lifepo4', purpose: 'house', capacityAh: 200, usableFraction: 0.8,
    makeModel: 'Example 200', installedOn: '2025-05-01', monitorDeviceId: 'monitor',
    voltagePath: 'electrical.batteries.house.voltage', currentPath: 'electrical.batteries.house.current',
    socPath: 'electrical.batteries.house.capacity.stateOfCharge',
    timeRemainingPath: 'electrical.batteries.house.capacity.timeRemaining'
  }
  await devices.methods.setResource('source', battery)
  const source = await devices.methods.getResource('source')
  const copy = duplicateDevicePayload(source, [battery.name])
  assert.deepEqual(copy, { ...battery, name: 'House battery copy', confirmSwitching: false, neverRemote: false, terminals: [] })
  await devices.methods.setResource('copy', copy)
  const saved = await devices.methods.getResource('copy')
  for (const [key, value] of Object.entries(copy)) assert.deepEqual(saved[key], value, key)
  assert.equal(saved.id, 'copy')
  assert.deepEqual(await devices.methods.getResource('source'), source)
})

test('a device copy keeps explicit AC/DC current, both sets of ratings and schematic colors', () => {
  for (const current of ['ac', 'dc']) {
    const device = {
      name: 'Bus bar', role: 'distribution', type: 'Bus bar', current,
      ratedAcA: 16, ratedAcV: 230, ratedDcA: 100, ratedDcV: 48,
      schematicBoxColor: '#123456', schematicIconColor: '#abcdef'
    }
    assert.deepEqual(duplicateDevicePayload(device, []), { ...device, name: 'Bus bar copy' })
  }
})

test('a device copy skips unset fields but keeps zero and false values', () => {
  const device = {
    name: 'Battery', chemistry: undefined, monitorDeviceId: null, schematicBoxColor: null,
    current: undefined, ratedAcA: null, capacityAh: 0, usableFraction: 0, ratedPowerW: 0,
    confirmSwitching: false, neverRemote: false
  }
  assert.deepEqual(duplicateDevicePayload(device, []), {
    name: 'Battery copy', capacityAh: 0, usableFraction: 0, ratedPowerW: 0,
    confirmSwitching: false, neverRemote: false
  })
})

test('a cable copy keeps conductors, gauge, label, zone and tags but not length or notes', () => {
  const cable = {
    id: 'c1', fromDeviceId: 'a', toDeviceId: 'b', gauge: 2.5, gaugeUnit: 'mm2', length: 4, lengthUnit: 'm',
    cableLabel: 'W1', zoneId: 'z', tags: ['t'], notes: 'x', route: [{ x: 1 }],
    conductors: [{ conductor: 'positive', color: 'red', fromDeviceId: 'a', toDeviceId: 'b' }]
  }
  const pre = duplicateCablePrefill(cableToValues(cable))
  assert.equal(pre.fromDeviceId, 'a')
  assert.equal(pre.gauge, 2.5)
  assert.equal(pre.cableLabel, 'W1')
  assert.equal(pre.zoneId, 'z')
  assert.deepEqual(pre.tags, ['t'])
  assert.equal(pre.colors.positive, 'red')
  assert.ok(!('length' in pre) && !('notes' in pre) && !('route' in pre))
})
