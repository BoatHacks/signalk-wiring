import { test } from 'node:test'
import assert from 'node:assert/strict'
import { edgeState } from '../public/tabBar.js'

test('edgeState: a bar that fits has no fade', () => {
  assert.deepEqual(edgeState({ scrollLeft: 0, clientWidth: 500, scrollWidth: 500 }), { left: false, right: false })
})

test('edgeState: at the start only the right edge has more', () => {
  assert.deepEqual(edgeState({ scrollLeft: 0, clientWidth: 400, scrollWidth: 900 }), { left: false, right: true })
})

test('edgeState: in the middle both edges have more, at the end only the left', () => {
  assert.deepEqual(edgeState({ scrollLeft: 200, clientWidth: 400, scrollWidth: 900 }), { left: true, right: true })
  assert.deepEqual(edgeState({ scrollLeft: 500, clientWidth: 400, scrollWidth: 900 }), { left: true, right: false })
})

test('edgeState: fractional scroll positions within the tolerance do not count', () => {
  assert.deepEqual(edgeState({ scrollLeft: 0.6, clientWidth: 400, scrollWidth: 401.5 }), { left: false, right: false })
})
