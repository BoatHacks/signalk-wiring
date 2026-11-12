import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js'
import { newId } from './ids.js'
import { deviceIconUrl } from './deviceIcons.js'
import {
  calibrationFromClicks, parseSvgSize, pxToMeters, pointToPx, applyClick, waypointFromClick,
  moveWaypoint, removeWaypoint, routePoints, routeLength, circuitMembers, planShowsPoint,
  metersToLengthUnit, lengthDirection, metersToPx, arrowHeadPoints, conduitRoutePoints, unroutedCables,
  conduitMembers, effectiveCableRoute, cornerArrows, routeEndAction, routeWithEnd, continuationMarks,
  escapeStep, deleteStep
} from './floorplan.js'
import { hashForState } from './router.js'
import { isTypingTarget, wireLineStyle, scaledDash, isDoubleTap, deviceHash } from './schematic.js'
import { useUndo } from './undoBar.js'
import { offerCableUndo } from './canvasRemoval.js'
import { cableName } from './conduits.js'
import {
  initialConnect, connectPickDevice, connectAddWaypoint, connectUndo, connectCanFinish, connectHint, connectionFields
} from './connectTool.js'
import { startValues } from './quickCable.js'
import { CablePopover } from './cablePopover.js'
import { useSettings, wireRunInitialValues } from './settings.js'
import { useLive } from './live.js'
import { LiveLock, LiveReading, LiveBar } from './liveMarks.js'
import { visibleLabels, labelWidth, labelSide } from './floorLabels.js'
import { clusterMarkers, clusterRadius } from './floorCluster.js'
import { placementBlock, isInside, childrenOf, contentsOf } from './enclosures.js'

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

// A refused write (400) says why in its body, for example a cable that mixes
// AC and DC; anything else keeps the generic text.
async function refusalMessage (res, fallback) {
  if (res.status !== 400 || typeof res.json !== 'function') return fallback
  try {
    const body = await res.json()
    return body && typeof body.message === 'string' && body.message ? body.message : fallback
  } catch (_) {
    return fallback
  }
}

async function putResource (type, id, value) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!res.ok) throw new Error(await refusalMessage(res, failureMessage(res.status)))
}

async function deleteResource (type, id) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, { method: 'DELETE' })
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

// A wire run or conduit as fetched also lists its assignments. Writing a
// whole record back must not carry that list along: it could be stale and
// would replace what the conduit page saved in the meantime.
function withoutAssignments (record) {
  const { conduitIds, cableIds, ...rest } = record
  return rest
}

