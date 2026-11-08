import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { formatDuration, batteryReading, bankReading, bankReadingInput, batteryInputs, batteryPathsToWatch, STALE_MS } from '../public/liveBattery.js'
import { liveInfo, pathsToWatch, applyDelta } from '../public/live.js'

const require = createRequire(import.meta.url)
const { resolveBatteryPaths, deriveSwitchability } = require('../src/switchability.js')

test('durations in hours and minutes, days for long values', () => {
  assert.equal(formatDuration(22800), '6 h 20 min')
  assert.equal(formatDuration(2700), '45 min')
  assert.equal(formatDuration(7200), '2 h')
  assert.equal(formatDuration(30), 'less than a minute')
  assert.equal(formatDuration(0), 'less than a minute')
  assert.equal(formatDuration(2 * 86400 + 3 * 3600 + 600), '2 d 3 h')
  assert.equal(formatDuration(86400), '1 d')
  assert.equal(formatDuration(null), null)
  assert.equal(formatDuration(-5), null)
})

test('battery reading: volts, percent, time remaining', () => {
  assert.equal(batteryReading({ voltage: 12.83, soc: 0.87, current: 8, timeRemaining: 22800 }), '12.8 V, 87 %, 6 h 20 min')
  assert.equal(batteryReading({ voltage: 12.8, soc: 0.5 }), '12.8 V, 50 %')
  assert.equal(batteryReading({}), null)
  assert.equal(batteryReading({ voltage: null, soc: undefined }), null)
})

test('a null time remaining says not discharging only when the current shows no discharge', () => {
  assert.equal(batteryReading({ voltage: 13.2, soc: 1, current: 0, timeRemaining: null }), '13.2 V, 100 %, not discharging')
  assert.equal(batteryReading({ voltage: 13.2, soc: 1, current: -12.5, timeRemaining: null }), '13.2 V, 100 %, not discharging')
  assert.equal(batteryReading({ voltage: 12.4, soc: 0.6, current: 5, timeRemaining: null }), '12.4 V, 60 %')
  assert.equal(batteryReading({ voltage: 12.4, soc: 0.6, timeRemaining: null }), '12.4 V, 60 %')
  assert.equal(batteryReading({ voltage: 12.4, current: 0, timeRemaining: 3600 }), '12.4 V, 1 h')
})

test('stale readings are marked', () => {
  assert.equal(batteryReading({ voltage: 12.8, soc: 0.5, stale: true }), '12.8 V, 50 % (stale)')
})

test('a bank takes, per metric, the first battery with a value', () => {
  const list = [{ voltage: null, soc: 0.8, current: null, timeRemaining: null }, { voltage: 12.7, soc: 0.5, current: 0, timeRemaining: null }]
  assert.deepEqual(bankReadingInput(list), { soc: 0.8, voltage: 12.7, current: 0, stale: false })
  assert.equal(bankReading(list), '12.7 V, 80 %, not discharging')
  assert.equal(bankReading([]), null)
  assert.equal(bankReading([{ voltage: 12, stale: true }, { soc: 0.5, stale: false }]), '12.0 V, 50 %')
  assert.equal(bankReading([{ voltage: 12, stale: true }, { soc: 0.5, stale: true }]), '12.0 V, 50 % (stale)')
})

test('inputs from the stream values, with staleness from the stamps', () => {
  const paths = { voltagePath: 'electrical.batteries.1.voltage', socPath: 'electrical.batteries.1.capacity.stateOfCharge', currentPath: null, timeRemainingPath: null }
  const values = new Map([['electrical.batteries.1.voltage', 12.8], ['electrical.batteries.1.capacity.stateOfCharge', 0.9]])
  const now = 1000000
  const fresh = new Map([['electrical.batteries.1.voltage', now - 1000], ['electrical.batteries.1.capacity.stateOfCharge', now - 1000]])
  assert.deepEqual(batteryInputs(paths, values, fresh, now), { voltage: 12.8, soc: 0.9, current: null, timeRemaining: null, stale: false })
  const old = new Map([['electrical.batteries.1.voltage', now - STALE_MS - 1], ['electrical.batteries.1.capacity.stateOfCharge', now - STALE_MS - 1]])
  assert.equal(batteryInputs(paths, values, old, now).stale, true)
  const mixed = new Map([['electrical.batteries.1.voltage', now - STALE_MS - 1], ['electrical.batteries.1.capacity.stateOfCharge', now]])
  assert.equal(batteryInputs(paths, values, mixed, now).stale, false)
  assert.equal(batteryInputs(null, values), null)
  assert.equal(batteryInputs(paths, new Map(), fresh, now).stale, false)
})

test('battery paths: own first, else the monitor, else none', () => {
  const devices = [
    { id: 'b1', role: 'storage', voltagePath: 'own.v', monitorDeviceId: 'm' },
    { id: 'b2', role: 'storage', monitorDeviceId: 'm' },
    { id: 'b3', role: 'storage' },
    { id: 'b4', role: 'storage', monitorDeviceId: 'gone', status: 'removed' },
    { id: 'm', role: 'consumer', voltagePath: 'mon.v', currentPath: 'mon.i', socPath: 'mon.soc', timeRemainingPath: 'mon.t' },
    { id: 'c', role: 'consumer', voltagePath: 'x' }
  ]
  const r = resolveBatteryPaths(devices)
  assert.deepEqual(r.b1, { monitorDeviceId: 'm', voltagePath: 'own.v', currentPath: 'mon.i', socPath: 'mon.soc', timeRemainingPath: 'mon.t' })
  assert.deepEqual(r.b2, { monitorDeviceId: 'm', voltagePath: 'mon.v', currentPath: 'mon.i', socPath: 'mon.soc', timeRemainingPath: 'mon.t' })
  assert.equal(r.b3, undefined)
  assert.equal(r.b4, undefined)
  assert.equal(r.m, undefined)
  assert.equal(r.c, undefined)
  assert.deepEqual(deriveSwitchability({ devices, cables: [] }).batteries, r)
})

test('the live view watches battery paths and reads a battery', () => {
  const live = { consumers: {}, switches: {}, batteries: { b: { voltagePath: 'vessels.self.v', currentPath: 'i', socPath: 's', timeRemainingPath: 't' } } }
  assert.deepEqual(batteryPathsToWatch(live).sort(), ['i', 's', 't', 'v'])
  assert.deepEqual(pathsToWatch(live), ['i', 's', 't', 'v'])
  const values = new Map([['v', 12.6], ['i', 0], ['s', 0.75], ['t', null]])
  const info = liveInfo('b', live, values, (id) => `Name ${id}`)
  assert.equal(info.kind, 'battery')
  assert.equal(info.reading, '12.6 V, 75 %, not discharging')
  assert.equal(info.clickable, false)
  assert.equal(liveInfo('other', live, values), null)
})

test('deltas record when each value arrived', () => {
  const values = new Map()
  const stamps = new Map()
  const msg = { context: 'vessels.self', updates: [{ timestamp: '2026-11-08T10:00:00.000Z', values: [{ path: 'v', value: 12.5 }] }] }
  assert.equal(applyDelta(values, msg, new Set(['v']), stamps, Date.parse('2026-11-08T10:00:05Z')), true)
  assert.equal(stamps.get('v'), Date.parse('2026-11-08T10:00:00Z'))
  // the same value again, long after: counts as a change so a stale mark clears
  assert.equal(applyDelta(values, msg, new Set(['v']), stamps, Date.parse('2026-11-08T10:05:00Z')), true)
})
