// Obstacle-avoiding wire routing for the schematic canvas (plan 0021, 4 and 4c).
// Pure: no DOM. Wires are routed on a grid of channels between the device
// boxes with a bend-aware path search. They leave their port straight out,
// never enter a box or a port block, and are routed in id order so the result
// is stable. After routing, wires that share a stretch are nudged side by
// side, crossings get bridges, and off-page tabs are placed clear of boxes,
// other tabs and wires. Wires with bend points placed by the user stay as drawn.

import { anchorOf, facingSide, sideNormal, STUB, LANE_GAP, OFFPAGE_TAB_W, OFFPAGE_TAB_H, OFFPAGE_LEN, OFFPAGE_GAP, boxCenter } from './schematic.js'

export const GRID = 10
export const MARGIN = 12 // wires keep this far from a box (port blocks stick out 7)
export const BEND_COST = 24
export const CROSS_COST = 30
export const OVERLAP_COST = 0.6
export const NEAR_COST = 0.5
export const CONDUIT_FACTOR = 0.25
export const BRIDGE_R = 4
export const ANCHOR_SPACING = 14

const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]
const dirOf = (n) => DIRS.findIndex((d) => d.x === n.x && d.y === n.y)

// ---- Binary heap -----------------------------------------------------------

class Heap {
  constructor () { this.f = []; this.v = [] }
  get size () { return this.f.length }
  push (f, v) {
    const F = this.f
    const V = this.v
    let i = F.length
    F.push(f); V.push(v)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (F[p] <= f) break
      F[i] = F[p]; V[i] = V[p]; i = p
    }
    F[i] = f; V[i] = v
  }

  pop () {
    const F = this.f
    const V = this.v
    const top = V[0]
    const lf = F.pop()
    const lv = V.pop()
    const n = F.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && F[c + 1] < F[c]) c++
        if (F[c] >= lf) break
        F[i] = F[c]; V[i] = V[c]; i = c
      }
      F[i] = lf; V[i] = lv
    }
    return top
  }
}

// ---- Small geometry --------------------------------------------------------

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
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) { out.splice(i, 1); changed = true; break }
    }
  }
  return out
}

const inflate = (b, m) => ({ x0: b.x - m, y0: b.y - m, x1: b.x + b.w + m, y1: b.y + b.h + m })

// Whether an axis-aligned segment passes through the interior of a rectangle.
function segHitsRect (a, b, r) {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return x1 > r.x0 && x0 < r.x1 && y1 > r.y0 && y0 < r.y1
}

const rectsOverlap = (a, b) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1

// ---- Anchors ---------------------------------------------------------------

// Where each wire meets its two boxes. A named terminal fixes the anchor; the
// other ends are spread along the edge facing the other device (ordered by the
// other device's position so wires do not cross at the box), together with the
// off-page stubs that leave the same edge.
function computeAnchors (wires, boxById, stubs) {
  const groups = new Map()
  const result = new Map()
  const add = (box, side, item) => {
    const key = box.id + '|' + side
    if (!groups.has(key)) groups.set(key, { box, side, items: [] })
    groups.get(key).items.push(item)
  }
  for (const w of wires) {
    const ends = [['from', w.fromId, w.fromTerminal, w.toId], ['to', w.toId, w.toTerminal, w.fromId]]
    const entry = {}
    result.set(w.id, entry)
    for (const [end, id, terminal, otherId] of ends) {
      const box = boxById.get(id)
      const other = boxById.get(otherId)
      const t = terminal && box.terminals.find((x) => x.name === terminal)
      if (t) { entry[end] = { x: t.x, y: t.y, side: t.side }; continue }
      const side = facingSide(box, boxCenter(other))
      const oc = boxCenter(other)
      add(box, side, { wireId: w.id, end, key: side === 'left' || side === 'right' ? oc.y : oc.x, id: w.id })
    }
  }
  const stubAnchors = new Map()
  for (const s of stubs) {
    if (s.terminal) continue
    add(boxById.get(s.deviceId), s.side, { stubId: s.cableId, key: Infinity, id: s.cableId })
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => (a.key - b.key) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || 0)
    const n = g.items.length
    g.items.forEach((it, i) => {
      const shift = (i - (n - 1) / 2) * ANCHOR_SPACING
      const a = anchorOf(g.box, null, side2point(g.box, g.side), shift)
      if (it.stubId) stubAnchors.set(it.stubId, a)
      else result.get(it.wireId)[it.end] = a
    })
  }
  return { wires: result, stubs: stubAnchors }
}

