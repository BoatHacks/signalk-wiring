import { test } from 'node:test'
import assert from 'node:assert/strict'
import dagre from '../public/vendor/dagre.esm.js'
import * as S from '../public/schematic.js'

const dev = (id, over = {}) => ({ id, name: id, role: 'consumer', terminals: [], ...over })
const box = (id, x, y, over) => S.deviceBox(dev(id, over), { x, y })
const orthogonal = (pts) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)

test('deviceBox: size grows with terminal rows and terminals get anchors on their sides', () => {
  const plain = box('a', 10, 20)
  assert.equal(plain.w, S.BOX_W)
  assert.equal(plain.h, S.BOX_MIN_H)
  assert.deepEqual(plain.terminals, [])

  const conv = S.deviceBox(dev('c', {
    role: 'converter',
    terminals: [
      { name: 'DC+', conductor: 'positive', port: 'DC in' },
      { name: 'DC-', conductor: 'negative', port: 'DC in' },
      { name: 'L', conductor: 'line', port: 'AC out' }
    ]
  }), { x: 0, y: 0 })
  assert.deepEqual(conv.terminals.map((t) => t.side), ['left', 'left', 'right'])
  assert.equal(conv.terminals[0].x, 0)
  assert.equal(conv.terminals[2].x, S.BOX_W)
  assert.ok(conv.terminals[1].y > conv.terminals[0].y)
  assert.ok(conv.h >= S.HEADER_H + 2 * S.TERMINAL_ROW_H)
})

test('terminalSides: by role when there are no ports', () => {
  const t = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]
  assert.deepEqual(S.terminalSides(dev('x', { terminals: t })), ['left', 'left', 'left', 'left'])
  assert.deepEqual(S.terminalSides(dev('x', { role: 'storage', terminals: t })), ['right', 'right', 'right', 'right'])
  assert.deepEqual(S.terminalSides(dev('x', { role: 'distribution', terminals: t })), ['left', 'left', 'right', 'right'])
})

test('facingSide and anchorOf: terminal wins, else the edge facing the target', () => {
  const b = box('a', 0, 0)
  assert.equal(S.facingSide(b, { x: 500, y: 20 }), 'right')
  assert.equal(S.facingSide(b, { x: -500, y: 20 }), 'left')
  assert.equal(S.facingSide(b, { x: 70, y: 500 }), 'bottom')
  assert.equal(S.facingSide(b, { x: 70, y: -500 }), 'top')
  const a = S.anchorOf(b, null, { x: 500, y: 20 })
  assert.deepEqual([a.x, a.y, a.side], [S.BOX_W, b.h / 2, 'right'])
  const shifted = S.anchorOf(b, null, { x: 500, y: 20 }, 100)
  assert.ok(shifted.y < b.h, 'shift is clamped inside the edge')
  const withT = S.deviceBox(dev('t', { terminals: [{ name: 'IN', conductor: 'positive' }] }), { x: 0, y: 0 })
  const ta = S.anchorOf(withT, 'IN', { x: 500, y: 20 })
  assert.equal(ta.side, 'left')
  assert.equal(ta.x, 0)
})

test('routeElbow: facing boxes give a Z with the channel in the middle', () => {
  const p = { x: 150, y: 20, side: 'right' }
  const q = { x: 400, y: 120, side: 'left' }
  const r = S.routeElbow(p, q)
  assert.deepEqual(r, [{ x: 150, y: 20 }, { x: 275, y: 20 }, { x: 275, y: 120 }, { x: 400, y: 120 }])
  assert.ok(orthogonal(r))
})

test('routeElbow: level anchors give a straight line', () => {
  const r = S.routeElbow({ x: 150, y: 20, side: 'right' }, { x: 400, y: 20, side: 'left' })
  assert.deepEqual(r, [{ x: 150, y: 20 }, { x: 400, y: 20 }])
})

test('routeElbow: target behind the source goes round, still right-angled', () => {
  const r = S.routeElbow({ x: 400, y: 20, side: 'right' }, { x: 100, y: 120, side: 'left' })
  assert.ok(orthogonal(r))
  assert.deepEqual(r[0], { x: 400, y: 20 })
  assert.deepEqual(r[r.length - 1], { x: 100, y: 120 })
  assert.ok(r.length >= 5)
})

test('routeElbow: both leaving right share a channel beyond both', () => {
  const r = S.routeElbow({ x: 150, y: 20, side: 'right' }, { x: 300, y: 200, side: 'right' })
  assert.ok(orthogonal(r))
  assert.ok(Math.max(...r.map((p) => p.x)) > 300)
})

