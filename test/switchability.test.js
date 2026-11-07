'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveSwitchability } = require('../src/switchability')

// Small builders so each test reads like the boat it describes.
const dev = (id, role, extra = {}) => ({ id, name: id, role, status: 'active', ...extra })
const battery = (id, extra = {}) => dev(id, 'storage', { nominalVoltage: 12, ...extra })
const fuse = (id, a = 10) => dev(id, 'distribution', { tripRatingA: a })
const relay = (id, path, extra = {}) => dev(id, 'distribution', { switchPath: path, ...extra })
const part = (id) => dev(id, 'distribution')
const lamp = (id, extra = {}) => dev(id, 'consumer', extra)
const cable = (id, from, to) => ({ id, fromDeviceId: from, toDeviceId: to, status: 'active' })

test('a relay feeding one lamp makes the lamp switchable through the relay', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), fuse('f'), relay('r', 'sw.1.state'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'f'), cable('c2', 'f', 'r'), cable('c3', 'r', 'lamp')]
  })
  const l = result.consumers.lamp
  assert.equal(l.switchable, true)
  assert.equal(l.switchDeviceId, 'r')
  assert.deepEqual(l.switchDeviceIds, ['r'])
  assert.deepEqual(l.sharedWith, [])
  assert.equal(l.neverRemote, false)
  assert.equal(l.confirm, false)
  assert.equal(l.reason, null)
  assert.deepEqual(result.switches.r.consumerIds, ['lamp'])
})

test('a relay feeding two lamps on a splice is shared, and each lamp names the other', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), fuse('f'), relay('r', 'sw.1.state'), part('splice'), lamp('a'), lamp('b')],
    cables: [
      cable('c1', 'bat', 'f'), cable('c2', 'f', 'r'), cable('c3', 'r', 'splice'),
      cable('c4', 'splice', 'a'), cable('c5', 'splice', 'b')
    ]
  })
  assert.equal(result.consumers.a.switchDeviceId, 'r')
  assert.deepEqual(result.consumers.a.sharedWith, ['b'])
  assert.deepEqual(result.consumers.b.sharedWith, ['a'])
  assert.deepEqual(result.switches.r.consumerIds, ['a', 'b'])
})

test('a lamp with no switch in line is not switchable', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), fuse('f'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'f'), cable('c2', 'f', 'lamp')]
  })
  assert.equal(result.consumers.lamp.switchable, false)
  assert.equal(result.consumers.lamp.reason, 'no-switch')
  assert.equal(result.consumers.lamp.switchDeviceId, null)
})

test('a manual switch without a switch path does not make a lamp switchable, and is said so', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), part('toggle'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'toggle'), cable('c2', 'toggle', 'lamp')]
  })
  assert.equal(result.consumers.lamp.switchable, false)
  assert.equal(result.consumers.lamp.reason, 'no-switch')
})

test('never remote on the switch or the lamp locks the lamp; confirm flags carry over', () => {
  const locked = deriveSwitchability({
    devices: [battery('bat'), relay('r', 'sw.state', { neverRemote: true }), lamp('lamp')],
    cables: [cable('c1', 'bat', 'r'), cable('c2', 'r', 'lamp')]
  })
  assert.equal(locked.consumers.lamp.switchable, true)
  assert.equal(locked.consumers.lamp.neverRemote, true)
  assert.equal(locked.consumers.lamp.reason, 'never-remote')

  const lampLocked = deriveSwitchability({
    devices: [battery('bat'), relay('r', 'sw.state'), lamp('lamp', { neverRemote: true })],
    cables: [cable('c1', 'bat', 'r'), cable('c2', 'r', 'lamp')]
  })
  assert.equal(lampLocked.consumers.lamp.neverRemote, true)

  const confirm = deriveSwitchability({
    devices: [battery('bat'), relay('r', 'sw.state', { confirmSwitching: true }), lamp('lamp'), lamp('other', { confirmSwitching: true })],
    cables: [cable('c1', 'bat', 'r'), cable('c2', 'r', 'lamp'), cable('c3', 'r', 'other')]
  })
  assert.equal(confirm.consumers.lamp.confirm, true) // the shared relay asks
  assert.equal(confirm.consumers.other.confirm, true)
})

test('a relay shared with a critical or never-remote device carries their flags to every lamp on it', () => {
  const result = deriveSwitchability({
    devices: [
      battery('bat'), relay('r', 'sw.state'), part('splice'), lamp('lamp'),
      lamp('pump', { confirmSwitching: true }), lamp('anchorlight', { neverRemote: true })
    ],
    cables: [
      cable('c1', 'bat', 'r'), cable('c2', 'r', 'splice'), cable('c3', 'splice', 'lamp'),
      cable('c4', 'splice', 'pump'), cable('c5', 'splice', 'anchorlight')
    ]
  })
  assert.equal(result.consumers.lamp.confirm, true)
  assert.equal(result.consumers.lamp.neverRemote, true)
  assert.equal(result.switches.r.neverRemote, true)
  assert.equal(result.switches.r.confirm, true)
})

test('the lamp own flags ask for confirmation even when the relay does not', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), relay('r', 'sw.state'), lamp('pump', { confirmSwitching: true })],
    cables: [cable('c1', 'bat', 'r'), cable('c2', 'r', 'pump')]
  })
  assert.equal(result.consumers.pump.confirm, true)
})

