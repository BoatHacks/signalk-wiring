import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../public/schematic.js'
import * as R from '../public/wireRouter.js'

const dev = (id, role = 'consumer') => ({ id, role, terminals: [] })
const box = (id, x, y, role) => S.deviceBox(dev(id, role), { x, y })
const wire = (id, fromId, toId, extra = {}) => ({ id, fromId, toId, fromTerminal: null, toTerminal: null, points: [], conduitIds: [], ...extra })
const through = (pts, b) => {
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]
    const c = pts[k]
    if (Math.max(a.x, c.x) > b.x && Math.min(a.x, c.x) < b.x + b.w && Math.max(a.y, c.y) > b.y && Math.min(a.y, c.y) < b.y + b.h) return true
  }
  return false
}
const orthogonal = (pts) => pts.every((p, k) => k === 0 || p.x === pts[k - 1].x || p.y === pts[k - 1].y)

test('router: two boxes facing each other get a short right-angle route', () => {
  const boxes = [box('a', 0, 0, 'source'), box('b', 300, 60)]
  const r = R.routePage({ boxes, wires: [wire('w', 'a', 'b')] })
  const p = r.wires.get('w').points
  assert.ok(orthogonal(p))
  assert.ok(p.length <= 4)
  assert.equal(p[0].x, 150)
  assert.equal(p[p.length - 1].x, 300)
})

test('router: a box in the way is avoided', () => {
  const boxes = [box('a', 0, 100, 'source'), box('m', 250, 60, 'distribution'), box('b', 500, 100)]
  const r = R.routePage({ boxes, wires: [wire('w', 'a', 'b')] })
  const p = r.wires.get('w').points
  assert.ok(orthogonal(p))
  assert.equal(through(p, boxes[1]), false)
  assert.equal(r.wires.get('w').fallback, false)
})

test('router: a wire from a bottom port leaves downwards', () => {
  const a = S.deviceBox({ id: 'a', role: 'converter', terminals: [{ name: 's', conductor: 'signal', port: 'CAN' }] }, { x: 0, y: 0 })
  const b = box('b', 300, 200)
  const r = R.routePage({ boxes: [a, b], wires: [wire('w', 'a', 'b', { fromTerminal: 's' })] })
  const p = r.wires.get('w').points
  assert.equal(p[0].y, a.y + a.h)
  assert.equal(p[1].x, p[0].x)
  assert.ok(p[1].y > p[0].y)
})

test('router: result is deterministic and independent of input order', () => {
  const boxes = [box('a', 0, 0, 'source'), box('b', 300, 0), box('c', 300, 120)]
  const ws = [wire('w1', 'a', 'b'), wire('w2', 'a', 'c')]
  const one = R.routePage({ boxes, wires: ws })
  const two = R.routePage({ boxes, wires: [...ws].reverse() })
  assert.deepEqual([...one.wires].sort(), [...two.wires].sort())
})

test('router: parallel wires between two boxes are spread apart', () => {
  const boxes = [box('a', 0, 0, 'source'), box('b', 300, 80)]
  const r = R.routePage({ boxes, wires: [wire('w1', 'a', 'b'), wire('w2', 'a', 'b'), wire('w3', 'a', 'b')] })
  const mids = ['w1', 'w2', 'w3'].map((id) => r.wires.get(id).points.map((p) => p.x).filter((x) => x > 160 && x < 290)[0])
  assert.equal(new Set(mids).size, 3)
})

test('router: a user bend point keeps the wire as drawn', () => {
  const boxes = [box('a', 0, 0, 'source'), box('b', 300, 0)]
  const r = R.routePage({ boxes, wires: [wire('w', 'a', 'b', { points: [{ x: 200, y: 120 }] })] })
  const w = r.wires.get('w')
  assert.equal(w.fixed, true)
  assert.deepEqual(w.points[1], { x: 200, y: 120 })
  assert.equal(w.points.length, 3)
})

test('bridges: a horizontal wire hops over a vertical one, not at the ends', () => {
  const paths = new Map([
    ['h', [{ x: 0, y: 50 }, { x: 100, y: 50 }]],
    ['v', [{ x: 50, y: 0 }, { x: 50, y: 100 }]]
  ])
  const b = R.findBridges(paths)
  assert.deepEqual(b.get('h'), [{ x: 50, y: 50 }])
  assert.equal(b.get('v'), undefined)
  const touching = R.findBridges(new Map([['h', [{ x: 0, y: 50 }, { x: 100, y: 50 }]], ['v', [{ x: 100, y: 0 }, { x: 100, y: 100 }]]]))
  assert.equal(touching.size, 0)
  const d = R.pathToDWithBridges(paths.get('h'), b.get('h'))
  assert.match(d, /A4 4 0 0 0 54 50/)
})