function side2point (box, side) {
  const c = boxCenter(box)
  const n = sideNormal(side)
  return { x: c.x + n.x * 10000, y: c.y + n.y * 10000 }
}

// ---- The grid ---------------------------------------------------------------

function buildGrid (boxes, exits, bbox) {
  const extraX = []
  const extraY = []
  for (const b of boxes) {
    const r = inflate(b, MARGIN)
    extraX.push(r.x0, r.x1)
    extraY.push(r.y0, r.y1)
  }
  for (const e of exits) { extraX.push(e.x); extraY.push(e.y) }
  const lines = (extra, lo, hi) => {
    const ex = [...new Set(extra)].sort((a, b) => a - b)
    const all = [...ex]
    const near = (v) => {
      let l = 0
      let h = ex.length
      while (l < h) { const m = (l + h) >> 1; if (ex[m] < v) l = m + 1; else h = m }
      return (l < ex.length && ex[l] - v < 4) || (l > 0 && v - ex[l - 1] < 4)
    }
    for (let v = Math.floor(lo / GRID) * GRID; v <= hi; v += GRID) if (!near(v)) all.push(v)
    return all.sort((a, b) => a - b)
  }
  const xs = lines(extraX, bbox.x0, bbox.x1)
  const ys = lines(extraY, bbox.y0, bbox.y1)
  const idx = (arr, v) => {
    let l = 0
    let h = arr.length
    while (l < h) { const m = (l + h) >> 1; if (arr[m] < v) l = m + 1; else h = m }
    return l
  }
  const nx = xs.length
  const ny = ys.length
  const blocked = new Uint8Array(nx * ny)
  const near = new Uint8Array(nx * ny)
  for (const b of boxes) {
    const r = inflate(b, MARGIN)
    // strictly inside the inflated rectangle
    for (let j = idx(ys, r.y0 + 0.01); j < ny && ys[j] < r.y1 - 0.01; j++) {
      for (let i = idx(xs, r.x0 + 0.01); i < nx && xs[i] < r.x1 - 0.01; i++) blocked[j * nx + i] = 1
    }
    const q = inflate(b, MARGIN + 14)
    for (let j = idx(ys, q.y0 + 0.01); j < ny && ys[j] < q.y1 - 0.01; j++) {
      for (let i = idx(xs, q.x0 + 0.01); i < nx && xs[i] < q.x1 - 0.01; i++) near[j * nx + i] = 1
    }
  }
  return { xs, ys, nx, ny, blocked, near, ix: (v) => idx(xs, v), iy: (v) => idx(ys, v) }
}

// ---- The search ------------------------------------------------------------

