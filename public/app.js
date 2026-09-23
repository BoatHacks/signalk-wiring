import { html, render, useState, useEffect } from './vendor/preact-standalone.module.js'
import dagre from './vendor/dagre.esm.js'
import { CsvImport } from './import.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'
const ROUTES_BASE = '/plugins/signalk-wiring'
const ALLOWED_ATTACHMENT_MIME_TYPES = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'

function apiErrorMessage (status) {
  if (status === 401) {
    return 'You need to be logged into the SignalK admin UI to do this.'
  }
  return `Request failed (server responded ${status}).`
}

async function fetchResourceMap (type) {
  const res = await fetch(`${RESOURCE_BASE}/${type}`)
  if (!res.ok) throw new Error(`failed to load ${type}: ${res.status}`)
  const map = await res.json()
  return Object.values(map)
}

async function fetchResource (type, id) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`)
  if (!res.ok) throw new Error(`failed to load ${type}/${id}: ${res.status}`)
  return res.json()
}

async function putResource (type, id, value) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!res.ok) throw new Error(apiErrorMessage(res.status))
}

async function deleteResource (type, id) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(apiErrorMessage(res.status))
}

function useResourceList (type, reloadKey = 0) {
  const [state, setState] = useState({ loading: true, error: null, items: [] })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, items: [] })
    fetchResourceMap(type)
      .then((items) => { if (!cancelled) setState({ loading: false, error: null, items }) })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, items: [] }) })
    return () => { cancelled = true }
  }, [type, reloadKey])

  return state
}

function StatusBadge ({ status }) {
  return html`<span class="badge ${status === 'removed' ? 'removed' : ''}">${status}</span>`
}

function ErrorBanner ({ message }) {
  if (!message) return null
  return html`<div class="error-banner">${message}</div>`
}

function BackLink ({ onClick, children }) {
  // HTML entities like &larr; aren't parsed here — htm builds vnodes
  // straight from the JS text content, not through an HTML parser, so
  // the literal character is needed instead.
  return html`<div class="back-link" onClick=${onClick}>← ${children}</div>`
}

function confirmRemove (label) {
  return window.confirm(`Mark "${label}" as removed? It stays in the record, but shows as removed.`)
}

// A generic labeled-field form: circuits, wire runs, and devices are all
// "a handful of inputs, Save/Cancel, an error banner on failure" with
// different field lists, so this covers all three rather than
// duplicating the submit/error/loading handling three times.
function Form ({ fields, initial, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [values, setValues] = useState(() => {
    const v = {}
    for (const f of fields) v[f.key] = initial && initial[f.key] != null ? String(initial[f.key]) : ''
    return v
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const setField = (key, value) => setValues((v) => ({ ...v, [key]: value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {}
    for (const f of fields) {
      const raw = values[f.key]
      if (raw === '' || raw == null) continue
      payload[f.key] = f.type === 'number' ? Number(raw) : raw
    }
    try {
      await onSubmit(payload)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return html`
    <form class="inline-form" onSubmit=${submit}>
      <${ErrorBanner} message=${error} />
      ${fields.map((f) => html`
        <label class="form-field" key=${f.key}>
          <span>${f.label}${f.required ? ' *' : ''}</span>
          ${f.type === 'textarea' && html`
            <textarea
              value=${values[f.key]}
              onInput=${(e) => setField(f.key, e.target.value)}
            ></textarea>
          `}
          ${f.type === 'select' && html`
            <select value=${values[f.key]} onChange=${(e) => setField(f.key, e.target.value)}>
              <option value="">—</option>
              ${f.options.map((o) => html`<option value=${o} key=${o}>${o}</option>`)}
            </select>
          `}
          ${(f.type === 'text' || f.type === 'number') && html`
            <input
              type=${f.type}
              value=${values[f.key]}
              required=${!!f.required}
              placeholder=${f.placeholder || ''}
              step=${f.type === 'number' ? 'any' : undefined}
              onInput=${(e) => setField(f.key, e.target.value)}
            />
          `}
        </label>
      `)}
      <div class="form-actions">
        <button type="submit" disabled=${saving}>${saving ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick=${onCancel} disabled=${saving}>Cancel</button>
      </div>
    </form>
  `
}

// Attachments are admin-gated (unlike the resource API reads elsewhere
// in this file) — they were designed that way from plan 0002 onward,
// binary files rather than the wiring records SPEC.md §12 decided to
// keep anonymously readable. So this component's own fetches can 401
// even for a user who can otherwise browse the whole app; it shows the
// same apiErrorMessage() text as a failed save, not a broken section.
function AttachmentList ({ ownerType, ownerId }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${ROUTES_BASE}/attachments?ownerType=${ownerType}&ownerId=${ownerId}`)
      .then((res) => {
        if (!res.ok) throw new Error(apiErrorMessage(res.status))
        return res.json()
      })
      .then((data) => { if (!cancelled) { setAttachments(data); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ownerType, ownerId, reloadKey])

  const upload = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const url = `${ROUTES_BASE}/attachments?ownerType=${ownerType}&ownerId=${ownerId}&filename=${encodeURIComponent(file.name)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      })
      if (!res.ok) throw new Error(apiErrorMessage(res.status))
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const remove = async (attachment) => {
    if (!window.confirm(`Delete "${attachment.filename}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`${ROUTES_BASE}/attachments/${attachment.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(apiErrorMessage(res.status))
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  return html`
    <div class="attachments">
      <${ErrorBanner} message=${error} />
      ${loading && html`<div class="empty-state">Loading attachments&hellip;</div>`}
      ${!loading && attachments.length === 0 && !error && html`
        <div class="empty-state">No attachments yet.</div>
      `}
      ${attachments.length > 0 && html`
        <div class="attachments-grid">
          ${attachments.map((a) => html`
            <div class="attachment" key=${a.id}>
              ${a.mimeType.startsWith('image/')
                ? html`<img src="${ROUTES_BASE}/attachments/${a.id}" alt=${a.filename} />`
                : html`
                  <a class="attachment-file" href="${ROUTES_BASE}/attachments/${a.id}" target="_blank" rel="noreferrer">
                    ${a.filename}
                  </a>
                `}
              <div class="attachment-meta">
                <span>${a.filename}</span>
                <button onClick=${() => remove(a)}>Delete</button>
              </div>
            </div>
          `)}
        </div>
      `}
      <label class="upload-button">
        ${uploading ? 'Uploading…' : '+ Add photo/file'}
        <input
          type="file"
          accept=${ALLOWED_ATTACHMENT_MIME_TYPES}
          onChange=${upload}
          disabled=${uploading}
          hidden
        />
      </label>
    </div>
  `
}