test('stubs: tabs do not overlap boxes or each other', () => {
  const boxes = [box('a', 0, 0, 'source'), box('b', 220, 0)]
  const cables = [1, 2, 3, 4].map((i) => ({ id: 'c' + i, fromDeviceId: 'a', toDeviceId: 'x' + i, status: 'active', conductors: [] }))
  const stubs = S.offPageStubs({ boxes: new Map(boxes.map((b) => [b.id, b])), cables, deviceName: (id) => id })
  const r = R.routePage({ boxes, wires: [], stubs })
  const tabs = [...r.stubs.values()].map((s) => s.tab)
  assert.equal(tabs.length, 4)
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  for (let i = 0; i < tabs.length; i++) {
    for (const b of boxes) assert.equal(hit(tabs[i], b), false)
    for (let j = i + 1; j < tabs.length; j++) assert.equal(hit(tabs[i], tabs[j]), false)
  }
})

// The page has 20 pairs of wires between the same devices (bundles, plan 0025), so a cold first route takes longer than a plain page; the boat's pages are held to 500 ms in routerBoatPages.test.mjs.
test('router: 40 devices and 60 wires route well inside a second', () => {
  const boxes = []
  for (let i = 0; i < 40; i++) boxes.push(box('d' + i, (i % 8) * 260, Math.floor(i / 8) * 130, i % 8 === 0 ? 'source' : 'consumer'))
  const wires = []
  for (let i = 0; i < 60; i++) wires.push(wire('w' + String(i).padStart(3, '0'), 'd' + (i % 40), 'd' + ((i * 7 + 3) % 40)))
  const t0 = performance.now()
  const r = R.routePage({ boxes, wires: wires.filter((w) => w.fromId !== w.toId) })
  const ms = performance.now() - t0
  assert.ok(ms < 900, `took ${ms.toFixed(0)} ms`)
  for (const [id, w] of r.wires) {
    const wr = wires.find((x) => x.id === id)
    for (const b of boxes) if (b.id !== wr.fromId && b.id !== wr.toId && !w.fallback) assert.equal(through(w.points, b), false)
  }
})

test('conduit bands: shared stretches, a lone wire, two conduits, the label', () => {
  const conduits = new Map([['k1', { kind: 'Hose', name: 'MPPT DC hose', innerDiameter: 16, diameterUnit: 'mm' }], ['k2', { kind: 'Conduit', name: 'Arch' }]])
  const paths = new Map([
    ['a', [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }]],
    ['b', [{ x: 0, y: 5 }, { x: 200, y: 5 }, { x: 200, y: 140 }]],
    ['c', [{ x: 0, y: 400 }, { x: 100, y: 400 }]]
  ])
  const bands = R.conduitBands({
    wires: [{ id: 'a', conduitIds: ['k1', 'k2'] }, { id: 'b', conduitIds: ['k1'] }, { id: 'c', conduitIds: [] }],
    paths,
    conduits
  })
  const k1 = bands.find((b) => b.conduitId === 'k1')
  assert.equal(k1.label, 'Hose 16 mm, MPPT DC hose')
  assert.ok(k1.stretches.length >= 1)
  assert.equal(k1.stretches.length, 2) // only the shared first segment of a and b
  const k2 = bands.find((b) => b.conduitId === 'k2')
  // a band stops short of the ports at both ends of its wire (plan 0022)
  assert.deepEqual(k2.stretches, [[{ x: R.BAND_END, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 - R.BAND_END }]])
  assert.ok(k1.stretches.every((st) => st[0].x >= R.BAND_END))
  assert.equal(bands.length, 2)
  assert.equal(R.conduitLabel({ kind: 'Conduit', name: '' }), 'Conduit')
})

test('USE_NEW_ROUTER false gives the old routes with no bridges', () => {
  const boxes = [box('a', 0, 0, 'source'), box('b', 300, 80)]
  const r = R.routeSchematicPage({ boxes, wires: [wire('w', 'a', 'b')], stubs: [], legacy: S.wirePath, useNew: false })
  assert.deepEqual(r.wires.get('w').bridges, [])
  assert.ok(r.wires.get('w').points.length >= 2)
})
