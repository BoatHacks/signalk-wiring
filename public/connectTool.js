// The floorplan connect tool (plan 0016) as a small state machine, kept free
// of the DOM so it can be tested. The user picks the From device (supply
// side), then the To device (load side), then clicks route waypoints on the
// plan, then finishes. Finishing straight away gives a cable with no route.
//
//   state: { stage: 'from' | 'to' | 'route', fromId, toId, waypoints }

export function initialConnect () {
  return { stage: 'from', fromId: null, toId: null, waypoints: [] }
}

// A click (or a pick from a list) on a device. In the From stage it sets the
// From device; in the To stage it sets the To device, which must differ.
// In the route stage a device click changes nothing: waypoints are plan clicks.
export function connectPickDevice (state, deviceId) {
  if (!deviceId) return state
  if (state.stage === 'from') return { ...state, stage: 'to', fromId: deviceId }
  if (state.stage === 'to') {
    if (deviceId === state.fromId) return state
    return { ...state, stage: 'route', toId: deviceId, waypoints: [] }
  }
  return state
}

export function connectAddWaypoint (state, point) {
  if (state.stage !== 'route') return state
  return { ...state, waypoints: [...state.waypoints, point] }
}

// Back one step: the last waypoint, else the To device, else the From device.
export function connectUndo (state) {
  if (state.stage === 'route') {
    if (state.waypoints.length > 0) return { ...state, waypoints: state.waypoints.slice(0, -1) }
    return { ...state, stage: 'to', toId: null }
  }
  if (state.stage === 'to') return initialConnect()
  return state
}

export function connectCanFinish (state) {
  return state.stage === 'route' && !!state.fromId && !!state.toId && state.fromId !== state.toId
}

// The instruction for the current stage.
export function connectHint (state, names = {}) {
  if (state.stage === 'from') return 'Click the From device (the supply side).'
  if (state.stage === 'to') return `From: ${names[state.fromId] || '?'}. Click the To device (the load side).`
  const n = state.waypoints.length
  return `From ${names[state.fromId] || '?'} to ${names[state.toId] || '?'}. Click the plan to add route waypoints` +
    `${n ? ` (${n} so far)` : ''}, then Finish. Finish at once for a cable with no drawn route.`
}

// The fields the finished connection adds to the cable payload: the drawn
// route (waypoints only; the start follows the From device) and its measured
// length in the cable's unit. No waypoints means no route and no length.
// `measure(waypoints)` returns the length in meters, or null when unknown.
export function connectionFields (state, lengthUnit, measure, toUnit) {
  if (state.waypoints.length === 0) return {}
  const meters = measure(state.waypoints)
  const out = { route: state.waypoints }
  if (meters != null && meters > 0) {
    out.length = toUnit(meters, lengthUnit)
    out.lengthUnit = lengthUnit || 'm'
  }
  return out
}
