import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../public/schematic.js'
import { pageInput, routeBoatPage, pageNames } from './helpers/boatPages.mjs'
import { checkPage, linesOf } from './helpers/routeCheck.mjs'

const box = (id, x, y) => S.deviceBox({ id, role: 'consumer', terminals: [] }, { x, y })
const clash = (t, b, m = 0) => t.x < b.x + b.w + m && t.x + S.OFFPAGE_TAB_W + m > b.x && t.y < b.y + b.h + m && t.y + S.OFFPAGE_TAB_H + m > b.y

test('freeTabSpot: a free drop stays where it is', () => {
  assert.deepEqual(S.freeTabSpot({ x: 500, y: 500 }, [box('a', 0, 0)]), { x: 500, y: 500 })
})

test('freeTabSpot: a drop on a device or another tab moves to the nearest free spot', () => {
  const boxes = [box('a', 0, 0), box('b', 300, 0)]
  const other = { x: 100, y: 200, w: S.OFFPAGE_TAB_W, h: S.OFFPAGE_TAB_H }
  const at = S.freeTabSpot({ x: 20, y: 10 }, boxes, [other])
  for (const b of boxes) assert.equal(clash(at, b), false)
  assert.equal(clash(at, { ...other, w: other.w, h: other.h }), false)
  const on = S.freeTabSpot({ x: 110, y: 205 }, boxes, [other])
  assert.equal(clash(on, other), false)
  assert.ok(Math.hypot(on.x - 110, on.y - 205) < 120)
})

test('stubAt: a tab at a given position with a line to the side that faces the device', () => {
  const { input } = routeBoatPage(pageNames[0])
  const st = input.stubs[0]
  const r = S.stubAt({ ...st, path: [{ x: 10, y: 10 }, { x: 28, y: 10 }] }, { x: 300, y: 10 })
  assert.deepEqual({ x: r.tab.x, y: r.tab.y }, { x: 300, y: 10 })
  assert.deepEqual(r.path[0], { x: 10, y: 10 })
  assert.equal(r.path[1].x, 300)
})

test('every stub of a page can be placed by the user and the page stays clean', () => {
  for (const name of pageNames) {
    const base = pageInput(name)
    const stubPos = {}
    base.stubs.forEach((s, i) => {
      const b = base.boxes.find((x) => x.id === s.deviceId)
      const drop = { x: b.x + b.w + 260 + (i % 2) * 180, y: b.y + 120 + i * 40 }
      // as the view does on a drop: the nearest spot clear of devices and other tabs
      stubPos[s.cableId] = S.freeTabSpot(drop, base.boxes, Object.values(stubPos).map((t) => ({ ...t, w: S.OFFPAGE_TAB_W, h: S.OFFPAGE_TAB_H })))
    })
    const { input, result } = routeBoatPage(name, { stubPos })
    for (const s of input.stubs) assert.deepEqual({ x: result.stubs.get(s.cableId).tab.x, y: result.stubs.get(s.cableId).tab.y }, stubPos[s.cableId])
    const problems = checkPage(linesOf(input, result))
    assert.equal(problems.length, 0, problems.map((p) => p.type + ' ' + p.ids.join(' ')).join('; '))
  }
})