function prettifyFieldName (key) {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function formatDiffValue (v) {
  if (v === null || v === undefined || v === '') return '(empty)'
  return String(v)
}

function formatTimestamp (iso) {
  return new Date(iso).toLocaleString()
}

// Same admin-gated pattern as AttachmentList (plan 0006) — the
// changelog route lives under the same /plugins/signalk-wiring/ prefix
// as attachments, so this can 401 for a logged-out visitor too.
function ChangeLog ({ kind, id }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${ROUTES_BASE}/changelog/${kind}/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(apiErrorMessage(res.status))
        return res.json()
      })
      .then((data) => { if (!cancelled) { setEntries(data); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kind, id])

  // store.js logs creation as { after: <full row> } — one key, not a
  // per-field {before,after} pair like updates/removes — so it can't go
  // through the same diff-row loop below; showing "created" alone is
  // enough, since the diff there is just "everything," not informative
  // to enumerate.
  const entriesNewestFirst = entries.slice().reverse()

  return html`
    <div class="changelog">
      <${ErrorBanner} message=${error} />
      ${loading && html`<div class="empty-state">Loading history&hellip;</div>`}
      ${!loading && entriesNewestFirst.length === 0 && !error && html`
        <div class="empty-state">No history yet.</div>
      `}
      ${entriesNewestFirst.length > 0 && html`
        <ul class="changelog-list">
          ${entriesNewestFirst.map((entry) => html`
            <li key=${entry.id}>
              <div class="changelog-entry-head">
                <span class="changelog-summary">${entry.summary}</span>
                <span class="changelog-time">${formatTimestamp(entry.timestamp)}</span>
              </div>
              ${entry.summary !== 'created' && html`
                <ul class="changelog-diff">
                  ${Object.entries(entry.diff).map(([field, change]) => html`
                    <li key=${field}>
                      <strong>${prettifyFieldName(field)}</strong>:
                      ${formatDiffValue(change.before)} → ${formatDiffValue(change.after)}
                    </li>
                  `)}
                </ul>
              `}
            </li>
          `)}
        </ul>
      `}
    </div>
  `
}

