import { test } from 'node:test'
import assert from 'node:assert/strict'
import { busGeometry, hitBus, placeBus, arrangeBuses, dropTitle, placedBuses, pageTaps, BUS_MIN_LEN } from '../public/schematicBus.js'

const box = (id, x, y, w = 150, h = 50) => ({ id, x, y, w, h })
const boxes = [box('a', 0, 0), box('b', 300, 0), box('c', 600, 200), box('other', 0, 120)]
const byId = new Map(boxes.map((b) => [b.id, b]))
const bus = { id: 'bb', name: 'Main', terminatorA: true, terminatorB: false, taps: [
  { deviceId: 'a', port: 'NMEA 2000', dropLength: 1.5, along: 0, powerFeed: true, fedFromDeviceId: 'f' },
  { deviceId: 'b', dropLength: null }, { deviceId: 'c' }, { deviceId: 'gone' }] }

test('only taps with a box on the page count', () => {
  assert.deepEqual(pageTaps(bus, byId).map((t) => t.deviceId), ['a', 'b', 'c'])
})

test('a line reaches the last drop, with a drop above or below', () => {
  const g = busGeometry(bus, { x: 0, y: 100 }, byId)
  assert.equal(g.x1, 0)
  assert.equal(g.x2, 600 + 75 + 30)
  assert.equal(g.drops.length, 3)
  const a = g.drops.find((d) => d.deviceId === 'a')
  assert.deepEqual([a.x, a.y1, a.y2], [75, 100, 50]) // box above the line: drop up to its bottom edge
  const c = g.drops.find((d) => d.deviceId === 'c')
  assert.deepEqual([c.x, c.y1, c.y2], [675, 100, 200]) // box below: drop down to its top edge
  assert.equal(a.powerFeed, true)
  assert.equal(g.termA, true)
  assert.equal(g.termB, false)
})

test('a short line is at least the minimum length and a box on the line has no drop', () => {
  const g = busGeometry({ id: 'x', name: 'X', taps: [{ deviceId: 'a' }] }, { x: 0, y: 20 }, byId)
  assert.equal(g.x2 - g.x1, BUS_MIN_LEN)
  assert.equal(g.drops[0].drawn, false)
})

test('hit test finds the line within the tolerance', () => {
  const g = busGeometry(bus, { x: 0, y: 100 }, byId)
  assert.equal(hitBus([g], 300, 105), g)
  assert.equal(hitBus([g], 300, 130), null)
  assert.equal(hitBus([g], -50, 100), null)
})

test('placement goes under the tapped boxes and clears other boxes', () => {
  const spot = placeBus(bus, boxes, { x: 0, y: 0 })
  // tapped boxes end at y 250 (c), plus the clearance; the box "other" (y 120 to 170) is not on that row
  assert.equal(spot.x, 0)
  assert.ok(spot.y >= 250 + 46)
  const blocker = [...boxes, box('wall', 100, 290, 400, 60)]
  const moved = placeBus(bus, blocker, { x: 0, y: 0 })
  assert.ok(moved.y >= 350)
  assert.deepEqual(placeBus({ id: 'e', taps: [] }, boxes, { x: 500, y: 400 }), { x: 500 - BUS_MIN_LEN / 2, y: 400 })
})

test('arrange lines the free tapped devices up in a row under the line, below the rest', () => {
  const out = arrangeBuses([bus], boxes, {})
  // "other" is the only box outside the group (y 120 to 170): the line goes 90 below it
  assert.deepEqual(out.buses.bb, { x: 0, y: 260 })
  assert.deepEqual(out.devices.a, { x: 0, y: 330 })
  assert.deepEqual(out.devices.b, { x: 180, y: 330 })
  assert.deepEqual(out.devices.c, { x: 360, y: 330 })
})

test('arrange keeps hand placed devices and buses, and stacks two buses', () => {
  const kept = arrangeBuses([bus], boxes, { bb: { x: 5, y: 500 } }, new Set(['bb']), new Set(['b']))
  assert.equal(kept.buses.bb, undefined)
  assert.equal(kept.devices.b, undefined)
  assert.deepEqual(kept.devices.a, { x: 5, y: 570 })
  const b2 = { id: 'bb2', name: 'Two', taps: [{ deviceId: 'other' }] }
  const two = arrangeBuses([bus, b2], boxes, {})
  assert.ok(two.buses.bb2.y > two.buses.bb.y + 70)
  // a device claimed by the first bus is not moved again by the second
  const shared = arrangeBuses([bus, { id: 'bb3', name: 'S', taps: [{ deviceId: 'a' }] }], boxes, {})
  assert.deepEqual(shared.devices.a, { x: 0, y: 330 })
})

test('hover text names device, drop and place', () => {
  assert.equal(dropTitle({ deviceId: 'a', port: 'NMEA 2000', dropLength: 1.5, along: 3, powerFeed: true }, 'Plotter', 'm'), 'Plotter, port NMEA 2000, drop 1.5 m, 3 m along, power feed')
  assert.equal(dropTitle({ deviceId: 'a', dropLength: null }, null), 'a, drop length not set')
})

test('placed buses skip removed and unknown backbones', () => {
  const list = placedBuses([{ backboneId: 'bb', x: 1, y: 2, handPlaced: true }, { backboneId: 'zz', x: 0, y: 0 }, { backboneId: 'rm', x: 0, y: 0 }], [bus, { id: 'rm', status: 'removed' }])
  assert.equal(list.length, 1)
  assert.deepEqual(list[0].at, { x: 1, y: 2 })
  assert.equal(list[0].handPlaced, true)
})
