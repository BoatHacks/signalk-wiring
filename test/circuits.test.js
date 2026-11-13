'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveCircuits } = require('../src/circuits')

// Small builders so each test reads like the boat it describes.
const dev = (id, role, extra = {}) => ({ id, name: id, role, status: 'active', ...extra })
const battery = (id, v = 12) => dev(id, 'storage', { nominalVoltage: v })
const fuse = (id, a = 10) => dev(id, 'distribution', { tripRatingA: a })
const part = (id) => dev(id, 'distribution') // switch, bus bar, splice: no trip rating
const lamp = (id) => dev(id, 'consumer')
const cable = (id, from, to, conductors) => ({
  id, fromDeviceId: from, toDeviceId: to, status: 'active', ...(conductors ? { conductors } : {})
})

const byKey = (result) => Object.fromEntries(result.circuits.map((c) => [c.key, c]))
const sorted = (list) => [...list].sort()

test('battery, fuse, switch and lamp make one protected circuit', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1', 10), part('sw'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'f1'), cable('c2', 'f1', 'sw'), cable('c3', 'sw', 'lamp')]
  })

  assert.equal(result.circuits.length, 1)
  const circuit = result.circuits[0]
  assert.equal(circuit.key, 'protector:f1')
  assert.equal(circuit.protectorId, 'f1')
  assert.deepEqual(circuit.cableIds, ['c1', 'c2', 'c3'])
  assert.deepEqual(sorted(circuit.deviceIds), ['bat', 'f1', 'lamp', 'sw'])
  assert.deepEqual(circuit.supplyDeviceIds, ['bat'])
  assert.deepEqual(circuit.endDeviceIds, ['lamp'])
  assert.equal(circuit.ratingA, 10)
  assert.equal(circuit.voltage, 12)
  assert.equal(circuit.unprotected, false)
  assert.equal(circuit.ac, false)
})

test('a bus bar with two fused branches is three circuits: the feeder and one per branch', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('m', 100), part('bb'), fuse('f1', 10), fuse('f2', 15), lamp('lamp'), lamp('pump')],
    cables: [
      cable('c1', 'bat', 'm'), cable('c2', 'm', 'bb'),
      cable('c3', 'bb', 'f1'), cable('c4', 'f1', 'lamp'),
      cable('c5', 'bb', 'f2'), cable('c6', 'f2', 'pump')
    ]
  })
  const circuits = byKey(result)

  assert.deepEqual(Object.keys(circuits).sort(), ['protector:f1', 'protector:f2', 'protector:m'])
  assert.deepEqual(circuits['protector:m'].cableIds, ['c1', 'c2'])
  assert.deepEqual(circuits['protector:f1'].cableIds, ['c3', 'c4'])
  assert.deepEqual(circuits['protector:f2'].cableIds, ['c5', 'c6'])
  assert.equal(circuits['protector:m'].ratingA, 100)
  assert.equal(circuits['protector:f2'].ratingA, 15)
  // The feeder ends at the bus bar, not at a load; the branches trace back to the battery.
  assert.deepEqual(circuits['protector:m'].endDeviceIds, [])
  assert.deepEqual(circuits['protector:f1'].supplyDeviceIds, ['bat'])
  assert.equal(circuits['protector:f1'].voltage, 12)
  assert.deepEqual(result.warnings, [])
})

test('two lamps joined by a splice after one fuse are one circuit', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), part('splice'), lamp('a'), lamp('b')],
    cables: [cable('c1', 'bat', 'f1'), cable('c2', 'f1', 'splice'), cable('c3', 'splice', 'a'), cable('c4', 'splice', 'b')]
  })
  assert.equal(result.circuits.length, 1)
  assert.deepEqual(result.circuits[0].cableIds, ['c1', 'c2', 'c3', 'c4'])
  assert.deepEqual(result.circuits[0].endDeviceIds, ['a', 'b'])
})

