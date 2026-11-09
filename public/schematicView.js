import { html, useState, useEffect, useRef, useMemo } from './vendor/preact-standalone.module.js'
import { formatGauge } from './gauge.js'
import dagre from './vendor/dagre.esm.js'
import { newId } from './ids.js'
import { TYPE_SUGGESTIONS } from './deviceTypes.js'
import { roleLabel } from './roles.js'
import * as G from './schematic.js'
import { startValues } from './quickCable.js'
import { CablePopover } from './cablePopover.js'
import { circuitsOfCable, cableTitle, CONDUCTOR_LABELS } from './cableForm.js'
import { useSettings, wireRunInitialValues } from './settings.js'
import { useLive } from './live.js'
import { LiveLock, LiveReading, LiveBar } from './liveMarks.js'
import { PortBlocks } from './ports.js'
import { useUndo } from './undoBar.js'
import { offerCableUndo, toast } from './canvasRemoval.js'
import { matchesRemoved, readShowRemoved, writeShowRemoved } from './zones.js'
import { purgeConfirmText, purgeFacts, purgeRecord } from './purge.js'
import * as Z from './zoneShapes.js'
import { midpoints } from './polygon.js'
import { pageModel, insideText } from './enclosures.js'
import { ensureInsidePage } from './insidePage.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'
const ZOOM_STEP = 1.25
const MOVE_SLOP_PX = 3
const DOUBLE_CLICK_MS = 400

// Small local copies of the app.js helpers; importing app.js from here would
// make the two modules import each other.
async function fetchList (type) {
  const res = await fetch(`${RESOURCE_BASE}/${type}`)
  if (!res.ok) throw new Error(`failed to load ${type}: ${res.status}`)
  return Object.values(await res.json())
}

function failureMessage (status) {
  if (status === 401) return 'You need to be logged into the SignalK admin UI to do this.'
  return `Request failed (server responded ${status}).`
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

// The palette: the popular types per kind of device, creating a device of the
// right role in place.
const PALETTE = [
  { title: 'Battery or source', items: [
    ...TYPE_SUGGESTIONS.storage.slice(0, 3).map((type) => ({ role: 'storage', type })),
    ...TYPE_SUGGESTIONS.source.slice(0, 3).map((type) => ({ role: 'source', type }))
  ] },
  { title: 'Consumer', items: TYPE_SUGGESTIONS.consumer.slice(0, 8).map((type) => ({ role: 'consumer', type })) },
  { title: 'Fuse or switch', items: TYPE_SUGGESTIONS.distribution.slice(0, 6).map((type) => ({ role: 'distribution', type })) },
  { title: 'Converter', items: TYPE_SUGGESTIONS.converter.slice(0, 4).map((type) => ({ role: 'converter', type })) }
]

function shorten (text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// One line about a derived circuit: name, rating, voltage, AC or DC.
function circuitLine (circuit) {
  const d = circuit.derived
  if (!d) return circuit.name
  const bits = []
  if (d.unprotected) bits.push('no protection')
  else if (d.ratingA != null) bits.push(`${d.ratingA} A`)
  if (d.voltage != null) bits.push(`${d.voltage} V ${d.ac ? 'AC' : 'DC'}`)
  return bits.length ? `${circuit.name} (${bits.join(', ')})` : circuit.name
}

function isLive (record) {
  return record && record.status !== 'removed'
}

// ---- The tab ---------------------------------------------------------------

export function SchematicsTab ({ renderCableForm, selectedId = null, onSelect = () => {}, onNotFound = () => {} }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  // A schematic opened right after creating it is not in the loaded list
  // yet: the first check after that open is skipped, the reload follows.
  const openedHere = useRef(null)
  const setSelectedId = (id) => { openedHere.current = id; onSelect(id) }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchList('wiringSchematics'), fetchList('wiringDevices'),
      fetchList('wiringWireRuns'), fetchList('wiringCircuits'), fetchList('wiringConduits'), fetchList('wiringZones')
    ]).then(([schematics, devices, cables, circuits, conduits, zones]) => {
      if (!cancelled) setData({ schematics, devices, cables, circuits, conduits, zones })
    }).catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)
  const schematic = data && selectedId && data.schematics.find((s) => s.id === selectedId && isLive(s))
  const missing = !!(data && selectedId && !schematic)
  useEffect(() => {
    if (!missing) return
    if (openedHere.current === selectedId) { openedHere.current = null; return }
    onNotFound(`The schematic "${selectedId}" was not found.`)
  }, [missing, selectedId, data])
  if (!data) return html`<p class="meta">${error || 'Loading…'}</p>`

  return html`
    <div>
      ${error && html`<div class="error-banner">${error}</div>`}
      ${schematic
        ? html`<${SchematicEditor} key=${schematic.id} schematic=${schematic} data=${data}
            reload=${reload} onBack=${() => setSelectedId(null)} onOpen=${setSelectedId}
            onError=${setError} renderCableForm=${renderCableForm} />`
        : html`<${SchematicList} schematics=${data.schematics} devices=${data.devices} reload=${reload}
            onOpen=${setSelectedId} onError=${setError} />`}
    </div>
  `
}

function SchematicList ({ schematics, devices = [], reload, onOpen, onError }) {
  const deviceNameOf = (id) => (devices.find((d) => d.id === id) || {}).name || 'an enclosure'
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [renameText, setRenameText] = useState('')

  const create = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const id = newId()
      await putResource('wiringSchematics', id, { name: trimmed })
      setName('')
      onError(null)
      await reload()
      onOpen(id)
    } catch (err) { onError(err.message) }
  }

  const rename = async (s) => {
    const trimmed = renameText.trim()
    setRenaming(null)
    if (!trimmed || trimmed === s.name) return
    try { await putResource('wiringSchematics', s.id, { name: trimmed }); onError(null); reload() } catch (err) { onError(err.message) }
  }

  const remove = async (s) => {
    if (!window.confirm(`Remove the schematic "${s.name}"? Its devices and cables are not touched.`)) return
    try { await deleteResource('wiringSchematics', s.id); onError(null); reload() } catch (err) { onError(err.message) }
  }

  // Erases a removed page for good, after saying what goes with it.
  const purge = async (s) => {
    try {
      if (!window.confirm(purgeConfirmText('schematic', s.name, await purgeFacts('schematic', s.id)))) return
      const failure = await purgeRecord('schematic', s.id, s.name)
      if (failure) { onError(failure); return }
      onError(null)
      toast(`Deleted "${s.name}" permanently.`)
      reload()
    } catch (err) { onError(err.message) }
  }

  const [showRemoved, setShowRemovedState] = useState(() => readShowRemoved('schematics'))
  const setShowRemoved = (value) => { setShowRemovedState(value); writeShowRemoved('schematics', value) }
  const removedCount = schematics.filter((s) => !isLive(s)).length
  const shown = schematics.filter((s) => matchesRemoved(s, showRemoved))

  return html`
    <div>
      <form class="inline-form" onSubmit=${create}>
        <div class="row-actions">
          <input type="text" value=${name} placeholder="New schematic, e.g. 12 V system"
            data-testid="new-schematic-name" onInput=${(e) => setName(e.target.value)} />
          <button type="submit" data-testid="new-schematic">Add schematic</button>
        </div>
      </form>
      ${removedCount > 0 && html`
        <label class="check-inline">
          <input type="checkbox" class="checkbox-input" data-testid="show-removed-schematics" checked=${showRemoved}
            onChange=${(e) => setShowRemoved(e.target.checked)} />
          Show removed (${removedCount})
        </label>
      `}
      ${schematics.filter(isLive).length === 0 && removedCount === 0 && html`<p class="meta">No schematics yet. A schematic is a diagram of part of the electrical system, for example "12 V system" or "Shore power and inverter". A device can be on several.</p>`}
      <ul class="plain-list">
        ${shown.map((s) => !isLive(s) ? html`
          <li key=${s.id} class="list-row removed" data-testid="removed-schematic">
            <span class="row-title">${s.name}</span>
            <span class="meta">removed</span>
            <button type="button" class="link-btn" data-testid="schematic-purge" onClick=${() => purge(s)}>Delete permanently</button>
          </li>
        ` : html`
          <li key=${s.id} class="list-row">
            ${renaming === s.id
              ? html`<input type="text" value=${renameText} autofocus
                  onInput=${(e) => setRenameText(e.target.value)}
                  onBlur=${() => rename(s)}
                  onKeyDown=${(e) => { if (e.key === 'Enter') rename(s); if (e.key === 'Escape') setRenaming(null) }} />`
              : html`<a class="row-title" href="#" onClick=${(e) => { e.preventDefault(); onOpen(s.id) }}>${s.name}</a>`}
            <span class="meta">${s.devices.length} device${s.devices.length === 1 ? '' : 's'}</span>
            ${s.enclosureId && html`<span class="meta" data-testid="inside-tag">Inside of ${deviceNameOf(s.enclosureId)}</span>`}
            <button type="button" class="link-btn" onClick=${() => { setRenaming(s.id); setRenameText(s.name) }}>Rename</button>
            <button type="button" class="link-btn" onClick=${() => remove(s)}>Remove</button>
          </li>
        `)}
      </ul>
    </div>
  `
}

