import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTags, tagsToText, collectTags, matchesFilter, circuitMatches, matchesSearch, matchesRemoved, readShowRemoved, writeShowRemoved
} from '../public/zones.js'

test('parseTags splits on commas, trims, drops empties and duplicates', () => {
  assert.deepEqual(parseTags(' audio: main, audio: cockpit ,, audio: main '), ['audio: main', 'audio: cockpit'])
  assert.deepEqual(parseTags(''), [])
  assert.deepEqual(parseTags(null), [])
})

test('tagsToText is the inverse for display', () => {
  assert.equal(tagsToText(['a', 'b']), 'a, b')
  assert.equal(tagsToText(null), '')
  assert.equal(tagsToText([]), '')
})

test('collectTags lists each tag once, sorted, ignoring case duplicates', () => {
  const items = [{ tags: ['Audio: main', 'bilge'] }, { tags: ['audio: main'] }, { tags: null }, {}]
  assert.deepEqual(collectTags(items), ['Audio: main', 'bilge'])
})

test('matchesFilter combines zone and tag, and an empty filter matches everything', () => {
  const item = { zoneId: 'z1', tags: ['Audio: main'] }
  assert.equal(matchesFilter(item, {}), true)
  assert.equal(matchesFilter(item, { zoneId: 'z1' }), true)
  assert.equal(matchesFilter(item, { zoneId: 'z2' }), false)
  assert.equal(matchesFilter(item, { tag: 'audio: MAIN' }), true)
  assert.equal(matchesFilter(item, { tag: 'bilge' }), false)
  assert.equal(matchesFilter(item, { zoneId: 'z1', tag: 'bilge' }), false)
  assert.equal(matchesFilter({}, { tag: 'bilge' }), false)
})

test('a special zone value finds items with no zone', () => {
  assert.equal(matchesFilter({ zoneId: null }, { zoneId: '__none__' }), true)
  assert.equal(matchesFilter({ zoneId: 'z1' }, { zoneId: '__none__' }), false)
})

test('a circuit matches when any live cable of it matches', () => {
  const cables = [
    { id: 'w1', zoneId: 'z1', status: 'removed' },
    { id: 'w2', zoneId: 'z2', status: 'active' },
    { id: 'w3', zoneId: 'z1', status: 'active' }
  ]
  const c1 = { derived: { cableIds: ['w1', 'w2'] } }
  assert.equal(circuitMatches(c1, cables, { zoneId: 'z2' }), true)
  assert.equal(circuitMatches(c1, cables, { zoneId: 'z1' }), false)
  assert.equal(circuitMatches({ derived: null }, cables, {}), true)
  assert.equal(circuitMatches({ derived: null }, cables, { zoneId: 'z1' }), false)
})

test('matchesSearch matches name, label, type, zone and tags case-insensitively', () => {
  const d = { name: 'Bilge Pump', type: 'pump', zone: 'Engine room', tags: ['Safety: bilge'], cableLabel: 'W12' }
  assert.equal(matchesSearch(d, ''), true)
  assert.equal(matchesSearch(d, '  '), true)
  assert.equal(matchesSearch(d, 'BILGE'), true)
  assert.equal(matchesSearch(d, 'pump'), true)
  assert.equal(matchesSearch(d, 'engine'), true)
  assert.equal(matchesSearch(d, 'safety'), true)
  assert.equal(matchesSearch(d, 'w12'), true)
  assert.equal(matchesSearch(d, 'bilge engine'), true)
  assert.equal(matchesSearch(d, 'bilge galley'), false)
  assert.equal(matchesSearch(d, 'zzz'), false)
  assert.equal(matchesSearch({ cableLabel: '' }, 'anchor', ['Anchor winch']), true)
  assert.equal(matchesSearch({}, 'x'), false)
})

test('search combines with the zone and tag filter', () => {
  const items = [
    { name: 'Pump A', zoneId: 'z1', tags: ['bilge'] },
    { name: 'Pump B', zoneId: 'z2', tags: ['bilge'] },
    { name: 'Light', zoneId: 'z1', tags: [] }
  ]
  const hits = items.filter((i) => matchesFilter(i, { zoneId: 'z1' }) && matchesSearch(i, 'pump'))
  assert.deepEqual(hits.map((i) => i.name), ['Pump A'])
})

test('matchesRemoved hides removed records unless asked', () => {
  assert.equal(matchesRemoved({ status: 'removed' }, false), false)
  assert.equal(matchesRemoved({ status: 'removed' }, true), true)
  assert.equal(matchesRemoved({ status: 'active' }, false), true)
})

test('the show-removed choice is remembered per list and survives missing or throwing storage', () => {
  const data = new Map()
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }
  assert.equal(readShowRemoved('cables', storage), false)
  writeShowRemoved('cables', true, storage)
  assert.equal(readShowRemoved('cables', storage), true)
  assert.equal(readShowRemoved('devices', storage), false)
  writeShowRemoved('cables', false, storage)
  assert.equal(readShowRemoved('cables', storage), false)
  const broken = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } }
  assert.equal(readShowRemoved('cables', broken), false)
  assert.doesNotThrow(() => writeShowRemoved('cables', true, broken))
  assert.equal(readShowRemoved('cables', undefined), false) // no localStorage on the host
})
