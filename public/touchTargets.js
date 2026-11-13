// Touch target hit areas (plan 0031). Pure helpers, no DOM. A finger needs a
// target of about 44 px on screen; a mouse or pen keeps the drawn size. The
// drawing never changes: only the area that takes the press grows, and only for
// a press made by a finger (the pointerType of that press decides, so a hybrid
// device behaves right).

export const TOUCH_TARGET_PX = 44

// The hit radius in drawing units of each kind of target for a mouse or pen.
// Tabs and markers are shapes, so they have no extra radius of their own.
export const BASE_RADIUS = {
  terminal: 8,
  bend: 8,
  midpoint: 8,
  corner: 9,
  handle: 9,
  tab: 0,
  marker: 0,
  cluster: 0
}

// `zoom` is screen pixels per drawing unit. For a finger the radius is the one
// that gives 44 px across, never smaller than the base radius.
export function hitRadius (kind, pointerType, zoom) {
  const base = BASE_RADIUS[kind] ?? 0
  if (pointerType !== 'touch' || !(zoom > 0)) return base
  return Math.max(base, TOUCH_TARGET_PX / 2 / zoom)
}

// How far a rectangle of w by h must grow on every side to give a finger
// `radius` of reach from its centre (zero when it is big enough already).
export const rectPad = (radius, w, h) => Math.max(0, radius - Math.min(w, h) / 2)

export const insideRect = (r, x, y, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad

// The target a press at p lands on. `candidates` are { kind, x, y, ... } points
// (their other fields are returned untouched). Each gets its hit radius, cut to
// half the distance to the nearest other candidate so that no hit area covers
// another target's centre (never below the base radius); of the areas that
// contain p, the nearest centre wins. Null when none does.
export function pickTarget (p, candidates, pointerType, zoom) {
  let best = null
  let bestD = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    let near = Infinity
    for (let j = 0; j < candidates.length; j++) {
      if (j !== i) near = Math.min(near, Math.hypot(candidates[j].x - c.x, candidates[j].y - c.y))
    }
    const base = BASE_RADIUS[c.kind] ?? 0
    const r = Math.max(base, Math.min(hitRadius(c.kind, pointerType, zoom), near / 2))
    const d = Math.hypot(c.x - p.x, c.y - p.y)
    if (d <= r && d < bestD) { best = c; bestD = d }
  }
  return best
}