// Splits a list of drawing points (null where a point is hidden or has no
// position in this view) into the runs of consecutive visible points that
// can be drawn as lines.
function visibleSegments (pxs) {
  const segments = []
  let current = []
  for (const px of pxs) {
    if (px) current.push(px)
    else { if (current.length > 1) segments.push(current); current = [] }
  }
  if (current.length > 1) segments.push(current)
  return segments
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

function isPlaced (device) {
  return device.posX != null || device.posY != null || device.posZ != null
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
  const lastTap = useRef(null) // the last tap on a device marker, for the double tap
  const [hoverId, setHoverId] = useState(null) // the device marker under the pointer
  const [openCluster, setOpenCluster] = useState(null) // the cluster whose device list is open: { id, ids, px }
  const [viewPx, setViewPx] = useState({ width: 900, height: 400 }) // the canvas on screen, for clusters
  const ready = !!size
  useEffect(() => {
    const measure = () => {
      const r = svgRef.current && svgRef.current.getBoundingClientRect()
      if (r && r.width > 0 && r.height > 0) setViewPx((v) => (v.width === r.width && v.height === r.height ? v : { width: r.width, height: r.height }))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ready])

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

  const onPointerDown = (e) => { setOpenCluster(null); startDrag(e, null) }

  // A marker takes the press itself so dragging it moves the marker, not the view.
  const onMarkerDown = (e, target) => {
    e.stopPropagation()
    if (calibrating) return
    if (ctx.tool === 'connect') {
      if (target.kind === 'device') actions.connectDevice(target.key)
      return
    }
    if (ctx.tool === 'live') {
      if (target.kind === 'device') actions.liveToggle(target.key)
      return
    }
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
        const tap = { id: d.target.key, t: Date.now(), x: e.clientX, y: e.clientY }
        if (ctx.tool === 'select' && isDoubleTap(lastTap.current, tap)) { lastTap.current = null; window.location.hash = deviceHash(d.target.key); return }
        lastTap.current = tap
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
    } else if (ctx.tool === 'connect') {
      const [a, b] = metersAt(e)
      actions.connectWaypoint(plan.view, a, b)
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
  const labelIds = visibleLabels(data.devices, { hoverId, selectedId: ctx.deviceId, members, run: ctx.run })
  const runLines = []
  const waypointMarkers = []
  // Where a route leaves this plan, a stub with a link to the plan it continues on.
  const continuations = []
  const addContinuations = (ownerId, points) => {
    for (const m of continuationMarks(points, plan, data.plans || [])) {
      continuations.push({ ...m, key: `${ownerId}:${m.index}:${m.dir.join(',')}` })
    }
  }
  if (cal) {
    for (const run of data.wireRuns) {
      if (run.status === 'removed') continue
      const circuit = null
      // A cable with no route of its own follows its conduits; those points
      // are the conduits' and cannot be edited as waypoints here.
      const effective = effectiveCableRoute(run, circuit, data.devicesById, data.conduitsById)
      const points = effective.points
      const ownRoute = effective.source === 'own'
      const isActive = run.id === ctx.runId
      const inCircuit = members && members.runIds.has(run.id)
      const pxs = points.map((p, i) => {
        const offset = points.length - (run.route || []).length
        const key = i - offset // index into the stored route; negative for the derived start
        return ownRoute && key >= 0 && isActive ? pxFor('waypoint', key, p) : (planShowsPoint(plan, p) ? pointToPx(cal, plan.view, p) : null)
      })
      for (const seg of visibleSegments(pxs)) {
        runLines.push({ id: run.id, dash: wireLineStyle(run).dasharray, active: isActive, highlighted: inCircuit, points: seg.map((p) => p.join(',')).join(' ') })
      }
      addContinuations(run.id, points)
      if (isActive && ownRoute) {
        const offset = points.length - (run.route || []).length
        points.slice(offset).forEach((p, i) => {
          const px = pxFor('waypoint', i, p)
          if (px) waypointMarkers.push({ index: i, px })
        })
      }
    }
  }

  // The connection being drawn: from the From device through its waypoints.
  const connectLines = []
  if (cal && ctx.connectPoints) {
    const pxs = ctx.connectPoints.map((p) => (planShowsPoint(plan, p) ? pointToPx(cal, plan.view, p) : null))
    for (const seg of visibleSegments(pxs)) connectLines.push(seg.map((p) => p.join(',')).join(' '))
    ctx.connectPoints.slice(ctx.connectStartCount).forEach((p, i) => {
      const px = planShowsPoint(plan, p) ? pointToPx(cal, plan.view, p) : null
      if (px) waypointMarkers.push({ index: 1000 + i, px })
    })
  }

  // Conduits are drawn under the cables, thicker, so cables along them show on top.
  const conduitLines = []
  if (cal) {
    for (const conduit of data.conduits) {
      if (conduit.status === 'removed') continue
      const isActive = conduit.id === ctx.conduitId
      const points = conduitRoutePoints(conduit)
      const pxs = points.map((p, i) => (isActive
        ? pxFor('waypoint', i, p)
        : (planShowsPoint(plan, p) ? pointToPx(cal, plan.view, p) : null)))
      for (const seg of visibleSegments(pxs)) {
        conduitLines.push({ id: conduit.id, active: isActive, points: seg.map((p) => p.join(',')).join(' ') })
      }
      addContinuations(conduit.id, points)
      if (isActive) {
        points.forEach((p, i) => {
          const px = pxFor('waypoint', i, p)
          if (px) waypointMarkers.push({ index: i, px })
        })
      }
    }
  }

  // Placed markers, and which of them collapse into numbered clusters. The
  // distance is measured on screen, so zooming in splits a cluster. Only the
  // Select tool clusters: the other tools need to reach every device.
  const deviceMarks = []
  if (cal) {
    for (const device of data.devices) {
      // A device inside an enclosure is shown by the enclosure's marker.
      if (device.status === 'removed' || isInside(device)) continue
      const px = pxFor('device', device.id, devicePosition(device))
      if (!px) continue
      const lit = ctx.deviceId === device.id || (members && members.deviceIds.has(device.id)) ||
        (ctx.run && (ctx.run.fromDeviceId === device.id || ctx.run.toDeviceId === device.id)) ||
        (ctx.connect && (ctx.connect.fromId === device.id || ctx.connect.toId === device.id))
      deviceMarks.push({ device, px, lit: !!lit })
    }
  }
  const pxPerUnit = Math.min(viewPx.width / box.width, viewPx.height / box.height)
  const clusterSet = ctx.tool === 'select' && !calibrating
    ? clusterMarkers(
      deviceMarks.map(({ device, px, lit }) => ({
        id: device.id, x: px[0] * pxPerUnit, y: px[1] * pxPerUnit,
        pinned: lit || (ghost && ghost.kind === 'device' && ghost.key === device.id)
      })),
      clusterRadius(unit * 2.6 * pxPerUnit)
    )
    : { clusters: [], singles: [] }
  const clustered = new Set(clusterSet.clusters.flatMap((c) => c.ids))

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
        <button onClick=${() => actions.removePlan(plan)}>Remove plan</button>
      </div>

      ${!cal && !calibrating && html`
        <p class="meta">Not calibrated yet. Calibrate to give the drawing a real-world scale.</p>
      `}
      ${cal && !calibrating && html`
        <p class="meta">Scale: ${cal.pxPerMeter.toFixed(2)} drawing units per meter. The bow is toward the ${lengthDirection(cal)} of this drawing. If that is wrong, or differs from your other plans, recalibrate.</p>
      `}

      ${calibrating && html`
        <div class="calibrate-help">
          ${clicks.length === 0 && html`<p>1. Click the origin: the stern end of the boat (x = 0), for example the transom centerline, at your chosen height. Use the same origin on every plan.</p>`}
          ${clicks.length === 1 && html`<p>2. Click a second point toward the bow, far from the origin. Distances along the boat increase toward the bow, on every plan.</p>`}
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

      <div class="floorplan-canvas-wrap">
      <svg ref=${svgRef} class="floorplan-canvas ${calibrating || ctx.tool !== 'select' ? 'crosshair' : ''}"
        viewBox="${box.x} ${box.y} ${box.width} ${box.height}"
        onWheel=${onWheel} onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
        onPointerUp=${onPointerUp} onPointerCancel=${() => { drag.current = null; setGhost(null) }}>
        <image href=${imageUrl} x=${size.x} y=${size.y} width=${size.width} height=${size.height} />

        ${conduitLines.map((l, i) => html`
          <polyline key=${'k' + l.id + ':' + i} points=${l.points} fill="none"
            class="conduit-line ${l.active ? 'active' : ''}" stroke-width=${unit * (l.active ? 2 : 1.6)} />
        `)}

        ${runLines.map((l, i) => html`
          <polyline key=${l.id + ':' + i} points=${l.points} fill="none"
            class="run-line ${l.active ? 'active' : ''} ${l.highlighted ? 'highlighted' : ''}"
            stroke-width=${unit * (l.active ? 0.9 : 0.5)}
            stroke-dasharray=${scaledDash(l.dash, unit * (l.active ? 0.9 : 0.5) / 3) || undefined} />
        `)}

        ${connectLines.map((points, i) => html`
          <polyline key=${'cn' + i} points=${points} fill="none" class="run-line active connecting" stroke-width=${unit * 0.9} />
        `)}

        ${waypointMarkers.map((w) => html`
          <rect key=${'w' + w.index} x=${w.px[0] - unit} y=${w.px[1] - unit} width=${unit * 2} height=${unit * 2}
            class="waypoint ${ctx.waypointIndex === w.index ? 'selected' : ''}"
            onPointerDown=${(e) => onMarkerDown(e, { kind: 'waypoint', key: w.index })} />
        `)}

        ${deviceMarks.map(({ device, px, lit }) => {
          if (clustered.has(device.id)) return null
          const liveState = ctx.live ? ctx.live.info(device.id) : null
          return html`
            <g key=${device.id} class="device-marker role-${device.role || 'consumer'} ${lit ? 'highlighted' : ''} ${liveState ? 'live-' + liveState.look + (liveState.clickable ? ' live-clickable' : '') : ctx.live ? 'live-none' : ''}"
              data-live=${liveState ? liveState.look : undefined}
              onPointerEnter=${() => setHoverId(device.id)} onPointerLeave=${() => setHoverId((h) => (h === device.id ? null : h))}
              onPointerDown=${(e) => onMarkerDown(e, { kind: 'device', key: device.id })}>
              ${liveState && html`<title>${liveState.title}</title>`}
              ${device.role === 'enclosure'
                ? html`<rect class="enclosure-box" x=${px[0] - unit * 1.5} y=${px[1] - unit * 1.5} width=${unit * 3} height=${unit * 3} rx=${unit * 0.5} />`
                : html`<circle cx=${px[0]} cy=${px[1]} r=${unit * 1.3} />`}
              ${device.role === 'enclosure' && html`
                <text class="enclosure-count" data-testid="enclosure-count" x=${px[0]} y=${px[1] + unit * 0.7} font-size=${unit * 2} text-anchor="middle">${contentsOf(data.devices, device.id).length}</text>
                <title>${device.name}: holds ${contentsOf(data.devices, device.id).length}</title>
              `}
              ${deviceIconUrl(device) && html`
                <image href=${deviceIconUrl(device)} x=${px[0] - unit * 1.1} y=${px[1] - unit * 1.1}
                  width=${unit * 2.2} height=${unit * 2.2} preserveAspectRatio="xMidYMid slice"
                  clip-path="circle(50%)" style="pointer-events: none" />
              `}
              ${labelIds.has(device.id) && (() => {
                // 75 percent of the former size, with a halo of a fifth of the font size
                const fontSize = unit * 1.43
                const left = labelSide(px, labelWidth(device.name, fontSize), unit * 1.8, box) === 'left'
                return html`<text class="device-label" data-testid="device-label" x=${px[0] + (left ? -unit * 1.8 : unit * 1.8)} y=${px[1] + unit * 0.5}
                  text-anchor=${left ? 'end' : 'start'} font-size=${fontSize} stroke-width=${fontSize / 5}>${device.name}</text>`
              })()}
              ${liveState && liveState.look === 'locked' && html`<${LiveLock} x=${px[0]} y=${px[1]} size=${unit * 1.9} />`}
              ${liveState && html`<${LiveReading} x=${px[0]} y=${px[1] + unit * 3.2} size=${unit * 1.5} text=${liveState.reading} />`}
            </g>
          `
        })}

        ${clusterSet.clusters.map((c) => {
          const cx = c.x / pxPerUnit
          const cy = c.y / pxPerUnit
          return html`
            <g key=${c.id} class="device-marker cluster-marker ${openCluster && openCluster.id === c.id ? 'open' : ''}" data-testid="cluster-marker"
              onPointerDown=${(e) => e.stopPropagation()}
              onClick=${() => setOpenCluster(openCluster && openCluster.id === c.id ? null : { id: c.id, ids: c.ids, px: [cx, cy] })}>
              <rect class="cluster-box" x=${cx - unit * 1.5} y=${cy - unit * 1.5} width=${unit * 3} height=${unit * 3} rx=${unit * 1.5} />
              <text class="cluster-count" data-testid="cluster-count" x=${cx} y=${cy + unit * 0.7} font-size=${unit * 2} text-anchor="middle">${c.ids.length}</text>
              <title>${c.ids.length} devices, click to list them</title>
            </g>
          `
        })}

        ${continuations.map((m) => {
          const end = [m.at[0] + m.dir[0] * unit * 5, m.at[1] + m.dir[1] * unit * 5]
          const head = arrowHeadPoints(m.at, end, unit * 1.6).map((p) => p.join(',')).join(' ')
          const left = m.dir[0] < 0
          const label = m.target ? `continues on ${m.target.name}` : 'continues, not shown on any plan'
          const text = html`<text x=${end[0] + (left ? -unit * 0.6 : unit * 0.6)} y=${end[1] + unit * 0.5}
            text-anchor=${left ? 'end' : 'start'} font-size=${unit * 1.6} class="continuation-label">${label}</text>`
          return html`
            <g key=${m.key} class="continuation" data-testid="continuation" onPointerDown=${(e) => e.stopPropagation()}>
              <line x1=${m.at[0]} y1=${m.at[1]} x2=${end[0]} y2=${end[1]} stroke-width=${unit * 0.4} />
              <polygon points=${head} />
              ${m.target
                ? html`<a href=${hashForState({ tab: 'floorplan', id: m.target.id })} data-testid="continuation-link"
                    onClick=${(e) => { e.preventDefault(); actions.goToPlan(m.target.id) }}>${text}</a>`
                : text}
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
      ${openCluster && html`
        <div class="cluster-list" data-testid="cluster-list"
          style=${{ left: ((openCluster.px[0] - box.x) / box.width * 100) + '%', top: ((openCluster.px[1] - box.y) / box.height * 100) + '%' }}>
          <strong>${openCluster.ids.length} devices here</strong>
          <ul>
            ${openCluster.ids.map((id) => html`
              <li key=${id}><a href=${hashForState({ tab: 'devices', id })} data-testid="cluster-device-link">${(data.devicesById.get(id) || {}).name || id}</a></li>
            `)}
          </ul>
          <button onClick=${() => setOpenCluster(null)}>Close</button>
        </div>
      `}
      ${cal && !calibrating && (() => {
        const arrows = cornerArrows(cal, 18)
        const poly = (a) => a.head.map((p) => p.join(',')).join(' ')
        const labelAt = (a) => [a.to[0] * 1.5, a.to[1] * 1.5 + 2.5]
        const bow = labelAt(arrows.bow)
        const up = labelAt(arrows.up)
        return html`
          <svg class="axis-corner" viewBox="-36 -36 72 72" data-testid="axis-corner">
            <line x1="0" y1="0" x2=${arrows.bow.to[0]} y2=${arrows.bow.to[1]} stroke-width="2" />
            <polygon points=${poly(arrows.bow)}><title>Toward the bow</title></polygon>
            <line x1="0" y1="0" x2=${arrows.up.to[0]} y2=${arrows.up.to[1]} stroke-width="2" />
            <polygon points=${poly(arrows.up)}><title>${plan.view === 'top' ? 'Positive y' : 'Up'}</title></polygon>
            <circle cx="0" cy="0" r="3" />
            <text x=${bow[0]} y=${bow[1]} text-anchor="middle">bow</text>
            <text x=${up[0]} y=${up[1]} text-anchor="middle">${plan.view === 'top' ? '+y' : 'up'}</text>
          </svg>
        `
      })()}
      </div>
    </div>
  `
}

function Select({ label, value, onChange, options }) {
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
  const [state, setState] = useState({ loading: true, plans: [], devices: [], circuits: [], wireRuns: [], conduits: [] })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchList('wiringPlans'), fetchList('wiringDevices'),
      fetchList('wiringCircuits'), fetchList('wiringWireRuns'), fetchList('wiringConduits')
    ])
      .then(([plans, devices, circuits, wireRuns, conduits]) => {
        if (!cancelled) setState({ loading: false, plans, devices, circuits, wireRuns, conduits })
      })
      .catch((err) => { if (!cancelled) { setState((s) => ({ ...s, loading: false })); onError(err.message) } })
    return () => { cancelled = true }
  }, [reloadKey])

  return state
}

export function FloorplanTab ({ renderCableForm, planId = null, onPlanChange = () => {}, onNotFound = () => {} }) {
  const settings = useSettings()
  const [error, setError] = useState(null)
  const [connect, setConnect] = useState(initialConnect)
  const [finishing, setFinishing] = useState(null) // null | { more: values | null }
  const [notice, setNotice] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)
  const { loading, plans, devices, circuits, wireRuns, conduits } = useFloorplanData(reloadKey, setError)

  const [topId, setTopId] = useState(null)
  const [sideId, setSideId] = useState(null)
  const [tool, setTool] = useState('select')
  const [circuitId, setCircuitId] = useState(null)
  const [deviceId, setDeviceId] = useState(null)
  const [runId, setRunId] = useState(null)
  const [conduitId, setConduitId] = useState(null)
  const [waypointIndex, setWaypointIndex] = useState(null)
  const [hint, setHint] = useState(null) // a short hint in the route panel
  const undo = useUndo()
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const active = plans.filter((p) => p.status !== 'removed' && p.filename)
  const topPlans = active.filter((p) => p.view === 'top')
  const sidePlans = active.filter((p) => p.view === 'side')
  // The route's plan id picks the plan in its own view; the other view keeps
  // its own choice. A plan id that no longer exists is reported once loaded.
  const openedHere = useRef(null) // a just created plan is not in the loaded list yet
  useEffect(() => {
    if (loading || !planId) return
    const target = plans.find((p) => p.id === planId && p.status !== 'removed')
    if (!target && openedHere.current === planId) { openedHere.current = null; return }
    if (!target) { onNotFound(`The floorplan "${planId}" was not found.`); return }
    if (target.view === 'top') setTopId(planId)
    else setSideId(planId)
  }, [planId, loading, plans])
  const pickTop = (id) => { setTopId(id); onPlanChange(id) }
  const pickSide = (id) => { setSideId(id); onPlanChange(id) }
  const topPlan = topPlans.find((p) => p.id === topId) || topPlans[0] || null
  const sidePlan = sidePlans.find((p) => p.id === sideId) || sidePlans[0] || null

  const liveDevices = devices.filter((d) => d.status !== 'removed')
  const liveRuns = wireRuns.filter((r) => r.status !== 'removed')
  const devicesById = new Map(devices.map((d) => [d.id, d]))
  const live = useLive(tool === 'live', reloadKey, (id) => (devicesById.get(id) || {}).name || id)
  const circuitsById = new Map(circuits.map((c) => [c.id, c]))
  const circuit = circuitId ? circuitsById.get(circuitId) : null
  const run = runId ? wireRuns.find((r) => r.id === runId) : null
  const conduitsById = new Map(conduits.map((c) => [c.id, c]))
  const conduit = conduitId ? conduitsById.get(conduitId) : null
  const members = circuit
    ? circuitMembers(circuit, wireRuns)
    : (conduit ? conduitMembers(conduit, wireRuns) : null)
  const data = { devices, wireRuns, devicesById, circuitsById, conduits, conduitsById, plans: active }

  // Runs a write, then reloads; resolves to false when it failed (and says so).
  const guard = async (fn) => {
    setError(null)
    try { await fn(); reload(); return true } catch (err) { setError(err.message); return false }
  }

  const saveDevicePosition = (device, view, a, b) => guard(() => {
    const pos = applyClick(devicePosition(device), view, a, b)
    return putResource('wiringDevices', device.id, { ...device, posX: pos.x, posY: pos.y, posZ: pos.z })
  })

  // The device becomes "not placed" on every plan; it is never removed from
  // the record. Undo puts the old position back.
  const clearPlacement = (device) => {
    const old = { posX: device.posX ?? null, posY: device.posY ?? null, posZ: device.posZ ?? null }
    guard(() => putResource('wiringDevices', device.id, { ...device, posX: null, posY: null, posZ: null })).then((ok) => {
      if (ok) undo.offer({
        message: `"${device.name}" is no longer placed on the plans.`,
        onUndo: async () => { await putResource('wiringDevices', device.id, old); reload() }
      })
    })
  }

  // No confirm dialog: the cable is marked removed, an Undo message is offered,
  // and when the window ends the cable is deleted for good.
  const removeRun = async (cable) => {
    const title = cableName(cable, new Map(devices.map((d) => [d.id, d.name])))
    try {
      await deleteResource('wiringWireRuns', cable.id)
    } catch (err) { setError(err.message); return }
    setError(null)
    setRunId(null)
    setWaypointIndex(null)
    setHint(null)
    reload()
    offerCableUndo({
      undo, cable, title,
      notice: (message) => { if (!mounted.current) return false; setError(message); return true },
      restore: async () => { await putResource('wiringWireRuns', cable.id, { status: 'active' }); reload() }
    })
  }

  // The route being drawn belongs to the selected conduit, else the selected
  // wire run. Choosing one clears the other.
  const currentRoute = () => (conduit ? conduit.route : run?.route) || []
  const saveRoute = (route) => guard(() => (conduit
    ? putResource('wiringConduits', conduit.id, { route })
    : putResource('wiringWireRuns', run.id, { ...withoutAssignments(run), route })))

  // The previous point for axis inheritance: the last waypoint, else the
  // resolved start of a wire run's route.
  const lastPoint = () => {
    const points = conduit
      ? conduitRoutePoints(conduit)
      : routePoints(run, null, devicesById)
    return points.length ? points[points.length - 1] : null
  }

  const actions = {
    placeDevice: (view, a, b) => {
      const device = devicesById.get(deviceId)
      if (!device) { setError('Choose a device to place first.'); return }
      const block = placementBlock(devices, device)
      if (block) { setError(block); return }
      saveDevicePosition(device, view, a, b)
    },
    moveDevice: (id, view, a, b) => {
      const block = placementBlock(devices, devicesById.get(id))
      if (block) { setError(block); return }
      return saveDevicePosition(devicesById.get(id), view, a, b)
    },
    addWaypoint: (view, a, b) => {
      if (!run && !conduit) { setError('Choose a wire run or a conduit to draw first.'); return }
      saveRoute([...currentRoute(), waypointFromClick(lastPoint(), view, a, b)])
      setWaypointIndex(null)
    },
    moveWaypoint: (index, view, a, b) => saveRoute(moveWaypoint(currentRoute(), index, view, a, b)),
    removePlan: (plan) => {
      if (!window.confirm(`Remove the plan "${plan.name}"? Placed devices and routes are kept; the plan stays in the record as removed.`)) return
      guard(() => deleteResource('wiringPlans', plan.id))
    },
    selectDevice: (id) => {
      setError(null)
      // With a wire run chosen in the Draw route tool, its To device ends the route.
      if (tool === 'route' && run && !conduit && effectiveCableRoute(run, null, devicesById, conduitsById).source !== 'conduits') {
        const act = routeEndAction(run, id, devicesById)
        if (act.kind === 'hint') { setHint(act.message); return }
        if (act.kind === 'finish') {
          setHint(null)
          setWaypointIndex(null)
          saveRoute(routeWithEnd(run.route, act.point)).then((ok) => {
            if (ok) { setRunId(null); setTool('select') }
          })
          return
        }
      }
      setHint(null)
      setDeviceId(id)
      setWaypointIndex(null)
    },
    goToPlan: (id) => {
      const target = plans.find((p) => p.id === id)
      if (target && target.view === 'side') pickSide(id)
      else pickTop(id)
    },
    liveToggle: async (id) => {
      setError(null)
      try { await live.toggle(id) } catch (err) { setError(err.message) }
    },
    connectDevice: (id) => {
      setError(null)
      // Cables go to what is inside an enclosure, not to the box.
      if ((devicesById.get(id) || {}).role === 'enclosure') {
        setNotice('Cables go to the devices inside an enclosure. Pick one of them from the list.')
        return
      }
      setConnect((s) => connectPickDevice(s, id)); setNotice(null)
    },
    connectWaypoint: (view, a, b) => {
      if (connect.stage !== 'route') { setError('Pick the From and To devices first.'); return }
      const previous = connect.waypoints.length
        ? connect.waypoints[connect.waypoints.length - 1]
        : (connectFrom ? devicePosition(connectFrom) : null)
      setConnect((s) => connectAddWaypoint(s, waypointFromClick(previous, view, a, b)))
    },
    selectWaypoint: (index) => { setWaypointIndex(index); if (tool !== 'place') setDeviceId(null) },
    clearSelection: () => { setDeviceId(null); setWaypointIndex(null) }
  }

  // ---- Connect tool ----
  const connectFrom = devicesById.get(connect.fromId)
  const connectTo = devicesById.get(connect.toId)
  const connecting = tool === 'connect'
  const connectStart = connecting && connectFrom
    ? routePoints({ fromDeviceId: connect.fromId, route: [] }, null, devicesById)
    : []
  const connectPoints = connecting ? [...connectStart, ...connect.waypoints] : null
  // Meters along the drawn route, ending at the To device when it is placed.
  const measureConnection = (waypoints) => {
    const pts = routePoints({ fromDeviceId: connect.fromId, route: waypoints }, null, devicesById)
    if (connectTo && isPlaced(connectTo)) pts.push(devicePosition(connectTo))
    return routeLength(pts).length
  }
  const connectLengthUnit = settings.defaultLengthUnit || 'm'
  const connectLength = connect.waypoints.length ? measureConnection(connect.waypoints) : null
  const resetConnect = () => { setConnect(initialConnect()); setFinishing(null) }
  const chooseTool = (id) => { setTool(id); setError(null); if (id !== 'connect') resetConnect() }
  const connectNames = Object.fromEntries(devices.map((d) => [d.id, d.name]))

  const createConnected = async (payload, id, withLength) => {
    const extra = withLength
      ? connectionFields(connect, payload.lengthUnit || connectLengthUnit, measureConnection, metersToLengthUnit)
      : (connect.waypoints.length ? { route: connect.waypoints } : {})
    await putResource('wiringWireRuns', id || newId(), { ...payload, ...extra })
    resetConnect()
    setNotice('Cable created.')
    reload()
  }

  const ctx = {
    tool, deviceId, runId, conduitId, members, waypointIndex,
    run: run && run.status !== 'removed' ? run : null,
    connect: connecting ? connect : null,
    live: tool === 'live' ? live : null,
    connectPoints,
    connectStartCount: connectStart.length
  }

  const deleteWaypoint = () => {
    saveRoute(removeWaypoint(currentRoute(), waypointIndex))
    setWaypointIndex(null)
  }
  const undoLast = () => saveRoute(removeWaypoint(currentRoute(), currentRoute().length - 1))

  const effective = run ? effectiveCableRoute(run, null, devicesById, conduitsById) : null
  const measured = effective
  const conduitMeasured = conduit ? routeLength(conduitRoutePoints(conduit)) : null
  const unrouted = unroutedCables(wireRuns, conduits)
  const drawCable = (id) => {
    setTool('route'); setCircuitId(null); setConduitId(null); setRunId(id); setWaypointIndex(null); setError(null)
  }
  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]))
  const useMeasured = () => guard(() => putResource('wiringWireRuns', run.id, {
    ...withoutAssignments(run),
    length: metersToLengthUnit(measured.length, run.lengthUnit),
    lengthUnit: run.lengthUnit || 'm'
  }))

  useEffect(() => { setHint(null) }, [runId, tool])

  // Keyboard: attached for as long as the tab is mounted, so it is gone when
  // another tab is shown. Re-attached every render to see the latest state.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      if (e.key === 'Escape') {
        const step = escapeStep({
          tool, finishing, waypointIndex, runId, conduitId, deviceId,
          connectActive: !!(connect.fromId || connect.toId || connect.waypoints.length)
        })
        if (!step) return
        e.preventDefault()
        if (step === 'close-finish') setFinishing(null)
        else if (step === 'reset-connect') resetConnect()
        else if (step === 'clear-waypoint') setWaypointIndex(null)
        else if (step === 'clear-route-target') { setRunId(null); setConduitId(null); setHint(null) }
        else if (step === 'clear-device') setDeviceId(null)
        else chooseTool('select')
      } else if (e.key === 'Delete') {
        const selected = deviceId ? devicesById.get(deviceId) : null
        const step = deleteStep({ waypointIndex, deviceId, devicePlaced: !!selected && isPlaced(selected) })
        if (!step) return
        e.preventDefault()
        if (step === 'delete-waypoint') deleteWaypoint()
        else clearPlacement(selected)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const circuitOptions = circuits.filter((c) => c.status !== 'removed').map((c) => ({ value: c.id, label: c.name }))
  // Devices inside an enclosure are not placed: the enclosure is. They stay in
  // the connect lists, since cables end on them, but not in the placement list.
  const deviceOptions = liveDevices.filter((d) => d.role !== 'enclosure').map((d) => ({
    value: d.id,
    label: d.name + (isInside(d) ? ' (inside an enclosure)' : d.posX != null || d.posY != null || d.posZ != null ? '' : ' (not placed)')
  }))
  const placeOptions = liveDevices.filter((d) => !isInside(d)).map((d) => ({
    value: d.id,
    label: d.name + (d.posX != null || d.posY != null || d.posZ != null ? '' : ' (not placed)')
  }))
  const insideCount = liveDevices.filter(isInside).length
  const runOptions = liveRuns
    .filter((r) => !members || members.runIds.has(r.id))
    .map((r) => ({ value: r.id, label: cableName(r, new Map(devices.map((d) => [d.id, d.name]))) }))

  const conduitOptions = conduits.filter((c) => c.status !== 'removed')
    .map((c) => ({ value: c.id, label: c.kind ? `${c.name} (${c.kind})` : c.name }))

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
            ${[['select', 'Select'], ['place', 'Place device'], ['route', 'Draw route'], ['connect', 'Connect'], ['live', 'Live']].map(([id, label]) => html`
              <button key=${id} class=${tool === id ? 'active' : ''} data-testid=${'tool-' + id} onClick=${() => chooseTool(id)}>${label}</button>
            `)}
          </div>
          <div class="toolbar-fields">
            <${Select} label="Highlight circuit" value=${circuitId} options=${circuitOptions}
              onChange=${(v) => { setCircuitId(v); setRunId(null); setWaypointIndex(null) }} />
            ${tool === 'place' && html`
              <${Select} label="Device to place" value=${deviceId} options=${placeOptions} onChange=${setDeviceId} />
            `}
            ${connecting && html`
              <${Select} label="From (supply side)" value=${connect.fromId} options=${deviceOptions}
                onChange=${(v) => { if (connect.stage === 'from') setConnect(connectPickDevice(connect, v)) }} />
              <${Select} label="To (load side)" value=${connect.toId} options=${deviceOptions}
                onChange=${(v) => { if (connect.stage === 'to') setConnect(connectPickDevice(connect, v)) }} />
            `}
            ${tool !== 'place' && !connecting && html`
              <${Select} label="Wire run" value=${runId} options=${runOptions}
                onChange=${(v) => { setRunId(v); setConduitId(null); setWaypointIndex(null) }} />
              <${Select} label="Conduit" value=${conduitId} options=${conduitOptions}
                onChange=${(v) => { setConduitId(v); setRunId(null); setWaypointIndex(null) }} />
            `}
          </div>
          ${tool === 'live' && html`<${LiveBar} live=${live} error=${live.error} />`}
          ${tool === 'place' && html`<p class="meta">Choose a device, then click a calibrated plan to place it. A click in one view sets only the two axes it shows. Drag a marker in Select mode to adjust it.</p>`}
          ${tool === 'place' && insideCount > 0 && html`<p class="meta" data-testid="inside-note">${insideCount} ${insideCount === 1 ? 'device is' : 'devices are'} inside an enclosure and not listed: place the enclosure instead, its marker stands for what is inside it.</p>`}
          ${connecting && html`<p class="meta">Pick the From and To devices by clicking their markers on a plan (or with the lists), then click the route on the plan and finish. The cable gets the drawn route and its measured length.</p>`}
          ${tool === 'route' && html`<p class="meta">Choose a wire run or a conduit, then click to add waypoints. A conduit route is just its points. A wire run route starts at the run's from-device when that is placed. Drag a waypoint to adjust it, or click it to select it for deletion.</p>`}
          ${connecting && html`
            <div class="route-info" data-testid="connect-panel">
              <span data-testid="connect-hint">${connectHint(connect, connectNames)}</span>
              ${connect.waypoints.length > 0 && html`<span>Measured route: <strong>${(connectLength || 0).toFixed(2)} m</strong></span>`}
              ${notice && html`<span class="meta" data-testid="notice">${notice}</span>`}
              ${!finishing && html`
                <div class="row-actions">
                  <button data-testid="connect-undo" disabled=${connect.stage === 'from'} onClick=${() => setConnect(connectUndo(connect))}>Undo</button>
                  <button data-testid="connect-finish" disabled=${!connectCanFinish(connect)} onClick=${() => setFinishing({ more: null })}>Finish</button>
                  <button onClick=${resetConnect}>Cancel</button>
                </div>`}
              ${finishing && !finishing.more && html`<${CablePopover}
                start=${startValues({ a: connectFrom, b: connectTo, cables: liveRuns, defaults: wireRunInitialValues(settings), keepOrder: true })}
                style="position:static"
                lengthNote=${connect.waypoints.length
                  ? `Length: ${metersToLengthUnit(connectLength || 0, connectLengthUnit)} ${connectLengthUnit}, measured from the drawn route.`
                  : 'No route drawn, so no length is recorded.'}
                onCreate=${(payload) => createConnected(payload, null, true).catch((err) => { throw err })}
                onMore=${(values) => setFinishing({ more: {
                  ...values,
                  ...(connect.waypoints.length && connectLength ? { length: metersToLengthUnit(connectLength, values.lengthUnit || connectLengthUnit), lengthUnit: values.lengthUnit || connectLengthUnit } : {})
                } })}
                onCancel=${() => setFinishing(null)} />`}
              ${finishing && finishing.more && renderCableForm({
                prefill: finishing.more,
                devices,
                cables: wireRuns,
                circuits,
                onDevicesChanged: reload,
                onSaved: (payload, id) => createConnected(payload, id, false),
                onCancel: () => setFinishing(null)
              })}
            </div>
          `}
          ${deviceId && devicesById.get(deviceId) && devicesById.get(deviceId).role === 'enclosure' && html`
            <div class="route-info" data-testid="enclosure-popover">
              <span><strong>${devicesById.get(deviceId).name}</strong> holds ${contentsOf(devices, deviceId).length === 0 ? 'nothing' : contentsOf(devices, deviceId).length}:</span>
              <ul class="enclosure-contents">
                ${childrenOf(devices, deviceId).map((id) => html`
                  <li key=${id}><a href=${hashForState({ tab: 'devices', id })} data-testid="enclosure-content-link">${(devicesById.get(id) || {}).name || id}</a>${(devicesById.get(id) || {}).role === 'enclosure' ? ` (holds ${contentsOf(devices, id).length})` : ''}</li>
                `)}
              </ul>
            </div>
          `}
          ${deviceId && devicesById.get(deviceId) && html`
            <div class="route-info">
              <span>Selected: <strong>${devicesById.get(deviceId).name}</strong>${isPlaced(devicesById.get(deviceId)) ? '' : ' (not placed)'}</span>
              <div class="row-actions">
                <button disabled=${!isPlaced(devicesById.get(deviceId))} onClick=${() => clearPlacement(devicesById.get(deviceId))}>Remove placement</button>
                <button onClick=${() => setDeviceId(null)}>Deselect</button>
              </div>
            </div>
          `}
          ${conduit && html`
            <div class="route-info">
              <span>Conduit route: <strong>${conduitMeasured.length.toFixed(2)} m</strong>${conduitMeasured.complete ? '' : ' (incomplete, some heights unset)'}</span>
              <span>Cables along it: ${(conduit.cableIds || []).length === 0
                ? 'none yet, add them on the Conduits tab'
                : (conduit.cableIds || []).map((id) => wireRuns.find((r) => r.id === id)).filter(Boolean)
                  .map((r) => cableName(r, deviceNameById)).join(', ')}</span>
              <div class="row-actions">
                <button disabled=${!(conduit.route || []).length} onClick=${undoLast}>Undo last point</button>
                <button disabled=${waypointIndex === null} onClick=${deleteWaypoint}>Delete selected point</button>
              </div>
            </div>
          `}
          ${run && html`
            <div class="route-info" data-testid="route-panel">
              <span>Cable: <strong>${cableName(run, deviceNameById)}</strong></span>
              ${hint && html`<span class="route-hint" data-testid="route-hint" role="status">${hint}</span>`}
              <span>Measured route: <strong>${measured.length.toFixed(2)} m</strong>${measured.complete ? '' : ' (incomplete, some heights unset or a conduit has no route)'}${effective.source === 'conduits' ? ', following its conduits' : ''}</span>
              <span>Recorded length: ${run.length != null ? `${run.length} ${run.lengthUnit || ''}` : 'none'}</span>
              <div class="row-actions">
                <button disabled=${measured.length === 0} onClick=${useMeasured}>Use measured length</button>
                <button disabled=${!(run.route || []).length} onClick=${undoLast}>Undo last point</button>
                <button disabled=${waypointIndex === null} onClick=${deleteWaypoint}>Delete selected point</button>
                <button data-testid="delete-run" onClick=${() => removeRun(run)}>Delete wire run</button>
              </div>
            </div>
          `}
        </div>

        ${unrouted.length > 0 && html`
          <details class="unrouted">
            <summary>${unrouted.length === 1 ? '1 cable is' : `${unrouted.length} cables are`} not drawn on the plans</summary>
            <p class="meta">These have no route of their own and no conduit with a drawn route. Pick one to draw it.</p>
            ${unrouted.map((r) => html`
              <div class="list-item" key=${r.id}>
                <div>${cableName(r, deviceNameById)}</div>
                <button onClick=${() => drawCable(r.id)}>Draw</button>
              </div>
            `)}
          </details>
        `}

        ${planButtons(topPlans, topPlan, pickTop)}
        ${planButtons(sidePlans, sidePlan, pickSide)}

        <div class="floorplan-pair">
          ${topPlan && html`<${PlanViewer} key=${topPlan.id} plan=${topPlan} data=${data} ctx=${ctx}
            actions=${actions} onSaved=${reload} onError=${setError} />`}
          ${sidePlan && html`<${PlanViewer} key=${sidePlan.id} plan=${sidePlan} data=${data} ctx=${ctx}
            actions=${actions} onSaved=${reload} onError=${setError} />`}
        </div>
      `}

      <${NewPlanForm} onCreated=${(id) => {
        const created = { id }
        setTopId(id); setSideId(id); openedHere.current = id; onPlanChange(id); reload(); return created
      }} onError=${setError} />
    </div>
  `
}
