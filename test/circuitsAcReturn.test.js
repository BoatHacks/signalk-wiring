'use strict'

// Plan 0044: AC neutral and earth join the circuits their loads return and
// ground through, like negative cables do on the DC side.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveCircuits } = require('../src/circuits')

const dev = (id, role, extra = {}) => ({ id, name: id, role, status: 'active', ...extra })
const cable = (id, from, to, conductors) => ({ id, fromDeviceId: from, toDeviceId: to, status: 'active', conductors })
const inverter = dev('inv', 'converter', {
  terminals: [
    { name: 'l', conductor: 'line', port: 'AC out', voltage: 230 },
    { name: 'n', conductor: 'neutral', port: 'AC out', voltage: 230 },
    { name: 'pe', conductor: 'earth', port: 'AC out', voltage: 230 }
  ]
})
const L = (extra = {}) => ({ conductor: 'line', ...extra })
const N = { conductor: 'neutral' }
const E = { conductor: 'earth' }

// inverter -> breaker -> outlet -> toaster, with the neutral through a neutral
// bar and the earth through a ground bar down to a central ground.
const boat = (withGround = true) => ({
  devices: [
    inverter, dev('brk', 'distribution', { tripRatingA: 16 }), dev('outlet', 'distribution'), dev('toaster', 'consumer'),
    dev('nbar', 'distribution'), dev('gbar', 'distribution'), ...(withGround ? [dev('gnd', 'ground')] : [])
  ],
  cables: [
    cable('c-line', 'inv', 'brk', [L({ fromTerminal: 'l' })]),
    cable('c-brk', 'brk', 'outlet', [L()]),
    cable('c-neut-src', 'inv', 'nbar', [{ ...N, fromTerminal: 'n' }]),
    cable('c-neut-bar', 'nbar', 'outlet', [N]),
    cable('c-earth-bar', 'gbar', 'outlet', [E]),
    cable('c-earth-gnd', 'gnd', 'gbar', [E]),
    cable('c-toaster', 'outlet', 'toaster', [L(), N, E])
  ]
})

const circuitOf = (result) => result.circuits.find((c) => c.protectorId === 'brk')

test('neutral and earth cables join the circuit whose load returns through them', () => {
  const result = deriveCircuits(boat())
  const c = circuitOf(result)
  assert.equal(c.ac, true)
  for (const id of ['c-neut-src', 'c-neut-bar', 'c-earth-bar', 'c-earth-gnd', 'c-toaster']) assert.ok(c.returnCableIds.includes(id), id)
  assert.deepEqual(c.noEarthDeviceIds, [])
  assert.deepEqual(result.warnings, [])
})

test('earth ends only at a ground device: none on the boat, nothing joins and nothing is listed', () => {
  const c = circuitOf(deriveCircuits(boat(false)))
  assert.ok(!c.returnCableIds.includes('c-earth-bar'))
  assert.ok(!c.returnCableIds.includes('c-earth-gnd'))
  assert.deepEqual(c.noEarthDeviceIds, [])
})

test('an earth path that ends at a converter does not count', () => {
  const b = boat()
  b.cables = b.cables.filter((x) => x.id !== 'c-earth-gnd')
  b.cables.push(cable('c-earth-inv', 'inv', 'gbar', [{ ...E, fromTerminal: 'pe' }]))
  const c = circuitOf(deriveCircuits(b))
  assert.ok(!c.returnCableIds.includes('c-earth-bar'))
  assert.deepEqual(c.noEarthDeviceIds, ['toaster'])
})

test('a consumer with no earth path is listed once a ground device exists, without a warning', () => {
  const b = boat()
  b.cables = b.cables.filter((x) => x.id !== 'c-earth-gnd')
  const result = deriveCircuits(b)
  assert.deepEqual(circuitOf(result).noEarthDeviceIds, ['toaster'])
  assert.deepEqual(result.warnings, [])
})

test('a neutral bar shared by two circuits serves both', () => {
  const b = boat()
  b.devices.push(dev('brk2', 'distribution', { tripRatingA: 10 }), dev('lamp', 'consumer'))
  b.cables.push(cable('c-line2', 'inv', 'brk2', [L({ fromTerminal: 'l' })]), cable('c-lamp', 'brk2', 'lamp', [L()]), cable('c-lamp-n', 'nbar', 'lamp', [N]))
  const result = deriveCircuits(b)
  const second = result.circuits.find((c) => c.protectorId === 'brk2')
  assert.ok(second.returnCableIds.includes('c-neut-src'))
  assert.ok(second.returnCableIds.includes('c-lamp-n'))
  assert.ok(circuitOf(result).returnCableIds.includes('c-neut-src'))
})

