import { cableCurrent } from './current.js'
import { hashForState } from './router.js'
// Pure geometry for the schematic canvas (plan 0016): device boxes and their
// terminal anchors, right-angle wire routing with lane offsets, wires through
// bend points, off-page stubs, hit testing, default conductors and the
// left-to-right auto layout. No DOM, so it is unit tested with plain data.
//
// Coordinates are canvas units. A box is { id, x, y, w, h, terminals } with
// x, y its top-left corner. A side is 'left', 'right', 'top' or 'bottom'.

export const BOX_W = 150
export const BOX_MIN_H = 46
export const HEADER_H = 30
export const TERMINAL_ROW_H = 18
export const STUB = 18
export const LANE_GAP = 10
export const OFFPAGE_LEN = 46
export const OFFPAGE_TAB_W = 130
export const OFFPAGE_TAB_H = 20
export const OFFPAGE_GAP = 24

const NORMALS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 }
}

export function sideNormal (side) {
  return NORMALS[side]
}

// ---- Devices as boxes -------------------------------------------------------

// Which side of the box each terminal sits on. A device with ports (a
// converter) puts its first port on the left and the others on the right.
// Without ports, consumers take their terminals on the left (supply arrives
// from the left), sources and storage on the right, and anything else splits
// them: the first half left, the rest right.
export function terminalSides (device) {
  const terminals = device.terminals || []
  const ports = []
  for (const t of terminals) if (t.port && !ports.includes(t.port)) ports.push(t.port)
  const role = device.role || 'consumer'
  return terminals.map((t, i) => {
    if (ports.length > 1) return t.port === ports[0] ? 'left' : 'right'
    if (role === 'consumer') return 'left'
    if (role === 'source' || role === 'storage') return 'right'
    return i < Math.ceil(terminals.length / 2) ? 'left' : 'right'
  })
}

// ---- Ports ------------------------------------------------------------------
//
// A port is a named group of terminals ("DC in" with "DC in +" and "DC in -").
// A device whose terminals name ports gets one block per port, with the port
// name written on the box and the terminals grouped inside the block: inputs
// on the left, outputs on the right, signal ports (data, relays) along the
// bottom. A device without ports keeps the flat layout above.

export const PORT_LABEL_H = 13
export const PORT_GAP = 7
export const BOTTOM_ROW_W = 16
export const BOTTOM_H = 24

const INPUT_WORDS = /\b(in|input|inputs|pv|solar|shore|supply|source|grid)\b/i
const OUTPUT_WORDS = /\b(out|output|outputs|load|battery|bat|house)\b/i

// Which side a port goes on. Signal ports (every terminal a signal) go along
// the bottom; otherwise the name decides ("in" left, "out" or "battery"
// right); a port the name does not place goes on the shorter side so far.
export function portSide (name, terminals, load) {
  if (terminals.length > 0 && terminals.every((t) => t.conductor === 'signal')) return 'bottom'
  const input = INPUT_WORDS.test(name)
  const output = OUTPUT_WORDS.test(name)
  if (input && !output) return 'left'
  if (output && !input) return 'right'
  return load.left <= load.right ? 'left' : 'right'
}

export function hasPorts (device) {
  return (device.terminals || []).some((t) => t.port)
}

// The ports of a device in order, each { name, side, terminals: [{ t, index }] }.
// Terminals with no port form an unnamed group.
export function devicePorts (device) {
  const groups = []
  ;(device.terminals || []).forEach((t, index) => {
    const name = t.port || ''
    let group = groups.find((g) => g.name === name)
    if (!group) { group = { name, side: null, terminals: [] }; groups.push(group) }
    group.terminals.push({ t, index })
  })
  const load = { left: 0, right: 0 }
  // Named inputs and outputs first so loose ports balance around them.
  const order = [...groups].sort((a, b) => Number(Boolean(b.name && (INPUT_WORDS.test(b.name) || OUTPUT_WORDS.test(b.name)))) -
    Number(Boolean(a.name && (INPUT_WORDS.test(a.name) || OUTPUT_WORDS.test(a.name)))))
  for (const g of order) {
    g.side = portSide(g.name, g.terminals.map((x) => x.t), load)
    if (g.side !== 'bottom') load[g.side] += g.terminals.length + (g.name ? 1 : 0)
  }
  return groups
}

