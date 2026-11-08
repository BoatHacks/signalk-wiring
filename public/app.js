import { html, render, useState, useEffect } from './vendor/preact-standalone.module.js'
import { newId } from './ids.js'
import { PathCombobox } from './signalkPaths.js'
import { ROLES, roleLabel } from './roles.js'
import { NO_ZONE, parseTags, tagsToText, collectTags, matchesFilter, circuitMatches } from './zones.js'
import {
  CABLE_KINDS, CONDUCTOR_LABELS, kindByValue, defaultNegativeLanding, negativeLandingCandidates, needsTerminal,
  terminalOptions, buildCablePayload, cableToValues, validateCable, circuitsOfCable, cableTitle
} from './cableForm.js'
import dagre from './vendor/dagre.esm.js'
import { CsvImport } from './import.js'
import { LoadSummary } from './loadSummary.js'
import { FloorplanTab } from './floorplanView.js'
import { SchematicsTab } from './schematicView.js'
import { useSettings, colorPlaceholder } from './settings.js'
import { useTheme } from './theme.js'
import { typeOptions } from './deviceTypes.js'
import { deviceFieldVisible, acConsumerIds, cleanTerminals, describeTerminal } from './deviceFields.js'
import { kindOptions, cableName, conduitSummary, addableCables, conduitsOfRun, moveInList, filterConduits } from './conduits.js'
import { canBeIcon, deviceIconUrl, attachmentKind } from './deviceIcons.js'

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

const ADD_OPTION = '__add__'
const ADD_ZONE = ADD_OPTION

// Dropdown of popular device types for the chosen role, plus the types
// already used on other devices, with an "Add type..." entry for anything
// else. The type is free text underneath, so a new one needs no setup.
function TypeField ({ role, value, onChange }) {
  const { items: devices } = useResourceList('wiringDevices')
  const [adding, setAdding] = useState(false)
  const [newType, setNewType] = useState('')
  const { suggested, used } = typeOptions(role, devices.map((d) => d.type), value)

  const addType = () => {
    const name = newType.trim()
    if (!name) return
    // Reuse an existing spelling rather than creating a near-duplicate.
    const existing = [...suggested, ...used].find((t) => t.toLowerCase() === name.toLowerCase())
    onChange(existing || name)
    setAdding(false)
    setNewType('')
  }

  return html`
    <div>
      <select value=${adding ? ADD_OPTION : value}
        onChange=${(e) => {
          if (e.target.value === ADD_OPTION) setAdding(true)
          else { setAdding(false); onChange(e.target.value) }
        }}>
        <option value="">No type recorded</option>
        <optgroup label=${`Suggested for ${roleLabel(role).toLowerCase()}`}>
          ${suggested.map((t) => html`<option value=${t} key=${t}>${t}</option>`)}
        </optgroup>
        ${used.length > 0 && html`
          <optgroup label="Already used">
            ${used.map((t) => html`<option value=${t} key=${t}>${t}</option>`)}
          </optgroup>
        `}
        <option value=${ADD_OPTION}>Add type…</option>
      </select>
      ${adding && html`
        <div class="row-actions">
          <input type="text" value=${newType} placeholder="Type, e.g. Sonar" autofocus
            onInput=${(e) => setNewType(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addType() } }} />
          <button type="button" onClick=${addType}>Add type</button>
        </div>
      `}
    </div>
  `
}

// Dropdown of conduit kinds: the suggestions, kinds already used, and an
// "Add kind..." entry. The kind is free text underneath.
function KindField ({ value, onChange }) {
  const { items: conduits } = useResourceList('wiringConduits')
  const [adding, setAdding] = useState(false)
  const [newKind, setNewKind] = useState('')
  const { suggested, used } = kindOptions(conduits.map((c) => c.kind), value)

  const addKind = () => {
    const name = newKind.trim()
    if (!name) return
    const existing = [...suggested, ...used].find((k) => k.toLowerCase() === name.toLowerCase())
    onChange(existing || name)
    setAdding(false)
    setNewKind('')
  }

  return html`
    <div>
      <select value=${adding ? ADD_OPTION : value}
        onChange=${(e) => {
          if (e.target.value === ADD_OPTION) setAdding(true)
          else { setAdding(false); onChange(e.target.value) }
        }}>
        <option value="">No kind recorded</option>
        <optgroup label="Suggested">
          ${suggested.map((k) => html`<option value=${k} key=${k}>${k}</option>`)}
        </optgroup>
        ${used.length > 0 && html`
          <optgroup label="Already used">
            ${used.map((k) => html`<option value=${k} key=${k}>${k}</option>`)}
          </optgroup>
        `}
        <option value=${ADD_OPTION}>Add kind…</option>
      </select>
      ${adding && html`
        <div class="row-actions">
          <input type="text" value=${newKind} placeholder="Kind, e.g. Flexible duct" autofocus
            onInput=${(e) => setNewKind(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addKind() } }} />
          <button type="button" onClick=${addKind}>Add kind</button>
        </div>
      `}
    </div>
  `
}

// Dropdown of the zones with an "Add new zone..." entry that creates the
// zone on the spot and selects it. An absent zone stays valid.
function ZoneField ({ value, onChange }) {
  const [reloadKey, setReloadKey] = useState(0)
  const { items: zones } = useResourceList('wiringZones', reloadKey)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState(null)

  const addZone = async () => {
    const name = newName.trim()
    if (!name) return
    setError(null)
    const existing = zones.find((z) => z.name.toLowerCase() === name.toLowerCase())
    if (existing) { onChange(existing.id); setAdding(false); setNewName(''); return }
    try {
      const id = newId()
      await putResource('wiringZones', id, { name })
      setReloadKey((k) => k + 1)
      onChange(id)
      setAdding(false)
      setNewName('')
    } catch (err) {
      setError(err.message)
    }
  }

  return html`
    <div>
      <select value=${adding ? ADD_ZONE : value}
        onChange=${(e) => {
          if (e.target.value === ADD_ZONE) setAdding(true)
          else { setAdding(false); onChange(e.target.value) }
        }}>
        <option value="">No zone yet</option>
        ${zones.map((z) => html`<option value=${z.id} key=${z.id}>${z.name}</option>`)}
        <option value=${ADD_ZONE}>Add new zone…</option>
      </select>
      ${adding && html`
        <div class="row-actions">
          <input type="text" value=${newName} placeholder="Zone name" autofocus
            onInput=${(e) => setNewName(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addZone() } }} />
          <button type="button" onClick=${addZone}>Add zone</button>
        </div>
      `}
      ${error && html`<small class="hint">${error}</small>`}
    </div>
  `
}