function makeSearch (grid) {
  const { xs, ys, nx, ny, blocked, near } = grid
  const N = nx * ny
  const g = new Float32Array(N * 4)
  const stamp = new Int32Array(N * 4)
  const parent = new Int32Array(N * 4)
  let run = 0
  // usage per edge (node to east, node to south) and per passing node
  const useH = new Uint8Array(N)
  const useV = new Uint8Array(N)
  const passH = new Uint8Array(N)
  const passV = new Uint8Array(N)
  const edgeConduits = new Map()

  const conduitShare = (key, ids) => {
    const list = edgeConduits.get(key)
    if (!list || !ids || ids.length === 0) return false
    return ids.some((c) => list.includes(c))
  }

  function search (si, sj, sdir, gi, gj, gdirIn, conduitIds) {
    run++
    const heap = new Heap()
    const start = (sj * nx + si) * 4 + sdir
    g[start] = 0; stamp[start] = run; parent[start] = -1
    heap.push(0, start)
    const goalNode = gj * nx + gi
    let limit = 400000
    while (heap.size > 0 && limit-- > 0) {
      const s = heap.pop()
      const node = s >> 2
      const d = s & 3
      const cg = g[s]
      if (node === goalNode) {
        const out = []
        for (let c = s; c !== -1; c = parent[c]) out.push(c >> 2)
        return out.reverse().map((n) => ({ x: xs[n % nx], y: ys[(n / nx) | 0] }))
      }
      const i = node % nx
      const j = (node / nx) | 0
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue
        const ni = i + DIRS[nd].x
        const nj = j + DIRS[nd].y
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue
        const nn = nj * nx + ni
        if (blocked[nn] && nn !== goalNode) continue
        const len = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j])
        const horizontal = nd === 0 || nd === 2
        const ekey = nd === 0 ? node : nd === 2 ? nn : nd === 1 ? node : nn
        const used = horizontal ? useH[ekey] : useV[ekey]
        let cost = len
        if (used > 0) {
          cost = conduitShare((horizontal ? 0 : N) + ekey, conduitIds) ? len * CONDUIT_FACTOR : len * (1 + OVERLAP_COST * used)
        }
        if (near[nn]) cost += len * NEAR_COST
        if (horizontal ? passV[nn] : passH[nn]) cost += CROSS_COST
        if (nd !== d) cost += BEND_COST
        if (nn === goalNode && nd !== gdirIn) cost += BEND_COST
        const ns = nn * 4 + nd
        const ng = cg + cost
        if (stamp[ns] === run && g[ns] <= ng) continue
        stamp[ns] = run; g[ns] = ng; parent[ns] = s
        const h = Math.abs(xs[gi] - xs[ni]) + Math.abs(ys[gj] - ys[nj])
        heap.push(ng + h, ns)
      }
    }
    return null
  }

  // Records a routed node path so later wires see it.
  function commit (nodes, conduitIds) {
    for (let k = 1; k < nodes.length; k++) {
      const a = nodes[k - 1]
      const b = nodes[k]
      const ai = grid.ix(a.x)
      const aj = grid.iy(a.y)
      const bi = grid.ix(b.x)
      const bj = grid.iy(b.y)
      const horizontal = aj === bj
      const node = bj * nx + bi
      const anode = aj * nx + ai
      const lo = horizontal ? Math.min(anode, node) : Math.min(anode, node)
      const key = (horizontal ? 0 : N) + lo
      if (horizontal) { if (useH[lo] < 250) useH[lo]++ } else if (useV[lo] < 250) useV[lo]++
      if (conduitIds && conduitIds.length) {
        if (!edgeConduits.has(key)) edgeConduits.set(key, [])
        edgeConduits.get(key).push(...conduitIds)
      }
      if (k > 1) { // the node a is passed through, if the path continues straight
        const p = nodes[k - 2]
        const straightH = p.y === a.y && a.y === b.y
        const straightV = p.x === a.x && a.x === b.x
        if (straightH) passH[anode] = 1
        if (straightV) passV[anode] = 1
      }
    }
  }
  return { search, commit, grid }
}

// ---- Nudging parallel runs apart ------------------------------------------

