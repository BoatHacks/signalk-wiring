// Pure geometry for the floorplan view. No DOM, no network, so it can be
// tested directly. Boat coordinates are meters: x along the boat, y
// athwartships (0 on the centerline), z height. A top view shows [x, y],
// a side view shows [x, z]; the axis a view does not show is left alone.

const VIEW_AXES = { top: ['x', 'y'], side: ['x', 'z'] }
const AXES = ['x', 'y', 'z']

export function axesForView (view) {
  const axes = VIEW_AXES[view]
  if (!axes) throw new Error(`unknown view: ${view}`)
  return axes
}

// Calibration comes from two clicks and a typed distance: the origin, a
// second point along the first axis, and the real distance between them.
// The second axis is perpendicular: "up" on screen for a side view; for a
// top view it points the same way (toward the top of the drawing), and
// `flip` reverses it when the drawing is the other way round. Uniform
// scale only; a warped drawing is not corrected.
export function calibrationFromClicks (originPx, axisPointPx, distanceM, { flip = false } = {}) {
  const dx = axisPointPx[0] - originPx[0]
  const dy = axisPointPx[1] - originPx[1]
  const len = Math.hypot(dx, dy)
  if (!(len > 0)) throw new Error('the two calibration points must differ')
  if (!(distanceM > 0)) throw new Error('the real distance must be greater than zero')
  return {
    originPx: [originPx[0], originPx[1]],
    pxPerMeter: len / distanceM,
    dir: [dx / len, dy / len],
    flip: Boolean(flip)
  }
}

function secondAxisDir (cal) {
  const [ux, uy] = cal.dir
  const sign = cal.flip ? -1 : 1
  return [sign * uy, -sign * ux]
}

// Which way x points on the drawing, by its dominant direction: x is the
// length axis, increasing toward the bow, so this is where the bow is.
export function lengthDirection (cal) {
  const [dx, dy] = cal.dir
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

// Triangle for the tip of an arrow from `from` to `to`: the tip at `to`,
// then the two corners of its base, `size` back along the line.
export function arrowHeadPoints (from, to, size) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy)
  if (len === 0) return [[...to], [...to], [...to]]
  const ux = dx / len
  const uy = dy / len
  const baseX = to[0] - ux * size
  const baseY = to[1] - uy * size
  const half = size * 0.5
  return [
    [to[0], to[1]],
    [baseX - uy * half, baseY + ux * half],
    [baseX + uy * half, baseY - ux * half]
  ]
}

// Drawing coordinates (SVG user units) to meters on the view's two axes.
export function pxToMeters (cal, px) {
  const dx = px[0] - cal.originPx[0]
  const dy = px[1] - cal.originPx[1]
  const [wx, wy] = secondAxisDir(cal)
  return [
    (dx * cal.dir[0] + dy * cal.dir[1]) / cal.pxPerMeter,
    (dx * wx + dy * wy) / cal.pxPerMeter
  ]
}

export function metersToPx (cal, a, b) {
  const [wx, wy] = secondAxisDir(cal)
  return [
    cal.originPx[0] + (a * cal.dir[0] + b * wx) * cal.pxPerMeter,
    cal.originPx[1] + (a * cal.dir[1] + b * wy) * cal.pxPerMeter
  ]
}

function pointOf (p) {
  return { x: p?.x ?? null, y: p?.y ?? null, z: p?.z ?? null }
}

// A click in a view sets that view's two axes and keeps the third, so a
// device moved in the side view also moves in the top view.
export function applyClick (position, view, a, b) {
  const [first, second] = axesForView(view)
  return { ...pointOf(position), [first]: a, [second]: b }
}

// A new waypoint takes the axis its view does not show from the previous
// point (or the route's start), and can be corrected from the other view.
export function waypointFromClick (previous, view, a, b) {
  return applyClick(previous, view, a, b)
}

// Length of the 3D polyline. A segment only counts axes set at both of its
// ends, so a half-placed route gives a lower bound and `complete` is false.
export function routeLength (route) {
  const points = (route || []).map(pointOf)
  let length = 0
  let complete = true
  for (let i = 1; i < points.length; i++) {
    let sum = 0
    let usedAxes = 0
    for (const axis of AXES) {
      const p = points[i - 1][axis]
      const q = points[i][axis]
      if (p === null || q === null) continue
      sum += (q - p) ** 2
      usedAxes++
    }
    if (usedAxes < AXES.length) complete = false
    length += Math.sqrt(sum)
  }
  return { length, complete }
}

function isPlaced (device) {
  return Boolean(device) && device.status !== 'removed' &&
    AXES.some((axis) => device[`pos${axis.toUpperCase()}`] != null)
}

function positionOf (device) {
  return { x: device.posX ?? null, y: device.posY ?? null, z: device.posZ ?? null }
}

// Where a wire run's drawn route begins: its from-device if that is placed,
// else the circuit's panel device, else nothing (the first clicked waypoint
// starts the route). Removed or unplaced devices are skipped.
export function resolveRouteStart (wireRun, circuit, devicesById) {
  const fromDevice = devicesById.get(wireRun.fromEndpoint)
  if (isPlaced(fromDevice)) return positionOf(fromDevice)
  const panel = circuit ? devicesById.get(circuit.panelDeviceId) : null
  if (isPlaced(panel)) return positionOf(panel)
  return null
}