const CIRCUIT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'sourceLabel', label: 'Source (breaker/fuse)', type: 'text' },
  { key: 'breakerRating', label: 'Breaker rating (A)', type: 'number' },
  { key: 'voltage', label: 'Voltage', type: 'number' },
  { key: 'panelRef', label: 'Panel reference', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
]

const DEVICE_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'zone', label: 'Zone', type: 'text' },
  { key: 'ratedPowerW', label: 'Rated power (W)', type: 'number' },
  {
    key: 'signalkPath',
    label: 'SignalK path',
    type: 'text',
    placeholder: 'e.g. electrical.switches.anchorLight'
  },
  { key: 'notes', label: 'Notes', type: 'textarea' }
]

const WIRE_RUN_FIELDS = [
  { key: 'fromEndpoint', label: 'From', type: 'text', required: true },
  { key: 'toEndpoint', label: 'To', type: 'text', required: true },
  { key: 'gauge', label: 'Gauge', type: 'number' },
  { key: 'gaugeUnit', label: 'Gauge unit', type: 'select', options: ['AWG', 'mm2'] },
  { key: 'color', label: 'Color', type: 'text' },
  { key: 'length', label: 'Length', type: 'number' },
  { key: 'lengthUnit', label: 'Length unit', type: 'select', options: ['m', 'ft'] },
  { key: 'zone', label: 'Zone', type: 'text' },
  { key: 'cableLabel', label: 'Cable label', type: 'text' },
  { key: 'switchRef', label: 'Switch reference', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
]

function CircuitsList ({ onSelect }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const { loading, error, items } = useResourceList('wiringCircuits', reloadKey)

  const createCircuit = async (payload) => {
    await putResource('wiringCircuits', crypto.randomUUID(), payload)
    setShowForm(false)
    setReloadKey((k) => k + 1)
  }

  if (showImport) {
    return html`
      <${CsvImport}
        onDone=${() => { setShowImport(false); setReloadKey((k) => k + 1) }}
        onCancel=${() => setShowImport(false)}
      />
    `
  }

  return html`
    <div>
      <div class="list-header">
        <button onClick=${() => setShowForm((v) => !v)}>${showForm ? 'Cancel' : '+ New circuit'}</button>
        <button onClick=${() => setShowImport(true)}>Import CSV</button>
      </div>
      ${showForm && html`
        <${Form}
          fields=${CIRCUIT_FIELDS}
          onSubmit=${createCircuit}
          onCancel=${() => setShowForm(false)}
          submitLabel="Create circuit"
        />
      `}
      ${loading && html`<div class="empty-state">Loading circuits&hellip;</div>`}
      <${ErrorBanner} message=${error} />
      ${!loading && !error && items.length === 0 && html`
        <div class="empty-state">No circuits recorded yet.</div>
      `}
      ${items.map((circuit) => html`
        <div
          key=${circuit.id}
          class="list-item ${circuit.status === 'removed' ? 'removed' : ''}"
          onClick=${() => onSelect(circuit.id)}
        >
          <div>
            <div>${circuit.name}</div>
            <div class="meta">${circuit.sourceLabel || 'no source recorded'}</div>
          </div>
          <${StatusBadge} status=${circuit.status} />
        </div>
      `)}
    </div>
  `
}

// Built from data CircuitDetail already fetches through the anonymous
// resource API, rather than calling the admin-gated
// GET .../circuits/:id/diagram route from plan 0002 — this is the same
// data as the wire-run table, just laid out as a graph, and gating one
// view of it but not the other has no real security rationale (see
// docs/plans/0005-diagram-view.md).
function DiagramView ({ wireRuns, deviceNameById }) {
  if (wireRuns.length === 0) return null

  const nodes = []
  const seenNodeIds = new Set()
  const addNode = (id) => {
    if (!id || seenNodeIds.has(id)) return
    seenNodeIds.add(id)
    const deviceName = deviceNameById.get(id)
    nodes.push({ id, label: deviceName || id, kind: deviceName ? 'device' : 'label' })
  }
  for (const wr of wireRuns) {
    addNode(wr.fromEndpoint)
    addNode(wr.toEndpoint)
  }

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 56, marginx: 16, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) {
    g.setNode(n.id, { width: Math.max(90, n.label.length * 7 + 28), height: 40 })
  }
  for (const wr of wireRuns) {
    g.setEdge(wr.fromEndpoint, wr.toEndpoint, { wireRun: wr })
  }
  dagre.layout(g)

  const { width, height } = g.graph()

  return html`
    <div class="diagram-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height=${Math.max(160, height)}>
        ${g.edges().map((e) => {
          const edgeData = g.edge(e)
          const wr = edgeData.wireRun
          const removed = wr.status === 'removed'
          const points = edgeData.points.map((p) => `${p.x},${p.y}`).join(' ')
          return html`
            <polyline
              key=${wr.id}
              points=${points}
              class="diagram-edge"
              stroke=${wr.color || '#94a3b8'}
              stroke-dasharray=${removed ? '4 3' : undefined}
              opacity=${removed ? 0.45 : 1}
            />
          `
        })}
        ${nodes.map((n) => {
          const pos = g.node(n.id)
          return html`
            <g key=${n.id} transform="translate(${pos.x - pos.width / 2}, ${pos.y - pos.height / 2})">
              <rect width=${pos.width} height=${pos.height} rx="6" class="diagram-node diagram-node-${n.kind}" />
              <text x=${pos.width / 2} y=${pos.height / 2 + 4} text-anchor="middle" class="diagram-label">
                ${n.label}
              </text>
            </g>
          `
        })}
      </svg>
    </div>
  `
}

