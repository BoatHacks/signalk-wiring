import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hitRadius, rectPad, pickTarget, insideRect, TOUCH_TARGET_PX } from '../public/touchTargets.js'

test('a mouse or pen keeps the drawn size at every zoom', () => {
  for (const zoom of [0.25, 1, 4]) {
    assert.equal(hitRadius('terminal', 'mouse', zoom), 8)
    assert.equal(hitRadius('terminal', 'pen', zoom), 8)
    assert.equal(hitRadius('handle', 'mouse', zoom), 9)
    assert.equal(hitRadius('tab', 'mouse', zoom), 0)
  }
})

test('a finger gets about 44 px on screen', () => {
  assert.equal(TOUCH_TARGET_PX, 44)
  assert.equal(hitRadius('terminal', 'touch', 1), 22)
  assert.equal(hitRadius('terminal', 'touch', 0.5), 44) // zoomed out: more units
  assert.equal(hitRadius('bend', 'touch', 2), 11)
  // zoomed in so far that the base is already larger than 22 px: the base stays
  assert.equal(hitRadius('terminal', 'touch', 4), 8)
  assert.equal(hitRadius('marker', 'touch', 2), 11)
  assert.equal(hitRadius('cluster', 'touch', 0.25), 88)
})

test('a missing zoom falls back to the base radius', () => {
  assert.equal(hitRadius('terminal', 'touch', 0), 8)
  assert.equal(hitRadius('terminal', 'touch', NaN), 8)
})

test('rectPad grows small tabs only', () => {
  assert.equal(rectPad(22, 20, 10), 17)
  assert.equal(rectPad(22, 100, 60), 0)
  assert.equal(insideRect({ x: 0, y: 0, w: 20, h: 10 }, -10, 5, 17), true)
  assert.equal(insideRect({ x: 0, y: 0, w: 20, h: 10 }, -10, 5, 0), false)
})

test('pickTarget gives a finger a wider reach than a mouse', () => {
  const c = [{ kind: 'terminal', id: 'a', x: 0, y: 0 }]
  assert.equal(pickTarget({ x: 15, y: 0 }, c, 'mouse', 1), null)
  assert.equal(pickTarget({ x: 15, y: 0 }, c, 'touch', 1).id, 'a')
  assert.equal(pickTarget({ x: 25, y: 0 }, c, 'touch', 1), null)
})

test('where hit areas would overlap, the nearer target wins and no centre is covered', () => {
  const c = [{ kind: 'terminal', id: 'a', x: 0, y: 0 }, { kind: 'terminal', id: 'b', x: 20, y: 0 }]
  assert.equal(pickTarget({ x: 8, y: 0 }, c, 'touch', 1).id, 'a')
  assert.equal(pickTarget({ x: 12, y: 0 }, c, 'touch', 1).id, 'b')
  // a's area is cut to 10, so it does not reach b's centre
  assert.equal(pickTarget({ x: 20, y: 0 }, c, 'touch', 1).id, 'b')
  assert.equal(pickTarget({ x: 11, y: 0 }, c, 'touch', 1).id, 'b')
  // never below the base radius, even when close
  const close = [{ kind: 'bend', id: 'p', x: 0, y: 0 }, { kind: 'bend', id: 'q', x: 6, y: 0 }]
  assert.equal(pickTarget({ x: -7, y: 0 }, close, 'touch', 1).id, 'p')
})

test('pickTarget works across kinds', () => {
  const c = [{ kind: 'bend', id: 'b', x: 0, y: 0 }, { kind: 'midpoint', id: 'm', x: 60, y: 0 }]
  assert.equal(pickTarget({ x: 40, y: 0 }, c, 'touch', 1).id, 'm')
  assert.equal(pickTarget({ x: 20, y: 0 }, c, 'touch', 1).id, 'b')
  assert.equal(pickTarget({ x: 30, y: 0 }, c, 'touch', 1), null)
})
