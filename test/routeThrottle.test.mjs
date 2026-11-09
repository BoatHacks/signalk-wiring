import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as S from '../public/schematic.js'

// A manual clock with a scheduler, so the throttle is tested without waiting.
function clock () {
  let t = 0
  let id = 0
  const timers = new Map()
  return {
    now: () => t,
    schedule: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id },
    unschedule: (h) => timers.delete(h),
    advance (ms) {
      const end = t + ms
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        timers.delete(next[0])
        t = next[1].at
        next[1].fn()
      }
      t = end
    },
    get waiting () { return timers.size }
  }
}

test('throttle: the first request runs at once', () => {
  const c = clock()
  const calls = []
  const th = S.createRouteThrottle((a) => calls.push(a), 66, c.now, c.schedule, c.unschedule)
  th.request('a')
  assert.deepEqual(calls, ['a'])
})

test('throttle: requests inside the interval wait, the latest wins, and it runs as a trailing call', () => {
  const c = clock()
  const calls = []
  const th = S.createRouteThrottle((a) => calls.push([a, c.now()]), 66, c.now, c.schedule, c.unschedule)
  th.request('a')
  c.advance(10); th.request('b')
  c.advance(10); th.request('c')
  c.advance(10); th.request('d')
  assert.deepEqual(calls, [['a', 0]])
  c.advance(100)
  assert.deepEqual(calls, [['a', 0], ['d', 66]])
  assert.equal(c.waiting, 0)
})

test('throttle: two runs start at least the interval apart', () => {
  const c = clock()
  const starts = []
  const th = S.createRouteThrottle(() => starts.push(c.now()), 66, c.now, c.schedule, c.unschedule)
  for (let i = 0; i < 40; i++) { th.request(i); c.advance(7) }
  c.advance(200)
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 66, `${starts[i - 1]} -> ${starts[i]}`)
  assert.ok(starts.length >= 4)
})

test('throttle: only one route is in flight; a slow async route delays the next', async () => {
  const c = clock()
  let inFlight = 0
  let maxInFlight = 0
  const seen = []
  const releases = []
  const th = S.createRouteThrottle((a) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); seen.push(a)
    return new Promise((resolve) => releases.push(() => { inFlight--; resolve() }))
  }, 66, c.now, c.schedule, c.unschedule)
  th.request('a')
  c.advance(500) // far past the interval, but 'a' is still running
  th.request('b'); th.request('c')
  assert.deepEqual(seen, ['a'])
  releases.shift()()
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(seen, ['a', 'c']) // the waiting request replaced 'b' and ran after 'a' finished
  releases.shift()()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(maxInFlight, 1)
  assert.equal(th.busy, false)
})

test('throttle: cancel drops the waiting request', () => {
  const c = clock()
  const calls = []
  const th = S.createRouteThrottle((a) => calls.push(a), 66, c.now, c.schedule, c.unschedule)
  th.request('a'); th.request('b')
  th.cancel()
  c.advance(500)
  assert.deepEqual(calls, ['a'])
  assert.equal(th.busy, false)
})

test('the drag code does not draw cheap routes for device, tab, bend or stretch drags', () => {
  const src = readFileSync(new URL('../public/schematicView.js', import.meta.url), 'utf8')
  assert.match(src, /createRouteThrottle/)
  // the old rule that skipped routing while a device or tab was dragged is gone
  assert.doesNotMatch(src, /if \(dragging\) return null/)
  assert.doesNotMatch(src, /routeKey = dragging \?/)
  assert.doesNotMatch(src, /cheapDragging/)
  // the dragging flag covers all four drag kinds
  assert.match(src, /kind === 'move' \|\| drag\.current\.kind === 'stub' \|\| drag\.current\.kind === 'bend' \|\| drag\.current\.kind === 'seg'/)
})