function CircuitDetail ({ circuitId, onBack }) {
  const [circuit, setCircuit] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editingCircuit, setEditingCircuit] = useState(false)
  const [wireRunForm, setWireRunForm] = useState(null) // null | 'create' | wireRun object being edited
  const [attachmentsWireRunId, setAttachmentsWireRunId] = useState(null)
  const [historyWireRunId, setHistoryWireRunId] = useState(null)
  const [showCircuitHistory, setShowCircuitHistory] = useState(false)
  const { items: allWireRuns, loading: wireRunsLoading } = useResourceList('wiringWireRuns', reloadKey)
  const { items: devices } = useResourceList('wiringDevices')
  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]))
  const endpointLabel = (endpoint) => deviceNameById.get(endpoint) || endpoint

  useEffect(() => {
    let cancelled = false
    fetchResource('wiringCircuits', circuitId)
      .then((data) => { if (!cancelled) setCircuit(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [circuitId, reloadKey])

  const wireRuns = allWireRuns.filter((wr) => wr.circuitId === circuitId)

  const saveCircuit = async (payload) => {
    await putResource('wiringCircuits', circuitId, payload)
    setEditingCircuit(false)
    setReloadKey((k) => k + 1)
  }

  const removeCircuit = async () => {
    if (!circuit || !confirmRemove(circuit.name)) return
    await deleteResource('wiringCircuits', circuitId)
    onBack()
  }

  const saveWireRun = async (payload) => {
    const id = (wireRunForm && wireRunForm.id) || crypto.randomUUID()
    await putResource('wiringWireRuns', id, { ...payload, circuitId })
    setWireRunForm(null)
    setReloadKey((k) => k + 1)
  }

  const removeWireRun = async (wireRun) => {
    if (!confirmRemove(`${endpointLabel(wireRun.fromEndpoint)} → ${endpointLabel(wireRun.toEndpoint)}`)) return
    await deleteResource('wiringWireRuns', wireRun.id)
    setReloadKey((k) => k + 1)
  }

  return html`
    <div>
      <${BackLink} onClick=${onBack}>Back to circuits<//>
      <${ErrorBanner} message=${error} />
      ${circuit && !editingCircuit && html`
        <div class="card">
          <h2>${circuit.name} <${StatusBadge} status=${circuit.status} /></h2>
          <div class="meta">
            Source: ${circuit.sourceLabel || 'not recorded'}
            ${circuit.breakerRating ? ` — ${circuit.breakerRating}A breaker` : ''}
            ${circuit.voltage ? ` — ${circuit.voltage}V` : ''}
          </div>
          ${circuit.notes && html`<p>${circuit.notes}</p>`}
          <div class="row-actions">
            <button onClick=${() => setEditingCircuit(true)}>Edit</button>
            ${circuit.status !== 'removed' && html`<button onClick=${removeCircuit}>Remove</button>`}
            <button onClick=${() => setShowCircuitHistory((v) => !v)}>
              ${showCircuitHistory ? 'Hide history' : 'History'}
            </button>
          </div>
        </div>
      `}
      ${circuit && editingCircuit && html`
        <div class="card">
          <${Form}
            fields=${CIRCUIT_FIELDS}
            initial=${circuit}
            onSubmit=${saveCircuit}
            onCancel=${() => setEditingCircuit(false)}
          />
        </div>
      `}
      ${showCircuitHistory && html`<${ChangeLog} kind="circuit" id=${circuitId} />`}

      ${wireRuns.length > 0 && html`
        <h3>Diagram</h3>
        <${DiagramView} wireRuns=${wireRuns} deviceNameById=${deviceNameById} />
      `}

      <h3>Wire runs</h3>
      ${wireRunsLoading && html`<div class="empty-state">Loading wire runs&hellip;</div>`}
      ${!wireRunsLoading && wireRuns.length === 0 && html`
        <div class="empty-state">No wire runs recorded for this circuit yet.</div>
      `}
      ${wireRuns.length > 0 && html`
        <table>
          <thead>
            <tr>
              <th>From</th><th>To</th><th>Cable</th><th>Gauge</th><th>Length</th>
              <th>Color</th><th>Zone</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${wireRuns.flatMap((wr) => {
              const rows = [html`
                <tr key=${wr.id}>
                  <td>${endpointLabel(wr.fromEndpoint)}</td>
                  <td>${endpointLabel(wr.toEndpoint)}</td>
                  <td>${wr.cableLabel || '—'}</td>
                  <td>${wr.gauge ? `${wr.gauge} ${wr.gaugeUnit || ''}` : '—'}</td>
                  <td>${wr.length ? `${wr.length} ${wr.lengthUnit || ''}` : '—'}</td>
                  <td>${wr.color || '—'}</td>
                  <td>${wr.zone || '—'}</td>
                  <td><${StatusBadge} status=${wr.status} /></td>
                  <td class="row-actions">
                    <button onClick=${() => setWireRunForm(wr)}>Edit</button>
                    ${wr.status !== 'removed' && html`
                      <button onClick=${() => removeWireRun(wr)}>Remove</button>
                    `}
                    <button onClick=${() => setAttachmentsWireRunId(attachmentsWireRunId === wr.id ? null : wr.id)}>
                      ${attachmentsWireRunId === wr.id ? 'Hide attachments' : 'Attachments'}
                    </button>
                    <button onClick=${() => setHistoryWireRunId(historyWireRunId === wr.id ? null : wr.id)}>
                      ${historyWireRunId === wr.id ? 'Hide history' : 'History'}
                    </button>
                  </td>
                </tr>
              `]
              if (attachmentsWireRunId === wr.id) {
                rows.push(html`
                  <tr key="${wr.id}-attachments">
                    <td colspan="9">
                      <${AttachmentList} ownerType="wireRun" ownerId=${wr.id} />
                    </td>
                  </tr>
                `)
              }
              if (historyWireRunId === wr.id) {
                rows.push(html`
                  <tr key="${wr.id}-history">
                    <td colspan="9">
                      <${ChangeLog} kind="wireRun" id=${wr.id} />
                    </td>
                  </tr>
                `)
              }
              return rows
            })}
          </tbody>
        </table>
      `}

      ${wireRunForm === null && html`
        <button onClick=${() => setWireRunForm('create')}>+ Add wire run</button>
      `}
      ${wireRunForm !== null && html`
        <${Form}
          fields=${WIRE_RUN_FIELDS}
          initial=${wireRunForm === 'create' ? null : wireRunForm}
          onSubmit=${saveWireRun}
          onCancel=${() => setWireRunForm(null)}
          submitLabel=${wireRunForm === 'create' ? 'Add wire run' : 'Save'}
        />
      `}
    </div>
  `
}

function DevicesList ({ onSelect }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const { loading, error, items } = useResourceList('wiringDevices', reloadKey)

  const createDevice = async (payload) => {
    await putResource('wiringDevices', crypto.randomUUID(), payload)
    setShowForm(false)
    setReloadKey((k) => k + 1)
  }

  return html`
    <div>
      <div class="list-header">
        <button onClick=${() => setShowForm((v) => !v)}>${showForm ? 'Cancel' : '+ New device'}</button>
      </div>
      ${showForm && html`
        <${Form}
          fields=${DEVICE_FIELDS}
          onSubmit=${createDevice}
          onCancel=${() => setShowForm(false)}
          submitLabel="Create device"
        />
      `}
      ${loading && html`<div class="empty-state">Loading devices&hellip;</div>`}
      <${ErrorBanner} message=${error} />
      ${!loading && !error && items.length === 0 && html`
        <div class="empty-state">No devices recorded yet.</div>
      `}
      ${items.map((device) => html`
        <div
          key=${device.id}
          class="list-item ${device.status === 'removed' ? 'removed' : ''}"
          onClick=${() => onSelect(device.id)}
        >
          <div>
            <div>${device.name}</div>
            <div class="meta">${device.type || 'no type recorded'}${device.zone ? ` – ${device.zone}` : ''}</div>
          </div>
          <${StatusBadge} status=${device.status} />
        </div>
      `)}
    </div>
  `
}

function DeviceDetail ({ deviceId, onBack }) {
  const [device, setDevice] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchResource('wiringDevices', deviceId)
      .then((data) => { if (!cancelled) setDevice(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [deviceId, reloadKey])

  const saveDevice = async (payload) => {
    await putResource('wiringDevices', deviceId, payload)
    setEditing(false)
    setReloadKey((k) => k + 1)
  }

  const removeDevice = async () => {
    if (!device || !confirmRemove(device.name)) return
    await deleteResource('wiringDevices', deviceId)
    onBack()
  }

  return html`
    <div>
      <${BackLink} onClick=${onBack}>Back to devices<//>
      <${ErrorBanner} message=${error} />
      ${device && !editing && html`
        <div class="card">
          <h2>${device.name} <${StatusBadge} status=${device.status} /></h2>
          <div class="meta">${device.type || 'no type recorded'}${device.zone ? ` – ${device.zone}` : ''}</div>
          ${device.ratedPowerW && html`<div class="meta">${device.ratedPowerW} W rated</div>`}
          ${device.signalkPath && html`
            <div class="meta">SignalK path: <code>${device.signalkPath}</code></div>
          `}
          ${device.notes && html`<p>${device.notes}</p>`}
          <div class="row-actions">
            <button onClick=${() => setEditing(true)}>Edit</button>
            ${device.status !== 'removed' && html`<button onClick=${removeDevice}>Remove</button>`}
            <button onClick=${() => setShowHistory((v) => !v)}>
              ${showHistory ? 'Hide history' : 'History'}
            </button>
          </div>
        </div>
      `}
      ${device && editing && html`
        <div class="card">
          <${Form}
            fields=${DEVICE_FIELDS}
            initial=${device}
            onSubmit=${saveDevice}
            onCancel=${() => setEditing(false)}
          />
        </div>
      `}
      ${showHistory && html`<${ChangeLog} kind="device" id=${deviceId} />`}
      ${device && html`
        <h3>Attachments</h3>
        <${AttachmentList} ownerType="device" ownerId=${deviceId} />
      `}
    </div>
  `
}

function App () {
  const [tab, setTab] = useState('circuits')
  const [selectedCircuitId, setSelectedCircuitId] = useState(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)

  const switchTab = (nextTab) => {
    setTab(nextTab)
    setSelectedCircuitId(null)
    setSelectedDeviceId(null)
  }

  return html`
    <div>
      <nav class="tabs">
        <button class=${tab === 'circuits' ? 'active' : ''} onClick=${() => switchTab('circuits')}>Circuits</button>
        <button class=${tab === 'devices' ? 'active' : ''} onClick=${() => switchTab('devices')}>Devices</button>
      </nav>
      ${tab === 'circuits' && !selectedCircuitId && html`<${CircuitsList} onSelect=${setSelectedCircuitId} />`}
      ${tab === 'circuits' && selectedCircuitId && html`
        <${CircuitDetail} circuitId=${selectedCircuitId} onBack=${() => setSelectedCircuitId(null)} />
      `}
      ${tab === 'devices' && !selectedDeviceId && html`<${DevicesList} onSelect=${setSelectedDeviceId} />`}
      ${tab === 'devices' && selectedDeviceId && html`
        <${DeviceDetail} deviceId=${selectedDeviceId} onBack=${() => setSelectedDeviceId(null)} />
      `}
    </div>
  `
}

// index.html's "Loading…" placeholder is static markup, not something
// Preact rendered — Preact's diffing tries to reuse existing container
// children rather than replacing them outright, so it's left behind
// as a stray node unless cleared first.
const container = document.getElementById('app')
container.textContent = ''
render(html`<${App} />`, container)