test('an unfused wire is still a circuit, flagged unprotected and keyed by its first cable', () => {
  const direct = deriveCircuits({
    devices: [battery('bat'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'lamp')]
  })
  assert.equal(direct.circuits[0].key, 'cable:c1')
  assert.equal(direct.circuits[0].unprotected, true)
  assert.equal(direct.circuits[0].protectorId, null)
  assert.equal(direct.circuits[0].ratingA, null)
  assert.equal(direct.circuits[0].voltage, 12)

  const viaSwitch = deriveCircuits({
    devices: [battery('bat'), part('sw'), lamp('lamp')],
    cables: [cable('c2', 'sw', 'lamp'), cable('c1', 'bat', 'sw')]
  })
  assert.equal(viaSwitch.circuits.length, 1)
  assert.equal(viaSwitch.circuits[0].key, 'cable:c1')
  assert.deepEqual(viaSwitch.circuits[0].cableIds, ['c1', 'c2'])
})

test('an unfused load on a bus bar is its own unprotected circuit beside the fused branches', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('m', 100), part('bb'), fuse('f1'), lamp('a'), lamp('b')],
    cables: [
      cable('c1', 'bat', 'm'), cable('c2', 'm', 'bb'), cable('c3', 'bb', 'f1'), cable('c4', 'f1', 'a'),
      cable('c7', 'bb', 'b')
    ]
  })
  const circuits = byKey(result)
  assert.deepEqual(Object.keys(circuits).sort(), ['cable:c7', 'protector:f1', 'protector:m'])
  assert.equal(circuits['cable:c7'].unprotected, true)
  assert.deepEqual(circuits['cable:c7'].cableIds, ['c7'])
  assert.equal(circuits['cable:c7'].voltage, 12)
})

test('fuses in series: the one nearest the load owns the branch, the main fuse owns the feeder', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('m', 100), fuse('f1', 10), lamp('lamp')],
    cables: [cable('c1', 'bat', 'm'), cable('c2', 'm', 'f1'), cable('c3', 'f1', 'lamp')]
  })
  const circuits = byKey(result)
  assert.deepEqual(circuits['protector:m'].cableIds, ['c1', 'c2'])
  assert.deepEqual(circuits['protector:f1'].cableIds, ['c3'])
  assert.equal(circuits['protector:f1'].voltage, 12)
})

test('battery to battery cables make a bank and belong to no circuit', () => {
  const result = deriveCircuits({
    devices: [battery('b1'), battery('b2'), fuse('f1', 100), fuse('f2', 100), part('bb'), fuse('fl'), lamp('lamp')],
    cables: [
      cable('cb', 'b1', 'b2'),
      cable('c1', 'b1', 'f1'), cable('c2', 'f1', 'bb'),
      cable('c3', 'b2', 'f2'), cable('c4', 'f2', 'bb'),
      cable('c5', 'bb', 'fl'), cable('c6', 'fl', 'lamp')
    ]
  })
  assert.deepEqual(result.banks, [{ batteryIds: ['b1', 'b2'], cableIds: ['cb'] }])
  assert.ok(result.circuits.every((c) => !c.cableIds.includes('cb')))
  const lampCircuit = byKey(result)['protector:fl']
  assert.deepEqual(lampCircuit.supplyDeviceIds, ['b1', 'b2'])
})

test('a solar panel, charge controller and battery make two circuits, each with its own voltage', () => {
  const controller = dev('ctrl', 'converter', {
    terminals: [
      { name: 'pv', conductor: 'positive', port: 'PV in', voltage: 36 },
      { name: 'batt', conductor: 'positive', port: 'Battery', voltage: 12 }
    ]
  })
  const result = deriveCircuits({
    devices: [dev('panel', 'source', { nominalVoltage: 36 }), fuse('fa', 15), controller, fuse('fb', 30), battery('bat')],
    cables: [
      cable('c1', 'panel', 'fa'),
      cable('c2', 'fa', 'ctrl', [{ conductor: 'positive', toTerminal: 'pv' }]),
      cable('c3', 'ctrl', 'fb', [{ conductor: 'positive', fromTerminal: 'batt' }]),
      cable('c4', 'fb', 'bat')
    ]
  })
  const circuits = byKey(result)
  assert.deepEqual(Object.keys(circuits).sort(), ['protector:fa', 'protector:fb'])
  assert.equal(circuits['protector:fa'].voltage, 36)
  assert.deepEqual(circuits['protector:fa'].supplyDeviceIds, ['panel'])
  assert.deepEqual(circuits['protector:fa'].endDeviceIds, ['ctrl'])
  assert.equal(circuits['protector:fb'].voltage, 12)
  assert.deepEqual(circuits['protector:fb'].supplyDeviceIds, ['ctrl'])
  assert.deepEqual(circuits['protector:fb'].endDeviceIds, ['bat'])
})