// A top-view plan with a height range shows only what lies inside it, so
// each deck plan shows its own deck. A point with no height is shown, since
// it cannot be ruled out. Plans without a range, and side views, show all.
export function planShowsPoint (plan, point) {
  if (plan.view !== 'top') return true
  const z = point?.z ?? null
  if (z === null) return true
  if (plan.zMin != null && z < plan.zMin) return false
  if (plan.zMax != null && z > plan.zMax) return false
  return true
}

// Reads the drawing's size from the root <svg> element: viewBox if there
// is one, else width and height in plain numbers or px. Null when neither
// gives a usable size.
export function parseSvgSize (svgText) {
  const tag = /<svg\b[^>]*>/i.exec(svgText)
  if (!tag) return null
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag[0])?.[1]

  const viewBox = attr('viewBox')
  if (viewBox) {
    const n = viewBox.trim().split(/[\s,]+/).map(Number)
    if (n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0) {
      return { x: n[0], y: n[1], width: n[2], height: n[3] }
    }
  }
  const plain = (v) => (/^\s*[\d.]+\s*(px)?\s*$/i.test(v || '') ? parseFloat(v) : NaN)
  const width = plain(attr('width'))
  const height = plain(attr('height'))
  if (width > 0 && height > 0) return { x: 0, y: 0, width, height }
  return null
}

// Where a point shows in a view: pixels in the drawing, or null when one
// of the view's two axes is unset (a half-placed point shows only in the
// view where both of its axes are known).
export function pointToPx (cal, view, point) {
  const [first, second] = axesForView(view)
  const a = point?.[first] ?? null
  const b = point?.[second] ?? null
  if (a === null || b === null) return null
  return metersToPx(cal, a, b)
}

// New route with one waypoint moved by a click or drag in a view. The
// axis the view does not show keeps its value.
export function moveWaypoint (route, index, view, a, b) {
  return route.map((p, i) => (i === index ? applyClick(p, view, a, b) : pointOf(p)))
}

export function removeWaypoint (route, index) {
  return route.filter((_, i) => i !== index).map(pointOf)
}

// The drawn polyline of a wire run: its resolved start (if any) followed
// by the stored waypoints. The start is derived, never stored, so moving
// the device moves the start with it.
export function routePoints (wireRun, circuit, devicesById) {
  const start = resolveRouteStart(wireRun, circuit, devicesById)
  const waypoints = (wireRun.route || []).map(pointOf)
  return start ? [start, ...waypoints] : waypoints
}

// Device ids and wire run ids that belong to a circuit, for highlighting.
// Removed runs are left out; the panel device counts as a member.
export function circuitMembers (circuit, wireRuns) {
  const runIds = new Set()
  const deviceIds = new Set()
  for (const run of wireRuns) {
    if (run.circuitId !== circuit.id || run.status === 'removed') continue
    runIds.add(run.id)
    if (run.fromEndpoint) deviceIds.add(run.fromEndpoint)
    if (run.toEndpoint) deviceIds.add(run.toEndpoint)
  }
  if (circuit.panelDeviceId) deviceIds.add(circuit.panelDeviceId)
  return { runIds, deviceIds }
}

const METERS_TO_FEET = 3.280839895

// A measured length expressed in the unit a wire run records, rounded to
// two decimals. Anything other than feet is meters.
export function metersToLengthUnit (meters, unit) {
  const value = unit === 'ft' ? meters * METERS_TO_FEET : meters
  return Math.round(value * 100) / 100
}

// The drawn polyline of a conduit: its stored points. Its ends are the first
// and last point; nothing is derived from devices.
export function conduitRoutePoints (conduit) {
  return (conduit?.route || []).map(pointOf)
}

function hasDrawnRoute (record) {
  return record.status !== 'removed' && Array.isArray(record.route) && record.route.length > 0
}

// Live cables that show nothing on the plans: no route of their own and no
// live conduit with a drawn route to follow.
export function unroutedCables (wireRuns, conduits) {
  const drawn = new Set(conduits.filter(hasDrawnRoute).map((c) => c.id))
  return wireRuns.filter((run) =>
    run.status !== 'removed' &&
    !(Array.isArray(run.route) && run.route.length > 0) &&
    !(run.conduitIds || []).some((id) => drawn.has(id)))
}

// Run ids and device ids to highlight for a selected conduit: its live
// cables and the devices at their ends.
export function conduitMembers (conduit, wireRuns) {
  const wanted = new Set(conduit.cableIds || [])
  const runIds = new Set()
  const deviceIds = new Set()
  for (const run of wireRuns) {
    if (!wanted.has(run.id) || run.status === 'removed') continue
    runIds.add(run.id)
    if (run.fromEndpoint) deviceIds.add(run.fromEndpoint)
    if (run.toEndpoint) deviceIds.add(run.toEndpoint)
  }
  return { runIds, deviceIds }
}
