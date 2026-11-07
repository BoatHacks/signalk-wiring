import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js'
import dagre from './vendor/dagre.esm.js'
import { newId } from './ids.js'
import { TYPE_SUGGESTIONS } from './deviceTypes.js'
import { roleLabel } from './roles.js'
import * as G from './schematic.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'
const ZOOM_STEP = 1.25
const MOVE_SLOP_PX = 3

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

async function putResource (type, id, value) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!res.ok) throw new Error(failureMessage(res.status))
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

function isLive (record) {
  return record && record.status !== 'removed'
}

// ---- The tab ---------------------------------------------------------------

export function SchematicsTab ({ renderCableForm }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchList('wiringSchematics'), fetchList('wiringDevices'),
      fetchList('wiringWireRuns'), fetchList('wiringCircuits')
    ]).then(([schematics, devices, cables, circuits]) => {
      if (!cancelled) setData({ schematics, devices, cables, circuits })
    }).catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)
  if (!data) return html`<p class="meta">${error || 'Loading…'}</p>`

  const schematic = selectedId && data.schematics.find((s) => s.id === selectedId && isLive(s))
  return html`
    <div>
      ${error && html`<div class="error-banner">${error}</div>`}
      ${schematic
        ? html`<${SchematicEditor} key=${schematic.id} schematic=${schematic} data=${data}
            reload=${reload} onBack=${() => setSelectedId(null)} onOpen=${setSelectedId}
            onError=${setError} renderCableForm=${renderCableForm} />`
        : html`<${SchematicList} schematics=${data.schematics.filter(isLive)} reload=${reload}
            onOpen=${setSelectedId} onError=${setError} />`}
    </div>
  `
}

