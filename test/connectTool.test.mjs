import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  initialConnect, connectPickDevice, connectAddWaypoint, connectUndo, connectCanFinish, connectHint, connectionFields
} from '../public/connectTool.js'

test('from, to, waypoints, finish', () => {
  let s = initialConnect()
  assert.equal(s.stage, 'from')
  assert.equal(connectCanFinish(s), false)
  s = connectPickDevice(s, 'a')
  assert.deepEqual([s.stage, s.fromId], ['to', 'a'])
  s = connectPickDevice(s, 'b')
  assert.deepEqual([s.stage, s.toId], ['route', 'b'])
  assert.equal(connectCanFinish(s), true)
  s = connectAddWaypoint(s, { x: 1, y: 2, z: 3 })
  s = connectAddWaypoint(s, { x: 4, y: 5, z: 3 })
  assert.equal(s.waypoints.length, 2)
  assert.equal(connectCanFinish(s), true)
})

test('the To device must differ from the From device, and an empty pick is ignored', () => {
  let s = connectPickDevice(initialConnect(), 'a')
  assert.equal(connectPickDevice(s, 'a'), s)
  assert.equal(connectPickDevice(s, ''), s)
  assert.equal(connectPickDevice(initialConnect(), null).stage, 'from')
})

test('waypoints only count in the route stage; device picks are ignored there', () => {
  const from = initialConnect()
  assert.equal(connectAddWaypoint(from, { x: 1 }), from)
  let s = connectPickDevice(connectPickDevice(initialConnect(), 'a'), 'b')
  assert.equal(connectPickDevice(s, 'c'), s)
})

test('undo steps back: waypoint, then To, then From', () => {
  let s = connectPickDevice(connectPickDevice(initialConnect(), 'a'), 'b')
  s = connectAddWaypoint(s, { x: 1 })
  s = connectUndo(s)
  assert.deepEqual([s.stage, s.waypoints.length], ['route', 0])
  s = connectUndo(s)
  assert.deepEqual([s.stage, s.toId, s.fromId], ['to', null, 'a'])
  s = connectUndo(s)
  assert.deepEqual([s.stage, s.fromId], ['from', null])
  assert.equal(connectUndo(s), s)
})

test('hints name the devices', () => {
  const names = { a: 'Battery', b: 'Lamp' }
  assert.match(connectHint(initialConnect(), names), /From device/)
  let s = connectPickDevice(initialConnect(), 'a')
  assert.match(connectHint(s, names), /Battery/)
  s = connectAddWaypoint(connectPickDevice(s, 'b'), { x: 1 })
  assert.match(connectHint(s, names), /Battery to Lamp/)
  assert.match(connectHint(s, names), /1 so far/)
})

test('connectionFields: no waypoints gives nothing; waypoints give route and measured length', () => {
  const base = connectPickDevice(connectPickDevice(initialConnect(), 'a'), 'b')
  assert.deepEqual(connectionFields(base, 'm', () => 5, (m) => m), {})
  const s = connectAddWaypoint(base, { x: 1, y: 1, z: 0 })
  const toUnit = (m, u) => (u === 'ft' ? Math.round(m * 3.28 * 100) / 100 : m)
  assert.deepEqual(connectionFields(s, 'm', () => 4.2, toUnit), { route: [{ x: 1, y: 1, z: 0 }], length: 4.2, lengthUnit: 'm' })
  assert.equal(connectionFields(s, 'ft', () => 1, toUnit).length, 3.28)
  assert.deepEqual(connectionFields(s, 'm', () => null, toUnit), { route: [{ x: 1, y: 1, z: 0 }] })
  assert.equal(connectionFields(s, '', () => 2, toUnit).lengthUnit, 'm')
})