// opts.w: the box width (default BOX_W); a box with bottom ports may grow.
export function deviceBox (device, pos, opts = {}) {
  if (hasPorts(device)) return portBox(device, pos, opts)
  const terminals = device.terminals || []
  const sides = terminalSides(device)
  const count = { left: 0, right: 0 }
  for (const s of sides) count[s]++
  const rows = Math.max(count.left, count.right)
  const h = Math.max(BOX_MIN_H, HEADER_H + rows * TERMINAL_ROW_H + 6)
  const w = opts.w || device.boxW || BOX_W
  const seen = { left: 0, right: 0 }
  return {
    id: device.id,
    x: pos.x,
    y: pos.y,
    w,
    h,
    ports: [],
    current: device.current || '',
    bottomPorts: false,
    terminals: terminals.map((t, i) => {
      const side = sides[i]
      const row = seen[side]++
      return {
        name: t.name,
        conductor: t.conductor,
        port: t.port || '',
        side,
        x: side === 'left' ? pos.x : pos.x + w,
        y: pos.y + HEADER_H + row * TERMINAL_ROW_H + TERMINAL_ROW_H / 2
      }
    })
  }
}

function portBox (device, pos, opts) {
  const groups = devicePorts(device)
  const cursor = { left: HEADER_H, right: HEADER_H }
  const placed = []
  let bottomW = 0
  const bottomGroups = groups.filter((g) => g.side === 'bottom')
  for (const g of bottomGroups) bottomW += Math.max(g.terminals.length * BOTTOM_ROW_W, g.name.length * 5.4) + PORT_GAP
  const w = Math.max(opts.w || device.boxW || BOX_W, Math.ceil(bottomW + PORT_GAP))
  const hasBottom = bottomGroups.length > 0

  for (const g of groups.filter((x) => x.side !== 'bottom')) {
    const top = cursor[g.side]
    const firstRowTop = top + (g.name ? PORT_LABEL_H : 0)
    g.rows = g.terminals.map((x, row) => ({ ...x, y: firstRowTop + row * TERMINAL_ROW_H + TERMINAL_ROW_H / 2 }))
    const edge = g.side === 'left' ? 0 : w
    g.block = { x: edge - 7, y: firstRowTop + 1, w: 14, h: g.terminals.length * TERMINAL_ROW_H - 2 }
    g.label = g.name ? { x: edge + (g.side === 'left' ? 11 : -11), y: top + 10, anchor: g.side === 'left' ? 'start' : 'end' } : null
    cursor[g.side] = firstRowTop + g.terminals.length * TERMINAL_ROW_H + PORT_GAP
    placed.push(g)
  }
  const bodyH = Math.max(BOX_MIN_H - (hasBottom ? BOTTOM_H : 0), cursor.left - PORT_GAP + 4, cursor.right - PORT_GAP + 4)
  const h = bodyH + (hasBottom ? BOTTOM_H : 0)

  let bx = (w - (bottomW - PORT_GAP)) / 2
  for (const g of bottomGroups) {
    const gw = Math.max(g.terminals.length * BOTTOM_ROW_W, g.name.length * 5.4)
    const dotsW = g.terminals.length * BOTTOM_ROW_W
    const start = bx + (gw - dotsW) / 2
    g.rows = g.terminals.map((x, col) => ({ ...x, x: start + col * BOTTOM_ROW_W + BOTTOM_ROW_W / 2, y: h }))
    g.block = { x: start + 1, y: h - 7, w: dotsW - 2, h: 14 }
    g.label = g.name ? { x: bx + gw / 2, y: h - 11, anchor: 'middle' } : null
    bx += gw + PORT_GAP
    placed.push(g)
  }

  const terminals = []
  for (const g of placed) {
    for (const r of g.rows) {
      terminals[r.index] = {
        name: r.t.name,
        conductor: r.t.conductor,
        port: r.t.port || '',
        side: g.side,
        x: pos.x + (g.side === 'bottom' ? r.x : g.side === 'left' ? 0 : w),
        y: pos.y + r.y
      }
    }
  }
  return {
    id: device.id,
    x: pos.x,
    y: pos.y,
    w,
    h,
    bottomPorts: hasBottom,
    current: device.current || '',
    // Port blocks in box-relative coordinates, for drawing.
    ports: placed.map((g) => ({ name: g.name, side: g.side, block: g.block, label: g.label })),
    terminals
  }
}