function SchematicList ({ schematics, reload, onOpen, onError }) {
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

  return html`
    <div>
      <form class="inline-form" onSubmit=${create}>
        <div class="row-actions">
          <input type="text" value=${name} placeholder="New schematic, e.g. 12 V system"
            data-testid="new-schematic-name" onInput=${(e) => setName(e.target.value)} />
          <button type="submit" data-testid="new-schematic">Add schematic</button>
        </div>
      </form>
      ${schematics.length === 0 && html`<p class="meta">No schematics yet. A schematic is a diagram of part of the electrical system, for example "12 V system" or "Shore power and inverter". A device can be on several.</p>`}
      <ul class="plain-list">
        ${schematics.map((s) => html`
          <li key=${s.id} class="list-row">
            ${renaming === s.id
              ? html`<input type="text" value=${renameText} autofocus
                  onInput=${(e) => setRenameText(e.target.value)}
                  onBlur=${() => rename(s)}
                  onKeyDown=${(e) => { if (e.key === 'Enter') rename(s); if (e.key === 'Escape') setRenaming(null) }} />`
              : html`<a class="row-title" href="#" onClick=${(e) => { e.preventDefault(); onOpen(s.id) }}>${s.name}</a>`}
            <span class="meta">${s.devices.length} device${s.devices.length === 1 ? '' : 's'}</span>
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
  const [pos, setPos] = useState({})
  const [bends, setBends] = useState({})
  const [vb, setVb] = useState(null)
  const [selection, setSelection] = useState(null) // { type: 'device' | 'wire', id }
  const [highlightId, setHighlightId] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, text }
  const [tabMenu, setTabMenu] = useState(null)
  const [addId, setAddId] = useState('')
  const [busy, setBusy] = useState(false)

  const { devices, cables, circuits, schematics } = data
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const deviceName = (id) => (deviceById.get(id) || {}).name

  // Layout lives in local state while it is being dragged and is written
  // when the drag ends. It is reset from the record whenever that changes.
  const recordKey = JSON.stringify([schematic.devices, schematic.wires])
  useEffect(() => {
    const p = {}
    for (const d of schematic.devices) p[d.deviceId] = { x: d.x, y: d.y }
    const b = {}
    for (const w of schematic.wires) b[w.wireRunId] = w.points
    setPos(p)
    setBends(b)
  }, [recordKey])

  const pageDevices = schematic.devices
    .map((d) => deviceById.get(d.deviceId))
    .filter((d) => isLive(d) && pos[d.id])
  const boxes = pageDevices.map((d) => G.deviceBox(d, pos[d.id]))
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  const liveCables = cables.filter(isLive)
  const onPage = liveCables.filter((c) => boxById.has(c.fromDeviceId) && boxById.has(c.toDeviceId))
  const lanes = G.assignLanes(onPage.map((c) => ({ id: c.id, a: c.fromDeviceId, b: c.toDeviceId })))
  const wires = onPage.map((c) => {
    const t = G.endTerminals(c)
    return {
      id: c.id,
      cable: c,
      path: G.wirePath({
        fromBox: boxById.get(c.fromDeviceId),
        toBox: boxById.get(c.toDeviceId),
        fromTerminal: t.from,
        toTerminal: t.to,
        lane: lanes[c.id] || 0,
        points: bends[c.id] || []
      })
    }
  })
  const stubs = G.offPageStubs({ boxes: boxById, cables: liveCables, deviceName })

  const view = vb || G.fitView(boxes)
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
      const v = cur || G.fitView(boxes)
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
  const save = async (nextPos, nextBends, order) => {
    const ids = order || schematic.devices.map((d) => d.deviceId)
    try {
      await putResource('wiringSchematics', schematic.id, {
        devices: ids.filter((id) => nextPos[id]).map((id) => ({ deviceId: id, x: Math.round(nextPos[id].x), y: Math.round(nextPos[id].y) })),
        wires: Object.entries(nextBends)
          .filter(([id, pts]) => pts && pts.length > 0 && liveCables.some((c) => c.id === id))
          .map(([wireRunId, points]) => ({ wireRunId, points }))
      })
      onError(null)
      await reload()
    } catch (err) { onError(err.message) }
  }

  const centre = () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 })

  const addExisting = async (id, at) => {
    if (!id || pos[id]) return
    const c = at || centre()
    const n = Object.keys(pos).length
    const next = { ...pos, [id]: { x: c.x - G.BOX_W / 2 + (at ? 0 : (n % 5) * 24), y: c.y - 23 + (at ? 0 : (n % 5) * 24) } }
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
      await putResource('wiringDevices', id, { name: uniqueName(item.type), type: item.type, role: item.role })
      const next = { ...pos, [id]: { x: Math.round(c.x - G.BOX_W / 2), y: Math.round(c.y - 23) } }
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

  const removeFromPage = async (id) => {
    const next = { ...pos }
    delete next[id]
    setSelection(null)
    await save(next, bends, schematic.devices.map((d) => d.deviceId).filter((x) => x !== id))
  }

  const autoArrange = async () => {
    setBusy(true)
    const layout = G.autoLayout(dagre, pageDevices, onPage)
    setPos(layout)
    await save(layout, bends)
    setBusy(false)
    fitNow()
  }

  // ---- Pointer handling ----
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const p = toCanvas(e)
    setTabMenu(null)
    const tab = stubs.find((s) => p.x >= s.tab.x && p.x <= s.tab.x + s.tab.w && p.y >= s.tab.y && p.y <= s.tab.y + s.tab.h)
    if (tab) { setTabMenu({ stub: tab }); return }
    const device = G.hitDevice(boxes, p.x, p.y)
    try { svgRef.current.setPointerCapture(e.pointerId) } catch (err) { /* synthetic pointers cannot be captured */ }
    if (device) {
      setSelection({ type: 'device', id: device.id })
      drag.current = { kind: 'move', id: device.id, dx: p.x - device.x, dy: p.y - device.y, sx: e.clientX, sy: e.clientY, moved: false }
      return
    }
    const wire = G.hitWire(wires, p.x, p.y)
    if (wire) { setSelection({ type: 'wire', id: wire.id }); return }
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
    } else if (d.kind === 'pan') {
      const svg = svgRef.current
      const rect = svg.getBoundingClientRect()
      const scale = Math.max(d.view.w / rect.width, d.view.h / rect.height)
      setVb({ ...d.view, x: d.view.x - (e.clientX - d.sx) * scale, y: d.view.y - (e.clientY - d.sy) * scale })
    }
  }

  const onPointerUp = (e) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'move' && d.moved) save(pos, bends)
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
  const highlighted = [...(highlightId ? circuits.filter((c) => c.id === highlightId) : []), ...wireCircuits]
  const hl = { deviceIds: new Set(), cableIds: new Set() }
  for (const c of highlighted) {
    const h = G.circuitHighlight(c)
    h.deviceIds.forEach((x) => hl.deviceIds.add(x))
    h.cableIds.forEach((x) => hl.cableIds.add(x))
  }
  const dimming = highlighted.length > 0
  const pageCircuits = circuits.filter((c) => isLive(c) && c.derived && c.derived.deviceIds.some((id) => boxById.has(id)))

  const addable = devices.filter((d) => isLive(d) && !pos[d.id]).sort((a, b) => a.name.localeCompare(b.name))
  const otherPages = (deviceId) => schematics.filter((s) => isLive(s) && s.id !== schematic.id && s.devices.some((d) => d.deviceId === deviceId))
  const selectedDevice = selection && selection.type === 'device' ? deviceById.get(selection.id) : null

  const renameBox = renaming && boxById.get(renaming.id)
  const renameAt = renameBox && svgRef.current ? toScreen({ x: renameBox.x, y: renameBox.y }) : null
  const scaleX = svgRef.current ? svgRef.current.getBoundingClientRect().width / view.w : 1

  return html`
    <div class="schematic-editor">
      <div class="back-link" onClick=${onBack}>← All schematics</div>
      <h2 class="schematic-title">${schematic.name}</h2>
      <div class="schematic-toolbar">
        <select value=${addId} data-testid="add-existing" onChange=${(e) => { setAddId(e.target.value); addExisting(e.target.value) }}>
          <option value="">Add existing device…</option>
          ${addable.map((d) => html`<option value=${d.id} key=${d.id}>${d.name} (${roleLabel(d.role)})</option>`)}
        </select>
        <button type="button" data-testid="auto-arrange" onClick=${autoArrange} disabled=${busy || boxes.length === 0}>Auto-arrange</button>
        <button type="button" onClick=${() => zoomAt(ZOOM_STEP)}>＋</button>
        <button type="button" onClick=${() => zoomAt(1 / ZOOM_STEP)}>－</button>
        <button type="button" onClick=${fitNow}>Fit</button>
        <select value=${highlightId} onChange=${(e) => setHighlightId(e.target.value)} data-testid="highlight-circuit">
          <option value="">Highlight a circuit…</option>
          ${pageCircuits.map((c) => html`<option value=${c.id} key=${c.id}>${c.name}</option>`)}
        </select>
      </div>
      <div class="schematic-layout">
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
            onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
            onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}>
            ${wires.map((w) => html`<${WireShape} key=${w.id} wire=${w} deviceName=${deviceName}
              selected=${!!selection && selection.type === 'wire' && selection.id === w.id}
              dim=${dimming && !hl.cableIds.has(w.id)} lit=${dimming && hl.cableIds.has(w.id)} />`)}
            ${stubs.map((s) => html`<${StubShape} key=${s.cableId} stub=${s} />`)}
            ${boxes.map((b) => html`<${DeviceShape} key=${b.id} box=${b} device=${deviceById.get(b.id)}
              selected=${!!selection && selection.type === 'device' && selection.id === b.id}
              dim=${dimming && !hl.deviceIds.has(b.id)} lit=${dimming && hl.deviceIds.has(b.id)} />`)}
          </svg>
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
      ${selectedDevice && html`
        <div class="schematic-inspector" data-testid="inspector">
          <strong>${selectedDevice.name}</strong>
          <span class="meta">${roleLabel(selectedDevice.role)}${selectedDevice.type ? ', ' + selectedDevice.type : ''}</span>
          <button type="button" class="link-btn" onClick=${() => setRenaming({ id: selectedDevice.id, text: selectedDevice.name, fresh: true })}>Rename</button>
          <button type="button" class="link-btn" data-testid="remove-from-page" onClick=${() => removeFromPage(selectedDevice.id)}>Remove from this page</button>
          <span class="meta">Takes it off this page only; the device and its cables stay.</span>
        </div>`}
    </div>
  `
}