test('routeElbow: vertical sides and mixed sides stay right-angled and end on the anchors', () => {
  const cases = [
    [{ x: 50, y: 50, side: 'bottom' }, { x: 300, y: 300, side: 'top' }],
    [{ x: 50, y: 50, side: 'bottom' }, { x: 300, y: 300, side: 'bottom' }],
    [{ x: 50, y: 300, side: 'top' }, { x: 300, y: 50, side: 'bottom' }],
    [{ x: 150, y: 50, side: 'right' }, { x: 300, y: 300, side: 'top' }],
    [{ x: 150, y: 50, side: 'right' }, { x: 300, y: -100, side: 'top' }],
    [{ x: 50, y: 50, side: 'bottom' }, { x: 300, y: 300, side: 'left' }],
    [{ x: 50, y: 50, side: 'bottom' }, { x: -300, y: 300, side: 'right' }]
  ]
  for (const [p, q] of cases) {
    const r = S.routeElbow(p, q, 5)
    assert.ok(orthogonal(r), JSON.stringify([p, q, r]))
    assert.deepEqual([r[0].x, r[0].y], [p.x, p.y])
    assert.deepEqual([r[r.length - 1].x, r[r.length - 1].y], [q.x, q.y])
  }
})

test('routeElbow: an L route when the corner is reachable', () => {
  const r = S.routeElbow({ x: 150, y: 50, side: 'right' }, { x: 300, y: 300, side: 'top' })
  assert.deepEqual(r, [{ x: 150, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 300 }])
})

test('assignLanes: parallel wires spread around zero, others stay at zero', () => {
  const lanes = S.assignLanes([
    { id: 'w1', a: 'x', b: 'y' },
    { id: 'w2', a: 'y', b: 'x' },
    { id: 'w3', a: 'x', b: 'y' },
    { id: 'w4', a: 'x', b: 'z' }
  ])
  assert.equal(lanes.w1, -S.LANE_GAP)
  assert.equal(lanes.w2, 0)
  assert.equal(lanes.w3, S.LANE_GAP)
  assert.equal(lanes.w4, 0)
})

test('lanes keep parallel routes apart', () => {
  const a = box('a', 0, 0)
  const b = box('b', 400, 200)
  const r1 = S.wirePath({ fromBox: a, toBox: b, lane: -10 })
  const r2 = S.wirePath({ fromBox: a, toBox: b, lane: 10 })
  assert.notDeepEqual(r1, r2)
  const mid = (r) => r[1].x
  assert.equal(mid(r2) - mid(r1), 20)
})

test('wirePath: terminals decide the anchors', () => {
  const a = S.deviceBox(dev('a', { role: 'source', terminals: [{ name: '+', conductor: 'positive' }, { name: '-', conductor: 'negative' }] }), { x: 0, y: 0 })
  const b = S.deviceBox(dev('b', { terminals: [{ name: 'IN', conductor: 'positive' }] }), { x: 400, y: 100 })
  const r = S.wirePath({ fromBox: a, toBox: b, fromTerminal: '-', toTerminal: 'IN' })
  assert.deepEqual([r[0].x, r[0].y], [a.terminals[1].x, a.terminals[1].y])
  assert.deepEqual([r[r.length - 1].x, r[r.length - 1].y], [b.terminals[0].x, b.terminals[0].y])
  assert.ok(orthogonal(r))
})

test('wirePath: bend points make the wire pass through them in order', () => {
  const a = box('a', 0, 0)
  const b = box('b', 400, 200)
  const r = S.wirePath({ fromBox: a, toBox: b, points: [{ x: 200, y: 10 }, { x: 250, y: 150 }] })
  assert.equal(r.length, 4)
  assert.deepEqual(r[1], { x: 200, y: 10 })
  assert.deepEqual(r[2], { x: 250, y: 150 })
  assert.equal(r[0].side, undefined)
})

test('pathMidpoint and pathToD', () => {
  const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
  assert.deepEqual(S.pathMidpoint(p), { x: 100, y: 0 })
  assert.equal(S.pathToD(p), 'M0 0 L100 0 L100 100')
})

