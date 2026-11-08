// Geometry checks for a routed page (plan 0022): no shared stretches, no plain
// crossings, a minimum clear space between parallel lines, a minimum outward
// leg at every port, and no line through a device or a tab. Returns a list of
// problems (empty when the page is clean).
import { sideNormal, PORT_GAP } from '../../public/schematic.js'
import { STUB_PITCH, PORT_CLEAR } from '../../public/wireRouter.js'

export const LINE_W = 3
export const MIN_CLEAR = 2 * LINE_W // two line widths, edge to edge
export const PAIR_EXTRA = 3.25 // a two-conductor wire's second line reaches this far past its first
export const MIN_OUT = 16
export { PORT_CLEAR }

const segs = (pts) => {
  const out = []
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]
    const b = pts[k]
    if (a.x === b.x && a.y === b.y) continue
    out.push({ a, b, h: a.y === b.y, k })
  }
  return out
}
const lo = (s) => (s.h ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y))
const hi = (s) => (s.h ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y))
const at = (s) => (s.h ? s.a.y : s.a.x)
const same = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01

// lines: [{ id, points, bridges, paired, kind }]; boxes: deviceBox results;
// tabs: [{ id, rect, deviceId }]
// Path distance from the ends of a line (its ports; for a line to a tab only
// the device end) to the point (x, y) on it, the smaller of the two.
export function portDistance (l, x, y) {
  const pts = l.points
  const along = (list) => {
    let d = 0
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1]
      const b = list[k]
      const onSeg = (a.x === b.x ? Math.abs(x - a.x) < 0.01 && y >= Math.min(a.y, b.y) - 0.01 && y <= Math.max(a.y, b.y) + 0.01 : Math.abs(y - a.y) < 0.01 && x >= Math.min(a.x, b.x) - 0.01 && x <= Math.max(a.x, b.x) + 0.01)
      if (onSeg) return d + Math.abs(x - a.x) + Math.abs(y - a.y)
      d += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    }
    return Infinity
  }
  const fromStart = along(pts)
  return l.endSide ? Math.min(fromStart, along([...pts].reverse())) : fromStart
}

// The bridges (crossing points) that lie closer than `dist` to a port of
// either line: [{ ids: [over, under], at: { x, y }, d }].
export function crossingsNearPorts (lines, dist) {
  const out = []
  for (const l of lines) {
    for (const p of l.bridges || []) {
      for (const m of lines) {
        if (m === l) continue
        const crosses = segs(m.points).some((s) => !s.h && Math.abs(s.a.x - p.x) < 0.01 && p.y >= lo(s) && p.y <= hi(s))
        if (!crosses) continue
        const d = Math.min(portDistance(l, p.x, p.y), portDistance(m, p.x, p.y))
        if (d < dist) out.push({ ids: [l.id, m.id], at: p, d })
      }
    }
  }
  return out
}