// ---- Shapes ----------------------------------------------------------------

function DeviceShape ({ box, device, selected, dim, lit }) {
  const cls = `sch-device role-${device.role || 'consumer'}${selected ? ' selected' : ''}${dim ? ' dim' : ''}${lit ? ' lit' : ''}`
  return html`
    <g class=${cls} transform="translate(${box.x}, ${box.y})" data-device=${box.id}>
      <rect width=${box.w} height=${box.h} rx="5" class="sch-device-box" />
      <text x=${box.w / 2} y="14" text-anchor="middle" class="sch-device-name">${shorten(device.name, 22)}</text>
      ${device.type && html`<text x=${box.w / 2} y="25" text-anchor="middle" class="sch-device-type">${shorten(device.type, 26)}</text>`}
      ${box.terminals.map((t) => html`
        <g key=${t.name}>
          <circle cx=${t.x - box.x} cy=${t.y - box.y} r="4" class="sch-terminal c-${t.conductor}" />
          <text x=${t.side === 'left' ? 9 : box.w - 9} y=${t.y - box.y + 3} text-anchor=${t.side === 'left' ? 'start' : 'end'} class="sch-terminal-label">${shorten(t.name, 14)}</text>
        </g>
      `)}
    </g>
  `
}

function cableLine (cable, deviceName) {
  const parts = [cable.cableLabel || `${deviceName(cable.fromDeviceId) || '?'} to ${deviceName(cable.toDeviceId) || '?'}`]
  if (cable.gauge != null) parts.push(`${cable.gauge} ${cable.gaugeUnit || ''}`.trim())
  if (cable.length != null) parts.push(`${cable.length} ${cable.lengthUnit || ''}`.trim())
  return parts.join(', ')
}

function WireShape ({ wire, deviceName, selected, dim, lit }) {
  const types = G.conductorTypes(wire.cable)
  const d = G.pathToD(wire.path)
  const cls = `sch-wire${selected ? ' selected' : ''}${dim ? ' dim' : ''}${lit ? ' lit' : ''}`
  return html`
    <g class=${cls} data-wire=${wire.id}>
      <path d=${d} class="sch-wire-line c-${types[0]}"><title>${cableLine(wire.cable, deviceName)}</title></path>
      ${types.length > 1 && html`<path d=${d} class="sch-wire-over c-${types[1]}" />`}
    </g>
  `
}

function StubShape ({ stub }) {
  const end = stub.path[stub.path.length - 1]
  return html`
    <g class="sch-stub" data-stub=${stub.cableId}>
      <path d=${G.pathToD(stub.path)} class="sch-stub-line" />
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