test('an inverter has a DC circuit on one side and an AC circuit on the other', () => {
  const inverter = dev('inv', 'converter', {
    terminals: [
      { name: 'dc', conductor: 'positive', port: 'DC in', voltage: 12 },
      { name: 'l', conductor: 'line', port: 'AC out', voltage: 230 },
      { name: 'n', conductor: 'neutral', port: 'AC out', voltage: 230 }
    ]
  })
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('fi', 150), inverter, fuse('brk', 16), lamp('outlet')],
    cables: [
      cable('c1', 'bat', 'fi'),
      cable('c2', 'fi', 'inv', [{ conductor: 'positive', toTerminal: 'dc' }]),
      cable('c3', 'inv', 'brk', [{ conductor: 'line', fromTerminal: 'l' }, { conductor: 'neutral', fromTerminal: 'n' }]),
      cable('c4', 'brk', 'outlet', [{ conductor: 'line' }, { conductor: 'neutral' }])
    ]
  })
  const circuits = byKey(result)
  assert.equal(circuits['protector:fi'].ac, false)
  assert.equal(circuits['protector:fi'].voltage, 12)
  assert.equal(circuits['protector:brk'].ac, true)
  assert.equal(circuits['protector:brk'].voltage, 230)
  assert.deepEqual(circuits['protector:brk'].cableIds, ['c3', 'c4'])
})

test('a two-conductor cable returns through a local negative bus bar', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), lamp('lamp'), part('nb')],
    cables: [
      cable('p1', 'bat', 'f1'),
      cable('p2', 'f1', 'lamp', [{ conductor: 'positive' }, { conductor: 'negative', fromDeviceId: 'nb' }]),
      cable('n1', 'nb', 'bat', [{ conductor: 'negative' }])
    ]
  })
  assert.equal(result.circuits.length, 1) // the negative-only cable is not a circuit of its own
  assert.deepEqual(result.circuits[0].returnCableIds, ['n1', 'p2'])
  assert.deepEqual(result.circuits[0].implicitReturnDeviceIds, [])
})

test('one negative wire shared by several consumers serves every one of their circuits', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), fuse('f2'), lamp('a'), lamp('b'), part('nb')],
    cables: [
      cable('p1', 'bat', 'f1'), cable('p2', 'f1', 'a', [{ conductor: 'positive' }, { conductor: 'negative', fromDeviceId: 'nb' }]),
      cable('p3', 'bat', 'f2'), cable('p4', 'f2', 'b', [{ conductor: 'positive' }, { conductor: 'negative', fromDeviceId: 'nb' }]),
      cable('n1', 'nb', 'bat', [{ conductor: 'negative' }])
    ]
  })
  const circuits = byKey(result)
  assert.deepEqual(circuits['protector:f1'].returnCableIds, ['n1', 'p2'])
  assert.deepEqual(circuits['protector:f2'].returnCableIds, ['n1', 'p4'])
  // The shared wire never joins the two circuits.
  assert.equal(result.circuits.length, 2)
})

test('a consumer with no negative recorded is assumed to return alongside its feed', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'f1'), cable('c2', 'f1', 'lamp')]
  })
  assert.deepEqual(result.circuits[0].returnCableIds, [])
  assert.deepEqual(result.circuits[0].implicitReturnDeviceIds, ['lamp'])
})

test('removed cables and devices are ignored, and a cable to a missing device warns', () => {
  const removedCable = { ...cable('c2', 'f1', 'lamp'), status: 'removed' }
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), lamp('lamp'), { ...lamp('old'), status: 'removed' }],
    cables: [cable('c1', 'bat', 'f1'), removedCable, cable('c3', 'f1', 'old'), cable('c4', 'f1', 'ghost')]
  })
  assert.deepEqual(result.circuits[0].cableIds, ['c1'])
  const codes = result.warnings.map((w) => `${w.code}:${w.cableId}`).sort()
  assert.deepEqual(codes, ['missing-device:c3', 'missing-device:c4'])
})

test('a cable entered backwards, from a load to a source, warns', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'f1'), cable('c2', 'lamp', 'f1')]
  })
  assert.ok(result.warnings.some((w) => w.code === 'backwards' && w.cableId === 'c2'))
})

