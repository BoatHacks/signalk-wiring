import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pinchStep, pinchView, viewScale, DEAD_ZONE_PX } from '../public/touchGestures.js'

const P = (x, y) => ({ x, y })

test('spreading the fingers zooms in, pinching zooms out', () => {
  const s = pinchStep([P(100, 100), P(200, 100)], [P(50, 100), P(250, 100)])
  assert.equal(s.idle, false)
  assert.equal(s.scale, 2)
  assert.deepEqual(s.pan, { dx: 0, dy: 0 })
  assert.equal(pinchStep([P(0, 0), P(200, 0)], [P(50, 0), P(150, 0)]).scale, 0.5)
})

test('a pure drag only pans', () => {
  const s = pinchStep([P(100, 100), P(200, 100)], [P(130, 150), P(230, 150)])
  assert.equal(s.scale, 1)
  assert.deepEqual(s.pan, { dx: 30, dy: 50 })
})

test('a rotation changes nothing', () => {
  const s = pinchStep([P(100, 100), P(200, 100)], [P(150, 50), P(150, 150)], 0)
  assert.ok(Math.abs(s.scale - 1) < 1e-9)
  assert.ok(Math.abs(s.pan.dx) < 1e-9 && Math.abs(s.pan.dy) < 1e-9)
})

test('jitter below the dead zone is ignored', () => {
  assert.equal(DEAD_ZONE_PX, 6)
  const s = pinchStep([P(100, 100), P(200, 100)], [P(102, 101), P(203, 99)])
  assert.equal(s.idle, true)
  assert.equal(s.scale, 1)
  assert.deepEqual(s.pan, { dx: 0, dy: 0 })
  assert.equal(pinchStep([P(100, 100), P(200, 100)], [P(100, 100), P(207, 100)]).idle, false)
})

test('pinchView keeps the point under the fingers and respects limits', () => {
  const rect = { left: 10, top: 20, width: 800, height: 400 }
  const view = { x: 0, y: 0, w: 800, h: 400 } // 1 unit per pixel
  // zoom in by 2 around the midpoint (410, 220): the drawing point (400, 200) stays put
  const z = pinchView(view, rect, { scale: 2, from: P(410, 220), to: P(410, 220) })
  assert.equal(z.w, 400)
  assert.equal(z.h, 200)
  assert.equal(z.x, 200)
  assert.equal(z.y, 100)
  // pure pan: the content follows the fingers
  const p = pinchView(view, rect, { scale: 1, from: P(410, 220), to: P(460, 240) })
  assert.deepEqual(p, { x: -50, y: -20, w: 800, h: 400 })
  // limits
  const c = pinchView(view, rect, { scale: 10, from: P(410, 220), to: P(410, 220) }, { minW: 200, maxW: 3200 })
  assert.equal(c.w, 200)
  assert.equal(c.h, 100)
  assert.equal(pinchView(view, rect, { scale: 0.01, from: P(410, 220), to: P(410, 220) }, { minW: 200, maxW: 1600 }).w, 1600)
})

test('pinchView handles a letterboxed canvas', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 400 }
  const view = { x: 0, y: 0, w: 500, h: 400 } // height limited, 1 unit per px, centred horizontally
  assert.equal(viewScale(view, rect), 1)
  // the centre of the screen (500, 200) is drawing point (250, 200)
  const z = pinchView(view, rect, { scale: 2, from: P(500, 200), to: P(500, 200) })
  assert.equal(z.w, 250)
  assert.equal(z.x, 125)
  assert.equal(z.y, 100)
})
