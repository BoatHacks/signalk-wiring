// Obstacle-avoiding wire routing for the schematic canvas (plan 0021, 4 and 4c;
// plan 0022). Pure: no DOM. Wires are routed on a grid of channels between the
// device boxes and the off-page tabs with a bend-aware path search. They leave
// their port straight out, never enter a box or a port block, and every routed
// line is recorded so that later lines keep a full pitch from it, never share
// a stretch with it and cross it only straight over its middle, where a bridge
// is drawn. The line from a device to a tab is routed like a wire. Wires with
// bend points placed by the user stay as drawn.

import { facingSide, sideNormal, STUB, LANE_GAP, OFFPAGE_TAB_W, OFFPAGE_TAB_H, OFFPAGE_LEN, OFFPAGE_GAP, boxCenter } from './schematic.js'

export const GRID = 10
export const MARGIN = 12 // wires keep this far from a box (port blocks stick out 7)
export const BEND_COST = 24
export const CROSS_COST = 30
export const NEAR_COST = 0.5
export const CONDUIT_FACTOR = 0.25
export const HEURISTIC_WEIGHT = 1.6 // greedy A*: a little off the shortest, much faster
export const BRIDGE_R = 4
export const ROUND_BUDGET_MS = 220 // no new rip-up round after this long
// Centre to centre distance between parallel lines: two line widths of clear
// space (the line is 3 wide) plus the second conductor of a pair, drawn 4 beside.
export const PITCH = 16
export const ANCHOR_SPACING = PITCH

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
// off-page stubs that leave the same edge. Spread anchors keep a full pitch
// from each other and from the terminals of that edge, so the legs leaving
// them never run closer than the minimum clear space.
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
    if (s.terminal) {
      const t = boxById.get(s.deviceId).terminals.find((x) => x.name === s.terminal)
      if (t) { stubAnchors.set(s.cableId, { x: t.x, y: t.y, side: t.side }); continue }
    }
    add(boxById.get(s.deviceId), s.side, { stubId: s.cableId, key: Infinity, id: s.cableId })
  }
  const all = boxById
  const spread = []
  for (const g of groups.values()) {
    g.items.sort((a, b) => (a.key - b.key) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || 0)
    const n = g.items.length
    const horiz = g.side === 'left' || g.side === 'right'
    const c = boxCenter(g.box)
    const lo = (horiz ? g.box.y : g.box.x) + 6
    const hi = (horiz ? g.box.y + g.box.h : g.box.x + g.box.w) - 6
    const taken = g.box.terminals.filter((t) => t.side === g.side).map((t) => (horiz ? t.y : t.x))
    // anchors on an edge that faces this one across a gap too narrow for both legs
    const edge = horiz ? (g.side === 'left' ? g.box.x : g.box.x + g.box.w) : (g.side === 'top' ? g.box.y : g.box.y + g.box.h)
    const facing = (o) => (g.side === 'left' ? o.x <= edge : g.side === 'right' ? o.x >= edge : g.side === 'top' ? o.y <= edge : o.y >= edge)
    const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[g.side]
    for (const other of all.values()) {
      if (other.id === g.box.id) continue
      for (const t of other.terminals) {
        if (t.side === opposite && facing(t) && Math.abs((horiz ? t.x : t.y) - edge) < 2 * STUB + 2) taken.push(horiz ? t.y : t.x)
      }
      for (const [bid, a] of spread) if (bid === other.id && a.side === opposite && facing(a) && Math.abs((horiz ? a.x : a.y) - edge) < 2 * STUB + 2) taken.push(horiz ? a.y : a.x)
    }
    g.items.forEach((it, i) => {
      const ideal = (horiz ? c.y : c.x) + (i - (n - 1) / 2) * ANCHOR_SPACING
      let pos = Math.max(lo, Math.min(hi, ideal))
      for (let m = 0; m <= 120; m++) {
        let ok = false
        for (const cand of m === 0 ? [ideal] : [ideal + m * 2, ideal - m * 2]) {
          if (cand < lo || cand > hi) continue
          if (taken.every((p) => Math.abs(p - cand) >= PITCH - 0.01)) { pos = cand; ok = true; break }
        }
        if (ok) break
      }
      taken.push(pos)
      const a = horiz
        ? { x: g.side === 'left' ? g.box.x : g.box.x + g.box.w, y: pos, side: g.side }
        : { x: pos, y: g.side === 'top' ? g.box.y : g.box.y + g.box.h, side: g.side }
      spread.push([g.box.id, a])
      if (it.stubId) stubAnchors.set(it.stubId, a)
      else result.get(it.wireId)[it.end] = a
    })
  }
  return { wires: result, stubs: stubAnchors }
}

