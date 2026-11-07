import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js'
import { newId } from './ids.js'
import {
  calibrationFromClicks, parseSvgSize, pxToMeters, pointToPx, applyClick, waypointFromClick,
  moveWaypoint, removeWaypoint, routePoints, routeLength, circuitMembers, planShowsPoint,
  metersToLengthUnit
} from './floorplan.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'
const ROUTES_BASE = '/plugins/signalk-wiring'
const MIN_ZOOM_SPAN = 0.02 // smallest visible fraction of the drawing
const CLICK_SLOP_PX = 4

// Small local copies of app.js helpers; importing app.js from here would
// make the two modules import each other (same reasoning as loadSummary.js).
async function fetchPlans () {
  const res = await fetch(`${RESOURCE_BASE}/wiringPlans`)
  if (!res.ok) throw new Error(`failed to load plans: ${res.status}`)
  return Object.values(await res.json())
}

async function fetchList (type) {
  const res = await fetch(`${RESOURCE_BASE}/${type}`)
  if (!res.ok) throw new Error(`failed to load ${type}: ${res.status}`)
  return Object.values(await res.json())
}

async function putResource (type, id, value) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!res.ok) throw new Error(failureMessage(res.status))
}

async function putPlan (id, value) {
  const res = await fetch(`${RESOURCE_BASE}/wiringPlans/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!res.ok) throw new Error(failureMessage(res.status))
}

function failureMessage (status) {
  if (status === 401) return 'You need to be logged into the SignalK admin UI to do this.'
  return `Request failed (server responded ${status}).`
}

// Pixel size of a PNG/JPEG/WebP, read by letting the browser decode it.
function rasterSize (blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img.naturalWidth > 0 ? { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight } : null)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

function numberOrNull (text) {
  const n = parseFloat(text)
  return Number.isFinite(n) ? n : null
}

function NewPlanForm ({ onCreated, onError }) {
  const [name, setName] = useState('')
  const [view, setView] = useState('top')
  const [zMin, setZMin] = useState('')
  const [zMax, setZMax] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !file) return
    setBusy(true)
    onError(null)
    try {
      const id = newId()
      await putPlan(id, {
        name: name.trim(),
        view,
        zMin: view === 'top' ? numberOrNull(zMin) : null,
        zMax: view === 'top' ? numberOrNull(zMax) : null
      })
      const res = await fetch(`${ROUTES_BASE}/plans/${id}/image`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || failureMessage(res.status))
      }
      setName(''); setZMin(''); setZMax(''); setFile(null)
      onCreated(id)
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return html`
    <form class="form-box" onSubmit=${submit}>
      <h3>Add a plan</h3>
      <p class="meta">
        Upload the drawing as SVG, PNG, JPEG or WebP. SVG stays sharp when
        zoomed; a photo or scan works too. DXF and DWG files are not
        supported; export SVG from the CAD tool instead.
      </p>
      <label class="form-field"><span>Name</span>
<input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Main deck" /></label>
      <label class="form-field"><span>View</span>
<select value=${view} onChange=${(e) => setView(e.target.value)}>
          <option value="top">Top-down</option>
          <option value="side">Side</option>
        </select>
      </label>
      ${view === 'top' && html`
        <label class="form-field"><span>Lowest height shown (m, optional)</span>
<input type="number" step="any" value=${zMin} onInput=${(e) => setZMin(e.target.value)} />
        </label>
        <label class="form-field"><span>Highest height shown (m, optional)</span>
<input type="number" step="any" value=${zMax} onInput=${(e) => setZMax(e.target.value)} />
        </label>
      `}
      <label class="form-field"><span>Drawing file</span>
<input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange=${(e) => setFile(e.target.files[0] || null)} />
      </label>
      <button type="submit" disabled=${busy || !name.trim() || !file}>${busy ? 'Uploading…' : 'Add plan'}</button>
    </form>
  `
}

function devicePosition (device) {
  return { x: device.posX ?? null, y: device.posY ?? null, z: device.posZ ?? null }
}

// Pan (drag) and zoom (wheel, buttons) work by changing the SVG viewBox, so
// the drawing and everything overlaid on it share one coordinate space.
// Markers and routes are drawn in that space from the boat coordinates
// through the plan's calibration; edits convert back the same way.
function PlanViewer ({ plan, data, ctx, actions, onSaved, onError }) {
  const svgRef = useRef(null)
  const [size, setSize] = useState(null)
  const [sizeError, setSizeError] = useState(null)
  const [box, setBox] = useState(null)
  const [calibrating, setCalibrating] = useState(false)
  const [clicks, setClicks] = useState([])
  const [distance, setDistance] = useState('')
  const [flip, setFlip] = useState(false)
  const [ghost, setGhost] = useState(null) // a marker being dragged: { kind, key, px }
  const drag = useRef(null)

  const imageUrl = `${ROUTES_BASE}/plans/${plan.id}/image`
  const cal = plan.calibration

  useEffect(() => {
    let cancelled = false
    setSize(null); setSizeError(null); setBox(null)
    fetch(imageUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(failureMessage(res.status))
        if ((res.headers.get('Content-Type') || '').startsWith('image/svg')) {
          return parseSvgSize(await res.text())
        }
        return rasterSize(await res.blob())
      })
      .then((parsed) => {
        if (cancelled) return
        if (!parsed) {
          setSizeError('The size of the drawing could not be read. For SVG, re-export it with a viewBox or a width and height.')
          return
        }
        setSize(parsed)
        setBox({ ...parsed })
      })
      .catch((err) => { if (!cancelled) setSizeError(err.message) })
    return () => { cancelled = true }
  }, [imageUrl])

  if (sizeError) return html`<div class="error-banner">${sizeError}</div>`
  if (!size || !box) return html`<p class="meta">Loading drawing…</p>`

  const toDrawing = (e) => {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    return [p.x, p.y]
  }

  const zoomAt = (factor, center) => {
    const [cx, cy] = center || [box.x + box.width / 2, box.y + box.height / 2]
    const width = Math.min(size.width * 4, Math.max(size.width * MIN_ZOOM_SPAN, box.width * factor))
    const height = width * (size.height / size.width)
    setBox({
      width,
      height,
      x: cx - ((cx - box.x) / box.width) * width,
      y: cy - ((cy - box.y) / box.height) * height
    })
  }

  const metersAt = (e) => pxToMeters(cal, toDrawing(e))

  const onWheel = (e) => {
    e.preventDefault()
    zoomAt(e.deltaY < 0 ? 0.8 : 1.25, toDrawing(e))
  }

  const startDrag = (e, target) => {
    // Capture keeps a drag going outside the canvas; not every pointer supports it.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) { /* unsupported pointer */ }
    drag.current = {
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, target
    }
  }

  const onPointerDown = (e) => startDrag(e, null)

  // A marker takes the press itself so dragging it moves the marker, not the view.
  const onMarkerDown = (e, target) => {
    e.stopPropagation()
    if (calibrating) return
    startDrag(e, target)
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > CLICK_SLOP_PX) d.moved = true
    if (!d.moved) return
    if (d.target) {
      setGhost({ ...d.target, px: toDrawing(e) })
      return
    }
    const rect = svgRef.current.getBoundingClientRect()
    const scale = box.width / rect.width
    setBox({ ...box, x: box.x - (e.clientX - d.lastX) * scale, y: box.y - (e.clientY - d.lastY) * scale })
    d.lastX = e.clientX; d.lastY = e.clientY
  }

  const onPointerUp = (e) => {
    const d = drag.current
    drag.current = null
    setGhost(null)
    if (!d) return

    if (d.target) {
      if (d.moved) {
        const [a, b] = metersAt(e)
        if (d.target.kind === 'device') actions.moveDevice(d.target.key, plan.view, a, b)
        else actions.moveWaypoint(d.target.key, plan.view, a, b)
      } else if (d.target.kind === 'device') {
        actions.selectDevice(d.target.key)
      } else {
        actions.selectWaypoint(d.target.key)
      }
      return
    }

    if (d.moved) return
    if (calibrating) {
      if (clicks.length < 2) setClicks([...clicks, toDrawing(e)])
    } else if (!cal) {
      if (ctx.tool !== 'select') onError('Calibrate this plan first, so clicks can be turned into positions.')
    } else if (ctx.tool === 'place') {
      const [a, b] = metersAt(e)
      actions.placeDevice(plan.view, a, b)
    } else if (ctx.tool === 'route') {
      const [a, b] = metersAt(e)
      actions.addWaypoint(plan.view, a, b)
    } else {
      actions.clearSelection()
    }
  }

  const startCalibrating = () => { setCalibrating(true); setClicks([]); setDistance(''); onError(null) }
  const stopCalibrating = () => { setCalibrating(false); setClicks([]) }

  const saveCalibration = async () => {
    try {
      const calibration = calibrationFromClicks(clicks[0], clicks[1], parseFloat(distance), { flip })
      await putPlan(plan.id, { ...plan, calibration })
      stopCalibrating()
      onSaved()
    } catch (err) {
      onError(err.message)
    }
  }

  const unit = box.width / 90
  const distanceValid = parseFloat(distance) > 0
  const secondAxis = plan.view === 'side' ? 'height' : 'athwartships'

  // Where a marker is drawn: the dragged position while dragging, else the
  // stored one. Null when the point has no position in this view or lies
  // outside this deck plan's height range.
  const pxFor = (kind, key, point) => {
    if (ghost && ghost.kind === kind && ghost.key === key) return ghost.px
    if (!cal || !planShowsPoint(plan, point)) return null
    return pointToPx(cal, plan.view, point)
  }

  const members = ctx.members
  const runLines = []
  const waypointMarkers = []
  if (cal) {
    for (const run of data.wireRuns) {
      if (run.status === 'removed') continue
      const circuit = data.circuitsById.get(run.circuitId)
      const points = routePoints(run, circuit, data.devicesById)
      const isActive = run.id === ctx.runId
      const inCircuit = members && members.runIds.has(run.id)
      const pxs = points.map((p, i) => {
        const offset = points.length - (run.route || []).length
        const key = i - offset // index into the stored route; negative for the derived start
        return key >= 0 && isActive ? pxFor('waypoint', key, p) : (planShowsPoint(plan, p) ? pointToPx(cal, plan.view, p) : null)
      })
      const segments = []
      let current = []
      for (const px of pxs) {
        if (px) current.push(px)
        else { if (current.length > 1) segments.push(current); current = [] }
      }
      if (current.length > 1) segments.push(current)
      for (const seg of segments) {
        runLines.push({ id: run.id, active: isActive, highlighted: inCircuit, points: seg.map((p) => p.join(',')).join(' ') })
      }
      if (isActive) {
        const offset = points.length - (run.route || []).length
        points.slice(offset).forEach((p, i) => {
          const px = pxFor('waypoint', i, p)
          if (px) waypointMarkers.push({ index: i, px })
        })
      }
    }
  }

  return html`
    <div class="floorplan">
      <h3>${plan.name} <span class="meta">(${plan.view === 'top' ? 'top-down' : 'side'})</span></h3>
      <div class="row-actions">
        <button onClick=${() => zoomAt(0.8)}>Zoom in</button>
        <button onClick=${() => zoomAt(1.25)}>Zoom out</button>
        <button onClick=${() => setBox({ ...size })}>Fit</button>
        ${!calibrating
          ? html`<button onClick=${startCalibrating}>${cal ? 'Recalibrate' : 'Calibrate'}</button>`
          : html`<button onClick=${stopCalibrating}>Cancel calibration</button>`}
      </div>

      ${!cal && !calibrating && html`
        <p class="meta">Not calibrated yet. Calibrate to give the drawing a real-world scale.</p>
      `}
      ${cal && !calibrating && html`
        <p class="meta">Scale: ${cal.pxPerMeter.toFixed(2)} drawing units per meter.</p>
      `}

      ${calibrating && html`
        <div class="calibrate-help">
          ${clicks.length === 0 && html`<p>1. Click the origin (for example the transom centerline, at your chosen height).</p>`}
          ${clicks.length === 1 && html`<p>2. Click a second point along the boat's length axis (bow to stern), far from the origin.</p>`}
          ${clicks.length === 2 && html`
            <p>3. Enter the real distance between the two points.</p>
            <label class="form-field"><span>Distance (m)</span>
              <input type="number" step="any" min="0" value=${distance} onInput=${(e) => setDistance(e.target.value)} />
            </label>
            <label class="inline">
              <input type="checkbox" checked=${flip} onChange=${(e) => setFlip(e.target.checked)} />
              Reverse the ${secondAxis} axis
            </label>
            <div class="row-actions">
              <button disabled=${!distanceValid} onClick=${saveCalibration}>Save calibration</button>
              <button onClick=${() => setClicks([])}>Redo clicks</button>
            </div>
          `}
        </div>
      `}

      <svg ref=${svgRef} class="floorplan-canvas ${calibrating || ctx.tool !== 'select' ? 'crosshair' : ''}"
        viewBox="${box.x} ${box.y} ${box.width} ${box.height}"
        onWheel=${onWheel} onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
        onPointerUp=${onPointerUp} onPointerCancel=${() => { drag.current = null; setGhost(null) }}>
        <image href=${imageUrl} x=${size.x} y=${size.y} width=${size.width} height=${size.height} />

        ${runLines.map((l, i) => html`
          <polyline key=${l.id + ':' + i} points=${l.points} fill="none"
            class="run-line ${l.active ? 'active' : ''} ${l.highlighted ? 'highlighted' : ''}"
            stroke-width=${unit * (l.active ? 0.9 : 0.5)} />
        `)}

        ${waypointMarkers.map((w) => html`
          <rect key=${'w' + w.index} x=${w.px[0] - unit} y=${w.px[1] - unit} width=${unit * 2} height=${unit * 2}
            class="waypoint ${ctx.waypointIndex === w.index ? 'selected' : ''}"
            onPointerDown=${(e) => onMarkerDown(e, { kind: 'waypoint', key: w.index })} />
        `)}

        ${cal && data.devices.map((device) => {
          if (device.status === 'removed') return null
          const px = pxFor('device', device.id, devicePosition(device))
          if (!px) return null
          const lit = ctx.deviceId === device.id || (members && members.deviceIds.has(device.id))
          return html`
            <g key=${device.id} class="device-marker role-${device.role || 'consumer'} ${lit ? 'highlighted' : ''}"
              onPointerDown=${(e) => onMarkerDown(e, { kind: 'device', key: device.id })}>
              <circle cx=${px[0]} cy=${px[1]} r=${unit * 1.3} />
              <text x=${px[0] + unit * 1.8} y=${px[1] + unit * 0.6} font-size=${unit * 1.9}>${device.name}</text>
            </g>
          `
        })}

        ${clicks.length === 2 && html`
          <line x1=${clicks[0][0]} y1=${clicks[0][1]} x2=${clicks[1][0]} y2=${clicks[1][1]}
            class="calibration-line" stroke-width=${unit / 2} />
        `}
        ${clicks.map(([x, y], i) => html`
          <circle key=${'c' + i} cx=${x} cy=${y} r=${unit} class="calibration-point" />
        `)}
      </svg>
    </div>
  `
}

function Select ({ label, value, onChange, options }) {
  return html`
    <label class="form-field compact"><span>${label}</span>
      <select value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>
        <option value="">None</option>
        ${options.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
      </select>
    </label>
  `
}

function useFloorplanData (reloadKey, onError) {
  const [state, setState] = useState({ loading: true, plans: [], devices: [], circuits: [], wireRuns: [] })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchList('wiringPlans'), fetchList('wiringDevices'),
      fetchList('wiringCircuits'), fetchList('wiringWireRuns')
    ])
      .then(([plans, devices, circuits, wireRuns]) => {
        if (!cancelled) setState({ loading: false, plans, devices, circuits, wireRuns })
      })
      .catch((err) => { if (!cancelled) { setState((s) => ({ ...s, loading: false })); onError(err.message) } })
    return () => { cancelled = true }
  }, [reloadKey])

  return state
}