test('offPageStubs: one end on the page gives a stub with a labelled tab', () => {
  const boxes = new Map([['a', box('a', 0, 0)]])
  const cables = [
    { id: 'c1', fromDeviceId: 'a', toDeviceId: 'z' },
    { id: 'c2', fromDeviceId: 'y', toDeviceId: 'a' },
    { id: 'c3', fromDeviceId: 'a', toDeviceId: 'a2' },
    { id: 'c4', fromDeviceId: 'q', toDeviceId: 'r' },
    { id: 'c5', fromDeviceId: 'a', toDeviceId: 'z', status: 'removed' }
  ]
  const names = { z: 'Anchor light', y: 'Battery', a2: 'Other' }
  const stubs = S.offPageStubs({ boxes, cables, deviceName: (id) => names[id] })
  assert.deepEqual(stubs.map((s) => s.cableId).sort(), ['c1', 'c2', 'c3'])
  const c1 = stubs.find((s) => s.cableId === 'c1')
  assert.equal(c1.label, 'to Anchor light')
  assert.equal(c1.side, 'right')
  assert.equal(c1.otherDeviceId, 'z')
  assert.equal(c1.path[0].x, S.BOX_W)
  assert.ok(c1.path[c1.path.length - 1].x > S.BOX_W)
  assert.equal(c1.tab.x, c1.path[c1.path.length - 1].x)
  const c2 = stubs.find((s) => s.cableId === 'c2')
  assert.equal(c2.side, 'left')
  assert.equal(c2.label, 'to Battery')
  assert.equal(c2.tab.x + c2.tab.w, c2.path[c2.path.length - 1].x)
})

test('offPageStubs: cables with both ends on the page or none make no stub; stubs on one side are spaced', () => {
  const boxes = { a: box('a', 0, 0), b: box('b', 300, 0) }
  const stubs = S.offPageStubs({
    boxes,
    cables: [
      { id: 'in', fromDeviceId: 'a', toDeviceId: 'b' },
      { id: 'o1', fromDeviceId: 'a', toDeviceId: 'p' },
      { id: 'o2', fromDeviceId: 'a', toDeviceId: 'q' }
    ],
    deviceName: () => 'X'
  })
  assert.equal(stubs.length, 2)
  assert.notEqual(stubs[0].tab.y, stubs[1].tab.y)
  assert.equal(Math.abs(stubs[0].tab.y - stubs[1].tab.y), S.OFFPAGE_GAP)
})

test('offPageStubs: a named terminal sets the side and anchor', () => {
  const a = S.deviceBox(dev('a', { role: 'storage', terminals: [{ name: '+', conductor: 'positive' }] }), { x: 0, y: 0 })
  const stubs = S.offPageStubs({
    boxes: { a },
    cables: [{ id: 'c', fromDeviceId: 'z', toDeviceId: 'a', conductors: [{ conductor: 'positive', toTerminal: '+' }] }],
    deviceName: () => 'Z'
  })
  assert.equal(stubs[0].side, 'right')
  assert.equal(stubs[0].path[0].y, a.terminals[0].y)
})

test('hit testing: devices, terminals, wires and bends', () => {
  const a = S.deviceBox(dev('a', { terminals: [{ name: 'IN', conductor: 'positive' }] }), { x: 0, y: 0 })
  const b = box('b', 200, 0)
  assert.equal(S.hitDevice([a, b], 10, 10).id, 'a')
  assert.equal(S.hitDevice([a, b], 220, 10).id, 'b')
  assert.equal(S.hitDevice([a, b], 180, 10), null)
  const overlap = [box('top1', 0, 0), box('top2', 10, 10)]
  assert.equal(S.hitDevice(overlap, 20, 20).id, 'top2')

  const t = S.hitTerminal([a, b], 3, a.terminals[0].y + 2)
  assert.deepEqual([t.deviceId, t.terminal], ['a', 'IN'])
  assert.equal(S.hitTerminal([a, b], 60, 60), null)

  const wires = [{ id: 'w', path: [{ x: 0, y: 100 }, { x: 100, y: 100 }] }]
  assert.equal(S.hitWire(wires, 50, 103).id, 'w')
  assert.equal(S.hitWire(wires, 50, 130), null)
  assert.equal(S.hitBend([{ x: 10, y: 10 }, { x: 50, y: 50 }], 52, 49), 1)
  assert.equal(S.hitBend([{ x: 10, y: 10 }], 80, 80), -1)
})

test('insertBendIndex: a click on the second segment goes after the first bend', () => {
  const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
  assert.equal(S.insertBendIndex(path, [{ x: 100, y: 0 }], 100, 60), 1)
  assert.equal(S.insertBendIndex(path, [{ x: 100, y: 0 }], 40, 0), 0)
  assert.equal(S.insertBendIndex([{ x: 0, y: 0 }, { x: 100, y: 100 }], [], 50, 50), 0)
})