// ---- The grid ---------------------------------------------------------------

function buildGrid (obstacles, exits, bbox) {
  const extraX = []
  const extraY = []
  for (const b of obstacles) {
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
  for (const b of obstacles) {
    const r = inflate(b, MARGIN)
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

// Routed lines are recorded as occupancy on the grid, and later wires may not
// break these rules (level 0): no shared edge, no edge of a parallel line
// closer than the pitch, no touching at a bend or an end, and a crossing only
// straight over the middle of another line (far enough from the ends for a
// bridge). Levels 1 and 2 relax the rules when a wire finds no way otherwise.
function makeSearch (grid) {
  const { xs, ys, nx, ny, blocked, near } = grid
  const N = nx * ny
  const g = new Float32Array(N * 4)
  const stamp = new Int32Array(N * 4)
  const parent = new Int32Array(N * 4)
  const runLen = new Float32Array(N * 4) // straight distance since the last bend
  const pend = new Float32Array(N * 4) // distance since the last crossing
  let run = 0
  // hard0: edge on a used line; hard1: edge on a line closer than the pitch.
  // Index: node to the east (H) or to the south (V).
  const same = [new Uint8Array(N), new Uint8Array(N)] // [H, V]
  const close = [new Uint8Array(N), new Uint8Array(N)]
  const occ = new Uint8Array(N) // node on an end, a bend or close to one
  const pass = new Uint8Array(N) // 1: a horizontal line passes straight, 2: a vertical one
  const edgeConduits = new Map()

  const conduitShare = (key, ids) => {
    const list = edgeConduits.get(key)
    if (!list || !ids || ids.length === 0) return false
    return ids.some((c) => list.includes(c))
  }

  function search (si, sj, sdir, gi, gj, gdirIn, conduitIds, level) {
    run++
    const heap = new Heap()
    const start = (sj * nx + si) * 4 + sdir
    g[start] = 0; stamp[start] = run; parent[start] = -1; runLen[start] = STUB; pend[start] = 1e9
    heap.push(0, start)
    const goalNode = gj * nx + gi
    const startNode = sj * nx + si
    const maxStates = level < 2 ? 40000 : 150000
    let limit = maxStates
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
      const rl = runLen[s]
      const pd = pend[s]
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue
        // after a crossing, straight on until there is room for the bridge
        if (level === 0 && pd < BRIDGE_R + 3 && nd !== d) continue
        const ni = i + DIRS[nd].x
        const nj = j + DIRS[nd].y
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue
        const nn = nj * nx + ni
        if (blocked[nn] && nn !== goalNode) continue
        const len = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j])
        const horizontal = nd === 0 || nd === 2
        const ekey = nd === 0 || nd === 1 ? node : nn
        const o = horizontal ? 0 : 1
        const newRun = nd === d ? rl + len : len
        let crossing = false
        let cost = len
        const isEnd = nn === goalNode
        if (level < 2) {
          if (same[o][ekey]) continue
          if (level === 0 && close[o][ekey]) continue
          if (!isEnd) {
            if (occ[nn]) continue
            const p = pass[nn]
            if (p === 3) continue
            if (p && level === 0) {
              // a crossing: over the middle of the other line, with room for a bridge
              if (horizontal ? p & 1 : p & 2) continue
              if (newRun < BRIDGE_R + 3) continue
              crossing = true
            }
          }
        } else {
          if (same[o][ekey]) cost = len * 3
          else if (close[o][ekey]) cost = len * 1.5
          if (occ[nn] && !isEnd) cost += 40
        }
        const used = edgeConduits.size ? conduitShare((horizontal ? 0 : N) + ekey, conduitIds) : false
        if (used) cost = len * CONDUIT_FACTOR
        if (near[nn]) cost += len * NEAR_COST
        if (pass[nn] && (horizontal ? pass[nn] & 2 : pass[nn] & 1)) cost += CROSS_COST
        if (nd !== d) cost += BEND_COST
        if (isEnd && nd !== gdirIn) cost += BEND_COST
        const ns = nn * 4 + nd
        const ng = cg + cost
        if (stamp[ns] === run && g[ns] <= ng) continue
        stamp[ns] = run; g[ns] = ng; parent[ns] = s; runLen[ns] = newRun; pend[ns] = crossing ? 0 : pd + len
        const h = Math.abs(xs[gi] - xs[ni]) + Math.abs(ys[gj] - ys[nj])
        heap.push(ng + h * HEURISTIC_WEIGHT, ns)
      }
    }
    if (globalThis.DBG) console.log('search failed', xs[si], ys[sj], '->', xs[gi], ys[gj], 'expanded', maxStates - limit, 'level', level, 'goal occ', occ[goalNode], 'pass', pass[goalNode], 'blocked', blocked[goalNode])
    return null
  }

  const lower = (arr, v) => { // first index with arr[i] >= v - 0.01
    let l = 0
    let h = arr.length
    while (l < h) { const m = (l + h) >> 1; if (arr[m] < v - 0.01) l = m + 1; else h = m }
    return l
  }

  // Records an orthogonal polyline (anchor to anchor) so later wires see it.
  function commit (points, conduitIds) {
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1]
      const b = points[k]
      if (a.x !== b.x && a.y !== b.y) continue
      if (a.x === b.x && a.y === b.y) continue
      const horizontal = a.y === b.y
      const A = horizontal ? xs : ys // along
      const B = horizontal ? ys : xs // across
      const c0 = horizontal ? a.y : a.x
      const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
      const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
      const o = horizontal ? 0 : 1
      const nodeAt = (ia, ib) => (horizontal ? ib * nx + ia : ia * nx + ib)
      // nodes along the segment
      const ca = lower(B, c0)
      if (ca < B.length && Math.abs(B[ca] - c0) < 0.01) {
        for (let ia = lower(A, lo); ia < A.length && A[ia] <= hi + 0.01; ia++) {
          const n = nodeAt(ia, ca)
          if (A[ia] - lo < BRIDGE_R + 3 || hi - A[ia] < BRIDGE_R + 3) occ[n] = 1
          else if (pass[n] & (horizontal ? 1 : 2)) occ[n] = 1
          else pass[n] |= horizontal ? 1 : 2
        }
      }
      // edges on this line and on lines closer than the pitch
      const markList = []
      for (let ib = Math.max(0, lower(B, c0 - PITCH) - 1); ib < B.length && B[ib] < c0 + PITCH; ib++) {
        const dist = Math.abs(B[ib] - c0)
        if (dist >= PITCH) continue
        const sameLine = dist < 0.01
        for (let ia = Math.max(0, lower(A, lo) - 1); ia < A.length - 1 && A[ia] < hi; ia++) {
          if (A[ia + 1] <= lo) continue
          const n = nodeAt(ia, ib)
          if (sameLine) same[o][n] = 1
          else close[o][n] = 1
        }
      }
      if (conduitIds && conduitIds.length) {
        for (let ib = Math.max(0, lower(B, c0 - 2 * PITCH) - 1); ib < B.length && B[ib] < c0 + 2 * PITCH; ib++) {
          const dist = Math.abs(B[ib] - c0)
          if (dist < PITCH - 0.01 && dist > 0.01) continue
          for (let ia = Math.max(0, lower(A, lo) - 1); ia < A.length - 1 && A[ia] < hi; ia++) {
            if (A[ia + 1] <= lo) continue
            const key = (horizontal ? 0 : N) + nodeAt(ia, ib)
            if (!edgeConduits.has(key)) edgeConduits.set(key, [])
            edgeConduits.get(key).push(...conduitIds)
          }
        }
      }
      markList.length = 0
    }
  }
  return { search, commit, grid }
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