function nudge (routes, boxes, order) {
  // routes: Map id -> { points, conduitKey }. Collect nudgeable segments.
  const segs = []
  for (const id of order) {
    const r = routes.get(id)
    if (!r || r.fixed) continue
    const p = r.points
    for (let k = 1; k + 1 < p.length; k++) {
      const a = p[k]
      const b = p[k + 1]
      if (a.x !== b.x && a.y !== b.y) continue
      const vertical = a.x === b.x
      // perpendicular to both neighbours
      const prev = p[k - 1]
      const next = p[k + 2]
      const perp = (u, v) => (vertical ? u.y === v.y : u.x === v.x)
      if (!perp(prev, a)) continue
      if (next && !perp(b, next)) continue
      segs.push({ id, k, vertical, c: vertical ? a.x : a.y, lo: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), hi: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x), key: r.conduitKey })
    }
  }
  const parent = segs.map((_, i) => i)
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]
      const b = segs[j]
      if (a.id === b.id || a.vertical !== b.vertical || Math.abs(a.c - b.c) > 0.5) continue
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 1) parent[find(i)] = find(j)
    }
  }
  const clusters = new Map()
  segs.forEach((s, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(s) })
  const rects = boxes.map((b) => inflate(b, 3))
  for (const list of clusters.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    list.forEach((s, i) => {
      const delta = (i - (list.length - 1) / 2) * LANE_GAP
      if (delta === 0) return
      const pts = routes.get(s.id).points
      const a = { ...pts[s.k] }
      const b = { ...pts[s.k + 1] }
      if (s.vertical) { a.x += delta; b.x += delta } else { a.y += delta; b.y += delta }
      const prev = pts[s.k - 1]
      const next = pts[s.k + 2]
      const bad = rects.some((r) => segHitsRect(a, b, r) || segHitsRect(prev, a, r) || (next && segHitsRect(b, next, r)))
      if (bad) return
      pts[s.k] = a
      pts[s.k + 1] = b
    })
  }
}

// ---- Bridges ----------------------------------------------------------------

// Hops on the horizontal segment of the wire that crosses another wire's
// vertical segment (away from the ends, so shared terminals and junctions do
// not count). Returns Map id -> [{ x, y }].
export function findBridges (paths) {
  const out = new Map()
  const ids = [...paths.keys()]
  const segsOf = (pts) => {
    const hs = []
    const vs = []
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]
      const b = pts[k]
      if (a.y === b.y && a.x !== b.x) hs.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) })
      else if (a.x === b.x && a.y !== b.y) vs.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) })
    }
    return { hs, vs }
  }
  const segs = new Map(ids.map((id) => [id, segsOf(paths.get(id))]))
  const E = BRIDGE_R + 3
  for (const id of ids) {
    for (const other of ids) {
      if (other === id) continue
      for (const h of segs.get(id).hs) {
        for (const v of segs.get(other).vs) {
          if (v.x - h.x0 < E || h.x1 - v.x < E) continue
          if (h.y - v.y0 < E || v.y1 - h.y < E) continue
          if (!out.has(id)) out.set(id, [])
          out.get(id).push({ x: v.x, y: h.y })
        }
      }
    }
  }
  // Hops on one segment must not touch: drop any closer than two radii.
  for (const [id, list] of out) {
    list.sort((a, b) => a.y - b.y || a.x - b.x)
    const kept = []
    for (const p of list) {
      const last = kept[kept.length - 1]
      if (!last || last.y !== p.y || p.x - last.x >= BRIDGE_R * 2 + 2) kept.push(p)
    }
    out.set(id, kept)
  }
  return out
}

// An SVG path with a semicircular hop at each bridge (horizontal segments only).
export function pathToDWithBridges (points, bridges = []) {
  if (!points.length) return ''
  let d = `M${points[0].x} ${points[0].y}`
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]
    const b = points[k]
    if (a.y === b.y && bridges.length) {
      const dir = Math.sign(b.x - a.x)
      const hops = bridges.filter((h) => h.y === a.y && h.x > Math.min(a.x, b.x) && h.x < Math.max(a.x, b.x)).sort((p, q) => dir * (p.x - q.x))
      for (const h of hops) d += ` L${h.x - dir * BRIDGE_R} ${a.y} A${BRIDGE_R} ${BRIDGE_R} 0 0 ${dir > 0 ? 0 : 1} ${h.x + dir * BRIDGE_R} ${a.y}`
    }
    d += ` L${b.x} ${b.y}`
  }
  return d
}