// The terminals of a device: a name, what conductor lands there, an optional
// voltage and, on a converter, the port (a side of it, for example DC in).
function TerminalsEditor ({ value, role, onChange }) {
  const update = (index, patch) => onChange(value.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  const remove = (index) => onChange(value.filter((_, i) => i !== index))
  const add = () => onChange([...value, { name: '', conductor: 'positive', voltage: '', port: '' }])
  return html`
    <div class="terminals-editor">
      ${value.map((t, i) => html`
        <div class="row-actions" key=${i}>
          <input type="text" value=${t.name} placeholder="Name, e.g. DC +" onInput=${(e) => update(i, { name: e.target.value })} />
          <select value=${t.conductor} onChange=${(e) => update(i, { conductor: e.target.value })}>
            ${Object.entries(CONDUCTOR_LABELS).map(([k, label]) => html`<option value=${k} key=${k}>${label}</option>`)}
          </select>
          <input type="number" step="any" value=${t.voltage ?? ''} placeholder="Volts" onInput=${(e) => update(i, { voltage: e.target.value })} />
          ${role === 'converter' && html`
            <input type="text" value=${t.port || ''} placeholder="Port, e.g. DC in" onInput=${(e) => update(i, { port: e.target.value })} />
          `}
          <button type="button" onClick=${() => remove(i)}>Remove</button>
        </div>
      `)}
      <button type="button" onClick=${add}>+ Add terminal</button>
    </div>
  `
}

// A generic labeled-field form: circuits, wire runs, and devices are all
// "a handful of inputs, Save/Cancel, an error banner on failure" with
// different field lists, so this covers all three rather than
// duplicating the submit/error/loading handling three times.
function Form ({ fields, initial, onSubmit, onCancel, submitLabel = 'Save', context }) {
  const [values, setValues] = useState(() => {
    const v = {}
    for (const f of fields) {
      const raw = initial ? initial[f.key] : null
      if (f.type === 'terminals') { v[f.key] = Array.isArray(raw) ? raw.map((t) => ({ ...t })) : []; continue }
      v[f.key] = f.type === 'tags' ? tagsToText(raw) : raw != null ? String(raw) : (f.defaultValue ?? '')
    }
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
      if (f.showWhen && !f.showWhen(values, context)) continue
      const raw = values[f.key]
      if (f.type === 'terminals') { payload[f.key] = cleanTerminals(raw); continue }
      // Zone and tags are always sent, so clearing them on an edit takes effect.
      if (f.type === 'zone' || f.type === 'deviceType' || f.type === 'conduitKind') { payload[f.key] = raw === '' || raw == null ? null : raw; continue }
      if (f.type === 'tags') { payload[f.key] = parseTags(raw); continue }
      if (f.clearable && (raw === '' || raw == null)) { payload[f.key] = null; continue }
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
      ${fields.filter((f) => !f.showWhen || f.showWhen(values, context)).map((f) => html`
        <label class="form-field" key=${f.key}>
          <span>${f.label}${f.required ? ' *' : ''}</span>
          ${f.type === 'terminals' && html`
            <${TerminalsEditor} value=${values[f.key]} role=${values.role} onChange=${(v) => setField(f.key, v)} />
          `}
          ${f.type === 'textarea' && html`
            <textarea
              value=${values[f.key]}
              onInput=${(e) => setField(f.key, e.target.value)}
            ></textarea>
          `}
          ${f.type === 'select' && html`
            <select value=${values[f.key]} onChange=${(e) => setField(f.key, e.target.value)}>
              ${!f.noBlank && html`<option value="">—</option>`}
              ${f.options.map((o) => {
                const option = typeof o === 'string' ? { value: o, label: o } : o
                return html`<option value=${option.value} key=${option.value}>${option.label}</option>`
              })}
            </select>
          `}
          ${f.type === 'zone' && html`
            <${ZoneField} value=${values[f.key]} onChange=${(v) => setField(f.key, v)} />
          `}
          ${f.type === 'deviceType' && html`
            <${TypeField} role=${values.role} value=${values[f.key]} onChange=${(v) => setField(f.key, v)} />
          `}
          ${f.type === 'conduitKind' && html`
            <${KindField} value=${values[f.key]} onChange=${(v) => setField(f.key, v)} />
          `}
          ${f.type === 'tags' && html`
            <input type="text" value=${values[f.key]} placeholder="e.g. audio: main, audio: cockpit"
              onInput=${(e) => setField(f.key, e.target.value)} />
          `}
          ${f.type === 'signalkPath' && html`
            <${PathCombobox}
              value=${values[f.key]}
              placeholder=${f.placeholder || ''}
              onChange=${(v) => setField(f.key, v)}
            />
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
          ${f.hint && html`<small class="hint">${f.hint}</small>`}
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
function AttachmentList ({ ownerType, ownerId, iconAttachmentId, onIconChange }) {
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
                ? html`
                  <a href="${ROUTES_BASE}/attachments/${a.id}" target="_blank" rel="noreferrer" title="Open full size">
                    <img src="${ROUTES_BASE}/attachments/${a.id}" alt=${a.filename} />
                  </a>
                `
                : html`
                  <a class="attachment-file" href="${ROUTES_BASE}/attachments/${a.id}" target="_blank" rel="noreferrer">
                    <span><strong>${attachmentKind(a.mimeType)}</strong><br />${a.filename}</span>
                  </a>
                `}
              <div class="attachment-meta">
                <span title=${a.filename}>${a.filename}</span>
                <button onClick=${() => remove(a)}>Delete</button>
              </div>
              ${ownerType === 'device' && onIconChange && canBeIcon(a.mimeType) && html`
                <div class="attachment-meta">
                  ${iconAttachmentId === a.id
                    ? html`<span class="badge ok">Icon</span><button onClick=${() => onIconChange(null)}>Clear icon</button>`
                    : html`<button onClick=${() => onIconChange(a.id)}>Use as icon</button>`}
                </div>
              `}
            </div>
          `)}
        </div>
      `}
      <label class="upload-button">
        ${uploading ? 'Uploading…' : '+ Add photo, schematic or file'}
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

const DEVICE_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  {
    key: 'role',
    label: 'Role',
    type: 'select',
    options: ROLES.map((r) => ({ value: r.value, label: r.label })),
    defaultValue: 'consumer',
    noBlank: true,
    hint: 'Consumer uses power. Source supplies it (solar, shore power, generator, hydro, wind, alternator). Storage is batteries. Distribution is switches, breakers, bus bars and panels. Converter is inverters, chargers and DC-DC. Put the specific kind in Type.'
  },
  {
    key: 'type',
    label: 'Type',
    type: 'deviceType',
    hint: 'The kind of device, for example Solar panel or Bilge pump. Pick one, or choose Add type for anything not listed.'
  },
  {
    key: 'zoneId',
    label: 'Zone',
    type: 'zone',
    hint: 'Where it is: an area such as salon or aft cabin. Used for filtering. Put access hints in Notes.'
  },
  {
    key: 'tags',
    label: 'Tags',
    type: 'tags',
    hint: 'Anything else you want to group by, such as an audio zone. Free text, several allowed, separated by commas.'
  },
  { key: 'ratedPowerW', label: 'Rated power (W)', type: 'number' },
  {
    key: 'tripRatingA',
    label: 'Trip rating (A)',
    type: 'number',
    clearable: true,
    showWhen: (values, ctx) => deviceFieldVisible('tripRatingA', values, ctx),
    hint: 'Read it off the fuse or breaker. A device with a rating protects the circuit it feeds; a switch or bus bar has none and only passes it through.'
  },
  {
    key: 'nominalVoltage',
    label: 'Nominal voltage (V)',
    type: 'number',
    clearable: true,
    showWhen: (values, ctx) => deviceFieldVisible('nominalVoltage', values, ctx),
    hint: 'The voltage this battery or source supplies. Circuits fed from it take this voltage.'
  },
  {
    key: 'powerFactor',
    label: 'Power factor',
    type: 'number',
    clearable: true,
    showWhen: (values, ctx) => deviceFieldVisible('powerFactor', values, ctx),
    hint: 'Between 0 and 1. Applied to the load check on AC circuits; left blank it counts as 1.'
  },
  {
    key: 'terminals',
    label: 'Terminals',
    type: 'terminals',
    showWhen: (values, ctx) => deviceFieldVisible('terminals', values, ctx),
    hint: 'Only needed where they remove ambiguity: a converter (give each terminal the port it belongs to, for example DC in or AC out), a battery with several posts, a fuse block.'
  },
  {
    key: 'signalkPath',
    label: 'SignalK path',
    type: 'signalkPath',
    placeholder: 'e.g. electrical.switches.anchorLight'
  },
  { key: 'posX', label: 'Position x (m, from the transom toward the bow)', type: 'number' },
  { key: 'posY', label: 'Position y (m, athwartships)', type: 'number' },
  { key: 'posZ', label: 'Position z (m, height)', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
]

const CONDUIT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Galley conduit' },
  {
    key: 'kind',
    label: 'Kind',
    type: 'conduitKind',
    hint: 'What it is: conduit, hose, loom, trunking or cable tray. Pick one, or choose Add kind for anything not listed.'
  },
  { key: 'innerDiameter', label: 'Inner diameter', type: 'number', hint: 'Optional, as a note for now.' },
  { key: 'diameterUnit', label: 'Diameter unit', type: 'select', options: ['mm', 'in'] },
  {
    key: 'zoneId',
    label: 'Zone',
    type: 'zone',
    hint: 'Where it is: an area such as salon or aft cabin. Used for filtering.'
  },
  { key: 'notes', label: 'Notes', type: 'textarea' }
]

// Zone and tag filter for a list. `items` supplies the tags in use.
function ZoneTagFilter ({ items, filter, onChange, withRole = false, children }) {
  const { items: zones } = useResourceList('wiringZones')
  const tags = collectTags(items)
  return html`
    <div class="filter-bar">
      <label class="form-field compact"><span>Zone</span>
        <select value=${filter.zoneId || ''} onChange=${(e) => onChange({ ...filter, zoneId: e.target.value || null })}>
          <option value="">All zones</option>
          <option value=${NO_ZONE}>No zone</option>
          ${zones.map((z) => html`<option value=${z.id} key=${z.id}>${z.name}</option>`)}
        </select>
      </label>
      ${withRole && html`
        <label class="form-field compact"><span>Role</span>
          <select value=${filter.role || ''} onChange=${(e) => onChange({ ...filter, role: e.target.value || null })}>
            <option value="">All roles</option>
            ${ROLES.map((r) => html`<option value=${r.value} key=${r.value}>${r.label}</option>`)}
          </select>
        </label>
      `}
      ${tags.length > 0 && html`
        <label class="form-field compact"><span>Tag</span>
          <select value=${filter.tag || ''} onChange=${(e) => onChange({ ...filter, tag: e.target.value || null })}>
            <option value="">All tags</option>
            ${tags.map((t) => html`<option value=${t} key=${t}>${t}</option>`)}
          </select>
        </label>
      `}
      ${children}
    </div>
  `
}

// Rename, merge and remove zones. A zone in use cannot be removed: merge it
// into another zone or move its items first.
function ZonesManager () {
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')
  const { loading, items: zones } = useResourceList('wiringZones', reloadKey)
  const { items: devices } = useResourceList('wiringDevices', reloadKey)
  const { items: wireRuns } = useResourceList('wiringWireRuns', reloadKey)
  const { items: conduits } = useResourceList('wiringConduits', reloadKey)

  const usage = (zoneId) => ({
    conduits: conduits.filter((c) => c.zoneId === zoneId && c.status !== 'removed').length,
    devices: devices.filter((d) => d.zoneId === zoneId && d.status !== 'removed').length,
    wireRuns: wireRuns.filter((w) => w.zoneId === zoneId && w.status !== 'removed').length
  })

  const run = async (fn) => {
    setError(null)
    try { await fn(); setReloadKey((k) => k + 1) } catch (err) { setError(err.message) }
  }

  const clash = (name, ownId) => zones.some((z) => z.id !== ownId && z.name.toLowerCase() === name.trim().toLowerCase())

  const add = () => run(async () => {
    if (!newName.trim()) return
    if (clash(newName)) throw new Error('A zone with that name already exists.')
    await putResource('wiringZones', newId(), { name: newName.trim() })
    setNewName('')
  })

  const rename = (zone) => run(async () => {
    if (!editName.trim()) return
    if (clash(editName, zone.id)) throw new Error('A zone with that name already exists. Merge them instead.')
    await putResource('wiringZones', zone.id, { name: editName.trim() })
    setEditingId(null)
  })

  const merge = (zone, intoId) => run(async () => {
    const into = zones.find((z) => z.id === intoId)
    if (!window.confirm(`Move everything in "${zone.name}" to "${into.name}" and delete "${zone.name}"?`)) return
    const res = await fetch(`${ROUTES_BASE}/zones/${zone.id}/merge?into=${intoId}`, { method: 'POST' })
    if (!res.ok) throw new Error(apiErrorMessage(res.status))
  })

  const remove = (zone) => run(async () => {
    if (!window.confirm(`Delete the zone "${zone.name}"?`)) return
    await deleteResource('wiringZones', zone.id)
  })

  return html`
    <div>
      <p class="meta">
        A zone is the area something is in, such as salon or aft cabin. Each device, wire run and conduit has at most one.
        Renaming a zone renames it everywhere.
      </p>
      <${ErrorBanner} message=${error} />
      ${loading && html`<div class="empty-state">Loading zones&hellip;</div>`}
      ${!loading && zones.length === 0 && html`<div class="empty-state">No zones yet. Add one below, or from a device form.</div>`}
      ${zones.map((zone) => {
        const u = usage(zone.id)
        const inUse = u.devices + u.wireRuns + u.conduits > 0
        return html`
          <div class="list-item" key=${zone.id}>
            <div>
              ${editingId === zone.id
                ? html`<input type="text" value=${editName} onInput=${(e) => setEditName(e.target.value)}
                    onKeyDown=${(e) => { if (e.key === 'Enter') rename(zone) }} />`
                : html`<div>${zone.name}</div>`}
              <div class="meta">${u.devices} devices, ${u.wireRuns} wire runs, ${u.conduits} conduits</div>
            </div>
            <div class="row-actions">
              ${editingId === zone.id
                ? html`<button onClick=${() => rename(zone)}>Save</button><button onClick=${() => setEditingId(null)}>Cancel</button>`
                : html`<button onClick=${() => { setEditingId(zone.id); setEditName(zone.name) }}>Rename</button>`}
              ${zones.length > 1 && html`
                <select value="" onChange=${(e) => e.target.value && merge(zone, e.target.value)}>
                  <option value="">Merge into…</option>
                  ${zones.filter((z) => z.id !== zone.id).map((z) => html`<option value=${z.id} key=${z.id}>${z.name}</option>`)}
                </select>
              `}
              <button disabled=${inUse} title=${inUse ? 'In use: merge it or move its items first' : ''}
                onClick=${() => remove(zone)}>Remove</button>
            </div>
          </div>
        `
      })}
      <div class="row-actions">
        <input type="text" value=${newName} placeholder="New zone name"
          onInput=${(e) => setNewName(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add() }} />
        <button onClick=${add}>Add zone</button>
      </div>
    </div>
  `
}

// A device chooser for the ends of a cable: the existing devices, and
// "New device..." to create one on the spot (name and role only; the rest
// can be filled in on the Devices tab).
const NEW_DEVICE = '__new_device__'

function DevicePicker ({ label, hint, value, onChange, devices, onCreated, defaultRole, only, required }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState(defaultRole || 'consumer')
  const [created, setCreated] = useState([])
  const [error, setError] = useState(null)

  const known = new Map([...created, ...devices].map((d) => [d.id, d]))
  const options = [...known.values()]
    .filter((d) => d.status !== 'removed' && (!only || only(d) || d.id === value))
    .sort((a, b) => a.name.localeCompare(b.name))

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    const clash = options.find((d) => d.name.toLowerCase() === trimmed.toLowerCase())
    if (clash) { onChange(clash.id); setAdding(false); setName(''); return }
    try {
      const id = newId()
      await putResource('wiringDevices', id, { name: trimmed, role })
      setCreated((list) => [...list, { id, name: trimmed, role, status: 'active' }])
      if (onCreated) onCreated()
      onChange(id)
      setAdding(false)
      setName('')
    } catch (err) {
      setError(err.message)
    }
  }

  return html`
    <label class="form-field">
      <span>${label}${required ? ' *' : ''}</span>
      <select value=${adding ? NEW_DEVICE : value || ''}
        onChange=${(e) => {
          if (e.target.value === NEW_DEVICE) setAdding(true)
          else { setAdding(false); onChange(e.target.value) }
        }}>
        <option value="">Choose a device…</option>
        ${options.map((d) => html`<option value=${d.id} key=${d.id}>${d.name} (${roleLabel(d.role)})</option>`)}
        <option value=${NEW_DEVICE}>New device…</option>
      </select>
      ${adding && html`
        <div class="row-actions">
          <input type="text" value=${name} placeholder="Device name" autofocus
            onInput=${(e) => setName(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
          <select value=${role} onChange=${(e) => setRole(e.target.value)}>
            ${ROLES.map((r) => html`<option value=${r.value} key=${r.value}>${r.label}</option>`)}
          </select>
          <button type="button" onClick=${create}>Create device</button>
        </div>
      `}
      ${error && html`<small class="hint">${error}</small>`}
      ${hint && html`<small class="hint">${hint}</small>`}
    </label>
  `
}

// The cable form (a wire run): DC first, two devices, and the circuit it
// belongs to is worked out from the cables, never entered.
function CableForm ({ cable, prefill, devices, cables, circuits, onDevicesChanged, onSaved, onCancel }) {
  const settings = useSettings()
  const [values, setValues] = useState(() => cable
    ? cableToValues(cable)
    : {
        fromDeviceId: '',
        toDeviceId: '',
        kind: 'both',
        colors: {},
        terminals: {},
        negativeLandingId: defaultNegativeLanding(cables) || '',
        existingConductors: [],
        gauge: '',
        gaugeUnit: settings.defaultGaugeUnit,
        length: '',
        lengthUnit: settings.defaultLengthUnit,
        cableLabel: '',
        zoneId: '',
        tags: [],
        notes: '',
        ...(prefill || {})
      })
  const [tagsText, setTagsText] = useState(() => tagsToText(cable ? cable.tags : []))
  const [more, setMore] = useState(() => (cable || prefill) ? kindByValue(values.kind).more : false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const setColor = (conductor, value) => setValues((v) => ({ ...v, colors: { ...v.colors, [conductor]: value } }))
  const setTerminal = (conductor, end, value) => setValues((v) => ({
    ...v,
    terminals: { ...v.terminals, [conductor]: { ...(v.terminals[conductor] || {}), [end]: value } }
  }))

  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const fromDevice = deviceById.get(values.fromDeviceId)
  const toDevice = deviceById.get(values.toDeviceId)
  const conductors = values.kind === 'custom'
    ? values.existingConductors.map((c) => c.conductor)
    : kindByValue(values.kind).conductors
  const askTerminals = needsTerminal(fromDevice) || needsTerminal(toDevice)
  const kinds = CABLE_KINDS.filter((k) => !k.more || more || k.value === values.kind)

  const submit = async (e) => {
    e.preventDefault()
    const message = validateCable(values) ||
      (values.kind === 'both' && !values.negativeLandingId ? 'Choose where the negative lands at the supply end.' : null)
    if (message) { setError(message); return }
    setSaving(true)
    setError(null)
    try {
      await onSaved(buildCablePayload({ ...values, tags: parseTags(tagsText) }), cable ? cable.id : newId())
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const here = cable ? circuitsOfCable(cable.id, circuits) : []

  return html`
    <form class="inline-form cable-form" onSubmit=${submit}>
      <${ErrorBanner} message=${error} />
      <${DevicePicker} label="From (supply side)" required=${true} value=${values.fromDeviceId}
        onChange=${(v) => set('fromDeviceId', v)} devices=${devices} onCreated=${onDevicesChanged}
        defaultRole="distribution"
        hint="The side the power comes from: a fuse, breaker, bus bar, battery or source." />
      <${DevicePicker} label="To (load side)" required=${true} value=${values.toDeviceId}
        onChange=${(v) => set('toDeviceId', v)} devices=${devices} onCreated=${onDevicesChanged}
        defaultRole="consumer" />

      <div class="form-field">
        <span>Conductors</span>
        <div class="kind-choice">
          ${kinds.map((k) => html`
            <label key=${k.value} class="radio-chip">
              <input type="radio" name="cable-kind" value=${k.value} checked=${values.kind === k.value}
                onChange=${() => set('kind', k.value)} />
              ${k.label}
            </label>
          `)}
          ${values.kind === 'custom' && html`<span class="meta">Custom: ${conductors.join(', ')}</span>`}
          ${!more && html`<button type="button" class="link-btn" onClick=${() => setMore(true)}>More (AC, earth)…</button>`}
        </div>
      </div>

      ${values.kind === 'both' && html`
        <${DevicePicker} label="Negative lands on at the supply end" required=${true}
          value=${values.negativeLandingId} onChange=${(v) => set('negativeLandingId', v)}
          devices=${devices} onCreated=${onDevicesChanged} defaultRole="distribution"
          only=${(d) => negativeLandingCandidates([d]).length > 0}
          hint="A negative bus bar or a battery post. It starts as the last one you used." />
      `}

      ${conductors.map((conductor) => html`
        <label class="form-field" key=${conductor}>
          <span>Colour: ${CONDUCTOR_LABELS[conductor]}</span>
          <input type="text" value=${values.colors[conductor] || ''}
            placeholder=${colorPlaceholder(settings.convention)}
            onInput=${(e) => setColor(conductor, e.target.value)} />
        </label>
      `)}

      ${askTerminals && conductors.map((conductor) => html`
        <div class="form-field" key=${'t-' + conductor}>
          <span>Terminals: ${CONDUCTOR_LABELS[conductor]}</span>
          <div class="row-actions">
            ${needsTerminal(fromDevice) && html`
              <select value=${(values.terminals[conductor] || {}).from || ''}
                onChange=${(e) => setTerminal(conductor, 'from', e.target.value)}>
                <option value="">${fromDevice.name}: terminal…</option>
                ${terminalOptions(fromDevice, conductor).map((t) => html`<option value=${t.name} key=${t.name}>${t.name}${t.port ? ` (${t.port})` : ''}</option>`)}
              </select>
            `}
            ${needsTerminal(toDevice) && html`
              <select value=${(values.terminals[conductor] || {}).to || ''}
                onChange=${(e) => setTerminal(conductor, 'to', e.target.value)}>
                <option value="">${toDevice.name}: terminal…</option>
                ${terminalOptions(toDevice, conductor).map((t) => html`<option value=${t.name} key=${t.name}>${t.name}${t.port ? ` (${t.port})` : ''}</option>`)}
              </select>
            `}
          </div>
          <small class="hint">Needed on a converter, so the circuit on each side is known, and on a device with several terminals.</small>
        </div>
      `)}

      <div class="form-field">
        <span>Gauge</span>
        <div class="row-actions">
          <input type="number" step="any" value=${values.gauge} onInput=${(e) => set('gauge', e.target.value)} />
          <select value=${values.gaugeUnit} onChange=${(e) => set('gaugeUnit', e.target.value)}>
            <option value="">-</option><option value="AWG">AWG</option><option value="mm2">mm²</option>
          </select>
        </div>
      </div>
      <div class="form-field">
        <span>Length</span>
        <div class="row-actions">
          <input type="number" step="any" value=${values.length} onInput=${(e) => set('length', e.target.value)} />
          <select value=${values.lengthUnit} onChange=${(e) => set('lengthUnit', e.target.value)}>
            <option value="">-</option><option value="m">m</option><option value="ft">ft</option>
          </select>
        </div>
      </div>
      <label class="form-field"><span>Cable label</span>
        <input type="text" value=${values.cableLabel} onInput=${(e) => set('cableLabel', e.target.value)} />
      </label>
      <label class="form-field"><span>Zone</span>
        <${ZoneField} value=${values.zoneId} onChange=${(v) => set('zoneId', v)} />
        <small class="hint">Where it is: an area such as salon or aft cabin. Used for filtering.</small>
      </label>
      <label class="form-field"><span>Tags</span>
        <input type="text" value=${tagsText} placeholder="e.g. audio: main, audio: cockpit"
          onInput=${(e) => setTagsText(e.target.value)} />
      </label>
      <label class="form-field"><span>Notes</span>
        <textarea value=${values.notes} onInput=${(e) => set('notes', e.target.value)}></textarea>
      </label>

      <div class="derived-circuit">
        <strong>Circuit</strong>
        ${!cable && html`<div class="meta">Worked out from the cables when you save. It needs no setup.</div>`}
        ${cable && here.length === 0 && html`<div class="meta">This cable is not part of a circuit yet (check both ends are set).</div>`}
        ${here.map(({ circuit, via }) => html`
          <div key=${circuit.id} class="meta">
            ${circuitSummaryLine(circuit)}${via === 'return' ? ' (this cable is its negative return)' : ''}
          </div>
        `)}
      </div>

      <div class="form-actions">
        <button type="submit" disabled=${saving}>${saving ? 'Saving…' : cable ? 'Save' : 'Add cable'}</button>
        <button type="button" onClick=${onCancel} disabled=${saving}>Cancel</button>
      </div>
    </form>
  `
}

function CablesList () {
  const settings = useSettings()
  const [reloadKey, setReloadKey] = useState(0)
  const [devKey, setDevKey] = useState(0)
  const [form, setForm] = useState(null) // null | 'create' | cable being edited
  const [showImport, setShowImport] = useState(false)
  const [notice, setNotice] = useState(null)
  const [attachmentsId, setAttachmentsId] = useState(null)
  const [historyId, setHistoryId] = useState(null)
  const [filter, setFilter] = useState({})
  const { loading, error, items: cables } = useResourceList('wiringWireRuns', reloadKey)
  const { items: devices } = useResourceList('wiringDevices', devKey)
  const { items: circuits } = useResourceList('wiringCircuits', reloadKey)
  const { items: conduits } = useResourceList('wiringConduits')
  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]))
  const conduitNameById = new Map(conduits.map((c) => [c.id, c.name]))
  const visible = cables.filter((c) => matchesFilter(c, filter))

  const save = async (payload, id) => {
    await putResource('wiringWireRuns', id, payload)
    const fresh = await fetchResourceMap('wiringCircuits')
    const mine = circuitsOfCable(id, Object.values(fresh))
    setNotice(mine.length === 0
      ? 'Saved. The cable is not part of a circuit yet.'
      : `Saved. ${mine.map(({ circuit }) => circuitSummaryLine(circuit)).join('; ')}`)
    setForm(null)
    setReloadKey((k) => k + 1)
  }

  const removeCable = async (cable) => {
    if (!confirmRemove(cableTitle(cable, deviceNameById))) return
    await deleteResource('wiringWireRuns', cable.id)
    setReloadKey((k) => k + 1)
  }

  if (showImport) {
    return html`
      <${CsvImport}
        onDone=${() => { setShowImport(false); setReloadKey((k) => k + 1); setDevKey((k) => k + 1) }}
        onCancel=${() => setShowImport(false)}
      />
    `
  }

  return html`
    <div>
      <p class="meta">
        A cable runs from the supply side to the load side. Circuits are worked out from the cables
        and listed on the Circuits tab.
      </p>
      <div class="list-header">
        <button onClick=${() => { setNotice(null); setForm(form ? null : 'create') }}>${form ? 'Cancel' : '+ New cable'}</button>
        <button onClick=${() => setShowImport(true)}>Import CSV</button>
      </div>
      ${notice && html`<div class="notice">${notice}</div>`}
      ${form && html`
        <${CableForm}
          key=${`${settings.defaultGaugeUnit}/${settings.defaultLengthUnit}/${form === 'create' ? 'new' : form.id}`}
          cable=${form === 'create' ? null : form}
          devices=${devices}
          cables=${cables}
          circuits=${circuits}
          onDevicesChanged=${() => setDevKey((k) => k + 1)}
          onSaved=${save}
          onCancel=${() => setForm(null)}
        />
      `}
      ${loading && html`<div class="empty-state">Loading cables&hellip;</div>`}
      <${ErrorBanner} message=${error} />
      ${!loading && !error && cables.length === 0 && html`<div class="empty-state">No cables recorded yet.</div>`}
      ${cables.length > 0 && html`<${ZoneTagFilter} items=${cables} filter=${filter} onChange=${setFilter} />`}
      ${visible.length > 0 && html`
        <table>
          <thead>
            <tr><th>From</th><th>To</th><th>Conductors</th><th>Cable</th><th>Conduits</th><th>Gauge</th><th>Length</th><th>Zone</th><th>Circuit</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${visible.flatMap((cable) => {
              const here = circuitsOfCable(cable.id, circuits)
              const rows = [html`
                <tr key=${cable.id}>
                  <td>${deviceNameById.get(cable.fromDeviceId) || '?'}</td>
                  <td>${deviceNameById.get(cable.toDeviceId) || '?'}</td>
                  <td>${(cable.conductors || []).length === 0 ? 'Positive' : cable.conductors.map((c) => CONDUCTOR_LABELS[c.conductor] + (c.color ? ` (${c.color})` : '')).join(', ')}</td>
                  <td>${cable.cableLabel || '-'}</td>
                  <td>${(cable.conduitIds || []).map((id) => conduitNameById.get(id) || '?').join(' > ') || '-'}</td>
                  <td>${cable.gauge ? `${cable.gauge} ${cable.gaugeUnit || ''}` : '-'}</td>
                  <td>${cable.length ? `${cable.length} ${cable.lengthUnit || ''}` : '-'}</td>
                  <td>${cable.zone || '-'}${(cable.tags || []).length ? html`<div class="meta">${cable.tags.join(', ')}</div>` : ''}</td>
                  <td>${here.length ? here.map(({ circuit }) => circuit.name).join(', ') : '-'}</td>
                  <td><${StatusBadge} status=${cable.status} /></td>
                  <td class="row-actions">
                    <button onClick=${() => { setNotice(null); setForm(cable) }}>Edit</button>
                    ${cable.status !== 'removed' && html`<button onClick=${() => removeCable(cable)}>Remove</button>`}
                    <button onClick=${() => setAttachmentsId(attachmentsId === cable.id ? null : cable.id)}>
                      ${attachmentsId === cable.id ? 'Hide attachments' : 'Attachments'}
                    </button>
                    <button onClick=${() => setHistoryId(historyId === cable.id ? null : cable.id)}>
                      ${historyId === cable.id ? 'Hide history' : 'History'}
                    </button>
                  </td>
                </tr>
              `]
              if (attachmentsId === cable.id) {
                rows.push(html`<tr key="${cable.id}-attachments"><td colspan="11"><${AttachmentList} ownerType="wireRun" ownerId=${cable.id} /></td></tr>`)
              }
              if (historyId === cable.id) {
                rows.push(html`<tr key="${cable.id}-history"><td colspan="11"><${ChangeLog} kind="wireRun" id=${cable.id} /></td></tr>`)
              }
              return rows
            })}
          </tbody>
        </table>
      `}
    </div>
  `
}

// "Lamp fuse: 10 A, 12 V DC" for a circuit resource.
function circuitSummaryLine (circuit) {
  return `${circuit.name}: ${circuitFacts(circuit)}`
}

function circuitFacts (circuit) {
  const d = circuit.derived
  if (!d) return 'no longer exists'
  const parts = [
    d.ratingA ? `${d.ratingA} A` : null,
    d.voltage ? `${d.voltage} V` : null,
    d.ac ? 'AC' : 'DC',
    d.unprotected ? 'no protection' : null
  ].filter(Boolean)
  return parts.join(', ')
}

const CIRCUIT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  {
    key: 'voltage',
    label: 'Voltage override (V)',
    type: 'number',
    clearable: true,
    hint: 'Leave empty to use the voltage of the supply: the battery or source that feeds the circuit.'
  },
  { key: 'notes', label: 'Notes', type: 'textarea', clearable: true }
]

// Circuits are worked out from the cables (plan 0014), so this is an
// overview: you can name a circuit and add notes, nothing else.
function CircuitsList ({ onSelect }) {
  const { loading, error, items } = useResourceList('wiringCircuits')
  const { items: cables } = useResourceList('wiringWireRuns')
  const { items: devices } = useResourceList('wiringDevices')
  const [filter, setFilter] = useState({})
  const nameById = new Map(devices.map((d) => [d.id, d.name]))
  const visible = items
    .filter((c) => circuitMatches(c, cables, filter))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'removed' ? 1 : -1))

  return html`
    <div>
      <p class="meta">
        Circuits are worked out from the cables: what one fuse or breaker protects, from the supply
        to the loads. Add or change cables on the Cables tab. Here you can name a circuit and add notes.
      </p>
      ${loading && html`<div class="empty-state">Loading circuits&hellip;</div>`}
      <${ErrorBanner} message=${error} />
      ${!loading && !error && items.length === 0 && html`
        <div class="empty-state">No circuits yet. Add cables between devices and they appear here.</div>
      `}
      ${items.length > 0 && html`<${ZoneTagFilter} items=${cables} filter=${filter} onChange=${setFilter} />`}
      ${visible.map((circuit) => {
        const d = circuit.derived
        return html`
          <div
            key=${circuit.id}
            class="list-item ${circuit.status === 'removed' ? 'removed' : ''}"
            onClick=${() => onSelect(circuit.id)}
          >
            <div>
              <div>${circuit.name}</div>
              <div class="meta">${circuitFacts(circuit)}${d && d.supplyDeviceIds.length ? ` – from ${d.supplyDeviceIds.map((id) => nameById.get(id) || '?').join(', ')}` : ''}${d && d.endDeviceIds.length ? ` – to ${d.endDeviceIds.map((id) => nameById.get(id) || '?').join(', ')}` : ''}</div>
            </div>
            <div>
              ${d && d.unprotected && html`<span class="badge over-rating">no protection</span> `}
              ${d && d.warnings.length > 0 && html`<span class="badge">${d.warnings.length} warning${d.warnings.length === 1 ? '' : 's'}</span> `}
              <${StatusBadge} status=${circuit.status} />
            </div>
          </div>
        `
      })}
    </div>
  `
}

// Built from data already fetched through the resource API: the derived
// circuit says which cables belong to it, and the cables say which devices
// they join. Return (negative) cables are drawn dotted.
function DiagramView ({ cables, deviceNameById, deviceIconById }) {
  if (cables.length === 0) return null

  const nodes = []
  const seenNodeIds = new Set()
  const addNode = (id) => {
    if (!id || seenNodeIds.has(id)) return
    seenNodeIds.add(id)
    const deviceName = deviceNameById.get(id)
    nodes.push({ id, label: deviceName || '?', kind: deviceName ? 'device' : 'label', icon: deviceIconById.get(id) || null })
  }
  for (const wr of cables) {
    addNode(wr.fromDeviceId)
    addNode(wr.toDeviceId)
  }

  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 56, marginx: 16, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) {
    g.setNode(n.id, { width: Math.max(90, n.label.length * 7 + 28) + (n.icon ? 36 : 0), height: n.icon ? 48 : 40 })
  }
  for (const wr of cables) {
    if (wr.fromDeviceId && wr.toDeviceId) g.setEdge(wr.fromDeviceId, wr.toDeviceId, { wireRun: wr }, wr.id)
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
          const feed = (wr.conductors || []).find((c) => c.conductor !== 'negative')
          const ret = wr.isReturn
          return html`
            <polyline
              key=${wr.id}
              points=${points}
              class="diagram-edge"
              stroke=${(ret ? (wr.conductors || []).find((c) => c.conductor === 'negative')?.color : feed && feed.color) || '#94a3b8'}
              stroke-dasharray=${removed ? '4 3' : ret ? '2 4' : undefined}
              opacity=${removed ? 0.45 : 1}
            />
          `
        })}
        ${nodes.map((n) => {
          const pos = g.node(n.id)
          return html`
            <g key=${n.id} transform="translate(${pos.x - pos.width / 2}, ${pos.y - pos.height / 2})">
              <rect width=${pos.width} height=${pos.height} rx="6" class="diagram-node diagram-node-${n.kind}" />
              ${n.icon && html`<image href=${n.icon} x="6" y=${(pos.height - 36) / 2} width="36" height="36" preserveAspectRatio="xMidYMid meet" />`}
              <text x=${(pos.width + (n.icon ? 36 : 0)) / 2} y=${pos.height / 2 + 4} text-anchor="middle" class="diagram-label">
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
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const { items: cables } = useResourceList('wiringWireRuns')
  const { items: devices } = useResourceList('wiringDevices')
  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]))
  const deviceIconById = new Map(devices.filter((d) => deviceIconUrl(d)).map((d) => [d.id, deviceIconUrl(d)]))

  useEffect(() => {
    let cancelled = false
    fetchResource('wiringCircuits', circuitId)
      .then((data) => { if (!cancelled) setCircuit(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [circuitId, reloadKey])

  const save = async (payload) => {
    await putResource('wiringCircuits', circuitId, payload)
    setEditing(false)
    setReloadKey((k) => k + 1)
  }

  const d = circuit && circuit.derived
  const cableById = new Map(cables.map((c) => [c.id, c]))
  const feedCables = d ? d.cableIds.map((id) => cableById.get(id)).filter(Boolean) : []
  const returnCables = d ? d.returnCableIds.map((id) => ({ ...cableById.get(id), isReturn: true })).filter((c) => c.id) : []
  const names = (ids) => ids.map((id) => deviceNameById.get(id) || '?').join(', ') || '-'

  return html`
    <div>
      <${BackLink} onClick=${onBack}>Back to circuits<//>
      <${ErrorBanner} message=${error} />
      ${circuit && !editing && html`
        <div class="card">
          <h2>${circuit.name} <${StatusBadge} status=${circuit.status} /></h2>
          <div class="meta">${circuitFacts(circuit)}</div>
          ${d && html`
            <div class="meta">Protected by: ${d.protectorId ? deviceNameById.get(d.protectorId) || '?' : 'nothing (no fuse or breaker)'}</div>
            <div class="meta">Supply: ${names(d.supplyDeviceIds)}</div>
            <div class="meta">Ends at: ${names(d.endDeviceIds)}</div>
            ${d.implicitReturnDeviceIds.length > 0 && html`<div class="meta">Negative assumed alongside the feed for: ${names(d.implicitReturnDeviceIds)}</div>`}
          `}
          ${d && d.warnings.map((w, i) => html`<div key=${i} class="error-banner">${w.message}</div>`)}
          ${circuit.notes && html`<p>${circuit.notes}</p>`}
          <div class="row-actions">
            <button onClick=${() => setEditing(true)}>Edit name and notes</button>
            <button onClick=${() => setShowHistory((v) => !v)}>${showHistory ? 'Hide history' : 'History'}</button>
          </div>
        </div>
      `}
      ${circuit && editing && html`
        <div class="card">
          <${Form} fields=${CIRCUIT_FIELDS} initial=${circuit} onSubmit=${save} onCancel=${() => setEditing(false)} />
        </div>
      `}
      ${showHistory && html`<${ChangeLog} kind="circuit" id=${circuitId} />`}

      ${feedCables.length > 0 && html`
        <h3>Diagram</h3>
        <${DiagramView} cables=${[...feedCables, ...returnCables]} deviceNameById=${deviceNameById} deviceIconById=${deviceIconById} />
      `}

      <h3>Cables</h3>
      ${d && feedCables.length + returnCables.length === 0 && html`<div class="empty-state">No cables.</div>`}
      ${feedCables.length + returnCables.length > 0 && html`
        <table>
          <thead><tr><th>From</th><th>To</th><th>Role</th><th>Cable</th><th>Gauge</th><th>Length</th></tr></thead>
          <tbody>
            ${[...feedCables, ...returnCables].map((c) => html`
              <tr key=${(c.isReturn ? 'r-' : 'f-') + c.id}>
                <td>${deviceNameById.get(c.fromDeviceId) || '?'}</td>
                <td>${deviceNameById.get(c.toDeviceId) || '?'}</td>
                <td>${c.isReturn ? 'Negative return' : 'Feed'}</td>
                <td>${c.cableLabel || '-'}</td>
                <td>${c.gauge ? `${c.gauge} ${c.gaugeUnit || ''}` : '-'}</td>
                <td>${c.length ? `${c.length} ${c.lengthUnit || ''}` : '-'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>
  `
}

function DevicesList ({ onSelect }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const { loading, error, items } = useResourceList('wiringDevices', reloadKey)
  const [filter, setFilter] = useState({})
  const visible = items.filter((d) =>
    matchesFilter(d, filter) && (!filter.role || (d.role || 'consumer') === filter.role))

  const createDevice = async (payload) => {
    await putResource('wiringDevices', newId(), payload)
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
      <${ZoneTagFilter} items=${items} filter=${filter} onChange=${setFilter} withRole=${true} />
      ${visible.map((device) => html`
        <div
          key=${device.id}
          class="list-item ${device.status === 'removed' ? 'removed' : ''}"
          onClick=${() => onSelect(device.id)}
        >
          <div class="list-item-main">
            ${deviceIconUrl(device) && html`<img class="device-icon" src=${deviceIconUrl(device)} alt="" />`}
            <div>
            <div>${device.name}</div>
            <div class="meta">${roleLabel(device.role)} – ${device.type || 'no type recorded'}${device.zone ? ` – ${device.zone}` : ''}${(device.tags || []).length ? ` – ${device.tags.join(', ')}` : ''}</div>
            </div>
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
  const { items: circuits } = useResourceList('wiringCircuits')

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

  const setIcon = async (attachmentId) => {
    setError(null)
    try {
      await putResource('wiringDevices', deviceId, { ...device, iconAttachmentId: attachmentId })
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    }
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
          <h2>
            ${deviceIconUrl(device) && html`<img class="device-icon device-icon-large" src=${deviceIconUrl(device)} alt="" />`}
            ${device.name} <${StatusBadge} status=${device.status} />
          </h2>
          <div class="meta">${roleLabel(device.role)} – ${device.type || 'no type recorded'}${device.zone ? ` – ${device.zone}` : ''}${(device.tags || []).length ? ` – ${device.tags.join(', ')}` : ''}</div>
          ${device.ratedPowerW && html`<div class="meta">${device.ratedPowerW} W rated</div>`}
          ${device.tripRatingA && html`<div class="meta">Trip rating: ${device.tripRatingA} A</div>`}
          ${device.nominalVoltage && html`<div class="meta">Nominal voltage: ${device.nominalVoltage} V</div>`}
          ${device.powerFactor && html`<div class="meta">Power factor: ${device.powerFactor}</div>`}
          ${(device.terminals || []).length > 0 && html`
            <div class="meta">Terminals:
              <ul>${device.terminals.map((t, i) => html`<li key=${i}>${describeTerminal(t)}</li>`)}</ul>
            </div>
          `}
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
            context=${{ deviceId, acDeviceIds: acConsumerIds(circuits) }}
            onSubmit=${saveDevice}
            onCancel=${() => setEditing(false)}
          />
        </div>
      `}
      ${showHistory && html`<${ChangeLog} kind="device" id=${deviceId} />`}
      ${device && html`
        <h3>Attachments</h3>
        <${AttachmentList} ownerType="device" ownerId=${deviceId}
          iconAttachmentId=${device.iconAttachmentId} onIconChange=${setIcon} />
      `}
    </div>
  `
}

function ConduitsList ({ onSelect }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const { loading, error, items } = useResourceList('wiringConduits', reloadKey)
  const [filter, setFilter] = useState({})
  const { suggested, used } = kindOptions(items.map((c) => c.kind), '')
  const visible = filterConduits(items, filter)

  const createConduit = async (payload) => {
    await putResource('wiringConduits', newId(), payload)
    setShowForm(false)
    setReloadKey((k) => k + 1)
  }

  return html`
    <div>
      <p class="meta">
        A conduit is a conduit, hose, loom, trunking or cable tray that several cables run through.
        Add the cables on its page; draw its route on the Floorplan tab.
      </p>
      <div class="list-header">
        <button onClick=${() => setShowForm((v) => !v)}>${showForm ? 'Cancel' : '+ New conduit'}</button>
      </div>
      ${showForm && html`
        <${Form}
          fields=${CONDUIT_FIELDS}
          onSubmit=${createConduit}
          onCancel=${() => setShowForm(false)}
          submitLabel="Create conduit"
        />
      `}
      ${loading && html`<div class="empty-state">Loading conduits&hellip;</div>`}
      <${ErrorBanner} message=${error} />
      ${!loading && !error && items.length === 0 && html`
        <div class="empty-state">No conduits recorded yet.</div>
      `}
      ${items.length > 0 && html`
        <${ZoneTagFilter} items=${[]} filter=${filter} onChange=${setFilter}>
          <label class="form-field compact"><span>Kind</span>
            <select value=${filter.kind || ''} onChange=${(e) => setFilter({ ...filter, kind: e.target.value || null })}>
              <option value="">All kinds</option>
              ${[...suggested, ...used].map((k) => html`<option value=${k} key=${k}>${k}</option>`)}
            </select>
          </label>
        <//>
      `}
      ${visible.map((conduit) => html`
        <div
          key=${conduit.id}
          class="list-item ${conduit.status === 'removed' ? 'removed' : ''}"
          onClick=${() => onSelect(conduit.id)}
        >
          <div>
            <div>${conduit.name}</div>
            <div class="meta">${conduitSummary(conduit)}${conduit.zone ? ` – ${conduit.zone}` : ''} – ${(conduit.cableIds || []).length === 1 ? '1 cable' : `${(conduit.cableIds || []).length} cables`}</div>
          </div>
          <${StatusBadge} status=${conduit.status} />
        </div>
      `)}
    </div>
  `
}

function ConduitDetail ({ conduitId, onBack }) {
  const [conduit, setConduit] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [toAdd, setToAdd] = useState('')
  const { items: runs } = useResourceList('wiringWireRuns', reloadKey)
  const { items: devices } = useResourceList('wiringDevices')
  const { items: conduits } = useResourceList('wiringConduits', reloadKey)

  useEffect(() => {
    let cancelled = false
    fetchResource('wiringConduits', conduitId)
      .then((data) => { if (!cancelled) setConduit(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [conduitId, reloadKey])

  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]))
  const runById = new Map(runs.map((r) => [r.id, r]))
  const reload = () => setReloadKey((k) => k + 1)
  const guard = async (fn) => {
    setError(null)
    try { await fn(); reload() } catch (err) { setError(err.message) }
  }

  const saveConduit = async (payload) => {
    await putResource('wiringConduits', conduitId, payload)
    setEditing(false)
    reload()
  }
  const removeConduit = async () => {
    if (!conduit || !confirmRemove(conduit.name)) return
    await deleteResource('wiringConduits', conduitId)
    onBack()
  }
  const setCables = (cableIds) => guard(() => putResource('wiringConduits', conduitId, { cableIds }))
  const addCable = () => {
    if (!toAdd) return
    const id = toAdd
    setToAdd('')
    return setCables([...(conduit.cableIds || []), id])
  }
  // Moves this conduit one place earlier or later in the cable's own list.
  const moveForCable = (run, delta) =>
    guard(() => putResource('wiringWireRuns', run.id, { conduitIds: moveInList(run.conduitIds || [], conduitId, delta) }))

  const cables = conduit ? (conduit.cableIds || []).map((id) => runById.get(id)).filter(Boolean) : []
  const candidates = conduit ? addableCables(runs, conduit) : []

  return html`
    <div>
      <${BackLink} onClick=${onBack}>Back to conduits<//>
      <${ErrorBanner} message=${error} />
      ${conduit && !editing && html`
        <div class="card">
          <h2>${conduit.name} <${StatusBadge} status=${conduit.status} /></h2>
          <div class="meta">${conduitSummary(conduit)}${conduit.zone ? ` – ${conduit.zone}` : ''}</div>
          <div class="meta">${Array.isArray(conduit.route) && conduit.route.length > 1
            ? `Route drawn: ${conduit.route.length} points`
            : 'No route drawn yet. Draw it on the Floorplan tab.'}</div>
          ${conduit.notes && html`<p>${conduit.notes}</p>`}
          <div class="row-actions">
            <button onClick=${() => setEditing(true)}>Edit</button>
            ${conduit.status !== 'removed' && html`<button onClick=${removeConduit}>Remove</button>`}
            <button onClick=${() => setShowHistory((v) => !v)}>
              ${showHistory ? 'Hide history' : 'History'}
            </button>
          </div>
        </div>
      `}
      ${conduit && editing && html`
        <div class="card">
          <${Form}
            fields=${CONDUIT_FIELDS}
            initial=${conduit}
            onSubmit=${saveConduit}
            onCancel=${() => setEditing(false)}
          />
        </div>
      `}
      ${showHistory && html`<${ChangeLog} kind="conduit" id=${conduitId} />`}
      ${conduit && html`
        <h3>Cables in this conduit (${cables.length})</h3>
        ${cables.length === 0 && html`<div class="empty-state">No cables assigned yet.</div>`}
        ${cables.map((run) => {
          const others = conduitsOfRun(run, conduits)
          const position = (run.conduitIds || []).indexOf(conduitId)
          return html`
            <div class="list-item ${run.status === 'removed' ? 'removed' : ''}" key=${run.id}>
              <div>
                <div>${cableName(run, deviceNameById)}</div>
                <div class="meta">
                  ${others.length > 1
                    ? `Passes through ${others.map((c) => c.name).join(', then ')}`
                    : 'Only in this conduit'}
                  ${run.status === 'removed' ? ' – removed' : ''}
                </div>
              </div>
              <div class="row-actions">
                ${others.length > 1 && html`
                  <button title="Pass through this conduit earlier" disabled=${position <= 0}
                    onClick=${() => moveForCable(run, -1)}>Earlier</button>
                  <button title="Pass through this conduit later" disabled=${position >= others.length - 1}
                    onClick=${() => moveForCable(run, 1)}>Later</button>
                `}
                <button onClick=${() => setCables((conduit.cableIds || []).filter((id) => id !== run.id))}>Take out</button>
              </div>
            </div>
          `
        })}
        ${conduit.status !== 'removed' && html`
          <div class="row-actions">
            <select value=${toAdd} onChange=${(e) => setToAdd(e.target.value)} aria-label="Cable to add">
              <option value="">Add a cable…</option>
              ${candidates.map((r) => html`<option value=${r.id} key=${r.id}>${cableName(r, deviceNameById)}</option>`)}
            </select>
            <button disabled=${!toAdd} onClick=${addCable}>Add cable</button>
          </div>
        `}
        <h3>Attachments</h3>
        <${AttachmentList} ownerType="conduit" ownerId=${conduitId} />
      `}
    </div>
  `
}

const ICON_MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
const ICON_SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'

function ThemeToggle ({ theme, onToggle }) {
  const toDark = theme !== 'dark'
  return html`
    <button class="theme-toggle" onClick=${onToggle}
      title=${toDark ? 'Switch to the red night theme' : 'Switch to the light theme'}
      aria-label=${toDark ? 'Switch to the red night theme' : 'Switch to the light theme'}
      dangerouslySetInnerHTML=${{ __html: toDark ? ICON_MOON : ICON_SUN }}></button>
  `
}

function App () {
  const settings = useSettings()
  const [theme, toggleTheme] = useTheme(settings.autoTheme)
  const [tab, setTab] = useState('circuits')
  const [selectedCircuitId, setSelectedCircuitId] = useState(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [selectedConduitId, setSelectedConduitId] = useState(null)

  const switchTab = (nextTab) => {
    setTab(nextTab)
    setSelectedCircuitId(null)
    setSelectedDeviceId(null)
    setSelectedConduitId(null)
  }

  return html`
    <div>
      <header>
        <h1>Wiring Documentation</h1>
        <${ThemeToggle} theme=${theme} onToggle=${toggleTheme} />
      </header>
      <nav class="tabs">
        <button class=${tab === 'circuits' ? 'active' : ''} onClick=${() => switchTab('circuits')}>Circuits</button>
        <button class=${tab === 'cables' ? 'active' : ''} onClick=${() => switchTab('cables')}>Cables</button>
        <button class=${tab === 'devices' ? 'active' : ''} onClick=${() => switchTab('devices')}>Devices</button>
        <button class=${tab === 'conduits' ? 'active' : ''} onClick=${() => switchTab('conduits')}>Conduits</button>
        <button class=${tab === 'load' ? 'active' : ''} onClick=${() => switchTab('load')}>Load Summary</button>
        <button class=${tab === 'zones' ? 'active' : ''} onClick=${() => switchTab('zones')}>Zones</button>
        <button class=${tab === 'schematics' ? 'active' : ''} onClick=${() => switchTab('schematics')}>Schematics</button>
        <button class=${tab === 'floorplan' ? 'active' : ''} onClick=${() => switchTab('floorplan')}>Floorplan</button>
      </nav>
      <main>
      ${tab === 'circuits' && !selectedCircuitId && html`<${CircuitsList} onSelect=${setSelectedCircuitId} />`}
      ${tab === 'circuits' && selectedCircuitId && html`
        <${CircuitDetail} circuitId=${selectedCircuitId} onBack=${() => setSelectedCircuitId(null)} />
      `}
      ${tab === 'cables' && html`<${CablesList} />`}
      ${tab === 'devices' && !selectedDeviceId && html`<${DevicesList} onSelect=${setSelectedDeviceId} />`}
      ${tab === 'devices' && selectedDeviceId && html`
        <${DeviceDetail} deviceId=${selectedDeviceId} onBack=${() => setSelectedDeviceId(null)} />
      `}
      ${tab === 'conduits' && !selectedConduitId && html`<${ConduitsList} onSelect=${setSelectedConduitId} />`}
      ${tab === 'conduits' && selectedConduitId && html`
        <${ConduitDetail} conduitId=${selectedConduitId} onBack=${() => setSelectedConduitId(null)} />
      `}
      ${tab === 'load' && html`<${LoadSummary} />`}
      ${tab === 'zones' && html`<${ZonesManager} />`}
      ${tab === 'schematics' && html`<${SchematicsTab} renderCableForm=${(props) => html`<${CableForm} ...${props} />`} />`}
      ${tab === 'floorplan' && html`<${FloorplanTab} />`}
      </main>
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