const tabRect = (t, m = 0) => ({ x0: t.x - m, y0: t.y - m, x1: t.x + t.w + m, y1: t.y + t.h + m })

function tabAt (x, y) { return { x, y, w: OFFPAGE_TAB_W, h: OFFPAGE_TAB_H } }

// Where the line meets a tab and which way the tab faces, for a tab placed
// at `tab` and a device anchor `anchor`.
function attachOf (tab, anchor) {
  const side = anchor.x >= tab.x + tab.w ? 'right' : anchor.x <= tab.x ? 'left' : anchor.y >= tab.y + tab.h / 2 ? 'bottom' : 'top'
  const p = side === 'left' ? { x: tab.x, y: tab.y + tab.h / 2 }
    : side === 'right' ? { x: tab.x + tab.w, y: tab.y + tab.h / 2 }
      : side === 'top' ? { x: tab.x + tab.w / 2, y: tab.y }
        : { x: tab.x + tab.w / 2, y: tab.y + tab.h }
  return { ...p, side }
}

// Chooses a tab position for every stub. A stub with a saved position keeps
// it. The others go straight out of their device when there is room, else
// further out or sideways, clear of every device, every other tab and every
// leg that leaves a port.
function placeTabs (stubs, anchors, boxes, segs, wires, wireAnchors) {
  const out = new Map()
  const placed = []
  for (const s of stubs.filter((x) => x.pos)) {
    const t = tabAt(s.pos.x, s.pos.y)
    placed.push(t)
    out.set(s.cableId, { tab: t, user: true })
  }
  const boxRects = boxes.map((b) => inflate(b, 8))
  const lengths = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => OFFPAGE_LEN + i * 30)
  const laterals = [0]
  for (let i = 1; i <= 8; i++) laterals.push(i * OFFPAGE_GAP, -i * OFFPAGE_GAP)
  for (const s of [...stubs].filter((x) => !x.pos).sort((a, b) => (a.cableId < b.cableId ? -1 : 1))) {
    const a = anchors.get(s.cableId)
    const n = sideNormal(a.side)
    // room for the lines that fan out of the same side, before the tab
    let crowd = 0
    for (const e of wireAnchors.values()) for (const q of [e.from, e.to]) if (q.side === a.side && (n.x !== 0 ? Math.abs(q.x - a.x) < 1 : Math.abs(q.y - a.y) < 1)) crowd++
    for (const o of anchors.values()) if (o !== a && o.side === a.side && (n.x !== 0 ? Math.abs(o.x - a.x) < 1 : Math.abs(o.y - a.y) < 1)) crowd++
    const base = crowd > 1 ? STUB + PITCH * crowd + 28 : OFFPAGE_LEN
    let best = null
    for (const len of lengths.map((l) => l - OFFPAGE_LEN + base)) {
      for (const lat of laterals) {
        const t = n.x !== 0
          ? tabAt(n.x === 1 ? a.x + len : a.x - len - OFFPAGE_TAB_W, a.y + lat - OFFPAGE_TAB_H / 2)
          : tabAt(a.x + lat - OFFPAGE_TAB_W / 2, n.y === 1 ? a.y + len : a.y - len - OFFPAGE_TAB_H)
        const r = tabRect(t, 8)
        let clash = 0
        for (const b of boxRects) if (rectsOverlap(r, b)) clash++
        for (const o of placed) if (rectsOverlap(r, tabRect(o, 24))) clash++
        for (const [p, q] of segs) if (segHitsRect(p, q, r)) clash++
        const score = clash * 1000 + len + Math.abs(lat) * 1.5
        if (!best || score < best.score) best = { t, score }
        if (clash === 0) break
      }
      if (best && best.score < 1000) break
    }
    placed.push(best.t)
    out.set(s.cableId, { tab: best.t, user: false })
  }
  return out
}

