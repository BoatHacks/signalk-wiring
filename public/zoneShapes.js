// Pure geometry for zone shapes on a schematic page (plan 0023): a rectangle,
// an oval or a polygon drawn on a background layer. A shape is
// { zoneId, kind: 'rect' | 'oval' | 'polygon', x, y, width, height, points? },
// x, y, width and height being its box in page units (for a polygon, the box
// around its corners). Shapes are visual only.

import { boundingBox, insertCorner, removeCorner, movePoints, triangle, pointInPolygon, distanceToOutline } from './polygon.js'

export const DEFAULT_W = 240
export const DEFAULT_H = 160
export const MIN_SIZE = 24
export const OUTLINE_HIT = 7
export const LABEL_H = 16

export const SHAPE_KINDS = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'oval', label: 'Oval' },
  { value: 'polygon', label: 'Polygon' }
]

// The box of a shape as { x, y, w, h }, for fitting the view.
export const shapeBox = (s) => ({ x: s.x, y: s.y, w: s.width, h: s.height })

// A new shape of `kind` centred on `centre`.
export function newShape (zoneId, kind, centre) {
  if (kind === 'polygon') {
    const points = triangle(centre.x, centre.y, DEFAULT_W)
    const b = boundingBox(points)
    return { zoneId, kind, x: b.x, y: b.y, width: b.w, height: b.h, points }
  }
  return { zoneId, kind, x: Math.round(centre.x - DEFAULT_W / 2), y: Math.round(centre.y - DEFAULT_H / 2), width: DEFAULT_W, height: DEFAULT_H }
}

// A polygon shape rebuilt from new corners.
export function withPoints (shape, points) {
  const b = boundingBox(points)
  return { ...shape, points, x: b.x, y: b.y, width: b.w, height: b.h }
}

export function moveShape (shape, dx, dy) {
  const moved = { ...shape, x: shape.x + dx, y: shape.y + dy }
  if (shape.kind === 'polygon') moved.points = movePoints(shape.points, dx, dy)
  return moved
}

// Insert a corner at the midpoint of a side (index `side`); returns the new
// shape and the index of the new corner. Remove a corner while more than three
// remain (returns the same shape otherwise).
export function addCorner (shape, side, at) {
  const r = insertCorner(shape.points, side, at)
  return { shape: withPoints(shape, r.points), index: r.index }
}
export function dropCorner (shape, index) {
  const points = removeCorner(shape.points, index)
  return points === shape.points ? shape : withPoints(shape, points)
}

// The eight resize handles of a rectangle or oval: corners and edge middles.
// `at` is [-1, 0, 1] per axis: the side the handle sits on.
export const HANDLES = [
  { id: 'nw', ax: -1, ay: -1 }, { id: 'n', ax: 0, ay: -1 }, { id: 'ne', ax: 1, ay: -1 },
  { id: 'e', ax: 1, ay: 0 }, { id: 'se', ax: 1, ay: 1 }, { id: 's', ax: 0, ay: 1 },
  { id: 'sw', ax: -1, ay: 1 }, { id: 'w', ax: -1, ay: 0 }
]

export function handlePositions (shape) {
  return HANDLES.map((h) => ({
    id: h.id,
    x: shape.x + (h.ax + 1) * shape.width / 2,
    y: shape.y + (h.ay + 1) * shape.height / 2
  }))
}

// The handle within `radius` of the point, or null.
export function hitHandle (shape, x, y, radius = 9) {
  let best = null
  let bestD = radius
  for (const h of handlePositions(shape)) {
    const d = Math.hypot(h.x - x, h.y - y)
    if (d <= bestD) { best = h.id; bestD = d }
  }
  return best
}

// The shape after dragging handle `id` to (px, py). The opposite edge or
// corner stays put; the box never gets smaller than MIN_SIZE. `square` keeps
// width equal to height (a circle or a square).
export function resizeShape (shape, id, px, py, square = false) {
  const h = HANDLES.find((k) => k.id === id)
  if (!h) return shape
  let x0 = shape.x
  let y0 = shape.y
  let x1 = shape.x + shape.width
  let y1 = shape.y + shape.height
  if (h.ax < 0) x0 = Math.min(px, x1 - MIN_SIZE)
  if (h.ax > 0) x1 = Math.max(px, x0 + MIN_SIZE)
  if (h.ay < 0) y0 = Math.min(py, y1 - MIN_SIZE)
  if (h.ay > 0) y1 = Math.max(py, y0 + MIN_SIZE)
  if (square) {
    const size = Math.max(x1 - x0, y1 - y0)
    if (h.ax === 0) { const c = (shape.x + shape.x + shape.width) / 2; x0 = c - size / 2; x1 = c + size / 2 } else if (h.ax < 0) x0 = x1 - size
    else x1 = x0 + size
    if (h.ay === 0) { const c = (shape.y + shape.y + shape.height) / 2; y0 = c - size / 2; y1 = c + size / 2 } else if (h.ay < 0) y0 = y1 - size
    else y1 = y0 + size
  }
  return { ...shape, x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) }
}

// The outline as a polygon: the corners of a rectangle, 48 points on an oval.
export function outlinePoints (shape) {
  if (shape.kind === 'polygon') return shape.points
  if (shape.kind === 'oval') {
    const cx = shape.x + shape.width / 2
    const cy = shape.y + shape.height / 2
    return Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2
      return { x: cx + Math.cos(a) * shape.width / 2, y: cy + Math.sin(a) * shape.height / 2 }
    })
  }
  return [
    { x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y },
    { x: shape.x + shape.width, y: shape.y + shape.height }, { x: shape.x, y: shape.y + shape.height }
  ]
}

export const insideShape = (shape, x, y) => pointInPolygon(outlinePoints(shape), x, y)

// Where the zone name goes: the top left of the shape's bounding box.
export const labelAt = (shape) => ({ x: shape.x + 8, y: shape.y + 16 })

// The label's text box, for hit testing: about 6.5 units per character.
export function labelBox (shape, name) {
  const at = labelAt(shape)
  return { x: at.x - 4, y: at.y - 13, w: Math.min(String(name).length, 28) * 6.8 + 8, h: LABEL_H }
}

// Does a click at (x, y) hit the shape's outline or label? A selected shape
// also takes its inside (to move it).
export function hitShape (shape, name, x, y, { inside = false, tolerance = OUTLINE_HIT } = {}) {
  if (distanceToOutline(outlinePoints(shape), x, y) <= tolerance) return true
  const b = labelBox(shape, name)
  if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true
  return inside && insideShape(shape, x, y)
}

// The topmost shape hit (later shapes are drawn on top), or null. `selectedId`
// is the zone id of the selected shape, whose inside also counts.
export function pickShape (shapes, nameOf, x, y, selectedId = null) {
  let found = null
  for (const s of shapes) if (hitShape(s, nameOf(s.zoneId), x, y, { inside: s.zoneId === selectedId })) found = s
  return found
}

// The zones that can still be added to a page: those without a shape on it.
export function addableZones (zones, shapes) {
  const used = new Set(shapes.map((s) => s.zoneId))
  return zones.filter((z) => !used.has(z.id)).sort((a, b) => a.name.localeCompare(b.name))
}

// The shape list with a shape for the zone added, or replaced when the zone
// already has one (one shape per zone per page).
export function withShape (shapes, shape) {
  const at = shapes.findIndex((s) => s.zoneId === shape.zoneId)
  return at < 0 ? [...shapes, shape] : shapes.map((s, i) => (i === at ? shape : s))
}