test('two switches in series: the nearest one to the lamp is the one operated', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), relay('main', 'main.state'), part('bus'), relay('local', 'local.state'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'main'), cable('c2', 'main', 'bus'), cable('c3', 'bus', 'local'), cable('c4', 'local', 'lamp')]
  })
  assert.equal(result.consumers.lamp.switchDeviceId, 'local')
  assert.deepEqual(result.consumers.lamp.switchDeviceIds, ['local'])
  // The main switch also shares everything downstream of it.
  assert.deepEqual(result.switches.main.consumerIds, ['lamp'])
})

test('a main switch in front of a bus bar is shared by every lamp behind it', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), relay('main', 'main.state'), part('bus'), fuse('f1'), fuse('f2'), lamp('a'), lamp('b')],
    cables: [
      cable('c1', 'bat', 'main'), cable('c2', 'main', 'bus'), cable('c3', 'bus', 'f1'), cable('c4', 'f1', 'a'),
      cable('c5', 'bus', 'f2'), cable('c6', 'f2', 'b')
    ]
  })
  assert.equal(result.consumers.a.switchDeviceId, 'main')
  assert.deepEqual(result.consumers.a.sharedWith, ['b'])
})

test('a device with its own switch path is switchable by itself', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), lamp('plug', { switchPath: 'plug.state' })],
    cables: [cable('c1', 'bat', 'plug')]
  })
  assert.equal(result.consumers.plug.switchable, true)
  assert.equal(result.consumers.plug.switchDeviceId, 'plug')
  assert.deepEqual(result.consumers.plug.sharedWith, [])
})

test('a removed relay is ignored, and a relay behind a converter does not count past it', () => {
  const removed = deriveSwitchability({
    devices: [battery('bat'), relay('r', 'sw.state', { status: 'removed' }), lamp('lamp')],
    cables: [cable('c1', 'bat', 'lamp')]
  })
  assert.equal(removed.consumers.lamp.switchable, false)

  const converter = deriveSwitchability({
    devices: [
      battery('bat'), relay('r', 'sw.state'),
      dev('inv', 'converter', { terminals: [{ name: 'in', conductor: 'positive', port: 'dc' }, { name: 'out', conductor: 'line', port: 'ac' }] }),
      lamp('tv')
    ],
    cables: [
      { id: 'c1', fromDeviceId: 'bat', toDeviceId: 'r', status: 'active' },
      { id: 'c2', fromDeviceId: 'r', toDeviceId: 'inv', status: 'active', conductors: [{ conductor: 'positive', toTerminal: 'in' }] },
      { id: 'c3', fromDeviceId: 'inv', toDeviceId: 'tv', status: 'active', conductors: [{ conductor: 'line', fromTerminal: 'out' }] }
    ]
  })
  // Switching the relay would cut the inverter, but the lamp is fed by the inverter, a source of its own.
  assert.equal(converter.consumers.tv.switchable, false)
})

test('meters: the nearest meter upstream measures a consumer, a battery meter is low confidence and last', () => {
  const result = deriveSwitchability({
    devices: [
      battery('bat', { meterPath: 'bat.current', meterUnit: 'A' }),
      dev('shunt', 'distribution', { meterPath: 'shunt.current', meterUnit: 'A' }),
      fuse('f'), relay('r', 'sw.state', { meterPath: 'r.power', meterUnit: 'W' }), lamp('lamp')
    ],
    cables: [cable('c1', 'bat', 'shunt'), cable('c2', 'shunt', 'f'), cable('c3', 'f', 'r'), cable('c4', 'r', 'lamp')]
  })
  const meters = result.consumers.lamp.meters
  assert.deepEqual(meters.map((m) => [m.deviceId, m.path, m.unit, m.lowConfidence]), [
    ['r', 'r.power', 'W', false],
    ['shunt', 'shunt.current', 'A', false],
    ['bat', 'bat.current', 'A', true]
  ])
})

test('meters: a meter on the circuit record applies to the consumers of that circuit, and the circuit voltage is reported', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), fuse('f'), lamp('lamp'), lamp('other')],
    cables: [cable('c1', 'bat', 'f'), cable('c2', 'f', 'lamp'), cable('c3', 'f', 'other')],
    circuits: [{ id: 'circ1', key: 'protector:f', meterPath: 'circ.power', meterUnit: 'W', status: 'active' }]
  })
  const l = result.consumers.lamp
  assert.equal(l.voltage, 12)
  assert.deepEqual(l.meters.map((m) => [m.source, m.circuitId, m.path, m.unit]), [['circuit', 'circ1', 'circ.power', 'W']])
  assert.equal(result.consumers.other.meters.length, 1)
})

test('a circuit voltage override wins over the derived one', () => {
  const result = deriveSwitchability({
    devices: [battery('bat'), fuse('f'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'f'), cable('c2', 'f', 'lamp')],
    circuits: [{ id: 'circ1', key: 'protector:f', voltage: 24, status: 'active' }]
  })
  assert.equal(result.consumers.lamp.voltage, 24)
})

test('only consumers get an entry, and the same input always gives the same answer', () => {
  const input = {
    devices: [battery('bat'), relay('r', 'sw.state'), lamp('lamp')],
    cables: [cable('c1', 'bat', 'r'), cable('c2', 'r', 'lamp')]
  }
  const a = deriveSwitchability(input)
  assert.deepEqual(Object.keys(a.consumers), ['lamp'])
  assert.deepEqual(a, deriveSwitchability(input))
})