// ---- The entry point --------------------------------------------------------

// boxes: deviceBox results. wires: [{ id, fromId, toId, fromTerminal, toTerminal,
// points (user bend points), conduitIds }]. stubs: offPageStubs results, each
// optionally with `pos` { x, y } (a tab the user placed).
// Returns { wires: Map id -> { points, bridges, fixed, fallback, level },
// stubs: Map cableId -> { path, tab, bridges, user, fallback, level } }.
export function routePage ({ boxes, wires, stubs = [] }) {
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  const order = [...wires].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const anchors = computeAnchors(order, boxById, stubs)
  const exitOf = (a) => ({ x: a.x + sideNormal(a.side).x * STUB, y: a.y + sideNormal(a.side).y * STUB })
  const prepare = (it) => { it.ea = exitOf(it.from); it.eb = exitOf(it.to); it.len = Math.abs(it.ea.x - it.eb.x) + Math.abs(it.ea.y - it.eb.y); return it }

  // 1. the tabs, clear of the devices and of every leg that leaves a port,
  // then every line to route: the line to each tab first (they have the least
  // room), then the wires, shortest first
  const legs = []
  for (const e of anchors.wires.values()) legs.push([e.from, exitOf(e.from)], [e.to, exitOf(e.to)])
  for (const a of anchors.stubs.values()) legs.push([a, exitOf(a)])
  const tabs = placeTabs(stubs, anchors.stubs, boxes, legs, order, anchors.wires)
  const items = []
  const routes = new Map()
  for (const s of [...stubs].sort((a, b) => (a.cableId < b.cableId ? -1 : 1))) {
    const t = tabs.get(s.cableId)
    const from = anchors.stubs.get(s.cableId)
    items.push(prepare({ id: 's:' + s.cableId, from, to: attachOf(t.tab, from), conduitIds: [], stub: true }))
  }
  for (const w of order) {
    const a = anchors.wires.get(w.id)
    if (w.points && w.points.length > 0) {
      routes.set(w.id, { points: [a.from, ...w.points, a.to].map((q) => ({ x: q.x, y: q.y })), fixed: true })
      continue
    }
    items.push(prepare({ id: w.id, from: a.from, to: a.to, conduitIds: w.conduitIds || [], self: w.fromId === w.toId }))
  }
  items.sort((a, b) => (b.stub ? 1 : 0) - (a.stub ? 1 : 0) || (a.len - b.len) || (a.id < b.id ? -1 : 1))
  if (boxes.length > 0) {
    const obstacles = [...boxes, ...[...tabs.values()].map((t) => t.tab)]
    const exits = items.flatMap((it) => [it.ea, it.eb])
    const grid = buildGrid(obstacles, exits, pageBox(obstacles, exits))
    const fixed = [...routes.values()].filter((r) => r.fixed).map((r) => ({ points: r.points }))
    for (const [id, r] of routeAll(grid, items, fixed, [], 4)) routes.set(id, r)
  }
  for (const r of routes.values()) r.points = r.fixed ? r.points : simplify(r.points)
  const paths = new Map()
  for (const [id, r] of routes) paths.set(id, r.points)
  const bridges = findBridges(paths)
  const outWires = new Map()
  const outStubs = new Map()
  for (const [id, r] of routes) {
    if (id.startsWith('s:')) {
      const cid = id.slice(2)
      const t = tabs.get(cid)
      outStubs.set(cid, { path: r.points, tab: t.tab, bridges: bridges.get(id) || [], user: t.user, fallback: !!r.fallback, level: r.level || 0 })
    } else outWires.set(id, { points: r.points, bridges: bridges.get(id) || [], fixed: !!r.fixed, fallback: !!r.fallback, level: r.level || 0 })
  }
  return { wires: outWires, stubs: outStubs }
}