test('supplyOrder puts the supply side first whichever way the wire was dragged', () => {
  const bat = dev('bat', { role: 'storage' })
  const lamp = dev('lamp')
  const fuse = dev('fuse', { role: 'distribution' })
  assert.deepEqual(S.supplyOrder(lamp, bat).map((d) => d.id), ['bat', 'lamp'])
  assert.deepEqual(S.supplyOrder(bat, fuse).map((d) => d.id), ['bat', 'fuse'])
  assert.deepEqual(S.supplyOrder(lamp, fuse).map((d) => d.id), ['fuse', 'lamp'])
  assert.deepEqual(S.supplyOrder(dev('x'), dev('y')).map((d) => d.id), ['x', 'y'])
})

test('defaultKind: positive + negative, a lone positive at a switch, AC for AC terminals', () => {
  assert.equal(S.defaultKind(dev('bat', { role: 'storage' }), dev('lamp')), 'both')
  assert.equal(S.defaultKind(dev('fuse', { role: 'distribution' }), dev('lamp')), 'positive')
  const inv = dev('inv', { role: 'converter', terminals: [{ name: 'L', conductor: 'line' }] })
  assert.equal(S.defaultKind(inv, dev('socket')), 'ac')
  const conv = dev('c', { role: 'converter', terminals: [{ name: 'L', conductor: 'line' }, { name: '+', conductor: 'positive' }] })
  assert.equal(S.defaultKind(conv, dev('socket')), 'both')
})

test('cablesBetween ignores removed cables and either direction', () => {
  const cables = [
    { id: '1', fromDeviceId: 'a', toDeviceId: 'b' },
    { id: '2', fromDeviceId: 'b', toDeviceId: 'a' },
    { id: '3', fromDeviceId: 'a', toDeviceId: 'b', status: 'removed' },
    { id: '4', fromDeviceId: 'a', toDeviceId: 'c' }
  ]
  assert.deepEqual(S.cablesBetween(cables, 'a', 'b').map((c) => c.id), ['1', '2'])
})

test('endTerminals and conductorTypes', () => {
  const cable = { conductors: [{ conductor: 'positive', fromTerminal: 'OUT' }, { conductor: 'negative', toTerminal: 'IN' }] }
  assert.deepEqual(S.endTerminals(cable), { from: 'OUT', to: 'IN' })
  assert.deepEqual(S.conductorTypes(cable), ['positive', 'negative'])
  assert.deepEqual(S.conductorTypes({}), ['positive'])
  assert.deepEqual(S.endTerminals({}), { from: null, to: null })
})

test('circuitHighlight collects feed and return cables and devices', () => {
  const h = S.circuitHighlight({ derived: { deviceIds: ['a', 'b'], cableIds: ['c1'], returnCableIds: ['c2'] } })
  assert.deepEqual([...h.deviceIds], ['a', 'b'])
  assert.deepEqual([...h.cableIds], ['c1', 'c2'])
  assert.equal(S.circuitHighlight(null).cableIds.size, 0)
  assert.equal(S.circuitHighlight({ derived: null }).deviceIds.size, 0)
})

test('autoLayout puts the supply left of its loads and does not overlap', () => {
  const devices = [
    dev('bat', { role: 'storage' }),
    dev('fuse', { role: 'distribution' }),
    dev('l1'), dev('l2')
  ]
  const cables = [
    { id: 'c1', fromDeviceId: 'bat', toDeviceId: 'fuse' },
    { id: 'c2', fromDeviceId: 'fuse', toDeviceId: 'l1' },
    { id: 'c3', fromDeviceId: 'fuse', toDeviceId: 'l2' },
    { id: 'c4', fromDeviceId: 'fuse', toDeviceId: 'gone' }
  ]
  const pos = S.autoLayout(dagre, devices, cables)
  assert.ok(pos.bat.x < pos.fuse.x)
  assert.ok(pos.fuse.x < pos.l1.x)
  assert.equal(pos.l1.x, pos.l2.x)
  assert.notEqual(pos.l1.y, pos.l2.y)
  assert.ok(Math.abs(pos.l1.y - pos.l2.y) >= S.BOX_MIN_H)
})

test('fitView frames the boxes with a margin', () => {
  assert.deepEqual(S.fitView([]), { x: 0, y: 0, w: 800, h: 500 })
  const v = S.fitView([box('a', 100, 100), box('b', 500, 300)], 40)
  assert.equal(v.x, 60)
  assert.equal(v.y, 60)
  assert.equal(v.w, 500 + S.BOX_W - 100 + 80)
})
