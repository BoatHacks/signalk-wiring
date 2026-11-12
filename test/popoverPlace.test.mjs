import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placePopover, POPOVER_GAP } from '../public/popoverPlace.js'

const VP = { width: 800, height: 500 }
const SIZE = { width: 250, height: 200 }
const inside = (r, size, vp, m = 8) => r.left >= m && r.left + Math.min(size.width, r.maxWidth) <= vp.width - m && r.top >= m && r.top + Math.min(size.height, r.maxHeight) <= vp.height - m

test('opens below and centred in the middle of the viewport, clear of the finger', () => {
  const r = placePopover({ x: 400, y: 100 }, SIZE, VP, 8)
  assert.equal(r.side, 'below')
  assert.equal(r.left, 275)
  assert.equal(r.top, 100 + POPOVER_GAP)
  assert.ok(r.top > 100)
})

test('flips above near the bottom edge and stays clear of the anchor', () => {
  const r = placePopover({ x: 400, y: 450 }, SIZE, VP, 8)
  assert.equal(r.side, 'above')
  assert.equal(r.top + SIZE.height, 450 - POPOVER_GAP)
  assert.ok(inside(r, SIZE, VP))
})

test('is pushed in from the left and right edges', () => {
  const l = placePopover({ x: 5, y: 200 }, SIZE, VP, 8)
  assert.equal(l.left, 8)
  const r = placePopover({ x: 798, y: 200 }, SIZE, VP, 8)
  assert.equal(r.left, 800 - 8 - 250)
  assert.ok(inside(l, SIZE, VP) && inside(r, SIZE, VP))
})

test('the top edge opens below, the corners stay inside', () => {
  for (const a of [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 0, y: 500 }, { x: 800, y: 500 }, { x: 400, y: 0 }, { x: 400, y: 500 }]) {
    const r = placePopover(a, SIZE, VP, 8)
    assert.ok(inside(r, SIZE, VP), JSON.stringify(a) + ' ' + JSON.stringify(r))
    // never covers the anchor
    assert.ok(r.top >= a.y || r.top + Math.min(SIZE.height, r.maxHeight) <= a.y)
  }
})

test('a small viewport shrinks the popover to the side with more room', () => {
  const small = { width: 300, height: 260 }
  const r = placePopover({ x: 150, y: 70 }, { width: 250, height: 260 }, small, 8)
  assert.equal(r.side, 'below')
  assert.equal(r.top, 86)
  assert.equal(r.maxHeight, 260 - 8 - 86)
  const up = placePopover({ x: 150, y: 200 }, { width: 250, height: 260 }, small, 8)
  assert.equal(up.side, 'above')
  assert.equal(up.maxHeight, 200 - POPOVER_GAP - 8)
  assert.equal(up.top, 200 - POPOVER_GAP - up.maxHeight)
})

test('a popover wider than the viewport is limited to it', () => {
  const r = placePopover({ x: 100, y: 100 }, { width: 400, height: 100 }, { width: 300, height: 400 }, 8)
  assert.equal(r.left, 8)
  assert.equal(r.maxWidth, 284)
})