test('a separate neutral cable that dead-ends warns; a neutral inside the feed cable never does', () => {
  const b = boat()
  b.devices.push(dev('kettle', 'consumer'), dev('stub', 'distribution'))
  b.cables.push(cable('c-kettle', 'outlet', 'kettle', [L()]), cable('c-kettle-n', 'stub', 'kettle', [N]))
  let result = deriveCircuits(b)
  assert.deepEqual(result.warnings.map((w) => [w.code, w.deviceId]), [['neutral-incomplete', 'kettle']])

  const lone = boat()
  lone.devices.push(dev('stub', 'distribution'))
  lone.cables = lone.cables.map((x) => (x.id === 'c-toaster' ? cable('c-toaster', 'outlet', 'toaster', [L(), N]) : x))
  lone.cables = lone.cables.filter((x) => x.id !== 'c-neut-bar') // the neutral inside the feed cable leads nowhere
  result = deriveCircuits(lone)
  assert.deepEqual(result.warnings, [])
})

test('an AC consumer with no neutral anywhere is assumed to return alongside its feed', () => {
  const b = boat()
  b.devices.push(dev('fan', 'consumer'))
  b.cables.push(cable('c-fan', 'outlet', 'fan', [L()]))
  const c = circuitOf(deriveCircuits(b))
  assert.ok(c.implicitReturnDeviceIds.includes('fan'))
})

test('an enclosure on the path passes the neutral and earth walk through', () => {
  const b = boat()
  b.devices.push(dev('box', 'enclosure'))
  b.cables = b.cables.map((x) => (x.id === 'c-earth-bar' ? cable('c-earth-bar', 'gbar', 'box', [E]) : x))
  b.cables.push(cable('c-earth-box', 'box', 'outlet', [E]))
  const c = circuitOf(deriveCircuits(b))
  assert.ok(c.returnCableIds.includes('c-earth-bar'))
  assert.ok(c.returnCableIds.includes('c-earth-box'))
})

test('DC circuits still trace negative, and an earth wire on a DC cable joins its circuit with no earth note', () => {
  const result = deriveCircuits({
    devices: [dev('bat', 'storage', { nominalVoltage: 12 }), dev('f1', 'distribution', { tripRatingA: 10 }), dev('lamp', 'consumer'), dev('nb', 'distribution'), dev('gnd', 'ground')],
    cables: [
      cable('p1', 'bat', 'f1', [{ conductor: 'positive' }]),
      cable('p2', 'f1', 'lamp', [{ conductor: 'positive' }, { conductor: 'negative', fromDeviceId: 'nb' }]),
      cable('n1', 'nb', 'bat', [{ conductor: 'negative' }]),
      cable('e1', 'gnd', 'lamp', [E])
    ]
  })
  const c = result.circuits[0]
  assert.deepEqual(c.returnCableIds, ['e1', 'n1', 'p2'])
  assert.deepEqual(c.noEarthDeviceIds, [])
})

test('a combined cable (line, neutral, earth) is recorded on its own circuit only, not on every circuit downstream', () => {
  const result = deriveCircuits({
    devices: [inverter, dev('main', 'distribution', { tripRatingA: 32 }), dev('panel', 'distribution'), dev('brkB', 'distribution', { tripRatingA: 10 }), dev('lamp', 'consumer')],
    cables: [
      cable('c1', 'inv', 'main', [L({ fromTerminal: 'l' }), { ...N, fromTerminal: 'n' }]),
      cable('c2', 'main', 'panel', [L(), N]),
      cable('c3', 'panel', 'brkB', [L(), N]),
      cable('c4', 'brkB', 'lamp', [L(), N])
    ]
  })
  const branch = result.circuits.find((c) => c.protectorId === 'brkB')
  // the lamp's neutral reaches the inverter through c4, c3, c2, c1, but only the branch's own cables are recorded
  assert.ok(!branch.returnCableIds.includes('c1'))
  assert.ok(!branch.returnCableIds.includes('c2'))
  assert.deepEqual(result.warnings, [])
})