// ---- The editor ------------------------------------------------------------

function SchematicEditor ({ schematic, data, reload, onBack, onOpen, onError, renderCableForm }) {
  const svgRef = useRef(null)
  const drag = useRef(null)
  const lastBendDown = useRef(null)
  const lastTap = useRef(null) // the last tap on a device, for the double tap
  const lastWireTap = useRef(null) // the last tap on a wire
  const autoRoutedAt = useRef(0)
  const lastCornerDown = useRef(null)
  const [pos, setPos] = useState({})
  const [bends, setBends] = useState({})
  const [stubPos, setStubPos] = useState({}) // cable id -> { x, y }: tabs the user placed
  const [shapes, setShapes] = useState([]) // zone shapes: { zoneId, kind, x, y, width, height, points? }
  const [shapeKind, setShapeKind] = useState('rect')
  const [vb, setVb] = useState(null)
  const [selection, setSelection] = useState(null) // { type: 'device' | 'wire', id }
  const [highlightId, setHighlightId] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, text }
  const [tabMenu, setTabMenu] = useState(null)
  const [addId, setAddId] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false) // Auto-arrange has run and nothing was edited since
  const armedPending = useRef(null) // the edit key at the click, until the saved layout has come back
  const armedKey = useRef(null)
  const [preview, setPreview] = useState(null) // a wire being dragged: { a: {x,y}, b: {x,y}, targetId }
  const [popover, setPopover] = useState(null) // { start, at }
  const [moreForm, setMoreForm] = useState(null) // { cable?, prefill? }
  const [notice, setNotice] = useState(null)
  const settings = useSettings()
  const undo = useUndo()
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const { devices, cables, circuits, schematics } = data
  const conduits = data.conduits || []
  const zones = data.zones || []
  const zoneById = new Map(zones.map((z) => [z.id, z]))
  const zoneName = (id) => (zoneById.get(id) || {}).name || ''
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const deviceName = (id) => (deviceById.get(id) || {}).name
  // Live mode (plan 0017): states and meter readings on the devices, and a
  // click switches a consumer through the relay that feeds it.
  const [liveOn, setLiveOn] = useState(false)
  const live = useLive(liveOn, 0, (id) => deviceName(id) || id)
  const liveToggle = async (id) => {
    onError(null)
    try { await live.toggle(id) } catch (err) { onError(err.message) }
  }

  // Layout lives in local state while it is being dragged and is written
  // when the drag ends. It is reset from the record whenever that changes.
  const recordKey = JSON.stringify([schematic.devices, schematic.wires, schematic.stubs || [], schematic.zoneShapes || []])
  useEffect(() => {
    const p = {}
    for (const d of schematic.devices) p[d.deviceId] = { x: d.x, y: d.y }
    const b = {}
    for (const w of schematic.wires) b[w.wireRunId] = w.points
    const sp = {}
    for (const st of schematic.stubs || []) sp[st.wireRunId] = { x: st.x, y: st.y }
    setPos(p)
    setBends(b)
    setStubPos(sp)
    setShapes(schematic.zoneShapes || [])
  }, [recordKey])

  // An enclosure on the page stands for what it holds: its ports are the
  // cables that cross its boundary, and the devices inside are not drawn.
  const placedDevices = schematic.devices
    .map((d) => deviceById.get(d.deviceId))
    .filter((d) => isLive(d) && pos[d.id])
  const model = pageModel(devices, cables, placedDevices.map((d) => d.id))
  const pageDevices = placedDevices.filter((d) => !model.hidden.has(d.id)).map((d) => model.devices.get(d.id) || d)
  const drawnById = new Map(pageDevices.map((d) => [d.id, d]))
  const isEnclosureBox = (id) => !!(drawnById.get(id) && drawnById.get(id).isEnclosure)
  const boxes = pageDevices.map((d) => G.deviceBox(d, pos[d.id]))
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  const wireBoxes = boxes.filter((b) => !isEnclosureBox(b.id)) // cables are drawn to what is inside, never to the box
  const liveCables = model.cables.filter(isLive)
  const onPage = liveCables.filter((c) => boxById.has(c.fromDeviceId) && boxById.has(c.toDeviceId))
  const lanes = G.assignLanes(onPage.map((c) => ({ id: c.id, a: c.fromDeviceId, b: c.toDeviceId })))
  const stubsBase = G.offPageStubs({ boxes: boxById, cables: liveCables, deviceName }).map((st) => ({ ...st, cable: liveCables.find((c) => c.id === st.cableId), ...(stubPos[st.cableId] ? { pos: stubPos[st.cableId] } : {}) }))
  // Routing runs when the page's layout, wires or conduits change, not on
  // every pointer move: while a device or a bend point is being dragged the
  // old cheap routes are drawn and the full routing follows the drop.
  const dragging = !!drag.current && drag.current.moved && (drag.current.kind === 'move' || drag.current.kind === 'bend' || drag.current.kind === 'seg' || drag.current.kind === 'stub')
  const routeKey = dragging ? 'drag' : JSON.stringify([
    boxes.map((b) => [b.id, b.x, b.y, b.w, b.h]), onPage.map((c) => [c.id, c.fromDeviceId, c.toDeviceId, c.conductors, c.conduitIds]),
    bends, stubsBase.map((x) => [x.cableId, x.pos || null])
  ])
  const routed = useMemo(() => {
    if (dragging) return null
    return G.routeSchematicPage({
      boxes,
      wires: onPage.map((c) => {
        const t = G.endTerminals(c)
        return { id: c.id, fromId: c.fromDeviceId, toId: c.toDeviceId, fromTerminal: t.from, toTerminal: t.to, points: bends[c.id] || [], conduitIds: c.conduitIds || [], lane: lanes[c.id] || 0 }
      }),
      stubs: stubsBase,
      legacy: G.wirePath
    })
  }, [routeKey])
  const wires = onPage.map((c) => {
    const t = G.endTerminals(c)
    const r = routed && routed.wires.get(c.id)
    return {
      id: c.id,
      cable: c,
      bridges: r ? r.bridges : [],
      path: r
        ? r.points
        : G.wirePath({ fromBox: boxById.get(c.fromDeviceId), toBox: boxById.get(c.toDeviceId), fromTerminal: t.from, toTerminal: t.to, lane: lanes[c.id] || 0, points: bends[c.id] || [] }),
      stored: c.source || c
    }
  })
  const stubs = stubsBase.map((st) => {
    const r = routed && routed.stubs.get(st.cableId)
    if (r) return { ...st, path: r.path, tab: r.tab, bridges: r.bridges || [] }
    return st.pos ? { ...st, ...G.stubAt(st, st.pos) } : st
  })
  const conduitInfo = new Map(conduits.filter(isLive).map((c) => [c.id, c]))
  const bands = G.conduitBands({
    wires: onPage.map((c) => ({ id: c.id, conduitIds: (c.conduitIds || []).filter((x) => conduitInfo.has(x)) })),
    paths: new Map(wires.map((w) => [w.id, w.path])),
    conduits: conduitInfo,
    avoid: { paths: [...wires.map((w) => w.path), ...stubs.map((s) => s.path).filter(Boolean)], rects: [...boxes.map((b) => ({ x0: b.x - 8, y0: b.y - 8, x1: b.x + b.w + 8, y1: b.y + b.h + 8 })), ...stubs.filter((s) => s.tab).map((s) => ({ x0: s.tab.x, y0: s.tab.y, x1: s.tab.x + s.tab.w, y1: s.tab.y + s.tab.h }))] }
  })

  const overlapping = G.findOverlaps(boxes).length > 0
  const tidyAll = async () => {
    const next = tidied(pos)
    setPos(next)
    await save(next, bends)
  }

  const selectedWireId = selection && selection.type === 'wire' ? selection.id : null
  const shown = shapes.filter((sh) => zoneById.has(sh.zoneId))
  // while a bend point or a stretch is dragged, the viewBox stays as it was: the cheap routes drawn meanwhile must not rescale the page under the pointer
  const view = (drag.current && drag.current.frozen) || vb || G.fitView([...boxes, ...stubs.map((s) => s.tab), ...shown.map(Z.shapeBox)])
  const fitNow = () => setVb(null)

  // ---- Coordinates ----
  const toCanvas = (e) => {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    return { x: p.x, y: p.y }
  }
  const toScreen = (p) => {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = p.x
    pt.y = p.y
    const s = pt.matrixTransform(svg.getScreenCTM())
    const r = svg.parentElement.getBoundingClientRect()
    return { x: s.x - r.left, y: s.y - r.top }
  }

  const zoomAt = (factor, at) => {
    setVb((cur) => {
      const v = cur || G.fitView([...boxes, ...stubs.map((s) => s.tab), ...shown.map(Z.shapeBox)])
      const nw = v.w / factor
      const nh = v.h / factor
      const cx = at ? at.x : v.x + v.w / 2
      const cy = at ? at.y : v.y + v.h / 2
      return { x: cx - (cx - v.x) / factor, y: cy - (cy - v.y) / factor, w: nw, h: nh }
    })
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, toCanvas(e))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  })

  // ---- Persisting ----
  const save = async (nextPos, nextBends, order, nextStubs = stubPos, nextShapes = shapes) => {
    const ids = order || schematic.devices.map((d) => d.deviceId)
    try {
      await putResource('wiringSchematics', schematic.id, {
        devices: ids.filter((id) => nextPos[id]).map((id) => ({ deviceId: id, x: Math.round(nextPos[id].x), y: Math.round(nextPos[id].y) })),
        wires: Object.entries(nextBends)
          .filter(([id, pts]) => pts && pts.length > 0 && liveCables.some((c) => c.id === id))
          .map(([wireRunId, points]) => ({ wireRunId, points })),
        stubs: Object.entries(nextStubs)
          .filter(([id]) => stubsBase.some((st) => st.cableId === id))
          .map(([wireRunId, at]) => ({ wireRunId, x: Math.round(at.x), y: Math.round(at.y) })),
        zoneShapes: nextShapes.filter((sh) => zoneById.has(sh.zoneId))
      })
      onError(null)
      await reload()
    } catch (err) { onError(err.message) }
  }

  // ---- Zone shapes ----
  // Adds a shape for a zone at the centre of the view; a zone that already has
  // one on this page just gets that shape selected.
  const addShape = async (zoneId, kind) => {
    if (!zoneId) return
    const existing = shapes.find((sh) => sh.zoneId === zoneId)
    if (existing) { setSelection({ type: 'zone', id: zoneId }); return }
    const next = Z.withShape(shapes, Z.newShape(zoneId, kind, centre()))
    setShapes(next)
    setSelection({ type: 'zone', id: zoneId })
    await save(pos, bends, undefined, stubPos, next)
  }

  const removeShape = async (zoneId) => {
    const next = shapes.filter((sh) => sh.zoneId !== zoneId)
    setShapes(next)
    setSelection(null)
    await save(pos, bends, undefined, stubPos, next)
  }

  const centre = () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 })

  // Moves the given devices (default: all) to the nearest free spot, at least
  // the overlap margin from every other device and every off-page tab.
  const tidied = (layout, movable = null, keepTabs = true) => {
    const bx = []
    for (const id of Object.keys(layout)) {
      const d = drawnById.get(id) || deviceById.get(id)
      if (d) bx.push(G.deviceBox(d, layout[id]))
    }
    // tabs the user placed stay where they are; the others are placed after the devices
    const tabs = !keepTabs ? [] : stubs.filter((st) => st.pos).map((st) => ({ ...st.tab, deviceId: st.deviceId }))
    const moved = G.resolveOverlaps(bx, tabs, G.OVERLAP_MARGIN, movable)
    return Object.keys(moved).length ? { ...layout, ...moved } : layout
  }

  const addExisting = async (id, at) => {
    if (!id || pos[id]) return
    const c = at || centre()
    const n = Object.keys(pos).length
    const next = tidied({ ...pos, [id]: { x: c.x - G.BOX_W / 2 + (at ? 0 : (n % 5) * 24), y: c.y - 23 + (at ? 0 : (n % 5) * 24) } }, [id])
    setPos(next)
    setAddId('')
    await save(next, bends, [...schematic.devices.map((d) => d.deviceId), id])
  }

  const uniqueName = (type) => {
    const taken = new Set(devices.filter(isLive).map((d) => d.name.toLowerCase()))
    if (!taken.has(type.toLowerCase())) return type
    for (let i = 2; ; i++) if (!taken.has(`${type} ${i}`.toLowerCase())) return `${type} ${i}`
  }

  const createDevice = async (item, at) => {
    const c = at || centre()
    const id = newId()
    try {
      // A device made on an inside page goes into that enclosure.
      await putResource('wiringDevices', id, { name: uniqueName(item.type), type: item.type, role: item.role, ...(schematic.enclosureId ? { parentId: schematic.enclosureId } : {}) })
      const next = tidied({ ...pos, [id]: { x: Math.round(c.x - G.BOX_W / 2), y: Math.round(c.y - 23) } }, [id])
      setPos(next)
      await save(next, bends, [...schematic.devices.map((d) => d.deviceId), id])
      setSelection({ type: 'device', id })
      setRenaming({ id, text: uniqueName(item.type), fresh: true })
    } catch (err) { onError(err.message) }
  }

  const commitRename = async () => {
    const r = renaming
    setRenaming(null)
    if (!r) return
    const text = r.text.trim()
    const current = deviceName(r.id)
    if (!text || text === current) return
    try { await putResource('wiringDevices', r.id, { name: text }); onError(null); reload() } catch (err) { onError(err.message) }
  }

  // Takes the device off this page only; Undo puts it back where it was.
  const removeFromPage = async (id) => {
    const old = pos[id]
    const index = schematic.devices.findIndex((d) => d.deviceId === id)
    const name = deviceName(id) || 'Device'
    const next = { ...pos }
    delete next[id]
    setSelection(null)
    await save(next, bends, schematic.devices.map((d) => d.deviceId).filter((x) => x !== id))
    if (!old) return
    undo.offer({
      message: `"${name}" taken off this page.`,
      onUndo: () => patchStored((s) => ({
        devices: G.withDevicePlaced(s.devices || [], { deviceId: id, x: Math.round(old.x), y: Math.round(old.y) }, index)
      }))
    })
  }

  // Two stages (plan 0025): the first click arranges as before, the second
  // one, with nothing edited in between, also clears the bend points and the
  // tabs the user placed. The full arrange can be undone.
  const autoArrange = async () => {
    const step = G.arrangeStage({ armed }, 'click')
    armedPending.current = null
    setBusy(true)
    const before = { devices: schematic.devices, wires: schematic.wires, stubs: schematic.stubs || [] }
    const layout = tidied(G.autoLayout(dagre, pageDevices, onPage), null, !step.clear.tabs)
    setPos(layout)
    if (step.full) {
      setBends({})
      setStubPos({})
      await save(layout, {}, undefined, {})
      undo.offer({
        message: 'Everything on this page arranged.',
        onUndo: () => patchStored(() => ({ devices: before.devices, wires: before.wires, stubs: before.stubs }))
      })
    } else await save(layout, bends)
    if (step.armed) {
      armedPending.current = editKeyRef.current
      // when the layout did not change, no new data comes back: settle after a moment
      setTimeout(() => { if (armedPending.current !== null) { armedKey.current = editKeyRef.current; armedPending.current = null } }, 1500)
    } else armedKey.current = null
    setArmed(step.armed)
    setBusy(false)
    fitNow()
  }
  // Any change to the page, its devices or its cables disarms the second stage.
  const editKey = JSON.stringify([schematic.id, recordKey, devices.map((d) => [d.id, d.status]), cables.map((c) => [c.id, c.status])])
  const editKeyRef = useRef(editKey)
  editKeyRef.current = editKey
  useEffect(() => {
    if (busy) return
    if (armedPending.current !== null) {
      if (editKey !== armedPending.current) { armedKey.current = editKey; armedPending.current = null }
      return
    }
    if (armedKey.current !== null && armedKey.current !== editKey) { armedKey.current = null; setArmed(false) }
  }, [busy, editKey])

  // ---- Drawing wires ----
  // Where a dragged wire would land: a terminal, else any other device box.
  const wireTarget = (p, fromId) => {
    const t = G.hitTerminal(wireBoxes, p.x, p.y)
    if (t && t.deviceId !== fromId) return t
    const b = G.hitDevice(wireBoxes, p.x, p.y)
    return b && b.id !== fromId ? { deviceId: b.id, terminal: '', x: p.x, y: p.y } : null
  }

  const openPopover = (aId, ta, bId, tb, p) => {
    const start = startValues({
      a: deviceById.get(aId), ta, b: deviceById.get(bId), tb, cables: liveCables,
      defaults: wireRunInitialValues(settings)
    })
    const at = toScreen(p)
    const wrap = svgRef.current.parentElement.getBoundingClientRect()
    setPopover({ start, at: { x: Math.max(4, Math.min(at.x, wrap.width - 250)), y: Math.max(4, Math.min(at.y, wrap.height - 260)) } })
  }

  const createCable = async (payload, id) => {
    const cableId = id || newId()
    await putResource('wiringWireRuns', cableId, payload)
    const fresh = await fetchList('wiringCircuits')
    const mine = circuitsOfCable(cableId, fresh)
    setNotice(mine.length === 0
      ? 'Cable created. It is not part of a circuit yet.'
      : `Cable created. ${mine.map(({ circuit, via }) => circuitLine(circuit) + (via === 'return' ? ' (negative return)' : '')).join('; ')}`)
    setPopover(null)
    setMoreForm(null)
    setSelection({ type: 'wire', id: cableId })
    await reload()
  }

  // Reads the stored schematic, changes its lists and writes them back; used by
  // Undo, which may run after the layout in local state has moved on.
  const patchStored = async (change) => {
    const res = await fetch(`${RESOURCE_BASE}/wiringSchematics/${schematic.id}`)
    if (!res.ok) throw new Error(failureMessage(res.status))
    const stored = await res.json()
    await putResource('wiringSchematics', schematic.id, change(stored))
    await reload()
  }

  // No confirm dialog: the cable is marked removed, an Undo message is offered,
  // and when the window ends the cable is deleted for good.
  const deleteWire = async (cable) => {
    const label = cableTitle(cable, new Map(devices.map((d) => [d.id, d.name])))
    const savedBends = bends[cable.id]
    try {
      await deleteResource('wiringWireRuns', cable.id)
      const next = { ...bends }
      delete next[cable.id]
      setBends(next)
      setSelection(null)
      setNotice(null)
      onError(null)
      await reload()
      if (savedBends) await save(pos, next)
    } catch (err) { onError(err.message); return }
    offerCableUndo({
      undo, cable, title: label,
      notice: (message) => { if (!mounted.current) return false; setNotice(message); return true },
      restore: async () => {
        await putResource('wiringWireRuns', cable.id, { status: 'active' })
        if (savedBends && savedBends.length) {
          await patchStored((s) => ({ wires: G.withWireBends(s.wires || [], cable.id, savedBends) }))
        } else await reload()
        setSelection({ type: 'wire', id: cable.id })
      }
    })
  }

  const straighten = async (id) => {
    const next = { ...bends }
    delete next[id]
    setBends(next)
    await save(pos, next)
  }

  // Double-click or double-tap on a hand-routed wire gives it back to the
  // router (plan 0025): its bend points go, and Undo puts them back. A wire
  // without bend points ignores it.
  const autoRoute = async (id) => {
    const saved = bends[id]
    if (!saved || saved.length === 0 || Date.now() - autoRoutedAt.current < 700) return
    autoRoutedAt.current = Date.now()
    const next = { ...bends }
    delete next[id]
    setBends(next)
    await save(pos, next)
    undo.offer({
      message: 'Wire routed automatically.',
      onUndo: () => patchStored((st) => ({ wires: G.withWireBends(st.wires || [], id, saved) }))
    })
  }

  // ---- Keyboard ----
  // Attached for as long as the editor is mounted, so it is gone when another
  // tab is shown. Re-attached every render to see the latest state.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const cmd = G.keyCommand(e.key, {
        typing: G.isTypingTarget(e.target),
        drag: !!drag.current && (drag.current.kind !== 'pan' || drag.current.moved),
        popover: !!popover,
        tabMenu: !!tabMenu,
        moreForm: !!moreForm,
        selection
      })
      if (!cmd) return
      e.preventDefault()
      if (cmd.kind === 'cancel-drag') {
        drag.current = null
        setPreview(null)
        const p = {}
        for (const d of schematic.devices) p[d.deviceId] = { x: d.x, y: d.y }
        const b = {}
        for (const w of schematic.wires) b[w.wireRunId] = w.points
        const sp = {}
        for (const st of schematic.stubs || []) sp[st.wireRunId] = { x: st.x, y: st.y }
        setPos(p)
        setBends(b)
        setStubPos(sp)
        setShapes(schematic.zoneShapes || [])
      } else if (cmd.kind === 'close-popover') setPopover(null)
      else if (cmd.kind === 'close-tabmenu') setTabMenu(null)
      else if (cmd.kind === 'clear-selection') setSelection(null)
      else if (cmd.kind === 'delete-wire') {
        const w = wires.find((x) => x.id === cmd.id)
        if (w) deleteWire(w.stored)
      } else if (cmd.kind === 'remove-device') removeFromPage(cmd.id)
      else if (cmd.kind === 'delete-zone-shape') removeShape(cmd.id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // ---- Pointer handling ----
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const p = toCanvas(e)
    setTabMenu(null)
    try { svgRef.current.setPointerCapture(e.pointerId) } catch (err) { /* synthetic pointers cannot be captured */ }
    // A tab: a click opens its menu, a drag moves it (not in live mode).
    const tab = stubs.find((s) => p.x >= s.tab.x && p.x <= s.tab.x + s.tab.w && p.y >= s.tab.y && p.y <= s.tab.y + s.tab.h)
    if (tab) { drag.current = { kind: 'stub', stub: tab, dx: p.x - tab.tab.x, dy: p.y - tab.tab.y, sx: e.clientX, sy: e.clientY, moved: false }; return }
    if (liveOn) {
      const hit = G.hitDevice(boxes, p.x, p.y)
      if (hit) { liveToggle(hit.id); return }
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: { ...view }, moved: false }
      return
    }
    // Bend handles of the selected wire come first, since they sit on the wire.
    const sel = selectedWireId && wires.find((w) => w.id === selectedWireId)
    if (sel) {
      const cur = bends[sel.id] || []
      const bi = G.hitBend(cur, p.x, p.y)
      if (bi >= 0) {
        const now = Date.now()
        const last = lastBendDown.current
        lastBendDown.current = { wireId: sel.id, index: bi, t: now }
        if (last && last.wireId === sel.id && last.index === bi && now - last.t < DOUBLE_CLICK_MS) {
          const next = { ...bends, [sel.id]: cur.filter((_, i) => i !== bi) }
          setBends(next)
          save(pos, next)
          lastBendDown.current = null
          return
        }
        drag.current = { kind: 'bend', frozen: { ...view }, wireId: sel.id, index: bi, sx: e.clientX, sy: e.clientY, moved: false }
        return
      }
      const mids = midHandles(sel.path)
      const mi = mids.findIndex((m) => Math.hypot(m.x - p.x, m.y - p.y) <= 8)
      if (mi >= 0 && (sel.path[mi].x === sel.path[mi + 1].x || sel.path[mi].y === sel.path[mi + 1].y)) {
        // the handle of a horizontal or vertical segment moves that segment, perpendicular to itself
        drag.current = { kind: 'seg', frozen: { ...view }, wireId: sel.id, index: mi, path: sel.path, mid: mids[mi], sx: e.clientX, sy: e.clientY, moved: false }
        return
      }
      if (mi >= 0) {
        const index = G.insertBendIndex(sel.path, cur, mids[mi].x, mids[mi].y)
        const next = { ...bends, [sel.id]: [...cur.slice(0, index), { x: Math.round(mids[mi].x), y: Math.round(mids[mi].y) }, ...cur.slice(index)] }
        setBends(next)
        drag.current = { kind: 'bend', frozen: { ...view }, wireId: sel.id, index, sx: e.clientX, sy: e.clientY, moved: true, fresh: true }
        return
      }
    }
    // The handles of the selected zone shape sit on its outline, above devices.
    const selShape = selection && selection.type === 'zone' ? shapes.find((sh) => sh.zoneId === selection.id) : null
    if (selShape && selShape.kind === 'polygon') {
      const pts = selShape.points
      const ci = pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 9)
      if (ci >= 0) {
        const now = Date.now()
        const last = lastCornerDown.current
        lastCornerDown.current = { zoneId: selShape.zoneId, index: ci, t: now }
        if (last && last.zoneId === selShape.zoneId && last.index === ci && now - last.t < DOUBLE_CLICK_MS) {
          lastCornerDown.current = null
          const dropped = Z.dropCorner(selShape, ci)
          if (dropped !== selShape) {
            const next = Z.withShape(shapes, dropped)
            setShapes(next)
            save(pos, bends, undefined, stubPos, next)
          }
          return
        }
        drag.current = { kind: 'corner', orig: selShape, index: ci, sx: e.clientX, sy: e.clientY, moved: false }
        return
      }
      const mids = midpoints(pts)
      const mi = mids.findIndex((m) => Math.hypot(m.x - p.x, m.y - p.y) <= 8)
      if (mi >= 0) {
        const added = Z.addCorner(selShape, mi, { x: Math.round(mids[mi].x), y: Math.round(mids[mi].y) })
        setShapes(Z.withShape(shapes, added.shape))
        drag.current = { kind: 'corner', orig: added.shape, index: added.index, sx: e.clientX, sy: e.clientY, moved: true, fresh: true }
        return
      }
    } else if (selShape) {
      const h = Z.hitHandle(selShape, p.x, p.y)
      if (h) { drag.current = { kind: 'shape-resize', orig: selShape, handle: h, sx: e.clientX, sy: e.clientY, moved: false }; return }
    }
    const term = G.hitTerminal(wireBoxes, p.x, p.y)
    const handle = !term && wireBoxes.find((b) => Math.hypot(b.x + b.w / 2 - p.x, (b.bottomPorts ? b.y : b.y + b.h) - p.y) <= 9)
    if (term || handle) {
      const id = term ? term.deviceId : handle.id
      drag.current = { kind: 'wire', fromId: id, fromTerminal: term ? term.terminal : '', sx: e.clientX, sy: e.clientY, moved: false }
      return
    }
    const device = G.hitDevice(boxes, p.x, p.y)
    if (device) {
      // The second tap of a double tap opens the device and starts no drag.
      if (G.isDoubleTap(lastTap.current, { id: device.id, t: Date.now(), x: e.clientX, y: e.clientY })) {
        lastTap.current = null
        drag.current = null
        openBox(device.id)
        return
      }
      setSelection({ type: 'device', id: device.id })
      drag.current = { kind: 'move', id: device.id, dx: p.x - device.x, dy: p.y - device.y, sx: e.clientX, sy: e.clientY, moved: false }
      return
    }
    const wire = G.hitWire(wires, p.x, p.y)
    if (wire) {
      const tap = { id: wire.id, t: Date.now(), x: e.clientX, y: e.clientY }
      const twice = G.isDoubleTap(lastWireTap.current, tap)
      lastWireTap.current = twice ? null : tap
      setSelection({ type: 'wire', id: wire.id })
      if (twice) autoRoute(wire.id)
      return
    }
    // A zone shape takes the click on its outline or label, or anywhere inside
    // once it is selected (to move it); never otherwise.
    const picked = Z.pickShape(shown, zoneName, p.x, p.y, selShape ? selShape.zoneId : null)
    if (picked) {
      setSelection({ type: 'zone', id: picked.zoneId })
      drag.current = { kind: 'shape-move', orig: picked, px: p.x, py: p.y, sx: e.clientX, sy: e.clientY, moved: false }
      return
    }
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: { ...view }, moved: false }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > MOVE_SLOP_PX) d.moved = true
    if (!d.moved) return
    if (d.kind === 'move') {
      const p = toCanvas(e)
      setPos((cur) => ({ ...cur, [d.id]: { x: Math.round(p.x - d.dx), y: Math.round(p.y - d.dy) } }))
    } else if (d.kind === 'stub') {
      const p = toCanvas(e)
      setStubPos((cur) => ({ ...cur, [d.stub.cableId]: { x: Math.round(p.x - d.dx), y: Math.round(p.y - d.dy) } }))
    } else if (d.kind === 'shape-move') {
      const p = toCanvas(e)
      setShapes((cur) => Z.withShape(cur, Z.moveShape(d.orig, Math.round(p.x - d.px), Math.round(p.y - d.py))))
    } else if (d.kind === 'shape-resize') {
      const p = toCanvas(e)
      setShapes((cur) => Z.withShape(cur, Z.resizeShape(d.orig, d.handle, p.x, p.y, e.shiftKey)))
    } else if (d.kind === 'corner') {
      const p = toCanvas(e)
      const points = d.orig.points.map((q, i) => (i === d.index ? { x: Math.round(p.x), y: Math.round(p.y) } : q))
      setShapes((cur) => Z.withShape(cur, Z.withPoints(d.orig, points)))
    } else if (d.kind === 'seg') {
      const p = toCanvas(e)
      const a = d.path[d.index]
      const horiz = a.y === d.path[d.index + 1].y
      const moved = G.moveSegment(d.path, d.index, Math.round(horiz ? p.y - d.mid.y : p.x - d.mid.x))
      d.result = moved.slice(1, -1)
      setBends((cur) => ({ ...cur, [d.wireId]: d.result }))
    } else if (d.kind === 'bend') {
      const p = toCanvas(e)
      setBends((cur) => {
        const list = [...(cur[d.wireId] || [])]
        list[d.index] = { x: Math.round(p.x), y: Math.round(p.y) }
        return { ...cur, [d.wireId]: list }
      })
    } else if (d.kind === 'wire') {
      const p = toCanvas(e)
      const target = wireTarget(p, d.fromId)
      const fromBox = boxById.get(d.fromId)
      setPreview({ a: G.anchorOf(fromBox, d.fromTerminal, p), b: target ? { x: target.x, y: target.y } : p, targetId: target ? target.deviceId : null })
    } else if (d.kind === 'pan') {
      const svg = svgRef.current
      const rect = svg.getBoundingClientRect()
      const scale = Math.max(d.view.w / rect.width, d.view.h / rect.height)
      setVb({ ...d.view, x: d.view.x - (e.clientX - d.sx) * scale, y: d.view.y - (e.clientY - d.sy) * scale })
    }
  }

  const openDevice = (id) => { window.location.hash = G.deviceHash(id) }

  // An enclosure opens its inside page (made the first time); any other device opens its page.
  const opening = useRef(false) // a double click arrives as a double tap and a click event: open once
  const openInside = async (id) => {
    if (opening.current) return
    opening.current = true
    onError(null)
    try {
      const pageId = await ensureInsidePage(id)
      await reload()
      onOpen(pageId)
    } catch (err) { onError(err.message) } finally { opening.current = false }
  }
  const openBox = (id) => { if (isEnclosureBox(id)) openInside(id); else openDevice(id) }

  // A mouse double-click, for clicks slower than the double tap window.
  const onDblClick = (e) => {
    if (liveOn) return
    const p = toCanvas(e)
    if (G.hitTerminal(wireBoxes, p.x, p.y)) return
    const device = G.hitDevice(boxes, p.x, p.y)
    if (device) { openBox(device.id); return }
    const wire = G.hitWire(wires, p.x, p.y)
    if (wire) autoRoute(wire.id)
  }

  const onPointerUp = (e) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'move' && !d.moved) lastTap.current = { id: d.id, t: Date.now(), x: e.clientX, y: e.clientY }
    if (d.kind === 'move' && d.moved) {
      const next = tidied(pos, [d.id])
      if (next !== pos) setPos(next)
      save(next, bends)
    }
    if (d.kind === 'bend' && d.moved) save(pos, bends)
    if (d.kind === 'seg' && d.moved && d.result) save(pos, { ...bends, [d.wireId]: d.result })
    if ((d.kind === 'shape-move' || d.kind === 'shape-resize' || d.kind === 'corner') && d.moved) save(pos, bends, undefined, stubPos, shapes)
    if (d.kind === 'stub') {
      if (!d.moved) { setTabMenu({ stub: d.stub }); return }
      const at = stubPos[d.stub.cableId]
      const next = at ? { ...stubPos, [d.stub.cableId]: G.freeTabSpot(at, boxes, stubs.filter((x) => x.cableId !== d.stub.cableId).map((x) => x.tab)) } : stubPos
      setStubPos(next)
      save(pos, bends, undefined, next)
    }
    if (d.kind === 'wire') {
      setPreview(null)
      const p = toCanvas(e)
      const target = d.moved ? wireTarget(p, d.fromId) : null
      if (target) openPopover(d.fromId, d.fromTerminal, target.deviceId, target.terminal || '', p)
    }
    if (d.kind === 'pan' && !d.moved) setSelection(null)
  }

  const onDrop = (e) => {
    e.preventDefault()
    let item
    try { item = JSON.parse(e.dataTransfer.getData('text/plain')) } catch (err) { return }
    if (item && item.type && item.role) createDevice(item, toCanvas(e))
  }

  // ---- Highlighting ----
  const selectedWire = selection && selection.type === 'wire' ? wires.find((w) => w.id === selection.id) : null
  const wireCircuits = selectedWire
    ? circuits.filter((c) => isLive(c) && c.derived &&
        (c.derived.cableIds.includes(selectedWire.id) || c.derived.returnCableIds.includes(selectedWire.id)))
    : []
  const conduitLit = highlightId.startsWith('conduit:') ? conduitInfo.get(highlightId.slice(8)) : null
  const highlighted = [...(highlightId ? circuits.filter((c) => c.id === highlightId) : []), ...wireCircuits]
  const hl = { deviceIds: new Set(), cableIds: new Set() }
  if (conduitLit) {
    for (const c of onPage) {
      if ((c.conduitIds || []).includes(conduitLit.id)) { hl.cableIds.add(c.id); hl.deviceIds.add(c.fromDeviceId); hl.deviceIds.add(c.toDeviceId) }
    }
  }
  for (const c of highlighted) {
    const h = G.circuitHighlight(c)
    h.deviceIds.forEach((x) => hl.deviceIds.add(x))
    h.cableIds.forEach((x) => hl.cableIds.add(x))
  }
  // A circuit through a device inside an enclosure lights the enclosure's box.
  for (const id of [...hl.deviceIds]) { const r = model.repOf(id); if (r) hl.deviceIds.add(r) }
  const dimming = highlighted.length > 0 || (conduitLit && hl.cableIds.size > 0)
  const pageCircuits = circuits.filter((c) => isLive(c) && c.derived && c.derived.deviceIds.some((id) => boxById.has(model.repOf(id) || id)))

  // A device inside an enclosure is placed on that enclosure's inside page only.
  const addable = devices.filter((d) => isLive(d) && !pos[d.id] && d.id !== schematic.enclosureId && (!d.parentId || d.parentId === schematic.enclosureId)).sort((a, b) => a.name.localeCompare(b.name))
  const otherPages = (deviceId) => schematics.filter((s) => isLive(s) && s.id !== schematic.id && s.devices.some((d) => d.deviceId === deviceId))
  const selectedShape = selection && selection.type === 'zone' ? shown.find((sh) => sh.zoneId === selection.id) : null
  const selectedDevice = selection && selection.type === 'device' ? deviceById.get(selection.id) : null
  // The page this one is the inside of, and the pages that show that enclosure.
  const insideOf = schematic.enclosureId ? deviceById.get(schematic.enclosureId) : null
  const outerPages = schematic.enclosureId
    ? schematics.filter((s) => isLive(s) && s.id !== schematic.id && s.devices.some((d) => d.deviceId === schematic.enclosureId))
    : []

  const renameBox = renaming && boxById.get(renaming.id)
  const renameAt = renameBox && svgRef.current ? toScreen({ x: renameBox.x, y: renameBox.y }) : null
  const scaleX = svgRef.current ? svgRef.current.getBoundingClientRect().width / view.w : 1

  return html`
    <div class="schematic-editor">
      <div class="back-link" onClick=${onBack}>← All schematics</div>
      <h2 class="schematic-title">${schematic.name}</h2>
      ${schematic.enclosureId && html`
        <div class="meta schematic-inside" data-testid="inside-header">
          ${'Inside of '}<a href=${G.deviceHash(schematic.enclosureId)}>${insideOf ? insideOf.name : 'an enclosure'}</a>${insideOf && insideText(devices, insideOf.id) ? ' (in ' + insideText(devices, insideOf.id) + ')' : ''}${'. '}
          ${outerPages.length > 0
            ? html`${'Back to '}${outerPages.map((p, i) => html`${i > 0 ? ', ' : ''}<a href="#" data-testid="outer-link" onClick=${(e) => { e.preventDefault(); onOpen(p.id) }}>${p.name}</a>`)}${'. '}`
            : 'The enclosure is not on any other page yet. '}
          ${'Cables that leave it end in "to" tabs.'}
        </div>`}
      <div class="schematic-toolbar">
        <select value=${addId} data-testid="add-existing" onChange=${(e) => { setAddId(e.target.value); addExisting(e.target.value) }}>
          <option value="">Add existing device…</option>
          ${addable.map((d) => html`<option value=${d.id} key=${d.id}>${d.name} (${roleLabel(d.role)})</option>`)}
        </select>
        <select value=${shapeKind} data-testid="shape-kind" title="Shape of a new zone" onChange=${(e) => setShapeKind(e.target.value)}>
          ${Z.SHAPE_KINDS.map((k) => html`<option value=${k.value} key=${k.value}>${k.label}</option>`)}
        </select>
        <select value="" data-testid="add-zone" disabled=${zones.length === 0} title=${zones.length === 0 ? 'Create zones on the Zones tab first' : 'Draw a zone on this page'}
          onChange=${(e) => { const id = e.target.value; e.target.value = ''; addShape(id, shapeKind) }}>
          <option value="">Add zone…</option>
          ${Z.addableZones(zones, shapes).map((z) => html`<option value=${z.id} key=${z.id}>${z.name}</option>`)}
        </select>
        <button type="button" class=${liveOn ? 'active' : ''} data-testid="schematic-live" onClick=${() => { setLiveOn((v) => !v); onError(null) }}>${liveOn ? 'Live: on' : 'Live'}</button>
        <button type="button" data-testid="auto-arrange" onClick=${autoArrange} disabled=${busy || boxes.length === 0}>${armed ? G.ARRANGE_ALL_LABEL : G.ARRANGE_LABEL}</button>
        <button type="button" onClick=${() => zoomAt(ZOOM_STEP)}>＋</button>
        <button type="button" onClick=${() => zoomAt(1 / ZOOM_STEP)}>－</button>
        <button type="button" onClick=${fitNow}>Fit</button>
        <select value=${highlightId} onChange=${(e) => setHighlightId(e.target.value)} data-testid="highlight-circuit">
          <option value="">Highlight a circuit…</option>
          ${pageCircuits.map((c) => html`<option value=${c.id} key=${c.id}>${c.name}</option>`)}
          ${bands.map((b) => html`<option value=${'conduit:' + b.conduitId} key=${'conduit:' + b.conduitId}>${(conduitInfo.get(b.conduitId) || {}).name || b.label} (conduit)</option>`)}
        </select>
      </div>
      <div class="meta schematic-legend" data-testid="schematic-legend">Double-click (or double-tap) a device to open it; an enclosure opens its inside page. Solid lines are DC, dashed lines are AC. The symbol on a port shows its conductor: = DC, ~ AC, a two-way arrow signal, the earth symbol earth or protective ground. A thin line beside a wire is its second conductor. A shaded band around wires is a conduit or hose.</div>
      ${overlapping && html`<div class="meta schematic-notice" data-testid="overlap-notice">Some devices overlap. <button type="button" class="link-btn" data-testid="tidy" onClick=${tidyAll}>Tidy</button></div>`}
      ${liveOn && html`<${LiveBar} live=${live} error=${live.error} />`}
      ${notice && html`<div class="meta schematic-notice" data-testid="notice">${notice}</div>`}
      ${moreForm && html`
        <div class="schematic-moreform">
          ${renderCableForm({
            cable: moreForm.cable,
            prefill: moreForm.prefill,
            devices,
            cables,
            circuits,
            onDevicesChanged: reload,
            onSaved: (payload, id) => createCable(payload, id),
            onCancel: () => setMoreForm(null)
          })}
        </div>`}
      <div class="schematic-layout" style=${moreForm ? 'display:none' : ''}>
        <aside class="schematic-palette">
          <h3>New device</h3>
          ${PALETTE.map((group) => html`
            <div key=${group.title} class="palette-group">
              <div class="palette-title">${group.title}</div>
              ${group.items.map((item) => html`
                <button type="button" key=${item.role + item.type} class="palette-item" draggable="true"
                  data-testid="palette-item"
                  onDragStart=${(e) => e.dataTransfer.setData('text/plain', JSON.stringify(item))}
                  onClick=${() => createDevice(item)}>${item.type}</button>
              `)}
            </div>
          `)}
        </aside>
        <div class="schematic-canvas-wrap">
          <svg ref=${svgRef} class="schematic-canvas" data-testid="schematic-canvas"
            viewBox="${view.x} ${view.y} ${view.w} ${view.h}"
            onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onDblClick=${onDblClick}
            onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}>
            <${ZoneShapes} shapes=${shown} nameOf=${zoneName} selectedId=${selection && selection.type === 'zone' ? selection.id : null} />
            ${bands.map((b) => html`<${ConduitBand} key=${b.conduitId} band=${b} />`)}
            ${wires.map((w) => html`<${WireShape} key=${w.id} wire=${w} deviceName=${deviceName}
              selected=${!!selection && selection.type === 'wire' && selection.id === w.id}
              dim=${dimming && !hl.cableIds.has(w.id)} lit=${dimming && hl.cableIds.has(w.id)} />`)}
            ${stubs.map((s) => html`<${StubShape} key=${s.cableId} stub=${s} />`)}
            ${selectedWireId && html`<${BendHandles} wire=${wires.find((w) => w.id === selectedWireId)} bends=${bends[selectedWireId] || []} />`}
            ${boxes.map((b) => html`<${DeviceShape} key=${b.id} box=${b} device=${drawnById.get(b.id)}
              selected=${!!selection && selection.type === 'device' && selection.id === b.id}
              target=${!!preview && preview.targetId === b.id}
              live=${liveOn ? (live.info(b.id) || { look: 'none' }) : null}
              dim=${dimming && !hl.deviceIds.has(b.id)} lit=${dimming && hl.deviceIds.has(b.id)} />`)}
            ${selection && selection.type === 'zone' && html`<${ZoneHandles} shape=${shown.find((sh) => sh.zoneId === selection.id)} />`}
            ${preview && html`<path class="sch-preview" d=${G.pathToD([preview.a, preview.b])} />`}
          </svg>
          ${popover && html`<${CablePopover} start=${popover.start}
            style=${`left:${popover.at.x}px;top:${popover.at.y}px`}
            onCreate=${(payload) => createCable(payload)}
            onMore=${(values) => { setMoreForm({ prefill: values }); setPopover(null) }}
            onCancel=${() => setPopover(null)} />`}
          ${boxes.length === 0 && html`<div class="schematic-empty meta">Empty page. Add an existing device from the list above, or click or drag a type from the palette to make a new one.</div>`}
          ${renaming && renameAt && html`
            <input type="text" class="schematic-rename" data-testid="rename-input" autofocus
              style="left:${renameAt.x}px;top:${renameAt.y}px;width:${G.BOX_W * scaleX}px"
              value=${renaming.text}
              ref=${(el) => { if (el && renaming.fresh && !renaming.focused) { renaming.focused = true; el.focus(); el.select() } }}
              onInput=${(e) => setRenaming({ ...renaming, text: e.target.value })}
              onBlur=${commitRename}
              onKeyDown=${(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }} />`}
          ${tabMenu && html`<${TabMenu} stub=${tabMenu.stub} pages=${otherPages(tabMenu.stub.otherDeviceId)}
            deviceName=${deviceName(tabMenu.stub.otherDeviceId)} placed=${!!pos[tabMenu.stub.otherDeviceId]}
            onGo=${(id) => onOpen(id)} onAdd=${() => { const t = tabMenu.stub.tab; setTabMenu(null); addExisting(tabMenu.stub.otherDeviceId, { x: t.x + t.w / 2 + (tabMenu.stub.side === 'right' ? 120 : -120), y: t.y + t.h / 2 }) }}
            onClose=${() => setTabMenu(null)} />`}
        </div>
      </div>
      ${selectedWire && html`
        <div class="schematic-inspector" data-testid="wire-inspector">
          <strong>${cableTitle(selectedWire.stored, new Map(devices.map((d) => [d.id, d.name])))}</strong>
          <span class="meta">${selectedWire.cable.conductors.length ? selectedWire.cable.conductors.map((c) => CONDUCTOR_LABELS[c.conductor] || c.conductor).join(' + ') : 'Positive'}${selectedWire.cable.gauge != null ? ', ' + formatGauge(selectedWire.cable.gauge, selectedWire.cable.gaugeUnit) : ''}${selectedWire.cable.length != null ? ', ' + selectedWire.cable.length + ' ' + (selectedWire.cable.lengthUnit || '') : ''}</span>
          <span class="meta" data-testid="wire-circuits">${wireCircuits.length ? wireCircuits.map(circuitLine).join('; ') : 'Not part of a circuit yet.'}</span>
          <button type="button" class="link-btn" onClick=${() => setMoreForm({ cable: selectedWire.stored })}>Edit cable</button>
          ${(bends[selectedWire.id] || []).length > 0 && html`<button type="button" class="link-btn" onClick=${() => straighten(selectedWire.id)}>Straighten</button>`}
          <button type="button" class="link-btn" data-testid="delete-wire" onClick=${() => deleteWire(selectedWire.stored)}>Delete wire</button>
          <span class="meta">Drag the small dot on a stretch to move that stretch; drag a corner dot to bend the wire; double-click a corner dot to remove it, or the wire itself to route it again.</span>
        </div>`}
      ${selectedShape && html`
        <div class="schematic-inspector" data-testid="zone-inspector">
          <strong>${zoneName(selectedShape.zoneId)}</strong>
          <span class="meta">Zone shape, ${(Z.SHAPE_KINDS.find((k) => k.value === selectedShape.kind) || {}).label.toLowerCase()}. Drawing only: it does not set the zone of a device.</span>
          <button type="button" class="link-btn" data-testid="remove-zone-shape" onClick=${() => removeShape(selectedShape.zoneId)}>Remove shape</button>
          <span class="meta">${selectedShape.kind === 'polygon' ? 'Drag a corner to move it, drag a midpoint dot to add a corner, double-click a corner to remove it.' : 'Drag the squares to resize; hold Shift for a circle or square.'}</span>
        </div>`}
      ${selectedDevice && html`
        <div class="schematic-inspector" data-testid="inspector">
          <strong>${selectedDevice.name}</strong>
          <span class="meta">${roleLabel(selectedDevice.role)}${selectedDevice.type ? ', ' + selectedDevice.type : ''}</span>
          ${selectedDevice.role === 'enclosure' && html`<button type="button" class="link-btn" data-testid="open-inside" onClick=${() => openInside(selectedDevice.id)}>Open inside schematic</button>`}
          ${selectedDevice.role === 'enclosure' && html`<button type="button" class="link-btn" data-testid="open-device-page" onClick=${() => openDevice(selectedDevice.id)}>Open device page</button>`}
          <button type="button" class="link-btn" onClick=${() => setRenaming({ id: selectedDevice.id, text: selectedDevice.name, fresh: true })}>Rename</button>
          <button type="button" class="link-btn" data-testid="remove-from-page" onClick=${() => removeFromPage(selectedDevice.id)}>Remove from this page</button>
          <span class="meta">Takes it off this page only; the device and its cables stay.</span>
        </div>`}
    </div>
  `
}

