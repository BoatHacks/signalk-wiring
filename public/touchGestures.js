// Two-finger pan and pinch zoom for the schematic canvas and the floorplan
// (plan 0031). Pure helpers, no DOM. Points are { x, y } in screen pixels.

export const DEAD_ZONE_PX = 6 // finger movement before a two-finger gesture starts

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// The step between two readings of two touch points: `prev` and `next` are
// [p, q] pairs (the same finger first in both). Returns the scale factor (above
// 1 when the fingers spread), the midpoints and `idle`, true while the move is
// inside the dead zone: both the change of finger distance and the move of the
// midpoint are below `deadZone` pixels. A rotation keeps the distance and the
// midpoint, so it changes nothing.
export function pinchStep (prev, next, deadZone = DEAD_ZONE_PX) {
  const d0 = dist(prev[0], prev[1])
  const d1 = dist(next[0], next[1])
  const m0 = mid(prev[0], prev[1])
  const m1 = mid(next[0], next[1])
  const pan = { dx: m1.x - m0.x, dy: m1.y - m0.y }
  const idle = Math.abs(d1 - d0) < deadZone && Math.hypot(pan.dx, pan.dy) < deadZone
  const raw = d0 > 0 && d1 > 0 ? d1 / d0 : 1
  const scale = idle ? 1 : raw
  return { idle, scale, pan: idle ? { dx: 0, dy: 0 } : pan, from: m0, to: m1 }
}

// How much one pixel of the screen is in drawing units, for an SVG viewBox
// shown with "meet" scaling (the default).
export const viewScale = (view, rect) => Math.max(view.w / rect.width, view.h / rect.height)

// The new viewBox after a step: the drawing point under the old midpoint
// ends up under the new midpoint, with the view scaled by `scale` around it.
// `view` is { x, y, w, h }, `rect` the canvas on screen { left, top, width,
// height }. `limits` ({ minW, maxW }) bound the visible width like the buttons.
export function pinchView (view, rect, step, limits = {}) {
  const k = viewScale(view, rect)
  const ox = (rect.width - view.w / k) / 2
  const oy = (rect.height - view.h / k) / 2
  const anchor = { x: view.x + (step.from.x - rect.left - ox) * k, y: view.y + (step.from.y - rect.top - oy) * k }
  let nw = view.w / (step.scale || 1)
  if (limits.minW !== undefined) nw = Math.max(limits.minW, nw)
  if (limits.maxW !== undefined) nw = Math.min(limits.maxW, nw)
  const factor = view.w / nw
  const nh = view.h / factor
  const k2 = k / factor
  const ox2 = (rect.width - nw / k2) / 2
  const oy2 = (rect.height - nh / k2) / 2
  return {
    x: anchor.x - (step.to.x - rect.left - ox2) * k2,
    y: anchor.y - (step.to.y - rect.top - oy2) * k2,
    w: nw,
    h: nh
  }
}