test('a converter end with no terminal warns, since the side cannot be told', () => {
  const converter = dev('dcdc', 'converter', {
    terminals: [
      { name: 'in', conductor: 'positive', port: 'In', voltage: 24 },
      { name: 'out', conductor: 'positive', port: 'Out', voltage: 12 }
    ]
  })
  const result = deriveCircuits({
    devices: [battery('bat', 24), fuse('f1'), converter],
    cables: [cable('c1', 'bat', 'f1'), cable('c2', 'f1', 'dcdc')]
  })
  assert.ok(result.warnings.some((w) => w.code === 'converter-port-unknown' && w.cableId === 'c2'))
})

test('deriving twice from the same data gives the same answer, whatever the input order', () => {
  const devices = [battery('bat'), fuse('m', 100), part('bb'), fuse('f1'), fuse('f2'), lamp('a'), lamp('b')]
  const cables = [
    cable('c1', 'bat', 'm'), cable('c2', 'm', 'bb'), cable('c3', 'bb', 'f1'), cable('c4', 'f1', 'a'),
    cable('c5', 'bb', 'f2'), cable('c6', 'f2', 'b')
  ]
  const one = deriveCircuits({ devices, cables })
  const two = deriveCircuits({ devices: [...devices].reverse(), cables: [...cables].reverse() })
  assert.deepEqual(two, one)
})

test('a switch between a bus bar and a fuse still makes the cable part of the fused branch', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('m', 100), part('bb'), part('sw'), fuse('f1'), lamp('a'), fuse('f2'), lamp('b')],
    cables: [
      cable('c1', 'bat', 'm'), cable('c2', 'm', 'bb'),
      cable('c3', 'bb', 'sw'), cable('c4', 'sw', 'f1'), cable('c5', 'f1', 'a'),
      cable('c6', 'bb', 'f2'), cable('c7', 'f2', 'b')
    ]
  })
  const circuits = byKey(result)
  assert.deepEqual(circuits['protector:f1'].cableIds, ['c3', 'c4', 'c5'])
  assert.deepEqual(circuits['protector:m'].cableIds, ['c1', 'c2'])
})

test('cables that form a loop do not hang the derivation', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), part('x'), part('y'), lamp('lamp')],
    cables: [
      cable('c1', 'bat', 'f1'), cable('c2', 'f1', 'x'), cable('c3', 'x', 'y'),
      cable('c4', 'y', 'x'), cable('c5', 'y', 'lamp')
    ]
  })
  assert.equal(result.circuits.length, 1)
  assert.deepEqual(result.circuits[0].cableIds, ['c1', 'c2', 'c3', 'c4', 'c5'])
})

test('no devices or cables is no circuits', () => {
  assert.deepEqual(deriveCircuits({}), { circuits: [], banks: [], warnings: [], feeds: [] })
  assert.deepEqual(deriveCircuits({ devices: [battery('bat')], cables: [] }).circuits, [])
})

test('a negative that never reaches a battery warns, and the return wire stays out of the circuit list', () => {
  const result = deriveCircuits({
    devices: [battery('bat'), fuse('f1'), lamp('lamp'), part('nb')],
    cables: [
      cable('p1', 'bat', 'f1'),
      cable('p2', 'f1', 'lamp', [{ conductor: 'positive' }, { conductor: 'negative', fromDeviceId: 'nb' }])
    ]
  })
  assert.ok(result.warnings.some((w) => w.code === 'return-incomplete' && w.deviceId === 'lamp'))
  assert.deepEqual(result.circuits[0].returnCableIds, [])
})

test('a cable between two terminals of one device does not change or break the circuits', () => {
  const devices = [battery('bat'), fuse('f1', 10), lamp('lamp')]
  const plain = deriveCircuits({ devices, cables: [cable('c1', 'bat', 'f1'), cable('c2', 'f1', 'lamp')] })
  const withJumper = deriveCircuits({
    devices,
    cables: [cable('c1', 'bat', 'f1'), cable('c2', 'f1', 'lamp'), cable('j', 'lamp', 'lamp', [{ conductor: 'signal', fromTerminal: 'A', toTerminal: 'B' }])]
  })
  assert.deepEqual(withJumper.circuits.map((c) => c.key), plain.circuits.map((c) => c.key))
})
