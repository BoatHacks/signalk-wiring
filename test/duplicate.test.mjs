import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uniqueCopyName, duplicateDevicePayload, duplicateCablePrefill } from '../public/duplicate.js'
import { cableToValues } from '../public/cableForm.js'

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
    posX: 1, posY: 2, posZ: 3, iconAttachmentId: 'att', measured: { avgW: 1 }
  }
  const copy = duplicateDevicePayload(device, ['Bilge pump'])
  assert.equal(copy.name, 'Bilge pump copy')
  assert.equal(copy.type, 'pump')
  assert.equal(copy.tripRatingA, 10)
  assert.equal(copy.nominalVoltage, 12)
  assert.deepEqual(copy.terminals, device.terminals)
  assert.notEqual(copy.terminals, device.terminals)
  for (const key of ['id', 'status', 'posX', 'posY', 'posZ', 'iconAttachmentId', 'measured']) assert.ok(!(key in copy), key)
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
