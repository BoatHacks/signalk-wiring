// Marker clusters on the floorplan (plan 0027). Pure: no DOM, no state.
//
// Markers whose centres are closer than radiusPx (the marker diameter plus a
// small gap, in screen pixels) collapse into one cluster with a count. Screen
// pixels, not drawing units, so the result follows the zoom: zooming in moves
// the markers apart on screen and splits the cluster.

export const CLUSTER_GAP_PX = 4

// The distance below which two markers of the given screen diameter overlap
// or touch: the diameter plus the gap.
export function clusterRadius (markerDiameterPx, gapPx = CLUSTER_GAP_PX) {
  return markerDiameterPx + gapPx
}

// markers: [{ id, x, y, pinned? }] with x and y in screen pixels. A pinned
// marker (the selected device, one of a highlighted circuit) never joins a
// cluster, so it stays visible and in place.
//
// Returns { clusters, singles }:
//   clusters: [{ id, x, y, ids }] with at least two ids each, x and y the mean
//             of the members, ids sorted; id is 'cluster:' plus the first id.
//   singles:  ids of the markers drawn on their own, in input order.
//
// Greedy in id order: the lowest unassigned id seeds a cluster and takes every
// unassigned marker within the radius of the seed. The result depends only on
// the set of markers, not on their order, and a lone marker is never a cluster.
export function clusterMarkers (markers, radiusPx) {
  const free = markers.filter((m) => !m.pinned)
  const order = [...free].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const taken = new Set()
  const clusters = []
  for (const seed of order) {
    if (taken.has(seed.id)) continue
    taken.add(seed.id)
    const group = [seed]
    for (const other of order) {
      if (taken.has(other.id)) continue
      if (Math.hypot(other.x - seed.x, other.y - seed.y) < radiusPx) {
        taken.add(other.id)
        group.push(other)
      }
    }
    if (group.length > 1) {
      const ids = group.map((m) => m.id).sort()
      clusters.push({
        id: 'cluster:' + ids[0],
        x: group.reduce((s, m) => s + m.x, 0) / group.length,
        y: group.reduce((s, m) => s + m.y, 0) / group.length,
        ids
      })
    }
  }
  const clustered = new Set(clusters.flatMap((c) => c.ids))
  const singles = markers.filter((m) => !clustered.has(m.id)).map((m) => m.id)
  return { clusters, singles }
}