export const boxCenter = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

// The side of a box that faces a point.
export function facingSide (box, point) {
  const c = boxCenter(box)
  const dx = point.x - c.x
  const dy = point.y - c.y
  // Compare against the box proportions so a wide box prefers its short sides.
  if (Math.abs(dx) * box.h >= Math.abs(dy) * box.w) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

// Where a wire meets a box: at the named terminal, else on the edge facing
// `toward`, shifted along the edge by `shift` (lane offsets) and kept inside
// the edge.
export function anchorOf (box, terminalName, toward, shift = 0) {
  const t = terminalName && box.terminals.find((x) => x.name === terminalName)
  if (t) return { x: t.x, y: t.y, side: t.side }
  const side = facingSide(box, toward)
  const clamp = (v, lo, hi) => Math.max(lo + 6, Math.min(hi - 6, v))
  const c = boxCenter(box)
  if (side === 'left' || side === 'right') {
    return { x: side === 'left' ? box.x : box.x + box.w, y: clamp(c.y + shift, box.y, box.y + box.h), side }
  }
  return { x: clamp(c.x + shift, box.x, box.x + box.w), y: side === 'top' ? box.y : box.y + box.h, side }
}

// ---- Routing ----------------------------------------------------------------

function simplify (points) {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    out.push({ x: p.x, y: p.y })
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1]
      const b = out[i]
      const c = out[i + 1]
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
        out.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return out
}

const swapXY = (p) => ({ x: p.y, y: p.x })

// Route between two anchors that both leave horizontally.
function routeHorizontal (p, np, q, nq, lane) {
  const s1 = { x: p.x + np.x * STUB, y: p.y }
  const s2 = { x: q.x + nq.x * STUB, y: q.y }
  // Facing each other with room between: one vertical channel in the middle.
  if (np.x === 1 && nq.x === -1 && s1.x <= s2.x) {
    const mx = (s1.x + s2.x) / 2 + lane
    return [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q]
  }
  if (np.x === -1 && nq.x === 1 && s1.x >= s2.x) {
    const mx = (s1.x + s2.x) / 2 + lane
    return [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q]
  }
  // Same direction: both leave to one side and meet in a channel beyond both.
  if (np.x === nq.x) {
    const cx = np.x === 1 ? Math.max(s1.x, s2.x) + lane : Math.min(s1.x, s2.x) - lane
    return [p, { x: cx, y: p.y }, { x: cx, y: q.y }, q]
  }
  // Facing each other without room (the target is behind): go round in a
  // horizontal channel between the two.
  const my = p.y === q.y ? p.y + 40 + lane : (p.y + q.y) / 2 + lane
  return [p, s1, { x: s1.x, y: my }, { x: s2.x, y: my }, s2, q]
}

// Route between a horizontally leaving anchor and a vertically leaving one.
function routeMixed (p, np, q, nq, lane) {
  const corner = { x: q.x, y: p.y }
  const towardQx = Math.sign(q.x - p.x) === np.x
  const qApproach = Math.sign(p.y - q.y) === nq.y
  if (towardQx && qApproach) return [p, corner, q]
  const s1 = { x: p.x + np.x * STUB, y: p.y }
  const s2 = { x: q.x, y: q.y + nq.y * STUB }
  const ym = s2.y + lane
  return [p, s1, { x: s1.x, y: ym }, { x: s2.x, y: ym }, s2, q]
}