export function FloorplanTab () {
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)
  const { loading, plans, devices, circuits, wireRuns } = useFloorplanData(reloadKey, setError)

  const [topId, setTopId] = useState(null)
  const [sideId, setSideId] = useState(null)
  const [tool, setTool] = useState('select')
  const [circuitId, setCircuitId] = useState(null)
  const [deviceId, setDeviceId] = useState(null)
  const [runId, setRunId] = useState(null)
  const [waypointIndex, setWaypointIndex] = useState(null)

  const active = plans.filter((p) => p.status !== 'removed' && p.filename)
  const topPlans = active.filter((p) => p.view === 'top')
  const sidePlans = active.filter((p) => p.view === 'side')
  const topPlan = topPlans.find((p) => p.id === topId) || topPlans[0] || null
  const sidePlan = sidePlans.find((p) => p.id === sideId) || sidePlans[0] || null

  const liveDevices = devices.filter((d) => d.status !== 'removed')
  const liveRuns = wireRuns.filter((r) => r.status !== 'removed')
  const devicesById = new Map(devices.map((d) => [d.id, d]))
  const circuitsById = new Map(circuits.map((c) => [c.id, c]))
  const circuit = circuitId ? circuitsById.get(circuitId) : null
  const run = runId ? wireRuns.find((r) => r.id === runId) : null
  const members = circuit ? circuitMembers(circuit, wireRuns) : null
  const data = { devices, wireRuns, devicesById, circuitsById }

  const guard = async (fn) => {
    setError(null)
    try { await fn(); reload() } catch (err) { setError(err.message) }
  }

  const saveDevicePosition = (device, view, a, b) => guard(() => {
    const pos = applyClick(devicePosition(device), view, a, b)
    return putResource('wiringDevices', device.id, { ...device, posX: pos.x, posY: pos.y, posZ: pos.z })
  })

  const saveRoute = (route) => guard(() => putResource('wiringWireRuns', run.id, { ...run, route }))

  // The previous point for axis inheritance: the last waypoint, else the
  // resolved start of the route.
  const lastPoint = () => {
    const points = routePoints(run, circuitsById.get(run.circuitId), devicesById)
    return points.length ? points[points.length - 1] : null
  }

  const actions = {
    placeDevice: (view, a, b) => {
      const device = devicesById.get(deviceId)
      if (!device) { setError('Choose a device to place first.'); return }
      saveDevicePosition(device, view, a, b)
    },
    moveDevice: (id, view, a, b) => saveDevicePosition(devicesById.get(id), view, a, b),
    addWaypoint: (view, a, b) => {
      if (!run) { setError('Choose a wire run to draw first.'); return }
      saveRoute([...(run.route || []), waypointFromClick(lastPoint(), view, a, b)])
      setWaypointIndex(null)
    },
    moveWaypoint: (index, view, a, b) => saveRoute(moveWaypoint(run.route || [], index, view, a, b)),
    selectDevice: (id) => { setDeviceId(id); setError(null) },
    selectWaypoint: (index) => setWaypointIndex(index),
    clearSelection: () => { setDeviceId(null); setWaypointIndex(null) }
  }

  const ctx = { tool, deviceId, runId, members, waypointIndex }

  const deleteWaypoint = () => {
    saveRoute(removeWaypoint(run.route || [], waypointIndex))
    setWaypointIndex(null)
  }
  const undoLast = () => saveRoute(removeWaypoint(run.route || [], (run.route || []).length - 1))

  const measured = run ? routeLength(routePoints(run, circuitsById.get(run.circuitId), devicesById)) : null
  const useMeasured = () => guard(() => putResource('wiringWireRuns', run.id, {
    ...run,
    length: metersToLengthUnit(measured.length, run.lengthUnit),
    lengthUnit: run.lengthUnit || 'm'
  }))

  const setPanel = (panelId) => guard(() =>
    putResource('wiringCircuits', circuit.id, { ...circuit, panelDeviceId: panelId }))

  const circuitOptions = circuits.filter((c) => c.status !== 'removed').map((c) => ({ value: c.id, label: c.name }))
  const deviceOptions = liveDevices.map((d) => ({
    value: d.id,
    label: d.name + (d.posX != null || d.posY != null || d.posZ != null ? '' : ' (not placed)')
  }))
  const runOptions = liveRuns
    .filter((r) => !circuitId || r.circuitId === circuitId)
    .map((r) => ({ value: r.id, label: `${circuitsById.get(r.circuitId)?.name || '?'}: ${r.fromEndpoint} to ${r.toEndpoint}` }))

  const planButtons = (list, selectedPlan, setId) => list.length > 1 && html`
    <div class="row-actions">
      ${list.map((p) => html`
        <button key=${p.id} class=${selectedPlan && selectedPlan.id === p.id ? 'active' : ''}
          onClick=${() => { setId(p.id); setError(null) }}>${p.name}</button>
      `)}
    </div>
  `

  return html`
    <div>
      ${error && html`<div class="error-banner">${error}</div>`}
      ${loading && html`<p class="meta">Loading…</p>`}
      ${!loading && active.length === 0 && html`<p class="meta">No plans yet. Add one below.</p>`}

      ${active.length > 0 && html`
        <div class="floorplan-toolbar">
          <div class="row-actions">
            ${[['select', 'Select'], ['place', 'Place device'], ['route', 'Draw route']].map(([id, label]) => html`
              <button key=${id} class=${tool === id ? 'active' : ''} onClick=${() => { setTool(id); setError(null) }}>${label}</button>
            `)}
          </div>
          <div class="toolbar-fields">
            <${Select} label="Highlight circuit" value=${circuitId} options=${circuitOptions}
              onChange=${(v) => { setCircuitId(v); setRunId(null); setWaypointIndex(null) }} />
            ${tool === 'place' && html`
              <${Select} label="Device to place" value=${deviceId} options=${deviceOptions} onChange=${setDeviceId} />
            `}
            ${tool !== 'place' && html`
              <${Select} label="Wire run" value=${runId} options=${runOptions}
                onChange=${(v) => { setRunId(v); setWaypointIndex(null) }} />
            `}
            ${circuit && html`
              <${Select} label="Panel device for this circuit" value=${circuit.panelDeviceId} options=${deviceOptions}
                onChange=${setPanel} />
            `}
          </div>
          ${tool === 'place' && html`<p class="meta">Choose a device, then click a calibrated plan to place it. A click in one view sets only the two axes it shows. Drag a marker in Select mode to adjust it.</p>`}
          ${tool === 'route' && html`<p class="meta">Choose a wire run, then click to add waypoints. The route starts at the run's from-device, else the circuit's panel device. Drag a waypoint to adjust it, or click it to select it for deletion.</p>`}
          ${run && html`
            <div class="route-info">
              <span>Measured route: <strong>${measured.length.toFixed(2)} m</strong>${measured.complete ? '' : ' (incomplete, some heights unset)'}</span>
              <span>Recorded length: ${run.length != null ? `${run.length} ${run.lengthUnit || ''}` : 'none'}</span>
              <div class="row-actions">
                <button disabled=${measured.length === 0} onClick=${useMeasured}>Use measured length</button>
                <button disabled=${!(run.route || []).length} onClick=${undoLast}>Undo last point</button>
                <button disabled=${waypointIndex === null} onClick=${deleteWaypoint}>Delete selected point</button>
              </div>
            </div>
          `}
        </div>

        ${planButtons(topPlans, topPlan, setTopId)}
        ${planButtons(sidePlans, sidePlan, setSideId)}

        <div class="floorplan-pair">
          ${topPlan && html`<${PlanViewer} key=${topPlan.id} plan=${topPlan} data=${data} ctx=${ctx}
            actions=${actions} onSaved=${reload} onError=${setError} />`}
          ${sidePlan && html`<${PlanViewer} key=${sidePlan.id} plan=${sidePlan} data=${data} ctx=${ctx}
            actions=${actions} onSaved=${reload} onError=${setError} />`}
        </div>
      `}

      <${NewPlanForm} onCreated=${(id) => {
        const created = { id }
        setTopId(id); setSideId(id); reload(); return created
      }} onError=${setError} />
    </div>
  `
}