// ---- Shapes ----------------------------------------------------------------

// Zone shapes on the background layer: they never take pointer events, the
// canvas hit-tests their outline and label itself.
function ZoneShapes ({ shapes, nameOf, selectedId }) {
  return html`
    <g class="sch-zones">
      ${shapes.map((s) => {
        const at = Z.labelAt(s)
        const cls = `sch-zone${s.zoneId === selectedId ? ' selected' : ''}`
        return html`
          <g key=${s.zoneId} class=${cls} data-zone-shape=${s.zoneId} data-kind=${s.kind}>
            ${s.kind === 'rect' && html`<rect x=${s.x} y=${s.y} width=${s.width} height=${s.height} rx="4" class="sch-zone-shape" />`}
            ${s.kind === 'oval' && html`<ellipse cx=${s.x + s.width / 2} cy=${s.y + s.height / 2} rx=${s.width / 2} ry=${s.height / 2} class="sch-zone-shape" />`}
            ${s.kind === 'polygon' && html`<path d=${G.pathToD(s.points) + ' Z'} class="sch-zone-shape" stroke-linejoin="round" />`}
            <text x=${at.x} y=${at.y} class="sch-zone-label">${shorten(nameOf(s.zoneId), 28)}</text>
          </g>`
      })}
    </g>
  `
}