// ---- Off-page tabs ----------------------------------------------------------

function stubGeometry (anchor, side, length, lateral) {
  const n = sideNormal(side)
  const end = { x: anchor.x + n.x * length, y: anchor.y + n.y * length }
  const path = lateral === 0
    ? [{ x: anchor.x, y: anchor.y }, end]
    : n.x !== 0
      ? [{ x: anchor.x, y: anchor.y }, { x: anchor.x + n.x * 14, y: anchor.y }, { x: anchor.x + n.x * 14, y: end.y + lateral }, { x: end.x, y: end.y + lateral }]
      : [{ x: anchor.x, y: anchor.y }, { x: anchor.x, y: anchor.y + n.y * 14 }, { x: anchor.x + lateral, y: anchor.y + n.y * 14 }, { x: anchor.x + lateral, y: end.y }]
  const e = path[path.length - 1]
  const tab = n.x !== 0
    ? { x: n.x === 1 ? e.x : e.x - OFFPAGE_TAB_W, y: e.y - OFFPAGE_TAB_H / 2, w: OFFPAGE_TAB_W, h: OFFPAGE_TAB_H }
    : { x: e.x - OFFPAGE_TAB_W / 2, y: n.y === 1 ? e.y : e.y - OFFPAGE_TAB_H, w: OFFPAGE_TAB_W, h: OFFPAGE_TAB_H }
  return { path: simplify(path), tab }
}

const tabRect = (t, m = 0) => ({ x0: t.x - m, y0: t.y - m, x1: t.x + t.w + m, y1: t.y + t.h + m })

function placeStubs (stubs, anchors, boxes, wirePaths) {
  const boxRects = boxes.map((b) => inflate(b, 6))
  const placed = []
  const wireSegs = []
  for (const p of wirePaths.values()) for (let k = 1; k < p.length; k++) wireSegs.push([p[k - 1], p[k]])
  const out = new Map()
  const lengths = [0, 1, 2, 3, 4, 5].map((i) => OFFPAGE_LEN + i * OFFPAGE_GAP * 2)
  const laterals = [0, OFFPAGE_GAP, -OFFPAGE_GAP, OFFPAGE_GAP * 2, -OFFPAGE_GAP * 2]
  for (const s of stubs) {
    const anchor = anchors.get(s.cableId) || s.path[0]
    const own = boxes.find((b) => b.id === s.deviceId)
    let best = null
    for (const len of lengths) {
      for (const lat of laterals) {
        const geo = stubGeometry(anchor, s.side, len, lat)
        const tr = tabRect(geo.tab, 4)
        let score = 0
        for (let i = 0; i < boxRects.length; i++) {
          const r = boxRects[i]
          if (boxes[i] === own) {
            // the tab itself must be clear of its own device too
            if (rectsOverlap(tr, inflate(own, 2))) score += 1000
            continue
          }
          if (rectsOverlap(tr, r)) score += 1000
          for (let k = 1; k < geo.path.length; k++) if (segHitsRect(geo.path[k - 1], geo.path[k], r)) score += 1000
        }
        for (const o of placed) {
          if (rectsOverlap(tr, tabRect(o.tab, 4))) score += 1000
          for (let k = 1; k < geo.path.length; k++) if (segHitsRect(geo.path[k - 1], geo.path[k], tabRect(o.tab, 2))) score += 1000
        }
        for (const [a, b] of wireSegs) if (segHitsRect(a, b, { x0: tr.x0 - 1, y0: tr.y0 - 1, x1: tr.x1 + 1, y1: tr.y1 + 1 })) score += 100
        score += len / 20 + Math.abs(lat) / 10
        if (!best || score < best.score) best = { ...geo, score }
        if (best.score < 10) break
      }
      if (best && best.score < 10) break
    }
    placed.push({ tab: best.tab })
    out.set(s.cableId, { path: best.path, tab: best.tab })
  }
  return out
}

