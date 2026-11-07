import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js'
import { calibrationFromClicks, parseSvgSize } from './floorplan.js'

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
      const id = crypto.randomUUID()
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

// Pan (drag) and zoom (wheel, buttons) work by changing the SVG viewBox, so
// the drawing and anything later overlaid on it share one coordinate space.
function PlanViewer ({ plan, onSaved, onError }) {
  const svgRef = useRef(null)
  const [size, setSize] = useState(null)
  const [sizeError, setSizeError] = useState(null)
  const [box, setBox] = useState(null)
  const [mode, setMode] = useState('select')
  const [clicks, setClicks] = useState([])
  const [distance, setDistance] = useState('')
  const [flip, setFlip] = useState(false)
  const drag = useRef(null)

  const svgUrl = `${ROUTES_BASE}/plans/${plan.id}/image`

  useEffect(() => {
    let cancelled = false
    setSize(null); setSizeError(null); setBox(null)
    fetch(svgUrl)
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
  }, [svgUrl])

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

  const onWheel = (e) => {
    e.preventDefault()
    zoomAt(e.deltaY < 0 ? 0.8 : 1.25, toDrawing(e))
  }

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > CLICK_SLOP_PX) d.moved = true
    if (!d.moved) return
    const rect = svgRef.current.getBoundingClientRect()
    const scale = box.width / rect.width
    setBox({ ...box, x: box.x - (e.clientX - d.lastX) * scale, y: box.y - (e.clientY - d.lastY) * scale })
    d.lastX = e.clientX; d.lastY = e.clientY
  }

  const onPointerUp = (e) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    if (mode === 'calibrate' && clicks.length < 2) setClicks([...clicks, toDrawing(e)])
  }

  const startCalibrating = () => { setMode('calibrate'); setClicks([]); setDistance(''); onError(null) }
  const stopCalibrating = () => { setMode('select'); setClicks([]) }

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

  const markerSize = box.width / 60
  const distanceValid = parseFloat(distance) > 0
  const secondAxis = plan.view === 'side' ? 'height' : 'athwartships'

  return html`
    <div class="floorplan">
      <div class="row-actions">
        <button onClick=${() => zoomAt(0.8)}>Zoom in</button>
        <button onClick=${() => zoomAt(1.25)}>Zoom out</button>
        <button onClick=${() => setBox({ ...size })}>Fit</button>
        ${mode === 'select'
          ? html`<button onClick=${startCalibrating}>${plan.calibration ? 'Recalibrate' : 'Calibrate'}</button>`
          : html`<button onClick=${stopCalibrating}>Cancel calibration</button>`}
      </div>

      ${!plan.calibration && mode === 'select' && html`
        <p class="meta">Not calibrated yet. Calibrate to give the drawing a real-world scale.</p>
      `}
      ${plan.calibration && mode === 'select' && html`
        <p class="meta">Scale: ${plan.calibration.pxPerMeter.toFixed(2)} drawing units per meter.</p>
      `}

      ${mode === 'calibrate' && html`
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

      <svg ref=${svgRef} class="floorplan-canvas ${mode === 'calibrate' ? 'calibrating' : ''}"
        viewBox="${box.x} ${box.y} ${box.width} ${box.height}"
        onWheel=${onWheel} onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
        onPointerUp=${onPointerUp} onPointerCancel=${() => { drag.current = null }}>
        <image href=${svgUrl} x=${size.x} y=${size.y} width=${size.width} height=${size.height} />
        ${clicks.length === 2 && html`
          <line x1=${clicks[0][0]} y1=${clicks[0][1]} x2=${clicks[1][0]} y2=${clicks[1][1]}
            class="calibration-line" stroke-width=${markerSize / 4} />
        `}
        ${clicks.map(([x, y], i) => html`
          <circle key=${i} cx=${x} cy=${y} r=${markerSize} class="calibration-point" />
        `)}
      </svg>
    </div>
  `
}

export function FloorplanTab () {
  const [plans, setPlans] = useState({ loading: true, items: [] })
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchPlans()
      .then((items) => { if (!cancelled) setPlans({ loading: false, items }) })
      .catch((err) => { if (!cancelled) { setPlans({ loading: false, items: [] }); setError(err.message) } })
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)
  const active = plans.items.filter((p) => p.status !== 'removed' && p.filename)
  const selected = active.find((p) => p.id === selectedId) || active[0] || null

  return html`
    <div>
      ${error && html`<div class="error-banner">${error}</div>`}
      ${plans.loading && html`<p class="meta">Loading…</p>`}
      ${!plans.loading && active.length === 0 && html`<p class="meta">No plans yet. Add one below.</p>`}
      ${active.length > 0 && html`
        <div class="row-actions">
          ${active.map((p) => html`
            <button key=${p.id} class=${selected && selected.id === p.id ? 'active' : ''}
              onClick=${() => { setSelectedId(p.id); setError(null) }}>
              ${p.name} (${p.view === 'top' ? 'top' : 'side'})
            </button>
          `)}
        </div>
      `}
      ${selected && html`<${PlanViewer} key=${selected.id} plan=${selected} onSaved=${reload} onError=${setError} />`}
      <${NewPlanForm} onCreated=${(id) => { setSelectedId(id); reload() }} onError=${setError} />
    </div>
  `
}