// A right-angle route from anchor p to anchor q, each with its side.
// `lane` shifts the middle channel so parallel wires do not overlap.
export function routeElbow (p, q, lane = 0) {
  const np = NORMALS[p.side]
  const nq = NORMALS[q.side]
  const pHoriz = np.y === 0
  const qHoriz = nq.y === 0
  let pts
  if (pHoriz && qHoriz) pts = routeHorizontal(p, np, q, nq, lane)
  else if (!pHoriz && !qHoriz) {
    const t = routeHorizontal(swapXY(p), swapXY(np), swapXY(q), swapXY(nq), lane)
    pts = t.map(swapXY)
  } else if (pHoriz) pts = routeMixed(p, np, q, nq, lane)
  else {
    const t = routeMixed(swapXY(p), swapXY(np), swapXY(q), swapXY(nq), lane)
    pts = t.map(swapXY)
  }
  return simplify(pts)
}

// Lane offsets for wires that share the same pair of devices: the first gets
// the most negative lane and the offsets are centred on zero. Input is a list
// of { id, a, b } (device ids); output maps id to a lane in canvas units.
export function assignLanes (wires) {
  const groups = new Map()
  for (const w of wires) {
    const key = [w.a, w.b].sort().join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(w)
  }
  const lanes = {}
  for (const list of groups.values()) {
    list.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    list.forEach((w, i) => { lanes[w.id] = (i - (list.length - 1) / 2) * LANE_GAP })
  }
  return lanes
}

// The terminal names a cable lands on at its two ends: the first conductor
// that names one wins.
export function endTerminals (cable) {
  const out = { from: null, to: null }
  for (const c of cable.conductors || []) {
    if (!out.from && c.fromTerminal) out.from = c.fromTerminal
    if (!out.to && c.toTerminal) out.to = c.toTerminal
  }
  return out
}

// The points of one wire between two boxes. With bend points the wire goes
// straight from the anchor to each bend in turn (so it can run at any angle);
// without, it is routed with right angles and shifted by its lane.
export function wirePath ({ fromBox, toBox, fromTerminal, toTerminal, lane = 0, points = [] }) {
  const toward = (box, other) => boxCenter(other)
  if (points && points.length > 0) {
    const a = anchorOf(fromBox, fromTerminal, points[0], lane)
    const b = anchorOf(toBox, toTerminal, points[points.length - 1], lane)
    return [{ x: a.x, y: a.y }, ...points.map((p) => ({ x: p.x, y: p.y })), { x: b.x, y: b.y }]
  }
  const a = anchorOf(fromBox, fromTerminal, toward(fromBox, toBox), lane)
  const b = anchorOf(toBox, toTerminal, toward(toBox, fromBox), lane)
  return routeElbow(a, b, lane)
}

// The point halfway along a path, for labels.
export function pathMidpoint (points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  let walk = total / 2
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (walk <= len && len > 0) {
      const t = walk / len
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t }
    }
    walk -= len
  }
  return points[0] || { x: 0, y: 0 }
}

export const pathToD = (points) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')

// ---- Off-page stubs ---------------------------------------------------------