// ---- The entry point --------------------------------------------------------

// boxes: deviceBox results. wires: [{ id, fromId, toId, fromTerminal, toTerminal,
// points (user bend points), conduitIds }]. stubs: offPageStubs results.
// Returns { wires: Map id -> { points, bridges, fixed }, stubs: Map cableId ->
// { path, tab } }.
export function routePage ({ boxes, wires, stubs = [] }) {
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  const order = [...wires].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const anchors = computeAnchors(order, boxById, stubs)
  const routes = new Map()
  const todo = []
  const exits = []
  for (const w of order) {
    const a = anchors.wires.get(w.id)
    if (w.points && w.points.length > 0) {
      const p = [a.from, ...w.points, a.to].map((q) => ({ x: q.x, y: q.y }))
      routes.set(w.id, { points: p, fixed: true })
      continue
    }
    const ea = { x: a.from.x + sideNormal(a.from.side).x * STUB, y: a.from.y + sideNormal(a.from.side).y * STUB }
    const eb = { x: a.to.x + sideNormal(a.to.side).x * STUB, y: a.to.y + sideNormal(a.to.side).y * STUB }
    exits.push(ea, eb)
    todo.push({ w, a, ea, eb })
  }
  if (boxes.length > 0) {
    const bbox = {
      x0: Math.min(...boxes.map((b) => b.x)) - 120,
      y0: Math.min(...boxes.map((b) => b.y)) - 120,
      x1: Math.max(...boxes.map((b) => b.x + b.w)) + 120,
      y1: Math.max(...boxes.map((b) => b.y + b.h)) + 120
    }
    for (const q of exits) { bbox.x0 = Math.min(bbox.x0, q.x - 20); bbox.y0 = Math.min(bbox.y0, q.y - 20); bbox.x1 = Math.max(bbox.x1, q.x + 20); bbox.y1 = Math.max(bbox.y1, q.y + 20) }
    const grid = buildGrid(boxes, exits, bbox)
    const s = makeSearch(grid)
    for (const { w, a, ea, eb } of todo) {
      const conduitKey = (w.conduitIds || []).join(',')
      const gi = grid.ix(eb.x)
      const gj = grid.iy(eb.y)
      const si = grid.ix(ea.x)
      const sj = grid.iy(ea.y)
      const nodes = w.fromId === w.toId
        ? null
        : s.search(si, sj, dirOf(sideNormal(a.from.side)), gi, gj, dirOf({ x: -sideNormal(a.to.side).x, y: -sideNormal(a.to.side).y }), w.conduitIds)
      if (!nodes) {
        // No channel found: the old elbow route keeps the wire visible.
        routes.set(w.id, { points: [a.from, ea, eb, a.to].map((q) => ({ x: q.x, y: q.y })), conduitKey, fallback: true })
        continue
      }
      s.commit(nodes, w.conduitIds)
      routes.set(w.id, { points: simplify([a.from, ...nodes, a.to]), conduitKey })
    }
  }
  nudge(routes, boxes, order.map((w) => w.id))
  const paths = new Map()
  for (const [id, r] of routes) {
    r.points = r.fixed ? r.points : simplify(r.points)
    paths.set(id, r.points)
  }
  const bridges = findBridges(paths)
  const outWires = new Map()
  for (const [id, r] of routes) outWires.set(id, { points: r.points, bridges: bridges.get(id) || [], fixed: !!r.fixed, fallback: !!r.fallback })
  const outStubs = placeStubs([...stubs].sort((a, b) => (a.cableId < b.cableId ? -1 : 1)), anchors.stubs, boxes, paths)
  return { wires: outWires, stubs: outStubs }
}

// ---- Conduit bands (plan 0021, 4c) ---------------------------------------