// The handles of the selected shape: eight squares for a rectangle or oval; a
// dot at each corner and a smaller one at each side's midpoint for a polygon.
function ZoneHandles ({ shape }) {
  if (!shape) return null
  if (shape.kind === 'polygon') {
    return html`
      <g class="sch-bend-handles" data-testid="zone-handles">
        ${midpoints(shape.points).map((m, i) => html`<circle key=${'m' + i} cx=${m.x} cy=${m.y} r="5" class="sch-bend-add" data-testid="zone-mid" />`)}
        ${shape.points.map((q, i) => html`<circle key=${'c' + i} cx=${q.x} cy=${q.y} r="6" class="sch-bend" data-testid="zone-corner" />`)}
      </g>`
  }
  return html`
    <g class="sch-zone-handles" data-testid="zone-handles">
      ${Z.handlePositions(shape).map((h) => html`<rect key=${h.id} x=${h.x - 5} y=${h.y - 5} width="10" height="10" class="sch-zone-handle" data-handle=${h.id} />`)}
    </g>`
}

function DeviceShape ({ box, device, selected, dim, lit, target, live }) {
  const liveClass = live ? ` live-${live.look}${live.clickable ? ' live-clickable' : ''}` : ''
  const cls = `sch-device role-${device.role || 'consumer'}${device.isEnclosure ? ' sch-enclosure' : ''}${target ? ' sch-connect-target' : ''}${selected ? ' selected' : ''}${dim ? ' dim' : ''}${lit ? ' lit' : ''}${liveClass}`
  return html`
    <g class=${cls} transform="translate(${box.x}, ${box.y})" data-device=${box.id} data-live=${live ? live.look : undefined}>
      ${live && live.title && html`<title>${live.title}</title>`}
      <rect width=${box.w} height=${box.h} rx="5" class="sch-device-box" />
      <text x=${box.w / 2} y="14" text-anchor="middle" class="sch-device-name">${shorten(device.name, 22)}</text>
      ${device.isEnclosure
        ? html`<text x=${box.w / 2} y="25" text-anchor="middle" class="sch-device-type" data-testid="enclosure-holds">${shorten(device.type || 'Enclosure', 18)}, holds ${device.holds}</text>
            <g class="sch-enclosure-link" data-testid="enclosure-link" transform=${'translate(' + (box.w - 16) + ' 4)'}><title>Double-click to open the inside</title><rect width="12" height="12" rx="2" /><path d="M3 9 L9 3 M5 3 H9 V7" /></g>`
        : device.type && html`<text x=${box.w / 2} y="25" text-anchor="middle" class="sch-device-type">${shorten(device.type, 26)}</text>`}
      ${live && live.look === 'locked' && html`<${LiveLock} x=${box.w - 10} y=${10} size=${13} />`}
      ${live && html`<${LiveReading} x=${box.w / 2} y=${box.bottomPorts ? 26 : box.h - 5} size=${live.reading && live.reading.length > 28 ? 8.5 : 10} text=${live.reading} stale=${live.stale} />`}
      ${!live && !device.isEnclosure && html`<circle cx=${box.w / 2} cy=${box.bottomPorts ? 0 : box.h} r="6" class="sch-connect-handle" data-testid="connect-handle"><title>Drag to connect</title></circle>`}
      <${PortBlocks} box=${box} labels=${!!device.isEnclosure} />
    </g>
  `
}

