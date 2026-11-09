// Pure polygon helpers for zone shapes (plan 0023). A polygon is a list of
// corners { x, y } in page units, at least three. Nothing here touches the DOM.

export const MIN_CORNERS = 3

// The box around the corners: { x, y, w, h }.
export function boundingBox (points) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// The point halfway along each side; side i runs from corner i to corner i + 1
// (the last side closes back to corner 0).
export function midpoints (points) {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length]
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  })
}

// A new corner at the midpoint of side `side`, placed (or dragged straight
// away) at `at` when given. The new corner sits between corner `side` and
// corner `side + 1`; its index is returned with the new list.
export function insertCorner (points, side, at) {
  const mid = at || midpoints(points)[side]
  const index = side + 1
  return { points: [...points.slice(0, index), { x: mid.x, y: mid.y }, ...points.slice(index)], index }
}

// The list without corner `index`, or the same list when only three remain.
export function removeCorner (points, index) {
  if (points.length <= MIN_CORNERS) return points
  return points.filter((_, i) => i !== index)
}

export function movePoints (points, dx, dy) {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

// An equilateral-ish triangle about `size` wide, centred on (cx, cy).
export function triangle (cx, cy, size = 240) {
  const h = Math.round(size * 0.866)
  return [
    { x: Math.round(cx), y: Math.round(cy - h / 2) },
    { x: Math.round(cx + size / 2), y: Math.round(cy + h / 2) },
    { x: Math.round(cx - size / 2), y: Math.round(cy + h / 2) }
  ]
}

// Even-odd point in polygon test.
export function pointInPolygon (points, x, y) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// Distance from a point to the closed outline.
export function distanceToOutline (points, x, y) {
  let best = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2))
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)))
  }
  return best
}
