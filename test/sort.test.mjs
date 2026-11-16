import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareValues, sortItems, nextSort, flipSort, readSort, writeSort, lengthMetres, cableAreaMm2 } from '../public/sort.js'

const cols = { name: (x) => x.name, n: (x) => x.n }
const names = (list) => list.map((x) => x.name)

test('numbers compare as numbers and text naturally, ignoring case', () => {
  assert.ok(compareValues(2, 10) < 0)
  assert.ok(compareValues('B10-3', 'B10-12') < 0)
  assert.ok(compareValues('apple', 'Banana') < 0)
  assert.equal(compareValues('Same', 'same'), 0)
})

test('sortItems sorts ascending and descending and does not change the input', () => {
  const items = [{ name: 'c' }, { name: 'a' }, { name: 'b' }]
  assert.deepEqual(names(sortItems(items, cols, { key: 'name', dir: 'asc' })), ['a', 'b', 'c'])
  assert.deepEqual(names(sortItems(items, cols, { key: 'name', dir: 'desc' })), ['c', 'b', 'a'])
  assert.deepEqual(names(items), ['c', 'a', 'b'])
})

test('numbers sort numerically, not as text', () => {
  const items = [{ name: 'x', n: 10 }, { name: 'y', n: 9 }, { name: 'z', n: 100 }]
  assert.deepEqual(names(sortItems(items, cols, { key: 'n', dir: 'asc' })), ['y', 'x', 'z'])
})

test('empty values go last in both directions', () => {
  const items = [{ name: 'a', n: null }, { name: 'b', n: 2 }, { name: 'c', n: undefined }, { name: 'd', n: 1 }, { name: 'e', n: NaN }, { name: 'f', n: '' }]
  assert.deepEqual(names(sortItems(items, cols, { key: 'n', dir: 'asc' })), ['d', 'b', 'a', 'c', 'e', 'f'])
  assert.deepEqual(names(sortItems(items, cols, { key: 'n', dir: 'desc' })), ['b', 'd', 'a', 'c', 'e', 'f'])
})

test('ties keep the default order, in both directions', () => {
  const items = [{ name: 'p', n: 1 }, { name: 'q', n: 2 }, { name: 'r', n: 1 }, { name: 's', n: 2 }]
  assert.deepEqual(names(sortItems(items, cols, { key: 'n', dir: 'asc' })), ['p', 'r', 'q', 's'])
  assert.deepEqual(names(sortItems(items, cols, { key: 'n', dir: 'desc' })), ['q', 's', 'p', 'r'])
})

test('no sort, an unknown key or a bad direction returns the default order', () => {
  const items = [{ name: 'b' }, { name: 'a' }]
  assert.deepEqual(names(sortItems(items, cols, null)), ['b', 'a'])
  assert.deepEqual(names(sortItems(items, cols, { key: 'nope', dir: 'asc' })), ['b', 'a'])
  assert.deepEqual(names(sortItems(items, cols, { key: 'name', dir: 'sideways' })), ['b', 'a'])
  assert.deepEqual(names(sortItems(items, {}, { key: 'name', dir: 'asc' })), ['b', 'a'])
})

test('nextSort cycles ascending, descending, cleared; a new column starts ascending', () => {
  let s = nextSort(null, 'name')
  assert.deepEqual(s, { key: 'name', dir: 'asc' })
  s = nextSort(s, 'name')
  assert.deepEqual(s, { key: 'name', dir: 'desc' })
  assert.equal(nextSort(s, 'name'), null)
  assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'n'), { key: 'n', dir: 'asc' })
})

test('flipSort flips the direction and leaves no sort alone', () => {
  assert.deepEqual(flipSort({ key: 'a', dir: 'asc' }), { key: 'a', dir: 'desc' })
  assert.deepEqual(flipSort({ key: 'a', dir: 'desc' }), { key: 'a', dir: 'asc' })
  assert.equal(flipSort(null), null)
})

function fakeStorage () {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}

test('the sort is remembered per list and cleared when null', () => {
  const st = fakeStorage()
  writeSort('devices', { key: 'name', dir: 'desc' }, st)
  writeSort('cables', { key: 'n', dir: 'asc' }, st)
  assert.deepEqual(readSort('devices', cols, st), { key: 'name', dir: 'desc' })
  assert.deepEqual(readSort('cables', cols, st), { key: 'n', dir: 'asc' })
  writeSort('devices', null, st)
  assert.equal(readSort('devices', cols, st), null)
  assert.deepEqual(readSort('cables', cols, st), { key: 'n', dir: 'asc' })
})

test('garbage, an unknown column or a bad direction in storage is ignored', () => {
  const st = fakeStorage()
  for (const raw of ['not json', '{}', '{"key":"name"}', '{"key":"name","dir":"up"}', '{"key":"gone","dir":"asc"}', '"x"', 'null']) {
    st.setItem('wiring.sort.l', raw)
    assert.equal(readSort('l', cols, st), null, raw)
  }
})

test('storage that is missing or throws does not break reading or writing', () => {
  const broken = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') }, removeItem () { throw new Error('blocked') } }
  assert.equal(readSort('l', cols, broken), null)
  assert.doesNotThrow(() => writeSort('l', { key: 'name', dir: 'asc' }, broken))
  assert.doesNotThrow(() => writeSort('l', null, broken))
})

test('lengthMetres converts feet and treats no unit as metres', () => {
  assert.equal(lengthMetres(10, 'm'), 10)
  assert.equal(lengthMetres('2', ''), 2)
  assert.ok(Math.abs(lengthMetres(10, 'ft') - 3.048) < 1e-9)
  assert.equal(lengthMetres(null, 'm'), null)
  assert.equal(lengthMetres('abc', 'm'), null)
})

test('cableAreaMm2 puts AWG and mm2 sizes on one scale', () => {
  assert.equal(cableAreaMm2(2.5, 'mm2'), 2.5)
  assert.equal(cableAreaMm2('10', 'AWG'), 5.26)
  assert.equal(cableAreaMm2(0, 'AWG'), 53.49)
  assert.ok(cableAreaMm2(4, 'mm2') < cableAreaMm2(10, 'AWG'))
  assert.equal(cableAreaMm2(4, ''), null)
  assert.equal(cableAreaMm2(null, 'mm2'), null)
  assert.equal(cableAreaMm2(99, 'AWG'), null)
})