function cableLine (cable, deviceName) {
  const parts = [cable.cableLabel || `${deviceName(cable.fromDeviceId) || '?'} to ${deviceName(cable.toDeviceId) || '?'}`]
  if (cable.gauge != null) parts.push(formatGauge(cable.gauge, cable.gaugeUnit))
  if (cable.length != null) parts.push(`${cable.length} ${cable.lengthUnit || ''}`.trim())
  return parts.join(', ')
}

function WireShape ({ wire, deviceName, selected, dim, lit }) {
  const types = G.conductorTypes(wire.cable)
  const style = G.wireLineStyle(wire.cable)
  const d = G.pathToDWithBridges(wire.path, wire.bridges)
  const paired = types.length > 1 ? G.pathToD(G.offsetPath(wire.path, 4)) : null
  const cls = `sch-wire${selected ? ' selected' : ''}${dim ? ' dim' : ''}${lit ? ' lit' : ''}`
  return html`
    <g class=${cls} data-wire=${wire.id} data-current=${style.current || ''}>
      <path d=${d} class="sch-wire-line c-${types[0]}" stroke-dasharray=${style.dasharray || undefined}><title>${cableLine(wire.stored || wire.cable, deviceName)}</title></path>
      ${paired && html`<path d=${paired} class="sch-wire-pair c-${types[1]}" stroke-dasharray=${style.dasharray || undefined} />`}
    </g>
  `
}