// For each live cable with exactly one end on the page, a short stub leaving
// the device and ending in a labelled tab. The side follows supply flow: a
// cable that comes from the device (the device is the supply end) leaves to
// the right, one that goes to it arrives from the left; a named terminal's
// own side wins. Several stubs on one side of a device are spaced apart.
//   onPage: Map or object of device id -> box
//   cables: wire run resources; deviceName(id) gives the label text
export function offPageStubs ({ boxes, cables, deviceName }) {
  const get = (id) => (boxes instanceof Map ? boxes.get(id) : boxes[id])
  const items = []
  for (const cable of cables) {
    if (cable.status === 'removed') continue
    const fromBox = get(cable.fromDeviceId)
    const toBox = get(cable.toDeviceId)
    if (!!fromBox === !!toBox) continue
    const box = fromBox || toBox
    const isFrom = !!fromBox
    const otherId = isFrom ? cable.toDeviceId : cable.fromDeviceId
    if (!otherId) continue
    const terminal = endTerminals(cable)[isFrom ? 'from' : 'to']
    const t = terminal && box.terminals.find((x) => x.name === terminal)
    const side = t ? t.side : (isFrom ? 'right' : 'left')
    items.push({ cableId: cable.id, deviceId: box.id, otherDeviceId: otherId, box, side, terminal: t || null })
  }
  const groups = new Map()
  for (const it of items) {
    const key = it.deviceId + '|' + it.side
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(it)
  }
  const out = []
  for (const list of groups.values()) {
    list.sort((a, b) => (a.cableId < b.cableId ? -1 : 1))
    list.forEach((it, i) => {
      const dir = NORMALS[it.side].x
      const c = boxCenter(it.box)
      const offset = (i - (list.length - 1) / 2) * OFFPAGE_GAP
      const ay = it.terminal ? it.terminal.y : c.y + offset
      const ax = it.side === 'left' ? it.box.x : it.box.x + it.box.w
      const endX = ax + dir * OFFPAGE_LEN
      const endY = it.terminal ? ay + offset : ay
      const path = simplify(it.terminal && offset !== 0
        ? [{ x: ax, y: ay }, { x: ax + dir * 14, y: ay }, { x: ax + dir * 14, y: endY }, { x: endX, y: endY }]
        : [{ x: ax, y: ay }, { x: endX, y: endY }])
      out.push({
        cableId: it.cableId,
        deviceId: it.deviceId,
        otherDeviceId: it.otherDeviceId,
        side: it.side,
        label: 'to ' + (deviceName(it.otherDeviceId) || '?'),
        terminal: it.terminal ? it.terminal.name : null,
        path,
        tab: {
          x: dir === 1 ? endX : endX - OFFPAGE_TAB_W,
          y: endY - OFFPAGE_TAB_H / 2,
          w: OFFPAGE_TAB_W,
          h: OFFPAGE_TAB_H
        }
      })
    })
  }
  return out
}

// ---- Opening a device ----

export const DOUBLE_TAP_MS = 350
export const DOUBLE_TAP_PX = 20

// True when `cur` is the second tap of a double tap after `prev`: the same
// target, within ms and px. Taps are { id, t, x, y } (t in ms, x and y in
// screen pixels).
export function isDoubleTap (prev, cur, ms = DOUBLE_TAP_MS, px = DOUBLE_TAP_PX) {
  if (!prev || !cur || prev.id !== cur.id) return false
  const dt = cur.t - prev.t
  return dt >= 0 && dt <= ms && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= px
}

// The address of a device's detail page.
export const deviceHash = (id) => hashForState({ tab: 'devices', id })

// ---- Hit testing ------------------------------------------------------------

export const insideBox = (box, x, y) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h

// The topmost box under a point. Later boxes are drawn on top, so the last
// match wins.
export function hitDevice (boxes, x, y) {
  let found = null
  for (const b of boxes) if (insideBox(b, x, y)) found = b
  return found
}

// A terminal dot within `radius` of the point, on any box.
export function hitTerminal (boxes, x, y, radius = 8) {
  let best = null
  let bestD = radius
  for (const b of boxes) {
    for (const t of b.terminals) {
      const d = Math.hypot(t.x - x, t.y - y)
      if (d <= bestD) { best = { deviceId: b.id, terminal: t.name, x: t.x, y: t.y, side: t.side }; bestD = d }
    }
  }
  return best
}

export function distanceToSegment (px, py, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

export function distanceToPath (points, x, y) {
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(x, y, points[i - 1], points[i]))
  return best
}

// The nearest wire within `tolerance`. wires: [{ id, path }].
export function hitWire (wires, x, y, tolerance = 6) {
  let best = null
  let bestD = tolerance
  for (const w of wires) {
    const d = distanceToPath(w.path, x, y)
    if (d <= bestD) { best = w; bestD = d }
  }
  return best
}

export function hitBend (points, x, y, radius = 8) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (Math.hypot(points[i].x - x, points[i].y - y) <= radius) return i
  }
  return -1
}

