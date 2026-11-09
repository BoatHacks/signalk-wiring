import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../public/schematic.js'

const P = (list) => list.map(([x, y]) => ({ x, y }))
const L = (pts) => pts.map((p) => [p.x, p.y])

test('moveSegment: a middle horizontal segment moves up or down and its neighbours stretch', () => {
  const path = P([[0, 0], [30, 0], [30, 50], [100, 50], [100, 20], [150, 20]])
  assert.deepEqual(L(S.moveSegment(path, 2, 30)), [[0, 0], [30, 0], [30, 80], [100, 80], [100, 20], [150, 20]])
  assert.deepEqual(L(S.moveSegment(path, 2, -20)), [[0, 0], [30, 0], [30, 30], [100, 30], [100, 20], [150, 20]])
})

test('moveSegment: a middle vertical segment moves left or right', () => {
  const path = P([[0, 0], [20, 0], [20, 60], [80, 60], [80, 100], [100, 100]])
  assert.deepEqual(L(S.moveSegment(path, 1, 15)), [[0, 0], [35, 0], [35, 60], [80, 60], [80, 100], [100, 100]])
  // the stretched neighbours may not leave the leg: here the first leg only grows
  assert.deepEqual(L(S.moveSegment(path, 3, -10)), [[0, 0], [20, 0], [20, 60], [70, 60], [70, 100], [100, 100]])
})

test('moveSegment: a straight wire gets a jog, and the legs at both ports stay', () => {
  const path = P([[0, 0], [200, 0]])
  const out = S.moveSegment(path, 0, 40)
  assert.deepEqual(L(out), [[0, 0], [18, 0], [18, 40], [182, 40], [182, 0], [200, 0]])
  // too short for two legs: left alone
  assert.deepEqual(L(S.moveSegment(P([[0, 0], [30, 0]]), 0, 40)), [[0, 0], [30, 0]])
})

test('moveSegment: the first segment keeps its port leg', () => {
  const path = P([[0, 0], [100, 0], [100, 80], [200, 80]])
  assert.deepEqual(L(S.moveSegment(path, 0, 25)), [[0, 0], [18, 0], [18, 25], [100, 25], [100, 80], [200, 80]])
  const back = S.moveSegment(path, 2, -30)
  assert.deepEqual(L(back), [[0, 0], [100, 0], [100, 50], [182, 50], [182, 80], [200, 80]])
})

test('moveSegment: a diagonal segment or a bad index changes nothing', () => {
  const path = P([[0, 0], [50, 30], [100, 30]])
  assert.deepEqual(S.moveSegment(path, 0, 10), path)
  assert.deepEqual(S.moveSegment(path, 7, 10), path)
})

test('mergeShortJogs: a vertical shorter than a line width is dropped and the two horizontals join', () => {
  const path = P([[0, 0], [40, 0], [40, 2], [90, 2], [90, 50], [120, 50]])
  assert.deepEqual(L(S.mergeShortJogs(path)), [[0, 0], [90, 0], [90, 50], [120, 50]])
  // the same for horizontals between two verticals
  const v = P([[0, 0], [0, 30], [2, 30], [2, 80], [50, 80], [50, 120]])
  assert.deepEqual(L(S.mergeShortJogs(v)), [[0, 0], [0, 80], [50, 80], [50, 120]])
})

test('mergeShortJogs: the line at a port wins over the moved one, and a jog of a line width stays', () => {
  const path = P([[0, 0], [40, 0], [40, 20], [90, 20], [90, 22], [120, 22]])
  assert.deepEqual(L(S.mergeShortJogs(path)), [[0, 0], [40, 0], [40, 22], [120, 22]])
  assert.deepEqual(L(S.mergeShortJogs(P([[0, 0], [40, 0], [40, 3], [90, 3], [90, 50]]))), [[0, 0], [40, 0], [40, 3], [90, 3], [90, 50]])
})

test('mergeShortJogs: a collapse cascades', () => {
  const path = P([[0, 0], [40, 0], [40, 2], [60, 2], [60, 1], [100, 1], [100, 60], [130, 60]])
  assert.deepEqual(L(S.mergeShortJogs(path)), [[0, 0], [100, 0], [100, 60], [130, 60]])
})

test('moveSegment: dragging a segment back next to its neighbour merges them', () => {
  const path = P([[0, 0], [40, 0], [40, 50], [90, 50], [90, 0], [130, 0]])
  assert.deepEqual(L(S.moveSegment(path, 2, -49)), [[0, 0], [130, 0]])
})
