// Bundled routes on the floorplan (plan 0027). Pure: no DOM, no state.
//
// Where several wire runs, or several conduit routes, run along the same
// segment they are drawn as one thicker line with a count, not as lines
// lying on top of each other.

function distance (p, q) {
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}

// Two segments are the same when both ends are within the tolerance of the
// other's ends, in either direction.
function sameSegment (s, t, tol) {
  return (distance(s.a, t.a) <= tol && distance(s.b, t.b) <= tol) ||
    (distance(s.a, t.b) <= tol && distance(s.b, t.a) <= tol)
}

// routes: [{ id, points: [[x, y], ...] }] in screen pixels; one id may appear
// more than once (a route cut into visible runs by a plan's height range).
// tolerancePx: how far apart the ends of two segments may be and still count
// as the same segment.
//
// Returns { bundles, covered }:
//   bundles: [{ key, a, b, mid, ids, count }] one per shared segment; ids are
//            the distinct route ids (sorted) and count their number, always
//            two or more.
//   covered: Set of 'routeIndex:segmentIndex' strings for the segments that
//            went into a bundle, so the caller draws only the rest on their own.
//
// Greedy in the order of route id, then position: the first segment not yet
// taken seeds a group and takes every later segment that matches it. The
// result depends only on the routes, not on the order they are given in.
export function bundleRoutes (routes, tolerancePx) {
  const segments = []
  routes.forEach((route, routeIndex) => {
    const pts = route.points || []
    for (let j = 0; j + 1 < pts.length; j++) {
      if (distance(pts[j], pts[j + 1]) <= tolerancePx) continue // too short to tell from a point
      segments.push({ id: route.id, routeIndex, segIndex: j, a: pts[j], b: pts[j + 1] })
    }
  })
  segments.sort((s, t) => (s.id < t.id ? -1 : s.id > t.id ? 1 : s.routeIndex - t.routeIndex || s.segIndex - t.segIndex))

  const taken = new Set()
  const bundles = []
  const covered = new Set()
  segments.forEach((seed, i) => {
    if (taken.has(i)) return
    taken.add(i)
    const group = [seed]
    segments.forEach((other, k) => {
      if (taken.has(k)) return
      if (sameSegment(seed, other, tolerancePx)) { taken.add(k); group.push(other) }
    })
    const ids = [...new Set(group.map((s) => s.id))].sort()
    if (ids.length < 2) return
    // Ends of every member, turned to run the same way as the seed.
    const ends = group.map((s) => (distance(s.a, seed.a) + distance(s.b, seed.b) <= distance(s.a, seed.b) + distance(s.b, seed.a)
      ? [s.a, s.b]
      : [s.b, s.a]))
    const mean = (n) => [ends.reduce((sum, e) => sum + e[n][0], 0) / ends.length, ends.reduce((sum, e) => sum + e[n][1], 0) / ends.length]
    const a = mean(0)
    const b = mean(1)
    bundles.push({ key: `bundle:${ids[0]}:${seed.routeIndex}:${seed.segIndex}`, a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ids, count: ids.length })
    for (const s of group) covered.add(`${s.routeIndex}:${s.segIndex}`)
  })
  return { bundles, covered }
}

// The pieces of a route that are not in a bundle: runs of consecutive
// segments, each as a list of points. A route that is not bundled at all
// comes back as one piece.
export function uncoveredPieces (routeIndex, points, covered) {
  const pieces = []
  let current = null
  for (let j = 0; j + 1 < points.length; j++) {
    if (covered.has(`${routeIndex}:${j}`)) {
      current = null
    } else {
      if (!current) { current = [points[j]]; pieces.push(current) }
      current.push(points[j + 1])
    }
  }
  return pieces
}

// Line width of a bundle in drawing units, growing with the count and capped.
export function bundleWidth (unit, count, base, step, cap) {
  return unit * Math.min(cap, base + step * (count - 1))
}