// Where a click on a wire would insert a bend point: the index in the bend
// list and the point itself. `path` is the full path including both anchors,
// `bends` the current bend points (a straight, unbent path has none).
export function insertBendIndex (path, bends, x, y) {
  let bestI = 1
  let bestD = Infinity
  for (let i = 1; i < path.length; i++) {
    const d = distanceToSegment(x, y, path[i - 1], path[i])
    if (d < bestD) { bestD = d; bestI = i }
  }
  return Math.min(bends.length, Math.max(0, bestI - 1))
}

// ---- Moving a segment (plan 0025) ---------------------------------------------

export const MIN_JOG = 3 // a jog shorter than one line width is dropped

const dropRepeats = (points) => {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y })
  }
  for (let i = 1; i < out.length - 1;) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(i, 1)
    else i++
  }
  return out
}

// Drops every segment shorter than `minLen` that sits between two parallel
// segments and joins those two into one line. The two end segments keep their
// line (the leg at the port); otherwise the earlier line wins. Cascades.
// `points` is the whole path with both anchors; returns a new list.
export function mergeShortJogs (points, minLen = MIN_JOG) {
  let pts = dropRepeats(points)
  for (let guard = 0; guard < 200; guard++) {
    let changed = false
    for (let k = 1; k <= pts.length - 3; k++) {
      const a = pts[k]
      const b = pts[k + 1]
      const vert = a.x === b.x
      if (!vert && a.y !== b.y) continue
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= minLen) continue
      const p0 = pts[k - 1]
      const p3 = pts[k + 2]
      if (vert ? !(p0.y === a.y && p3.y === b.y) : !(p0.x === a.x && p3.x === b.x)) continue
      const firstFixed = k - 1 === 0
      const lastFixed = k + 1 === pts.length - 2
      if (firstFixed && lastFixed) continue
      const keepEarlier = firstFixed || !lastFixed
      const f = vert ? 'y' : 'x'
      if (keepEarlier) pts = [...pts.slice(0, k), { ...p3, [f]: a[f] }, ...pts.slice(k + 3)]
      else pts = [...pts.slice(0, k - 1), { ...p0, [f]: b[f] }, ...pts.slice(k + 2)]
      pts = dropRepeats(pts)
      changed = true
      break
    }
    if (!changed) break
  }
  return pts
}

// Moves segment `index` (between points[index] and points[index + 1]) of an
// orthogonal path by `delta`, perpendicular to itself: a horizontal segment
// moves up or down, a vertical one left or right, and its neighbours stretch.
// The first and last segments keep their leg out of the port: the port end
// stays and a jog is made after `leg` units. A segment that is not horizontal
// or vertical, or too short for its legs, is left alone. Jogs shorter than
// one line width are merged away. `points` is the whole path with both anchors.
export function moveSegment (points, index, delta, leg = STUB) {
  const pts = points.map((p) => ({ x: p.x, y: p.y }))
  const n = pts.length
  if (index < 0 || index > n - 2) return pts
  const a = pts[index]
  const b = pts[index + 1]
  const horiz = a.y === b.y
  if (horiz === (a.x === b.x)) return pts
  const d = horiz ? { x: 0, y: delta } : { x: delta, y: 0 }
  const shift = (p) => ({ x: p.x + d.x, y: p.y + d.y })
  const first = index === 0
  const last = index === n - 2
  const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
  const dir = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }
  let out
  if (!first && !last) out = [...pts.slice(0, index), shift(a), shift(b), ...pts.slice(index + 2)]
  else {
    if (len <= (first ? leg : 0) + (last ? leg : 0)) return pts
    const e1 = { x: a.x + dir.x * leg, y: a.y + dir.y * leg }
    const e2 = { x: b.x - dir.x * leg, y: b.y - dir.y * leg }
    const pre = first ? [a, e1, shift(e1)] : [shift(a)]
    const post = last ? [shift(e2), e2, b] : [shift(b)]
    out = [...pts.slice(0, index), ...pre, ...post, ...pts.slice(index + 2)]
  }
  return mergeShortJogs(out)
}

// ---- Defaults ---------------------------------------------------------------

