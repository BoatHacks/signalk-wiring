import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { stateFromValue, formatReading, liveInfo, confirmText, pathsToWatch, applyDelta } from '../public/live.js'

const require = createRequire(import.meta.url)
const switching = require('../src/switching.js')

test('the browser reads switch states the way the plugin does', () => {
  for (const v of [true, false, 0, 1, 2, 'on', 'OFF', 'Closed', 'maybe', null, undefined, { value: 1 }, { value: 'off' }]) {
    assert.equal(stateFromValue(v), switching.stateFromValue(v), JSON.stringify(v))
  }
})

test('readings: amps get two decimals when small, watts are whole when large, a minus sign is dropped', () => {
  assert.equal(formatReading(1.234, 'A'), '1.23 A')
  assert.equal(formatReading(-12.34, 'A'), '12.3 A')
  assert.equal(formatReading(36.04, 'W'), '36 W')
  assert.equal(formatReading(1834.5, 'W'), '1835 W')
  assert.equal(formatReading(undefined, 'W'), null)
})

const live = {
  consumers: {
    lampA: { switchable: true, switchDeviceId: 'relay', sharedWith: ['lampB'], neverRemote: false, confirm: false, meters: [{ path: 'm.power', unit: 'W', lowConfidence: false }, { path: 'bat.current', unit: 'A', lowConfidence: true }] },
    lampB: { switchable: true, switchDeviceId: 'relay', sharedWith: ['lampA'], neverRemote: false, confirm: false, meters: [] },
    anchor: { switchable: true, switchDeviceId: 'relay2', sharedWith: [], neverRemote: true, confirm: true, meters: [] },
    fridge: { switchable: false, switchDeviceId: null, sharedWith: [], neverRemote: false, confirm: true, meters: [] },
    pump: { switchable: true, switchDeviceId: 'relay', sharedWith: ['lampA', 'lampB'], neverRemote: false, confirm: true, meters: [] }
  },
  switches: {
    relay: { deviceId: 'relay', switchPath: 'electrical.switches.bank.0.3.state', consumerIds: ['lampA', 'lampB', 'pump'], neverRemote: false, confirm: true },
    relay2: { deviceId: 'relay2', switchPath: 'vessels.self.electrical.switches.bank.0.4.state', consumerIds: ['anchor'], neverRemote: true, confirm: true }
  }
}
const names = { lampA: 'Lamp A', lampB: 'Lamp B', relay: 'Cabin relay', pump: 'Pump' }
const nameOf = (id) => names[id] || id

test('a switchable lamp shows the state of its relay, its shared consumers and the nearest real meter', () => {
  const values = new Map([['electrical.switches.bank.0.3.state', 1], ['m.power', 36.2], ['bat.current', -9]])
  const info = liveInfo('lampA', live, values, nameOf)
  assert.equal(info.look, 'on')
  assert.equal(info.clickable, true)
  assert.equal(info.reading, '36.2 W') // the battery meter is low confidence and not shown
  assert.deepEqual(info.shared, ['Lamp B'])
  assert.match(info.title, /Lamp A: on\. Switched through Cabin relay, which also feeds Lamp B/)
  assert.equal(liveInfo('lampB', live, values, nameOf).reading, null)
  assert.equal(liveInfo('lampB', live, new Map([['electrical.switches.bank.0.3.state', false]]), nameOf).look, 'off')
  assert.equal(liveInfo('lampB', live, new Map(), nameOf).look, 'unknown')
})

test('a never-remote device is locked, one with no switch is fixed, and neither can be clicked', () => {
  const values = new Map([['electrical.switches.bank.0.4.state', 1]])
  const locked = liveInfo('anchor', live, values, nameOf)
  assert.equal(locked.look, 'locked')
  assert.equal(locked.clickable, false)
  assert.equal(locked.state, 'on') // still known, just not switchable
  const fixed = liveInfo('fridge', live, values, nameOf)
  assert.equal(fixed.look, 'fixed')
  assert.equal(fixed.clickable, false)
})

test('a switch device is shown and clicked on its own, and a locked one is locked', () => {
  const info = liveInfo('relay', live, new Map([['electrical.switches.bank.0.3.state', 0]]), nameOf)
  assert.equal(info.kind, 'switch')
  assert.equal(info.look, 'off')
  assert.equal(info.clickable, true)
  assert.match(info.title, /Feeds Lamp A, Lamp B, pump/i)
  const locked = liveInfo('relay2', live, new Map(), nameOf)
  assert.equal(locked.look, 'locked')
  assert.equal(liveInfo('nothing', live, new Map(), nameOf), null)
  assert.equal(liveInfo('lampA', null, new Map(), nameOf), null)
})

test('the confirmation question names the switch and everything it switches', () => {
  const text = confirmText({ switchDeviceName: 'Cabin relay', consumerNames: ['Lamp A', 'Pump'] }, false)
  assert.equal(text, 'Switch off through Cabin relay? This switches Lamp A, Pump.')
})

test('paths to watch are the switch states and the first trustworthy meter of each consumer, once each', () => {
  assert.deepEqual(pathsToWatch(live), [
    'electrical.switches.bank.0.3.state', 'electrical.switches.bank.0.4.state', 'm.power'
  ])
  assert.deepEqual(pathsToWatch(null), [])
})

test('delta messages update the watched values only, for the own vessel only', () => {
  const values = new Map()
  const watching = new Set(['a.b', 'c.d'])
  const msg = { context: 'vessels.self', updates: [{ values: [{ path: 'a.b', value: 1 }, { path: 'x.y', value: 5 }, { path: 'c.d', meta: {} }] }] }
  assert.equal(applyDelta(values, msg, watching), true)
  assert.deepEqual([...values], [['a.b', 1]])
  assert.equal(applyDelta(values, msg, watching), false) // nothing new
  assert.equal(applyDelta(values, { context: 'vessels.other', updates: [{ values: [{ path: 'a.b', value: 9 }] }] }, watching), false)
  assert.equal(applyDelta(values, { name: 'hello' }, watching), false)
})