// A conduit or hose: a thin outlined band with a faint fill around the shared
// stretches of its wires, stacked wider for a wire in several conduits, and
// labelled at its start. The outline is drawn as a wider stroke under a
// narrower fill stroke, so overlapping wires give one outline.
function ConduitBand ({ band }) {
  const w = 16 + band.layer * 8
  const ds = band.stretches.map((p) => G.pathToD(p))
  const at = band.labelPos
  return html`
    <g class="sch-conduit" data-conduit=${band.conduitId}>
      ${ds.map((d, i) => html`<path key=${'o' + i} d=${d} class="sch-conduit-outline" stroke-width=${w + 2} />`)}
      ${ds.map((d, i) => html`<path key=${'f' + i} d=${d} class="sch-conduit-fill" stroke-width=${w} />`)}
      <text x=${at.x} y=${at.y} class="sch-conduit-label">${shorten(band.label, 40)}</text>
    </g>
  `
}

// The line to a tab is drawn like the wire it stands for (conductor colours,
// a second conductor line, DC solid or AC dashed); the tab
// stays the off-page marker.
function StubShape ({ stub }) {
  const types = G.conductorTypes(stub.cable)
  const style = G.wireLineStyle(stub.cable)
  const paired = types.length > 1 ? G.pathToD(G.offsetPath(stub.path, 4)) : null
  return html`
    <g class="sch-stub" data-stub=${stub.cableId} data-current=${style.current || ''}>
      <path d=${G.pathToDWithBridges(stub.path, stub.bridges || [])} class=${'sch-wire-line sch-stub-line c-' + types[0]} stroke-dasharray=${style.dasharray || undefined} />
      ${paired && html`<path d=${paired} class=${'sch-wire-pair c-' + types[1]} stroke-dasharray=${style.dasharray || undefined} />`}
      <rect x=${stub.tab.x} y=${stub.tab.y} width=${stub.tab.w} height=${stub.tab.h} rx="3" class="sch-tab" />
      <text x=${stub.tab.x + stub.tab.w / 2} y=${stub.tab.y + 14} text-anchor="middle" class="sch-tab-label">${shorten(stub.label, 20)}</text>
    </g>
  `
}