function pageBox (obstacles, exits) {
  const bbox = {
    x0: Math.min(...obstacles.map((b) => b.x)) - 120,
    y0: Math.min(...obstacles.map((b) => b.y)) - 120,
    x1: Math.max(...obstacles.map((b) => b.x + b.w)) + 120,
    y1: Math.max(...obstacles.map((b) => b.y + b.h)) + 120
  }
  for (const q of exits) { bbox.x0 = Math.min(bbox.x0, q.x - 20); bbox.y0 = Math.min(bbox.y0, q.y - 20); bbox.x1 = Math.max(bbox.x1, q.x + 20); bbox.y1 = Math.max(bbox.y1, q.y + 20) }
  return bbox
}

// Routes every item on the grid, shortest first. A wire that finds no way
// under the strict rules goes to the front of the next round; after a few
// rounds the rest are routed with the rules relaxed, one level at a time.
function routeAll (grid, items, committed, legs, rounds = 4) {
  const pre = new Map(items.map((it) => [it.id, {
    si: grid.ix(it.ea.x), sj: grid.iy(it.ea.y), sdir: dirOf(sideNormal(it.from.side)),
    gi: grid.ix(it.eb.x), gj: grid.iy(it.eb.y), gdir: dirOf({ x: -sideNormal(it.to.side).x, y: -sideNormal(it.to.side).y })
  }]))
  let queue = items
  let result = null
  const t0 = performance.now()
  for (let round = 0; round < rounds; round++) {
    const s = makeSearch(grid)
    for (const f of committed) s.commit(f.points, f.conduitIds)
    for (const l of legs) s.commit(l.points)
    for (const it of items) { s.commit([it.from, it.ea]); s.commit([it.to, it.eb]) }
    const res = new Map()
    const failed = []
    for (const it of queue) {
      const p = pre.get(it.id)
      const nodes = it.self ? null : s.search(p.si, p.sj, p.sdir, p.gi, p.gj, p.gdir, it.conduitIds, 0)
      if (!nodes) { failed.push(it); continue }
      const pts = simplify([it.from, ...nodes, it.to])
      s.commit(pts, it.conduitIds)
      res.set(it.id, { points: pts, level: 0 })
    }
    result = { s, res, failed }
    if (failed.length === 0 || failed.length > 4 || performance.now() - t0 > ROUND_BUDGET_MS) break
    queue = [...failed, ...queue.filter((it) => !failed.includes(it))]
  }
  const { s, res, failed } = result
  for (const it of failed) {
    const p = pre.get(it.id)
    let nodes = null
    let level = 1
    for (; level <= 2 && !nodes; level++) nodes = it.self ? null : s.search(p.si, p.sj, p.sdir, p.gi, p.gj, p.gdir, it.conduitIds, level)
    if (!nodes) {
      res.set(it.id, { points: [it.from, it.ea, it.eb, it.to].map((q) => ({ x: q.x, y: q.y })), fallback: true, level: 3 })
      continue
    }
    const pts = simplify([it.from, ...nodes, it.to])
    s.commit(pts, it.conduitIds)
    res.set(it.id, { points: pts, level: level - 1 })
  }
  return res
}

// A cheap tab and line for a stub the user is dragging: the tab at `pos`, a
// straight line from the device to the side of the tab that faces it. The full
// routing follows the drop.
export function stubAt (stub, pos) {
  const tab = tabAt(pos.x, pos.y)
  const a = stub.path[0]
  const to = attachOf(tab, a)
  return { tab, path: [{ x: a.x, y: a.y }, { x: to.x, y: to.y }], bridges: [] }
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
