import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleLabels, labelSide, labelWidth } from '../public/floorLabels.js'

const devices = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

test('visibleLabels: no names with nothing hovered or selected', () => {
  assert.equal(visibleLabels(devices, {}).size, 0)
  assert.equal(visibleLabels(devices).size, 0)
})

test('visibleLabels: hover and selection', () => {
  assert.deepEqual([...visibleLabels(devices, { hoverId: 'a' })], ['a'])
  assert.deepEqual([...visibleLabels(devices, { selectedId: 'b' })], ['b'])
  assert.deepEqual([...visibleLabels(devices, { hoverId: 'a', selectedId: 'b' })].sort(), ['a', 'b'])
})

test('visibleLabels: circuit highlight and conduit members', () => {
  const members = { deviceIds: new Set(['b', 'c']) }
  assert.deepEqual([...visibleLabels(devices, { members })].sort(), ['b', 'c'])
})

test('visibleLabels: wire run shows both ends', () => {
  const run = { fromDeviceId: 'a', toDeviceId: 'd' }
  assert.deepEqual([...visibleLabels(devices, { run })].sort(), ['a', 'd'])
  assert.deepEqual([...visibleLabels(devices, { run: { fromDeviceId: 'a' } })], ['a'])
})

test('visibleLabels: ids that are not in the list are ignored', () => {
  assert.equal(visibleLabels(devices, { hoverId: 'zzz' }).size, 0)
})

test('labelSide: right by default, left near the right edge', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(labelSide([10, 50], 30, 2, box), 'right')
  assert.equal(labelSide([90, 50], 30, 2, box), 'left')
})

test('labelSide: picks the side with more room when neither fits', () => {
  const box = { x: 0, y: 0, width: 20, height: 20 }
  assert.equal(labelSide([15, 5], 50, 2, box), 'left')
  assert.equal(labelSide([5, 5], 50, 2, box), 'right')
})

test('labelWidth grows with the text and the font size', () => {
  assert.ok(labelWidth('abcd', 2) > labelWidth('ab', 2))
  assert.ok(labelWidth('ab', 4) > labelWidth('ab', 2))
  assert.equal(labelWidth('', 3), 0)
})