function TabMenu ({ stub, pages, deviceName, placed, onGo, onAdd, onClose }) {
  return html`
    <div class="schematic-tabmenu" data-testid="tab-menu" onPointerDown=${(e) => e.stopPropagation()}>
      <strong>${deviceName || 'Device'}</strong>
      ${pages.map((p) => html`<button type="button" key=${p.id} onClick=${() => onGo(p.id)}>Go to ${p.name}</button>`)}
      ${!placed && html`<button type="button" data-testid="tab-add" onClick=${onAdd}>Add to this page</button>`}
      <button type="button" class="link-btn" onClick=${onClose}>Close</button>
    </div>
  `
}

// The points halfway along each segment of a path, where a drag adds a bend.
function midHandles (path) {
  const out = []
  for (let i = 1; i < path.length; i++) {
    out.push({ x: (path[i - 1].x + path[i].x) / 2, y: (path[i - 1].y + path[i].y) / 2 })
  }
  return out
}

function BendHandles ({ wire, bends }) {
  if (!wire) return null
  return html`
    <g class="sch-bend-handles">
      ${midHandles(wire.path).map((m, i) => html`<circle key=${'m' + i} cx=${m.x} cy=${m.y} r="5" class="sch-bend-add" />`)}
      ${bends.map((b, i) => html`<circle key=${'b' + i} cx=${b.x} cy=${b.y} r="6" class="sch-bend" data-testid="bend" />`)}
    </g>
  `
}
