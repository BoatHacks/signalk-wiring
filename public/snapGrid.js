// Snap to grid for the schematic editor (plan 0028). Pure helpers, no DOM.
// The grid is 16 units, the router's lane pitch, so snapped devices, ports,
// tabs and lanes line up. The on or off choice is kept per browser.

import { moveShape, resizeShape, HANDLES, MIN_SIZE } from './zoneShapes.js'

export const GRID = 16
const STORAGE_KEY = 'wiring.schematicSnap'

// The nearest multiple of the grid.
export function snapValue (v, grid = GRID) {
  return Math.round(v / grid) * grid + 0 // + 0 turns -0 into 0
}

export function snapPoint (p, grid = GRID) {
  return { x: snapValue(p.x, grid), y: snapValue(p.y, grid) }
}

// Is snapping in effect for this pointer event? The Alt key flips the choice:
// with snap on, Alt gives free movement; with snap off, Alt snaps.
export function snapActive (snapOn, altKey) {
  return !!snapOn !== !!altKey
}

// The remembered choice; default on. Storage may be missing or throw (private
// windows, blocked site data), so every access is guarded.
export function readSnap (storage) {
  try {
    return (storage || globalThis.localStorage).getItem(STORAGE_KEY) !== '0'
  } catch (err) {
    return true
  }
}

export function writeSnap (value, storage) {
  try {
    (storage || globalThis.localStorage).setItem(STORAGE_KEY, value ? '1' : '0')
  } catch (err) {
    // the choice just is not remembered
  }
}

// A device box or a tab is held at `p` by the pointer offset (dx, dy) from its
// top-left corner; the corner snaps, not the pointer.
export function snapCorner (p, dx, dy, grid = GRID) {
  return { x: snapValue(p.x - dx, grid), y: snapValue(p.y - dy, grid) }
}

// The change of the coordinate of a segment (a.y for a horizontal one, a.x for
// a vertical one) after it is dragged by `delta`: the segment lands on the grid.
export function snapSegmentDelta (coord, delta, grid = GRID) {
  return snapValue(coord + delta, grid) - coord
}

// Moving a zone shape by (dx, dy): the top-left corner of its box lands on
// the grid (for a polygon, the box around its corners).
export function snapMoveShape (shape, dx, dy, grid = GRID) {
  return moveShape(shape, snapValue(shape.x + dx, grid) - shape.x, snapValue(shape.y + dy, grid) - shape.y)
}

// Resizing a rectangle or oval by handle `id` dragged to (px, py): the edges
// being dragged land on the grid. For a square or circle (Shift) on a corner
// handle the size follows the shorter side.
export function snapResizeShape (shape, id, px, py, square = false, grid = GRID) {
  const sx = snapValue(px, grid)
  const sy = snapValue(py, grid)
  const h = HANDLES.find((k) => k.id === id)
  if (!h || !square || h.ax === 0 || h.ay === 0) return resizeShape(shape, id, sx, sy, square)
  const free = resizeShape(shape, id, sx, sy, false)
  const size = Math.max(MIN_SIZE, Math.min(free.width, free.height))
  const fx = h.ax < 0 ? shape.x + shape.width : shape.x
  const fy = h.ay < 0 ? shape.y + shape.height : shape.y
  return resizeShape(shape, id, fx + h.ax * size, fy + h.ay * size, true)
}
