import { test } from 'node:test'
import assert from 'node:assert/strict'
import { followDevice } from '../public/floorplan.js'

const dev = (id, x, y, z, extra = {}) => ({ id, name: id, status: 'active', posX: x, posY: y, posZ: z, ...extra })
const byId = (list) => new Map(list.map((d) => [d.id, d]))
const run = (id, from, to, route, extra = {}) => ({ id, fromDeviceId: from, toDeviceId: to, status: 'active', route, ...extra })

test('the end of a route follows the To device when that device is moved', () => {
  const devices = byId([dev('a', 1, 1, 0.5), dev('b', 4, 2, 0.5)])
  const runs = [run('r1', 'a', 'b', [{ x: 4, y: 2, z: 0.5 }])]
  const out = followDevice('b', { x: 4, y: 2, z: 0.5 }, { x: 5, y: 3, z: 0.5 }, runs, devices)
  assert.deepEqual(out, [{ runId: 'r1', route: [{ x: 5, y: 3, z: 0.5 }] }])
})

test('moving the From device changes nothing for a route whose start is derived', () => {
  const devices = byId([dev('a', 1, 1, 0.5), dev('b', 4, 2, 0.5)])
  const runs = [run('r1', 'a', 'b', [{ x: 4, y: 2, z: 0.5 }])]
  assert.deepEqual(followDevice('a', { x: 1, y: 1, z: 0.5 }, { x: 2, y: 1, z: 0.5 }, runs, devices), [])
})

test('a route that stores its first point at the From device follows that device too', () => {
  const devices = byId([dev('a', 1, 1, 0.5), dev('b', 4, 2, 0.5)])
  const runs = [run('r1', 'a', 'b', [{ x: 1, y: 1, z: 0.5 }, { x: 2, y: 1, z: 0.5 }, { x: 4, y: 2, z: 0.5 }])]
  const out = followDevice('a', { x: 1, y: 1, z: 0.5 }, { x: 1.5, y: 1.2, z: 0.5 }, runs, devices)
  assert.deepEqual(out[0].route, [{ x: 1.5, y: 1.2, z: 0.5 }, { x: 2, y: 1, z: 0.5 }, { x: 4, y: 2, z: 0.5 }])
})

test('a device inside an enclosure is represented by the enclosure that holds it', () => {
  const devices = byId([dev('box', 5, 0, 0.8, { role: 'enclosure' }), { id: 'in', name: 'in', status: 'active', parentId: 'box', posX: null, posY: null, posZ: null }, dev('a', 1, 1, 0.8)])
  const runs = [run('r1', 'a', 'in', [{ x: 5, y: 0, z: 0.8 }])]
  const out = followDevice('box', { x: 5, y: 0, z: 0.8 }, { x: 6, y: -1, z: 0.8 }, runs, devices)
  assert.deepEqual(out, [{ runId: 'r1', route: [{ x: 6, y: -1, z: 0.8 }] }])
})

test('an end the user moved away from the device stays where it is', () => {
  const devices = byId([dev('a', 1, 1, 0.5), dev('b', 4, 2, 0.5)])
  const runs = [run('r1', 'a', 'b', [{ x: 3, y: 2.5, z: 0.5 }])]
  assert.deepEqual(followDevice('b', { x: 4, y: 2, z: 0.5 }, { x: 5, y: 3, z: 0.5 }, runs, devices), [])
})

test('the match is within two centimeters on every axis', () => {
  const devices = byId([dev('a', 1, 1, 0.5), dev('b', 4, 2, 0.5)])
  const near = [run('r1', 'a', 'b', [{ x: 4.015, y: 2, z: 0.5 }])]
  const far = [run('r2', 'a', 'b', [{ x: 4.05, y: 2, z: 0.5 }])]
  assert.equal(followDevice('b', { x: 4, y: 2, z: 0.5 }, { x: 5, y: 3, z: 0.5 }, near, devices).length, 1)
  assert.equal(followDevice('b', { x: 4, y: 2, z: 0.5 }, { x: 5, y: 3, z: 0.5 }, far, devices).length, 0)
})

test('removed runs, runs without a route and unrelated devices are left alone', () => {
  const devices = byId([dev('a', 1, 1, 0.5), dev('b', 4, 2, 0.5), dev('c', 8, 8, 0.5)])
  const runs = [
    run('gone', 'a', 'b', [{ x: 4, y: 2, z: 0.5 }], { status: 'removed' }),
    run('none', 'a', 'b', null),
    run('empty', 'a', 'b', []),
    run('other', 'a', 'c', [{ x: 8, y: 8, z: 0.5 }])
  ]
  assert.deepEqual(followDevice('b', { x: 4, y: 2, z: 0.5 }, { x: 5, y: 3, z: 0.5 }, runs, devices), [])
})

test('a route ending at a position with no height still follows on the axes both have', () => {
  const devices = byId([dev('a', 1, 1, 0.5), dev('b', 4, 2, null)])
  const runs = [run('r1', 'a', 'b', [{ x: 4, y: 2, z: null }])]
  const out = followDevice('b', { x: 4, y: 2, z: null }, { x: 4.5, y: 2.2, z: null }, runs, devices)
  assert.equal(out.length, 1)
  assert.equal(out[0].route[0].x, 4.5)
})
