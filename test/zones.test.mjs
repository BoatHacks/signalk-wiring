import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTags, tagsToText, collectTags, matchesFilter, circuitMatches } from '../public/zones.js'

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

test('a circuit matches when any live wire run of it matches', () => {
  const runs = [
    { circuitId: 'c1', zoneId: 'z1', status: 'removed' },
    { circuitId: 'c1', zoneId: 'z2', status: 'active' },
    { circuitId: 'c2', zoneId: 'z1', status: 'active' }
  ]
  assert.equal(circuitMatches({ id: 'c1' }, runs, { zoneId: 'z2' }), true)
  assert.equal(circuitMatches({ id: 'c1' }, runs, { zoneId: 'z1' }), false)
  assert.equal(circuitMatches({ id: 'c3' }, runs, {}), true)
  assert.equal(circuitMatches({ id: 'c3' }, runs, { zoneId: 'z1' }), false)
})
