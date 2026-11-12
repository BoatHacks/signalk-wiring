import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clusterMarkers, clusterRadius, CLUSTER_GAP_PX } from '../public/floorCluster.js'

const m = (id, x, y, extra = {}) => ({ id, x, y, ...extra })

test('clusterRadius is the marker diameter plus 4 px', () => {
  assert.equal(CLUSTER_GAP_PX, 4)
  assert.equal(clusterRadius(20), 24)
})

test('a single marker is never a cluster', () => {
  const r = clusterMarkers([m('a', 0, 0)], 24)
  assert.deepEqual(r.clusters, [])
  assert.deepEqual(r.singles, ['a'])
  assert.deepEqual(clusterMarkers([], 24), { clusters: [], singles: [] })
})

test('markers closer than the radius cluster, farther ones stay single', () => {
  const r = clusterMarkers([m('a', 0, 0), m('b', 10, 0), m('c', 100, 0)], 24)
  assert.equal(r.clusters.length, 1)
  assert.deepEqual(r.clusters[0].ids, ['a', 'b'])
  assert.equal(r.clusters[0].x, 5)
  assert.equal(r.clusters[0].y, 0)
  assert.deepEqual(r.singles, ['c'])
})

test('exactly the radius apart is not an overlap', () => {
  assert.equal(clusterMarkers([m('a', 0, 0), m('b', 24, 0)], 24).clusters.length, 0)
})

test('zooming in (larger screen distances) splits a cluster', () => {
  const at = (k) => [m('a', 0, 0), m('b', 10 * k, 0), m('c', 0, 12 * k)]
  assert.equal(clusterMarkers(at(1), 24).clusters[0].ids.length, 3)
  assert.equal(clusterMarkers(at(2), 24).clusters[0].ids.length, 2)
  assert.equal(clusterMarkers(at(4), 24).clusters.length, 0)
})

test('a pinned marker (selected or highlighted) stays out of its cluster', () => {
  const r = clusterMarkers([m('a', 0, 0), m('b', 5, 0, { pinned: true }), m('c', 8, 0)], 24)
  assert.deepEqual(r.clusters.map((c) => c.ids), [['a', 'c']])
  assert.deepEqual(r.singles, ['b'])
  const only = clusterMarkers([m('a', 0, 0), m('b', 5, 0, { pinned: true })], 24)
  assert.deepEqual(only.clusters, [])
  assert.deepEqual(only.singles, ['a', 'b'])
})

test('stable: the same markers give the same result in any input order', () => {
  const list = [m('d', 3, 0), m('a', 0, 0), m('c', 40, 0), m('b', 6, 0), m('e', 45, 2)]
  const first = clusterMarkers(list, 24)
  assert.deepEqual(clusterMarkers(list, 24), first)
  const reversed = clusterMarkers([...list].reverse(), 24)
  assert.deepEqual(reversed.clusters, first.clusters)
  assert.deepEqual([...reversed.singles].sort(), [...first.singles].sort())
  assert.equal(first.clusters[0].id, 'cluster:a')
})

test('every marker is in exactly one place', () => {
  const list = Array.from({ length: 30 }, (_, i) => m('m' + String(i).padStart(2, '0'), (i * 7) % 50, (i * 13) % 40))
  const r = clusterMarkers(list, 24)
  const all = [...r.clusters.flatMap((c) => c.ids), ...r.singles].sort()
  assert.deepEqual(all, list.map((x) => x.id).sort())
})
