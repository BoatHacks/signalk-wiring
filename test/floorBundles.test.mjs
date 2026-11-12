import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bundleRoutes, uncoveredPieces, bundleWidth } from '../public/floorBundles.js'

const r = (id, ...pts) => ({ id, points: pts })

test('routes that share nothing make no bundle', () => {
  const out = bundleRoutes([r('a', [0, 0], [100, 0]), r('b', [0, 50], [100, 50])], 3)
  assert.deepEqual(out.bundles, [])
  assert.equal(out.covered.size, 0)
})

test('a shared segment becomes one bundle with a count at its midpoint', () => {
  const out = bundleRoutes([
    r('a', [0, 0], [100, 0], [100, 40]),
    r('b', [0, 0], [100, 0], [100, 80]),
    r('c', [100, 0], [0, 0])
  ], 3)
  const shared = out.bundles.find((b) => b.count === 3)
  assert.ok(shared)
  assert.deepEqual(shared.ids, ['a', 'b', 'c'])
  assert.deepEqual(shared.mid, [50, 0])
  assert.ok(out.covered.has('0:0') && out.covered.has('1:0') && out.covered.has('2:0'))
  assert.ok(!out.covered.has('0:1') && !out.covered.has('1:1'))
})

test('ends within the tolerance match, farther ends do not', () => {
  const near = bundleRoutes([r('a', [0, 0], [100, 0]), r('b', [2, 1], [99, -2])], 3)
  assert.equal(near.bundles.length, 1)
  const far = bundleRoutes([r('a', [0, 0], [100, 0]), r('b', [0, 10], [100, 10])], 3)
  assert.equal(far.bundles.length, 0)
})

test('a route repeated under one id is not a bundle with itself', () => {
  const out = bundleRoutes([r('a', [0, 0], [100, 0]), r('a', [0, 0], [100, 0])], 3)
  assert.deepEqual(out.bundles, [])
})

test('stable: the same result for any input order', () => {
  const list = [r('c', [0, 0], [50, 0]), r('a', [0, 0], [50, 0]), r('b', [1, 0], [50, 1])]
  const one = bundleRoutes(list, 3)
  const two = bundleRoutes([...list].reverse(), 3)
  assert.equal(one.bundles.length, 1)
  assert.deepEqual(one.bundles[0].ids, two.bundles[0].ids)
  assert.equal(one.bundles[0].count, 3)
})

test('segments shorter than the tolerance are ignored', () => {
  assert.equal(bundleRoutes([r('a', [0, 0], [1, 0]), r('b', [0, 0], [1, 0])], 3).bundles.length, 0)
})

test('uncoveredPieces keeps what is not in a bundle', () => {
  const pts = [[0, 0], [10, 0], [20, 0], [30, 0]]
  assert.deepEqual(uncoveredPieces(4, pts, new Set()), [pts])
  assert.deepEqual(uncoveredPieces(4, pts, new Set(['4:1'])), [[[0, 0], [10, 0]], [[20, 0], [30, 0]]])
  assert.deepEqual(uncoveredPieces(4, pts, new Set(['4:0', '4:1', '4:2'])), [])
})

test('bundleWidth grows with the count and is capped', () => {
  assert.equal(bundleWidth(2, 2, 0.5, 0.25, 3), 2 * 0.75)
  assert.equal(bundleWidth(2, 99, 0.5, 0.25, 3), 6)
})
