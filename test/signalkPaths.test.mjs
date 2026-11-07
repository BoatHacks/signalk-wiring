import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flattenPaths, filterPaths } from '../public/signalkPaths.js'

const tree = {
  electrical: {
    batteries: {
      house: {
        voltage: { value: 12.6, timestamp: 't', $source: 's', meta: { units: 'V' } },
        current: { value: 3, timestamp: 't' },
        meta: { displayName: 'House' }
      }
    },
    switches: { anchorLight: { state: { value: 1, $source: 's' } } }
  },
  design: { length: { value: { overall: 11 }, timestamp: 't' } },
  name: 'Boat'
}

test('flattenPaths returns leaf paths, skipping meta and plain strings', () => {
  assert.deepEqual(flattenPaths(tree), [
    'design.length',
    'electrical.batteries.house.current',
    'electrical.batteries.house.voltage',
    'electrical.switches.anchorLight.state'
  ])
  assert.deepEqual(flattenPaths(null), [])
  assert.deepEqual(flattenPaths({}), [])
})

const paths = flattenPaths(tree)

test('filterPaths: every term must match, in any order, case-insensitively', () => {
  assert.deepEqual(filterPaths(paths, 'bat volt'), ['electrical.batteries.house.voltage'])
  assert.deepEqual(filterPaths(paths, 'VOLT bat'), ['electrical.batteries.house.voltage'])
  assert.deepEqual(filterPaths(paths, 'nothing'), [])
})

test('filterPaths: an empty query lists the first paths, and the limit applies', () => {
  assert.equal(filterPaths(paths, '').length, 4)
  assert.equal(filterPaths(paths, '', 2).length, 2)
})

test('filterPaths ranks a prefix match before a later one', () => {
  const list = ['a.electrical.x', 'electrical.zzzzzz']
  assert.equal(filterPaths(list, 'electrical')[0], 'electrical.zzzzzz')
})