const SUPPLY_RANK = { source: 0, storage: 1, converter: 2, distribution: 3, consumer: 4 }

// A drag can start at either end, so the cable's From (supply side) is the
// device with the lower supply rank; ties keep the drag order.
export function supplyOrder (a, b) {
  const rank = (d) => SUPPLY_RANK[d.role || 'consumer'] ?? 4
  return rank(b) < rank(a) ? [b, a] : [a, b]
}

// The conductors to suggest for a new wire. AC terminals on either end give
// the AC set; a switch, fuse, breaker or bus bar at either end gives a lone
// positive; otherwise positive and negative.
export function defaultKind (a, b) {
  const terminals = [...(a.terminals || []), ...(b.terminals || [])]
  if (terminals.length > 0 && terminals.every((t) => t.conductor === 'signal')) return 'signal'
  const hasAc = terminals.some((t) => t.conductor === 'line')
  const hasDc = terminals.some((t) => t.conductor === 'positive')
  if (hasAc && !hasDc) return 'ac'
  if ((a.role === 'distribution') || (b.role === 'distribution')) return 'positive'
  return 'both'
}

// Whether a cable that is already drawn between the two devices exists, so
// the caller can warn before drawing a second.
export function cablesBetween (cables, idA, idB) {
  return cables.filter((c) => c.status !== 'removed' &&
    ((c.fromDeviceId === idA && c.toDeviceId === idB) || (c.fromDeviceId === idB && c.toDeviceId === idA)))
}

// ---- Wire colours -----------------------------------------------------------

// The conductor types of a cable in drawing order. A cable with none listed
// is a single positive conductor.
export function conductorTypes (cable) {
  const types = (cable.conductors || []).map((c) => c.conductor)
  return types.length ? types : ['positive']
}

// The long-dash pattern that marks AC cables, shared by the schematic and the
// floorplan (the floorplan scales it to its line width).
export const AC_DASH = [10, 6]

// How a cable's current shows: `current` is 'ac', 'dc' or null, `dasharray` a
// stroke-dasharray string (AC only, DC and the rest stay solid). The
// conductor symbols sit on the ports, not on the wires (public/portMark.js).
export function wireLineStyle (cable) {
  const current = cableCurrent(cable)
  return {
    current,
    dasharray: current === 'ac' ? AC_DASH.join(' ') : null
  }
}

// The same dash pattern scaled by a factor, as a stroke-dasharray string.
export function scaledDash (dasharray, factor) {
  if (!dasharray) return null
  return dasharray.split(' ').map((n) => Math.round(Number(n) * factor * 100) / 100).join(' ')
}

// A copy of a polyline moved sideways by `dist` (positive is to the right of
// the direction of travel), corners mitred, for drawing the second conductor
// of a cable beside the first.
export function offsetPath (points, dist) {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const normals = []
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const len = Math.hypot(dx, dy)
    normals.push(len > 0 ? { x: -dy / len, y: dx / len } : null)
  }
  const fallback = normals.find(Boolean) || { x: 0, y: 0 }
  const at = (i) => normals[i] || normals[i - 1] || fallback
  return points.map((p, i) => {
    const a = i === 0 ? at(0) : at(i - 1)
    const b = i === points.length - 1 ? a : at(i)
    const dot = a.x * b.x + a.y * b.y
    const k = dist / Math.max(1 + dot, 0.2)
    return { x: p.x + (a.x + b.x) * k, y: p.y + (a.y + b.y) * k }
  })
}

// ---- Highlighting -----------------------------------------------------------

// The devices and cables a circuit resource spans, for highlighting.
export function circuitHighlight (circuit) {
  const d = circuit && circuit.derived
  if (!d) return { deviceIds: new Set(), cableIds: new Set() }
  return {
    deviceIds: new Set(d.deviceIds || []),
    cableIds: new Set([...(d.cableIds || []), ...(d.returnCableIds || [])])
  }
}

// ---- Layout -----------------------------------------------------------------

