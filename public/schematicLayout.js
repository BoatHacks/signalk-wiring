// Layout for the schematic canvas (plan 0021, 4b): the auto layout with gaps
// that follow the cable lengths, and keeping devices from overlapping.
// Pure, no DOM. Boxes are { id, x, y, w, h }.

import { deviceBox } from './schematic.js'

export const OVERLAP_MARGIN = 24
export const GAP_MIN = 80
export const GAP_MAX = 420
const GAP_BASE = 60
const GAP_PER_SQRT_M = 60
const DEFAULT_LENGTH_M = 1

// The gap between two neighbouring ranks for a median cable length in metres.
export function rankGap (lengthM) {
  const L = lengthM == null || !(lengthM >= 0) ? DEFAULT_LENGTH_M : lengthM
  return Math.min(GAP_MAX, Math.max(GAP_MIN, GAP_BASE + GAP_PER_SQRT_M * Math.sqrt(L)))
}

function lengthMetres (cable) {
  if (cable.length == null || !(cable.length >= 0)) return null
  const unit = String(cable.lengthUnit || 'm').toLowerCase()
  if (unit === 'ft' || unit === 'feet') return cable.length * 0.3048
  if (unit === 'mm') return cable.length / 1000
  if (unit === 'cm') return cable.length / 100
  return cable.length
}

const median = (list) => {
  const s = [...list].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Positions for devices left to right from the supply: dagre (passed in so
// this module stays free of imports) gives the ranks and the order, then the
// gap between neighbouring ranks follows the median cable length between them.
// Only cables with both ends in the list count. Returns { [deviceId]: { x, y } }
// with x, y the top-left corner.
export function autoLayout (dagre, devices, cables) {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 90, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  const ids = new Set(devices.map((d) => d.id))
  const sizes = {}
  for (const d of devices) {
    const box = deviceBox(d, { x: 0, y: 0 })
    sizes[d.id] = box
    g.setNode(d.id, { width: box.w, height: box.h })
  }
  const live = cables.filter((c) => c.status !== 'removed' && ids.has(c.fromDeviceId) && ids.has(c.toDeviceId))
  for (const c of live) g.setEdge(c.fromDeviceId, c.toDeviceId, {}, c.id)
  dagre.layout(g)
  // Ranks: nodes with the same dagre x.
  const rankX = [...new Set(devices.map((d) => Math.round(g.node(d.id).x)))].sort((a, b) => a - b)
  const rankOf = {}
  for (const d of devices) rankOf[d.id] = rankX.indexOf(Math.round(g.node(d.id).x))
  const between = rankX.map(() => [])
  for (const c of live) {
    const a = rankOf[c.fromDeviceId]
    const b = rankOf[c.toDeviceId]
    if (Math.abs(a - b) === 1) between[Math.min(a, b)].push(lengthMetres(c))
  }
  const widths = rankX.map(() => 0)
  for (const d of devices) widths[rankOf[d.id]] = Math.max(widths[rankOf[d.id]], sizes[d.id].w)
  const left = []
  let x = 0
  rankX.forEach((_, r) => {
    left[r] = x
    const known = between[r].filter((v) => v != null)
    x += widths[r] + rankGap(known.length ? median(known) : null)
  })
  const out = {}
  for (const d of devices) {
    const n = g.node(d.id)
    const r = rankOf[d.id]
    out[d.id] = { x: Math.round(left[r] + (widths[r] - sizes[d.id].w) / 2), y: Math.round(n.y - sizes[d.id].h / 2) }
  }
  return out
}

const clash = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y

// Pairs of boxes that overlap (no margin), for the "Some devices overlap" notice.
export function findOverlaps (boxes) {
  const out = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (clash(boxes[i], boxes[j], 0)) out.push([boxes[i].id, boxes[j].id])
  return out
}

// Moves boxes to the nearest free spot, at least `margin` from every other box
// and every stub tab ({ x, y, w, h, deviceId } rectangles that stay put; a box
// ignores the tabs of its own device). `movable` (ids) limits which boxes may
// move, default all; the others stay and count as obstacles. Boxes are handled
// in order, so the earlier ones keep their place. Returns { [id]: { x, y } }
// for the boxes that moved.
export function resolveOverlaps (boxes, stubs = [], margin = OVERLAP_MARGIN, movable = null) {
  const may = (id) => !movable || movable.includes(id)
  const placed = []
  const moved = {}
  // Boxes that may not move go in first.
  const order = [...boxes.filter((b) => !may(b.id)), ...boxes.filter((b) => may(b.id))]
  for (const b of order) {
    let cur = { ...b }
    const blockers = (r) => [
      ...placed.filter((o) => clash(r, o, margin)),
      ...stubs.filter((t) => t.deviceId !== b.id && clash(r, t, margin / 2))
    ]
    if (may(b.id) && blockers(cur).length > 0) {
      let found = null
      for (let d = 8; d <= 4000 && !found; d += 8) {
        let best = null
        const steps = Math.max(8, Math.round(d / 4))
        for (let k = 0; k < steps; k++) {
          const ang = (2 * Math.PI * k) / steps
          const cand = { ...b, x: Math.round(b.x + Math.cos(ang) * d), y: Math.round(b.y + Math.sin(ang) * d) }
          if (blockers(cand).length === 0) {
            const dist = Math.hypot(cand.x - b.x, cand.y - b.y)
            if (!best || dist < best.dist) best = { cand, dist }
          }
        }
        if (best) found = best.cand
      }
      if (found) { cur = found; moved[b.id] = { x: found.x, y: found.y } }
    }
    placed.push(cur)
  }
  return moved
}
