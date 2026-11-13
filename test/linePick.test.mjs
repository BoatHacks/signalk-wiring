import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nearestLine } from '../public/floorplan.js'

const line = (id, kind, pts) => ({ id, kind, pts })

test('the nearest line within the tolerance is picked', () => {
  const lines = [line('a', 'run', [[0, 0], [100, 0]]), line('b', 'run', [[0, 40], [100, 40]])]
  assert.deepEqual(nearestLine([50, 6], lines, 8), { id: 'a', kind: 'run', distance: 6 })
  assert.equal(nearestLine([50, 36], lines, 8).id, 'b')
})

test('nothing is picked when every line is farther than the tolerance', () => {
  const lines = [line('a', 'run', [[0, 0], [100, 0]])]
  assert.equal(nearestLine([50, 20], lines, 8), null)
  assert.equal(nearestLine([50, 20], [], 8), null)
})

test('the ends of a line are measured to the end point, not the extended line', () => {
  const lines = [line('a', 'run', [[0, 0], [100, 0]])]
  assert.equal(nearestLine([112, 0], lines, 8), null)
  assert.equal(nearestLine([105, 0], lines, 8).id, 'a')
})

test('every segment of a bent route counts', () => {
  const lines = [line('a', 'run', [[0, 0], [50, 0], [50, 50]])]
  assert.equal(nearestLine([53, 30], lines, 8).id, 'a')
})

test('a cable wins over a conduit at the same distance, a nearer conduit wins over a farther cable', () => {
  const same = [line('c', 'conduit', [[0, 0], [100, 0]]), line('r', 'run', [[0, 0], [100, 0]])]
  assert.equal(nearestLine([50, 3], same, 8).kind, 'run')
  const near = [line('r', 'run', [[0, 10], [100, 10]]), line('c', 'conduit', [[0, 0], [100, 0]])]
  assert.equal(nearestLine([50, 1], near, 12).id, 'c')
})

test('a single point line and a zero length segment do not break the distance', () => {
  assert.equal(nearestLine([1, 1], [line('p', 'run', [[0, 0]])], 5), null)
  assert.equal(nearestLine([1, 1], [line('z', 'run', [[0, 0], [0, 0]])], 5).id, 'z')
})