// autoLayout, resolveOverlaps and the other layout functions live in
// schematicLayout.js and are re-exported here.
export { autoLayout, resolveOverlaps, findOverlaps, freeTabSpot, arrangeStage, ARRANGE_LABEL, ARRANGE_ALL_LABEL, rankGap, GAP_MIN, GAP_MAX, OVERLAP_MARGIN } from './schematicLayout.js'
export { routePage, routeSchematicPage, stubAt, conduitBands, pathToDWithBridges, USE_NEW_ROUTER } from './wireRouter.js'

// Live routing while dragging (plan 0026). request(args) asks for a route with
// the latest arguments: at most one route runs at a time, two route starts are
// at least minIntervalMs apart, and a request that arrives meanwhile replaces
// the one waiting (latest wins) and runs as a trailing call. routeFn may
// return a promise; the next run waits for it. cancel() drops a waiting
// request (a route already running is not interrupted).
export function createRouteThrottle (routeFn, minIntervalMs = 66, now = Date.now, schedule = setTimeout, unschedule = clearTimeout) {
  let pending = null // { args } while a request waits
  let running = false
  let timer = null
  let lastStart = -Infinity
  const pump = () => {
    if (running || !pending) return
    const wait = lastStart + minIntervalMs - now()
    if (wait > 0) {
      if (timer === null) timer = schedule(() => { timer = null; pump() }, wait)
      return
    }
    const { args } = pending
    pending = null
    running = true
    lastStart = now()
    const done = () => { running = false; pump() }
    let out
    try { out = routeFn(args) } catch (err) { running = false; throw err }
    if (out && typeof out.then === 'function') out.then(done, done)
    else done()
  }
  return {
    request (args) { pending = { args }; pump() },
    cancel () { pending = null; if (timer !== null) { unschedule(timer); timer = null } },
    get busy () { return running || pending !== null }
  }
}


// A viewBox that frames every box with a margin, or a default when empty.
export function fitView (boxes, margin = 40) {
  if (boxes.length === 0) return { x: 0, y: 0, w: 800, h: 500 }
  const x0 = Math.min(...boxes.map((b) => b.x)) - margin
  const y0 = Math.min(...boxes.map((b) => b.y)) - margin
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + margin
  const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + margin
  return { x: x0, y: y0, w: Math.max(200, x1 - x0), h: Math.max(150, y1 - y0) }
}

// ---- Keyboard --------------------------------------------------------------

// True when a key press belongs to a text field and must not drive the canvas.
export function isTypingTarget (el) {
  if (!el) return false
  const tag = String(el.tagName || '').toUpperCase()
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

// What a key press does on the schematic canvas, or null for nothing.
// state: { typing, drag, popover, tabMenu, moreForm, selection: { type, id } | null }
export function keyCommand (key, state) {
  if (state.typing || state.moreForm) return null
  if (key === 'Escape') {
    if (state.drag) return { kind: 'cancel-drag' }
    if (state.popover) return { kind: 'close-popover' }
    if (state.tabMenu) return { kind: 'close-tabmenu' }
    if (state.selection) return { kind: 'clear-selection' }
    return null
  }
  if (key === 'Delete' || key === 'Backspace') {
    if (state.drag || state.popover || !state.selection) return null
    if (state.selection.type === 'wire') return { kind: 'delete-wire', id: state.selection.id }
    if (state.selection.type === 'device') return { kind: 'remove-device', id: state.selection.id }
    if (state.selection.type === 'zone') return { kind: 'delete-zone-shape', id: state.selection.id }
  }
  return null
}

// The schematic record's device list with one device put back at its old
// position (and old place in the order), without duplicating it.
export function withDevicePlaced (devices, placed, index) {
  const rest = devices.filter((d) => d.deviceId !== placed.deviceId)
  const at = Math.max(0, Math.min(index, rest.length))
  return [...rest.slice(0, at), placed, ...rest.slice(at)]
}

// The schematic record's wire list with one wire's bend points put back.
export function withWireBends (wires, wireRunId, points) {
  return [...wires.filter((w) => w.wireRunId !== wireRunId), { wireRunId, points }]
}
