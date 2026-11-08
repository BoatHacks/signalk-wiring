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
// Positions are kept to the centimeter; finer values are noise.
export function roundCm (value) {
  return Math.round(value * 100) / 100
}

export function applyClick (position, view, a, b) {
  const [first, second] = axesForView(view)
  return { ...pointOf(position), [first]: roundCm(a), [second]: roundCm(b) }
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
// else nothing (the first clicked waypoint starts the route). Removed or
// unplaced devices are skipped. The second argument used to be the circuit,
// whose panel device was the fallback; circuits no longer have one, and it
// is kept (ignored) so callers do not change.
export function resolveRouteStart (wireRun, _circuit, devicesById) {
  const fromDevice = devicesById.get(wireRun.fromDeviceId)
  if (isPlaced(fromDevice)) return positionOf(fromDevice)
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

// Device ids and wire run ids that belong to a circuit, for highlighting,
// from what the derivation says about it (its feed cables, the negative
// cables that serve it, and the devices on them). Removed runs are left out.
export function circuitMembers (circuit, wireRuns) {
  const derived = circuit.derived
  const runIds = new Set()
  const deviceIds = new Set()
  if (!derived) return { runIds, deviceIds }
  const wanted = new Set([...derived.cableIds, ...derived.returnCableIds])
  for (const run of wireRuns) {
    if (!wanted.has(run.id) || run.status === 'removed') continue
    runIds.add(run.id)
    if (run.fromDeviceId) deviceIds.add(run.fromDeviceId)
    if (run.toDeviceId) deviceIds.add(run.toDeviceId)
  }
  for (const id of derived.deviceIds) deviceIds.add(id)
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
    if (run.fromDeviceId) deviceIds.add(run.fromDeviceId)
    if (run.toDeviceId) deviceIds.add(run.toDeviceId)
  }
  return { runIds, deviceIds }
}

function distanceBetween (p, q) {
  let sum = 0
  for (const axis of AXES) {
    if (p[axis] === null || q[axis] === null) continue
    sum += (q[axis] - p[axis]) ** 2
  }
  return Math.sqrt(sum)
}

// What a cable (a wire run) is drawn as and how long it measures.
//
// A cable with route points of its own keeps them (source 'own'): its route
// is its resolved start plus its waypoints, as before. Otherwise it follows
// the conduits it passes through, each for its whole length, in the cable's
// order (source 'conduits'). A conduit may have been drawn in either
// direction, so each is turned to meet the end of the one before; the first
// is turned toward the cable's start device when that is placed, else toward
// the second conduit. Where one conduit ends away from where the next
// begins, a straight link joins them and counts toward the length. Removed
// conduits and ones with fewer than two points are skipped, which makes the
// result incomplete. A cable with neither has source 'none'.
//
// `complete` is false when a conduit was skipped or when heights are unset
// (see routeLength), meaning the length is a lower bound.
export function effectiveCableRoute (wireRun, circuit, devicesById, conduitsById) {
  const ownWaypoints = Array.isArray(wireRun.route) && wireRun.route.length > 0
  if (ownWaypoints) {
    const points = routePoints(wireRun, circuit, devicesById)
    return { source: 'own', points, ...routeLength(points) }
  }

  let complete = true
  const routes = []
  for (const id of wireRun.conduitIds || []) {
    const conduit = conduitsById.get(id)
    if (!conduit || conduit.status === 'removed') continue
    const points = conduitRoutePoints(conduit)
    if (points.length < 2) { complete = false; continue }
    routes.push(points)
  }
  if (routes.length === 0) return { source: 'none', points: [], length: 0, complete }

  const reversed = (points) => points.slice().reverse()
  const ends = (points) => [points[0], points[points.length - 1]]
  let anchor = resolveRouteStart(wireRun, circuit, devicesById)
  const oriented = []
  routes.forEach((points, i) => {
    let route = points
    const [first, last] = ends(points)
    if (anchor) {
      if (distanceBetween(anchor, last) < distanceBetween(anchor, first)) route = reversed(points)
    } else if (i === 0 && routes.length > 1) {
      // No anchor: turn the first conduit so its end is nearest the next one.
      const [nextFirst, nextLast] = ends(routes[1])
      const toNext = (p) => Math.min(distanceBetween(p, nextFirst), distanceBetween(p, nextLast))
      if (toNext(first) < toNext(last)) route = reversed(points)
    }
    oriented.push(route)
    anchor = route[route.length - 1]
  })

  const points = oriented.flat()
  const measured = routeLength(points)
  return { source: 'conduits', points, length: measured.length, complete: complete && measured.complete }
}

// ---- Corner arrows ---------------------------------------------------------

// The bow and up markers drawn in a fixed corner of the plan view, in a small
// box of its own (not in drawing space, so they do not scale with the zoom).
// Both start at [0, 0] and point the way the plan's x axis and second axis
// run on screen; `length` is their reach in the same units as the box.
export function cornerArrows (cal, length, headSize = length * 0.35) {
  const o = metersToPx(cal, 0, 0)
  const unitVector = (a, b) => {
    const p = metersToPx(cal, a, b)
    const dx = p[0] - o[0]
    const dy = p[1] - o[1]
    const len = Math.hypot(dx, dy) || 1
    return [dx / len, dy / len]
  }
  const build = (v) => {
    const to = [roundTo(v[0] * length), roundTo(v[1] * length)]
    return { to, head: arrowHeadPoints([0, 0], to, headSize) }
  }
  return { bow: build(unitVector(1, 0)), up: build(unitVector(0, 1)) }
}

function roundTo (value) {
  return Math.round(value * 1000) / 1000
}

// ---- Route tool: ending on the To device -----------------------------------

// What a click on a device marker does while a wire run is chosen in the Draw
// route tool. A cable with no To device keeps the old behaviour (select the
// device). Clicking the To device ends the route there; any other device only
// shows a hint.
//   { kind: 'select' } | { kind: 'hint', message } | { kind: 'finish', point }
export function routeEndAction (wireRun, clickedDeviceId, devicesById) {
  if (!wireRun.toDeviceId) return { kind: 'select' }
  const to = devicesById.get(wireRun.toDeviceId)
  const name = to?.name || 'the To device'
  if (!to || to.status === 'removed') return { kind: 'select' }
  if (!isPlaced(to)) {
    return { kind: 'hint', message: `This route ends at ${name}, which is not placed on a plan yet. Place it first, then click it to finish the route.` }
  }
  if (clickedDeviceId !== to.id) return { kind: 'hint', message: `This route ends at ${name}` }
  return { kind: 'finish', point: positionOf(to) }
}

// The route with the To device's position as its last point (not repeated if
// the route already ends exactly there).
export function routeWithEnd (route, point) {
  const points = (route || []).map(pointOf)
  const last = points[points.length - 1]
  if (last && AXES.every((axis) => last[axis] === (point[axis] ?? null))) return points
  return [...points, pointOf(point)]
}

// ---- Continuation marks ----------------------------------------------------

// Where a route leaves a plan. For each pair of neighbouring points where one
// is shown on this plan and the other is hidden by the deck range, a mark sits
// at the shown point: a short stub toward the hidden one, labelled with the
// first plan (by name) of the same view that shows the hidden point. Points
// without a height are shown everywhere, so they never start a mark; neither
// does a point with no position in this plan's view (it cannot be drawn).
//   points  the route as 3D points
//   plan    the plan being drawn (needs a calibration)
//   plans   all plans that can be linked to
// Returns [{ index, at: [px, py], dir: [ux, uy], target: { id, name } | null }].
export function continuationMarks (points, plan, plans) {
  const cal = plan.calibration
  if (!cal) return []
  const marks = []
  const pxOf = (p) => pointToPx(cal, plan.view, p)
  const shown = (p) => planShowsPoint(plan, p) && pxOf(p) !== null
  const hidden = (p) => !planShowsPoint(plan, p)
  const others = plans
    .filter((p) => p.id !== plan.id && p.view === plan.view && p.calibration && p.status !== 'removed')
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const add = (index, neighbour) => {
    const a = points[index]
    const at = pxOf(a)
    const b = points[neighbour]
    const bPx = pxOf(b)
    let dir = [1, 0]
    if (bPx) {
      const dx = bPx[0] - at[0]
      const dy = bPx[1] - at[1]
      const len = Math.hypot(dx, dy)
      if (len > 0) dir = [dx / len, dy / len]
    }
    const target = others.find((p) => planShowsPoint(p, b) && pointToPx(p.calibration, p.view, b) !== null)
    marks.push({ index, at, dir, target: target ? { id: target.id, name: target.name } : null })
  }
  for (let i = 0; i < points.length; i++) {
    if (!shown(points[i])) continue
    if (i > 0 && hidden(points[i - 1])) add(i, i - 1)
    if (i < points.length - 1 && hidden(points[i + 1])) add(i, i + 1)
  }
  return marks
}

// ---- Keyboard --------------------------------------------------------------

// What Escape does on the floorplan, one step per press, innermost first.
// state: { tool, finishing, connectActive, waypointIndex, runId, conduitId, deviceId }
export function escapeStep (state) {
  if (state.finishing) return 'close-finish'
  if (state.tool === 'connect' && state.connectActive) return 'reset-connect'
  if (state.waypointIndex != null) return 'clear-waypoint'
  if (state.tool === 'route' && (state.runId || state.conduitId)) return 'clear-route-target'
  if (state.tool === 'select') return state.deviceId ? 'clear-device' : null
  return 'tool-select'
}

// What Delete does: the selected waypoint, else the selected device's placement.
// state: { waypointIndex, deviceId, devicePlaced }
export function deleteStep (state) {
  if (state.waypointIndex != null) return 'delete-waypoint'
  if (state.deviceId && state.devicePlaced) return 'clear-placement'
  return null
}