// Where a conduit is drawn. wires: [{ id, conduitIds }] with their routed
// paths in `paths` (Map id -> points); conduits: Map id -> { kind, name,
// innerDiameter, diameterUnit }. For each conduit, the stretches (polylines)
// where two or more of its wires run side by side, or the whole wire when the
// conduit has only one wire on the page (or its wires never run together).
// Returns [{ conduitId, label, stretches: [points], layer }], layer being the
// stacking index of this conduit on its wires.
export function conduitBands ({ wires, paths, conduits }) {
  const byConduit = new Map()
  for (const w of wires) for (const c of w.conduitIds || []) { if (!byConduit.has(c)) byConduit.set(c, []); byConduit.get(c).push(w.id) }
  const layerOf = (wireId, conduitId) => (wires.find((w) => w.id === wireId).conduitIds || []).indexOf(conduitId)
  const out = []
  for (const [cid, ids] of [...byConduit].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const info = conduits.get(cid)
    if (!info) continue
    const usable = ids.filter((id) => paths.get(id) && paths.get(id).length > 1)
    if (usable.length === 0) continue
    let stretches = []
    if (usable.length > 1) {
      for (const id of usable) {
        const p = paths.get(id)
        let run = null
        for (let k = 1; k < p.length; k++) {
          const shared = usable.some((o) => o !== id && runsBeside(p[k - 1], p[k], paths.get(o)))
          if (shared) { if (!run) run = [p[k - 1]]; run.push(p[k]) } else if (run) { stretches.push({ points: run, wireId: id }); run = null }
        }
        if (run) stretches.push({ points: run, wireId: id })
      }
    }
    if (stretches.length === 0) stretches = usable.map((id) => ({ points: paths.get(id), wireId: id }))
    out.push({
      conduitId: cid,
      label: conduitLabel(info),
      stretches: stretches.map((s) => s.points),
      layer: Math.max(0, ...usable.map((id) => layerOf(id, cid))),
      labelAt: stretches[0].points[0]
    })
  }
  return out
}

function runsBeside (a, b, other) {
  const vertical = a.x === b.x
  if (!vertical && a.y !== b.y) return false
  for (let k = 1; k < other.length; k++) {
    const c = other[k - 1]
    const d = other[k]
    if (vertical ? !(c.x === d.x) : !(c.y === d.y)) continue
    const gap = vertical ? Math.abs(c.x - a.x) : Math.abs(c.y - a.y)
    if (gap > LANE_GAP * 2.5) continue
    const lo = vertical ? Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) : Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
    const hi = vertical ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) : Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
    if (hi - lo > 1) return true
  }
  return false
}

// "Hose 16 mm, MPPT DC hose": kind, size when known, name.
export function conduitLabel (c) {
  const size = c.innerDiameter != null ? ` ${c.innerDiameter}${c.diameterUnit ? ' ' + c.diameterUnit : ''}` : ''
  const head = `${c.kind || 'Conduit'}${size}`
  return c.name ? `${head}, ${c.name}` : head
}

// ---- Swapping routers -------------------------------------------------------

// The single switch between the obstacle-avoiding router and the old elbow
// router (plan 0021: the user decides after trying it). Set to false to go
// back to the old routes; stubs and bridges then use the old placement and
// no bridges are drawn.
export const USE_NEW_ROUTER = true

// The one call the schematic view makes. `legacy` is the old per-wire
// function (wirePath), passed in to keep this module free of a cycle at load.
export function routeSchematicPage ({ boxes, wires, stubs, legacy, useNew = USE_NEW_ROUTER }) {
  if (useNew) return routePage({ boxes, wires, stubs })
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  const out = { wires: new Map(), stubs: new Map() }
  for (const w of wires) {
    out.wires.set(w.id, {
      points: legacy({ fromBox: boxById.get(w.fromId), toBox: boxById.get(w.toId), fromTerminal: w.fromTerminal, toTerminal: w.toTerminal, lane: w.lane || 0, points: w.points || [] }),
      bridges: [], fixed: false
    })
  }
  for (const s of stubs) out.stubs.set(s.cableId, { path: s.path, tab: s.tab })
  return out
}
