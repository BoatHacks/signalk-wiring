import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultLayers, sanitizeLayers, loadLayers, saveLayers, toggleLayer, toggleRole, roleShown,
  rolesPresent, layersChanged, focusSet
} from '../public/floorLayers.js'

function fakeStorage (initial = {}) {
  const data = { ...initial }
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) } }
}
const throwing = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } }

test('defaults: every layer on and no role hidden', () => {
  assert.deepEqual(defaultLayers(), { names: true, devices: true, cables: true, conduits: true, hiddenRoles: [] })
  assert.equal(layersChanged(defaultLayers()), false)
})

test('round trip through storage', () => {
  const st = fakeStorage()
  const layers = toggleRole(toggleLayer(defaultLayers(), 'cables'), 'consumer')
  saveLayers(layers, st)
  assert.deepEqual(loadLayers(st), layers)
  assert.equal(layersChanged(layers), true)
})

test('nothing stored gives the defaults', () => {
  assert.deepEqual(loadLayers(fakeStorage()), defaultLayers())
})

test('storage that throws gives the defaults and saving does not throw', () => {
  assert.deepEqual(loadLayers(throwing), defaultLayers())
  assert.doesNotThrow(() => saveLayers(defaultLayers(), throwing))
})

test('garbage in storage is ignored field by field', () => {
  assert.deepEqual(loadLayers(fakeStorage({ 'wiring.floorLayers': 'not json' })), defaultLayers())
  const s = sanitizeLayers({ names: 'yes', devices: false, hiddenRoles: ['b', 3, 'a', 'b'], extra: 1 })
  assert.deepEqual(s, { names: true, devices: false, cables: true, conduits: true, hiddenRoles: ['a', 'b'] })
  assert.deepEqual(sanitizeLayers(null), defaultLayers())
})

test('toggles flip one switch and ignore unknown keys', () => {
  const off = toggleLayer(defaultLayers(), 'names')
  assert.equal(off.names, false)
  assert.equal(toggleLayer(off, 'names').names, true)
  assert.deepEqual(toggleLayer(defaultLayers(), 'bogus'), defaultLayers())
})

test('role filter: hide and show a role, no role counts as consumer', () => {
  const hidden = toggleRole(defaultLayers(), 'storage')
  assert.equal(roleShown(hidden, 'storage'), false)
  assert.equal(roleShown(hidden, 'source'), true)
  assert.equal(roleShown(toggleRole(defaultLayers(), 'consumer'), undefined), false)
  assert.deepEqual(toggleRole(hidden, 'storage').hiddenRoles, [])
})

test('rolesPresent lists only the roles on the plan, in list order', () => {
  const r = rolesPresent([{ role: 'storage' }, { }, { role: 'storage' }, { role: 'source' }])
  assert.deepEqual(r.map((x) => x.value), ['consumer', 'source', 'storage'])
  assert.equal(r[0].label, 'Consumer')
  assert.deepEqual(rolesPresent([]), [])
})

const runs = [
  { id: 'r1', fromDeviceId: 'a', toDeviceId: 'b' },
  { id: 'r2', fromDeviceId: 'b', toDeviceId: 'c' },
  { id: 'r3', fromDeviceId: 'x', toDeviceId: 'y', status: 'removed' },
  { id: 'r4', fromDeviceId: 'a', toDeviceId: 'y' }
]

test('focusSet: no selection means nothing fades', () => {
  assert.equal(focusSet({}, runs), null)
  assert.equal(focusSet(undefined, runs), null)
})

test('focusSet: a device keeps itself and its cables', () => {
  const f = focusSet({ deviceId: 'b' }, runs)
  assert.deepEqual([...f.deviceIds], ['b'])
  assert.deepEqual([...f.runIds].sort(), ['r1', 'r2'])
})

test('focusSet: a wire run keeps itself and its ends', () => {
  const f = focusSet({ run: runs[1] }, runs)
  assert.deepEqual([...f.runIds], ['r2'])
  assert.deepEqual([...f.deviceIds].sort(), ['b', 'c'])
})

test('focusSet: a circuit or conduit keeps its members; a conduit itself too', () => {
  const members = { runIds: new Set(['r1']), deviceIds: new Set(['a', 'b']) }
  const f = focusSet({ conduit: { id: 'k1' }, members }, runs)
  assert.deepEqual([...f.conduitIds], ['k1'])
  assert.deepEqual([...f.runIds], ['r1'])
  assert.deepEqual([...f.deviceIds].sort(), ['a', 'b'])
  assert.equal(focusSet({ members }, runs).conduitIds.size, 0)
})