export function checkPage ({ lines, boxes, tabs = [], portClear = 0 }) {
  const problems = []
  const bad = (type, ...ids) => problems.push({ type, ids })
  const S = lines.map((l) => ({ l, s: segs(l.points) }))
  for (let i = 0; i < S.length; i++) {
    for (let j = i + 1; j < S.length; j++) {
      const A = S[i]
      const B = S[j]
      const ends = (l) => [l.points[0], l.points[l.points.length - 1]]
      const shared = ends(A.l).some((p) => ends(B.l).some((q) => same(p, q)))
      for (const a of A.s) {
        for (const b of B.s) {
          if (a.h === b.h) {
            const d = Math.abs(at(a) - at(b))
            const overlap = Math.min(hi(a), hi(b)) - Math.max(lo(a), lo(b))
            if (overlap <= 0.01) continue
            if (d < 0.01) {
              // a shared terminal's own leg may be shared
              const startsAtShared = [a.a, a.b].some((p) => ends(A.l).some((e) => same(p, e) && ends(B.l).some((q) => same(q, e))))
              if (!(shared && startsAtShared)) bad('overlap', A.l.id, B.l.id)
              continue
            }
            let need = MIN_CLEAR + LINE_W + (A.l.paired ? PAIR_EXTRA : 0) + (B.l.paired ? PAIR_EXTRA : 0)
            // a line to a tab keeps more room from every other line
            if (String(A.l.id).startsWith('s:') !== String(B.l.id).startsWith('s:')) need = Math.max(need, STUB_PITCH)
            if (d < need - 0.01) bad('separation', A.l.id, B.l.id)
          } else {
            const hs = a.h ? a : b
            const vs = a.h ? b : a
            const hl = a.h ? A.l : B.l
            const x = vs.a.x
            const y = hs.a.y
            if (x < lo(hs) - 0.01 || x > hi(hs) + 0.01 || y < lo(vs) - 0.01 || y > hi(vs) + 0.01) continue
            const atEnd = x < lo(hs) + 0.01 || x > hi(hs) - 0.01 || y < lo(vs) + 0.01 || y > hi(vs) - 0.01
            if (atEnd) { if (!shared) bad('touch', A.l.id, B.l.id); continue }
            const ok = (hl.bridges || []).some((p) => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5)
            if (!ok) bad('crossing', A.l.id, B.l.id)
          }
        }
      }
    }
  }
  // lines against boxes and tabs
  const hitsRect = (s, r) => Math.max(s.a.x, s.b.x) > r.x0 && Math.min(s.a.x, s.b.x) < r.x1 && Math.max(s.a.y, s.b.y) > r.y0 && Math.min(s.a.y, s.b.y) < r.y1
  for (const { l, s } of S) {
    for (const b of boxes) {
      const own = l.boxIds && l.boxIds.includes(b.id)
      const r = { x0: b.x - (own ? 0 : PORT_GAP), y0: b.y - (own ? 0 : PORT_GAP), x1: b.x + b.w + (own ? 0 : PORT_GAP), y1: b.y + b.h + (own ? 0 : PORT_GAP) }
      for (const seg of s) {
        if (own) {
          // an own box may only be touched at the ends (the leaving leg), never crossed
          const inner = { x0: r.x0 + 0.5, y0: r.y0 + 0.5, x1: r.x1 - 0.5, y1: r.y1 - 0.5 }
          if (hitsRect(seg, inner)) bad('through-device', l.id, b.id)
        } else if (hitsRect(seg, r)) bad('through-device', l.id, b.id)
      }
    }
    for (const t of tabs) {
      if (l.tabId === t.id) continue
      for (const seg of s) if (hitsRect(seg, { x0: t.rect.x, y0: t.rect.y, x1: t.rect.x + t.rect.w, y1: t.rect.y + t.rect.h })) bad('through-tab', l.id, t.id)
    }
  }
  // tabs against boxes and each other
  const rr = (t) => ({ x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h })
  const ov = (a, b) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1
  for (const t of tabs) {
    for (const b of boxes) if (ov(rr(t.rect), rr(b))) bad('tab-on-device', t.id, b.id)
    for (const u of tabs) if (u.id > t.id && ov(rr(t.rect), rr(u.rect))) bad('tab-on-tab', t.id, u.id)
  }
  if (portClear > 0) for (const c of crossingsNearPorts(lines, portClear)) bad('port-crossing', ...c.ids)
  // a visible straight leg out of every port
  for (const l of lines) {
    for (const [end, side] of [['first', l.startSide], ['last', l.endSide]]) {
      if (!side) continue
      const n = sideNormal(side)
      const pts = end === 'first' ? l.points : [...l.points].reverse()
      const p = pts[0]
      let q = pts[1]
      let k = 1
      while (pts[k + 1] && ((pts[k + 1].x === p.x && n.x === 0) || (pts[k + 1].y === p.y && n.y === 0))) { k++; q = pts[k] }
      const dx = (q.x - p.x) * n.x + (q.y - p.y) * n.y
      const straight = n.x === 0 ? q.x === p.x : q.y === p.y
      if (!straight || dx < MIN_OUT) bad('short-leg', l.id, end)
    }
  }
  return problems
}

// Adapts routePage's input and result to checkPage.
export function linesOf (input, result) {
  const sideAt = (boxId, p) => {
    const b = input.boxes.find((x) => x.id === boxId)
    const t = b.terminals.find((x) => x.x === p.x && x.y === p.y)
    if (t) return t.side
    if (p.x === b.x) return 'left'
    if (p.x === b.x + b.w) return 'right'
    if (p.y === b.y) return 'top'
    return 'bottom'
  }
  const lines = input.wires.map((w) => {
    const r = result.wires.get(w.id)
    const pts = r.points
    return { id: w.id, points: pts, bridges: r.bridges, paired: !!w.paired, boxIds: [w.fromId, w.toId], startSide: sideAt(w.fromId, pts[0]), endSide: sideAt(w.toId, pts[pts.length - 1]), fixed: r.fixed }
  })
  const tabs = []
  for (const s of input.stubs) {
    const r = result.stubs.get(s.cableId)
    lines.push({ id: 's:' + s.cableId, points: r.path, bridges: r.bridges || [], paired: !!s.paired, boxIds: [s.deviceId], startSide: sideAt(s.deviceId, r.path[0]), endSide: null, tabId: s.cableId })
    tabs.push({ id: s.cableId, rect: r.tab, deviceId: s.deviceId })
  }
  return { lines: lines.filter((l) => !l.fixed), boxes: input.boxes, tabs }
}
