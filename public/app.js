import { html, render, useState, useEffect } from './vendor/preact-standalone.module.js'
import { newId } from './ids.js'
import { PathCombobox } from './signalkPaths.js'
import { ROLES, roleLabel } from './roles.js'
import {
  NO_ZONE, parseTags, tagsToText, collectTags, matchesFilter, circuitMatches, matchesSearch, matchesRemoved,
  readShowRemoved, writeShowRemoved
} from './zones.js'
import { duplicateDevicePayload, duplicateCablePrefill } from './duplicate.js'
import {
  CABLE_KINDS, CONDUCTOR_LABELS, kindByValue, defaultNegativeLanding, negativeLandingCandidates, needsTerminal,
  terminalOptions, buildCablePayload, defaultColorFor, buildBulkPayload, cableToValues, validateCable, circuitsOfCable, cableTitle,
  LINK_CHOICES, linkApplies, linkKind, resolveLink
} from './cableForm.js'
import dagre from './vendor/dagre.esm.js'
import { CsvImport } from './import.js'
import { LoadSummary } from './loadSummary.js'
import { FloorplanTab } from './floorplanView.js'
import { SchematicsTab } from './schematicView.js'
import { BatteriesTab } from './batteriesView.js'
import { hashForState, parseHash } from './router.js'
import { UndoProvider, useUndo } from './undoBar.js'
import { deviceBox, endTerminals } from './schematic.js'
import { PortBlocks } from './ports.js'
import { useSettings, colorPlaceholder } from './settings.js'
import { useTheme } from './theme.js'
import { typeOptions, isCriticalType, typeCurrent } from './deviceTypes.js'
import { suggestKind, mismatchText, conduitCurrentMix, conduitMixText } from './current.js'
import { describeMeasured, describeGroup } from './measured.js'
import { useLive } from './live.js'
import { CalibrateDialog } from './calibrate.js'
import { LiveLock, LiveReading, LiveBar } from './liveMarks.js'
import { deviceFieldVisible, acConsumerIds, cleanTerminals, describeTerminal, terminalPreset } from './deviceFields.js'
import { kindOptions, cableName, conduitSummary, addableCables, conduitsOfRun, moveInList, filterConduits } from './conduits.js'
import {
  CHEMISTRIES, PURPOSES, CHEMISTRY_LABELS, PURPOSE_LABELS, batteryFieldVisible, deviceToFormValues, formPayloadToDevice,
  chemistryFill, typeBatteryFill, socPathFill, installedAgeText, fractionToPercent, bankOfBattery, describeBank
} from './batteries.js'
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
  if (!res.ok) {
    const err = new Error(`failed to load ${type}/${id}: ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
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
  if (!res.ok) throw new Error(await refusalMessage(res, apiErrorMessage(res.status)))
}

// Undo of a removal: a plain write of status active, which the store logs as a restore.
async function restoreResource (type, id) {
  await putResource(type, id, { status: 'active' })
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

// Plain anchors on the hash routes, so a link can be opened in a new tab and
// the Back button returns to where the link was. Clicks do not reach the
// clickable list row around a link.
function RouteLink ({ tab, id, children }) {
  return html`<a class="route-link" href=${hashForState({ tab, id })} onClick=${(e) => e.stopPropagation()}>${children}</a>`
}

// A device name that links to the device, or "?" when the device is unknown.
function DeviceLink ({ id, names }) {
  const name = id ? names.get(id) : null
  return name ? html`<${RouteLink} tab="devices" id=${id}>${name}<//>` : '?'
}

// The remembered "Show removed" choice of one list; off by default.
function useShowRemoved (listKey) {
  const [on, setOn] = useState(() => readShowRemoved(listKey))
  const set = (value) => { setOn(value); writeShowRemoved(listKey, value) }
  return [on, set]
}

// Search box and "Show removed" toggle, placed in the zone and tag filter bar.
function ListControls ({ query, onQuery, showRemoved, onShowRemoved, removedCount, label }) {
  return html`
    <label class="form-field compact search-field"><span>Search</span>
      <input type="search" value=${query} placeholder=${label} aria-label="Search"
        onInput=${(e) => onQuery(e.target.value)} />
    </label>
    <label class="check-inline">
      <input type="checkbox" class="checkbox-input" checked=${showRemoved} onChange=${(e) => onShowRemoved(e.target.checked)} />
      Show removed${removedCount > 0 ? ` (${removedCount})` : ''}
    </label>
  `
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
function TerminalsEditor ({ value, role, type, onChange }) {
  const preset = terminalPreset(type)
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
      <div class="row-actions">
        <button type="button" onClick=${add}>+ Add terminal</button>
        ${preset && value.length === 0 && html`<button type="button" onClick=${() => onChange(preset.terminals)}>Use standard ports for ${preset.label}</button>`}
      </div>
    </div>
  `
}

// A generic labeled-field form: circuits, wire runs, and devices are all
// "a handful of inputs, Save/Cancel, an error banner on failure" with
// different field lists, so this covers all three rather than
// duplicating the submit/error/loading handling three times.
function Form ({ fields, initial, onSubmit, onCancel, submitLabel = 'Save', context, onFieldChange }) {
  const [values, setValues] = useState(() => {
    const v = {}
    for (const f of fields) {
      const raw = initial ? initial[f.key] : null
      if (f.type === 'terminals') { v[f.key] = Array.isArray(raw) ? raw.map((t) => ({ ...t })) : []; continue }
      if (f.type === 'checkbox') { v[f.key] = initial ? Boolean(raw) : Boolean(f.defaultValue); continue }
      v[f.key] = f.type === 'tags' ? tagsToText(raw) : raw != null ? String(raw) : (f.defaultValue ?? '')
    }
    return v
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [touched, setTouched] = useState({})
  // onFieldChange(key, value, values, touched) may return more values to set,
  // for example a default that follows another field until the user sets it.
  const setField = (key, value) => {
    setTouched((t) => ({ ...t, [key]: true }))
    setValues((v) => {
      const next = { ...v, [key]: value }
      const extra = onFieldChange ? onFieldChange(key, value, next, touched) : null
      return extra ? { ...next, ...extra } : next
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {}
    for (const f of fields) {
      if (f.showWhen && !f.showWhen(values, context)) continue
      const raw = values[f.key]
      if (f.type === 'terminals') { payload[f.key] = cleanTerminals(raw); continue }
      if (f.type === 'checkbox') { payload[f.key] = Boolean(raw); continue }
      // Zone and tags are always sent, so clearing them on an edit takes effect.
      if (f.type === 'zone' || f.type === 'deviceType' || f.type === 'conduitKind') { payload[f.key] = raw === '' || raw == null ? null : raw; continue }
      if (f.type === 'tags') { payload[f.key] = parseTags(raw); continue }
      // Emptied free-form fields are sent as null so clearing them on an edit
      // takes effect (a missing key keeps the stored value).
      const freeForm = f.type === 'text' || f.type === 'number' || f.type === 'textarea' || f.type === 'signalkPath' ||
        f.type === 'date' || f.type === 'devicePick'
      if ((f.clearable || (freeForm && !f.required)) && (raw === '' || raw == null)) { payload[f.key] = null; continue }
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
            <${TerminalsEditor} value=${values[f.key]} role=${values.role} type=${values.type} onChange=${(v) => setField(f.key, v)} />
          `}
          ${f.type === 'checkbox' && html`
            <input type="checkbox" class="checkbox-input" checked=${Boolean(values[f.key])}
              onChange=${(e) => setField(f.key, e.target.checked)} />
          `}
          ${f.type === 'textarea' && html`
            <textarea
              value=${values[f.key]}
              onInput=${(e) => setField(f.key, e.target.value)}
            ></textarea>
          `}
          ${f.type === 'select' && html`
            <select value=${values[f.key]} onChange=${(e) => setField(f.key, e.target.value)}>
              ${!f.noBlank && html`<option value="">${f.blankLabel || '—'}</option>`}
              ${f.options.map((o) => {
                const option = typeof o === 'string' ? { value: o, label: o } : o
                return html`<option value=${option.value} key=${option.value}>${option.label}</option>`
              })}
            </select>
          `}
          ${f.type === 'devicePick' && html`
            <select value=${values[f.key]} onChange=${(e) => setField(f.key, e.target.value)}>
              <option value="">None</option>
              ${((context && context.devices) || [])
                .filter((d) => d.status !== 'removed' && d.id !== (context && context.deviceId))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => html`<option value=${d.id} key=${d.id}>${d.name} (${roleLabel(d.role)})</option>`)}
            </select>
          `}
          ${f.type === 'date' && html`
            <input type="date" value=${values[f.key]} onInput=${(e) => setField(f.key, e.target.value)} />
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
              step=${f.type === 'number' ? (f.step || 'any') : undefined}
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
      <div class="upload-row">
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
        <label class="upload-button">
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            data-testid="take-photo"
            onChange=${upload}
            disabled=${uploading}
            hidden
          />
        </label>
      </div>
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

// A new device of a critical-looking type starts with confirm-before-switching
// on, until the user sets the box themselves.
// A type with standard ports (a DC-DC converter, a MultiPlus) fills in its
// terminals while the list is still empty.
function criticalDefault (key, value, values, touched) {
  if (key !== 'type') return null
  const extra = {}
  if (!touched.confirmSwitching) extra.confirmSwitching = isCriticalType(value)
  const preset = terminalPreset(value)
  if (preset && !(values.terminals || []).some((t) => t.name)) extra.terminals = preset.terminals
  return extra
}

// For a new device the Current select follows the type until the user sets it.
function newDeviceDefaults (key, value, values, touched) {
  const extra = criticalDefault(key, value, values, touched) || {}
  if (key === 'type' && !touched.current) extra.current = typeCurrent(value) || ''
  if (key === 'type') Object.assign(extra, typeBatteryFill(value, values, touched))
  return { ...extra, ...(batteryDefaults(key, value, values, touched) || {}) }
}

// The battery form follows: the chemistry fills voltage and usable, the state
// of charge path suggests the time remaining path. Used when adding and editing.
function batteryDefaults (key, value, values, touched) {
  if (key === 'chemistry') return chemistryFill(value, values, touched)
  if (key === 'socPath') return socPathFill(value, values, touched)
  return null
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
  {
    key: 'current',
    label: 'Current',
    type: 'select',
    options: [{ value: 'ac', label: 'AC' }, { value: 'dc', label: 'DC' }],
    blankLabel: 'Either',
    clearable: true,
    hint: 'Whether this device is AC or DC. Cables drawn to it get the matching cable type, and a warning appears when the two ends disagree. Starts from the type (a battery is DC, a shore power inlet AC). Leave it on Either for converters and for devices whose terminals say it already.'
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
    key: 'chemistry',
    label: 'Chemistry',
    type: 'select',
    options: CHEMISTRIES.map((c) => ({ value: c, label: CHEMISTRY_LABELS[c] })),
    blankLabel: 'Either',
    clearable: true,
    showWhen: (values) => batteryFieldVisible('chemistry', values),
    hint: 'Choosing one fills Nominal voltage and Usable (%) with usual values until you set them yourself.'
  },
  {
    key: 'purpose',
    label: 'Purpose',
    type: 'select',
    options: PURPOSES.map((p) => ({ value: p, label: PURPOSE_LABELS[p] })),
    blankLabel: 'Not set',
    clearable: true,
    showWhen: (values) => batteryFieldVisible('purpose', values)
  },
  {
    key: 'capacityAh',
    label: 'Capacity (Ah)',
    type: 'number',
    clearable: true,
    showWhen: (values) => batteryFieldVisible('capacityAh', values),
    hint: 'The amp-hours of this one battery.'
  },
  {
    key: 'usablePercent',
    label: 'Usable (%)',
    type: 'number',
    clearable: true,
    showWhen: (values) => batteryFieldVisible('usablePercent', values),
    hint: 'How much of the capacity you plan to use, for example 50 for lead-acid and 80 for LiFePO4.'
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
    key: 'makeModel',
    label: 'Make and model',
    type: 'text',
    showWhen: (values) => batteryFieldVisible('makeModel', values)
  },
  {
    key: 'installedOn',
    label: 'Installed on',
    type: 'date',
    showWhen: (values) => batteryFieldVisible('installedOn', values)
  },
  {
    key: 'monitorDeviceId',
    label: 'Monitored by',
    type: 'devicePick',
    showWhen: (values) => batteryFieldVisible('monitorDeviceId', values),
    hint: 'The shunt or battery monitor that measures this battery. Its paths are used when this battery has none of its own.'
  },
  {
    key: 'voltagePath',
    label: 'Voltage path',
    type: 'signalkPath',
    placeholder: 'e.g. electrical.batteries.house.voltage',
    showWhen: (values) => batteryFieldVisible('voltagePath', values)
  },
  {
    key: 'currentPath',
    label: 'Current path',
    type: 'signalkPath',
    placeholder: 'e.g. electrical.batteries.house.current',
    showWhen: (values) => batteryFieldVisible('currentPath', values)
  },
  {
    key: 'socPath',
    label: 'State of charge path',
    type: 'signalkPath',
    placeholder: 'e.g. electrical.batteries.house.capacity.stateOfCharge',
    showWhen: (values) => batteryFieldVisible('socPath', values)
  },
  {
    key: 'timeRemainingPath',
    label: 'Time remaining path',
    type: 'signalkPath',
    placeholder: 'e.g. electrical.batteries.house.capacity.timeRemaining',
    showWhen: (values) => batteryFieldVisible('timeRemainingPath', values),
    hint: 'Suggested from the state of charge path. Leave empty when the monitor does not report it.'
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
    hint: 'Only needed where they remove ambiguity: a converter (give each terminal the port it belongs to, for example DC in or AC out, or PV in and Battery on an MPPT charger), a battery with several posts, a fuse block.'
  },
  {
    key: 'signalkPath',
    label: 'SignalK path',
    type: 'signalkPath',
    placeholder: 'e.g. electrical.switches.anchorLight',
    hint: 'For a Shunt, this is where its current readings come from, unless a Meter path is set below.'
  },
  {
    key: 'switchPath',
    label: 'Switch path',
    type: 'signalkPath',
    clearable: true,
    placeholder: 'e.g. electrical.switches.bank.0.3.state',
    hint: 'Only for a relay, switch or breaker module the plugin may turn on and off, or a device that switches itself. The SignalK path that holds its on or off state. Every consumer fed through it can then be switched from the Live view.'
  },
  {
    key: 'confirmSwitching',
    label: 'Confirm before switching',
    type: 'checkbox',
    hint: 'Ask "are you sure" before this device (or anything on the same switch) is turned on or off from the app. Starts on for devices that look critical, such as a bilge pump, refrigerator, autopilot, navigation light or windlass. The type is free text, so check it for your own critical devices.'
  },
  {
    key: 'neverRemote',
    label: 'Never switch remotely',
    type: 'checkbox',
    hint: 'The app and the calibration refuse to switch this device, and the Live view shows it with a lock. A switch shared with a locked device is locked too, since turning it off would turn the locked device off.'
  },
  {
    key: 'meterPath',
    label: 'Meter path',
    type: 'signalkPath',
    clearable: true,
    placeholder: 'e.g. electrical.batteries.shunt.current',
    hint: 'A SignalK path that measures the current or power through this device: a shunt, a relay channel with a current reading, a battery. Consumers downstream are measured by the nearest meter upstream. A whole-battery meter works but is less accurate, since every other load adds noise.'
  },
  {
    key: 'meterUnit',
    label: 'Meter unit',
    type: 'select',
    options: [{ value: 'A', label: 'Amps (A)' }, { value: 'W', label: 'Watts (W)' }],
    clearable: true,
    hint: 'Watts are better. With amps the plugin multiplies by the circuit voltage and assumes a power factor of 1, and marks the result as an estimate. Blank counts as amps.'
  },
  { key: 'posX', label: 'Position x (m, from the transom toward the bow)', type: 'number', step: '0.01' },
  { key: 'posY', label: 'Position y (m, athwartships)', type: 'number', step: '0.01' },
  { key: 'posZ', label: 'Position z (m, height)', type: 'number', step: '0.01' },
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
  const [tagsText, setTagsText] = useState(() => tagsToText(cable ? cable.tags : (prefill && prefill.tags) || []))
  const [more, setMore] = useState(() => (cable || prefill) ? kindByValue(values.kind).more : false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Until the user picks a kind themselves, the kind follows the two ends. A
  // cable being edited, or one that arrives with a kind chosen elsewhere
  // (the quick popover), keeps its kind.
  const [kindTouched, setKindTouched] = useState(Boolean(cable || (prefill && prefill.kind)))
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const setKind = (kind) => { setKindTouched(true); set('kind', kind) }
  const setLink = (link) => setValues((v) => ({ ...v, link, kind: v.kind === 'custom' ? v.kind : linkKind(link) }))
  const setEnd = (key, id) => {
    const next = { ...values, [key]: id }
    if (!kindTouched && !cable) {
      const from = devices.find((d) => d.id === next.fromDeviceId)
      const to = devices.find((d) => d.id === next.toDeviceId)
      if (from && to) {
        const { kind } = suggestKind(from, '', to, '')
        if (kindByValue(kind).more) setMore(true)
        next.kind = kind
      }
    }
    // Between two batteries a new cable is a parallel link until chosen otherwise.
    const fromEnd = devices.find((d) => d.id === next.fromDeviceId)
    const toEnd = devices.find((d) => d.id === next.toDeviceId)
    if (!cable && linkApplies(fromEnd, toEnd) && !next.link) {
      next.link = 'parallel'
      if (!kindTouched) next.kind = linkKind('parallel')
    }
    setValues(next)
  }
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
  const showLink = linkApplies(fromDevice, toDevice)
  const mismatch = !cable && fromDevice && toDevice ? suggestKind(fromDevice, '', toDevice, '').mismatch : null
  const kinds = CABLE_KINDS.filter((k) => !k.more || more || k.value === values.kind)

  const submit = async (e) => {
    e.preventDefault()
    const message = validateCable(values) ||
      (values.kind === 'both' && !values.negativeLandingId ? 'Choose where the negative lands at the supply end.' : null)
    if (message) { setError(message); return }
    setSaving(true)
    setError(null)
    try {
      const link = resolveLink(values, fromDevice, toDevice, cable && cable.link)
      await onSaved(buildCablePayload({ ...values, tags: parseTags(tagsText), link }, { defaults: !cable }), cable ? cable.id : newId())
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
        onChange=${(v) => setEnd('fromDeviceId', v)} devices=${devices} onCreated=${onDevicesChanged}
        defaultRole="distribution"
        hint="The side the power comes from: a fuse, breaker, bus bar, battery or source." />
      <${DevicePicker} label="To (load side)" required=${true} value=${values.toDeviceId}
        onChange=${(v) => setEnd('toDeviceId', v)} devices=${devices} onCreated=${onDevicesChanged}
        defaultRole="consumer" />

      ${showLink && html`
        <div class="form-field" data-testid="link-choice">
          <span>Link between the batteries</span>
          <div class="kind-choice">
            ${LINK_CHOICES.map((l) => html`
              <label key=${l.value} class="radio-chip">
                <input type="radio" name="cable-link" value=${l.value} checked=${(values.link || 'parallel') === l.value}
                  onChange=${() => setLink(l.value)} />
                ${l.label}
              </label>
            `)}
          </div>
          <small class="hint">Parallel joins positive and negative and makes one bigger bank. Series is a single positive conductor between two batteries and adds their voltages.</small>
        </div>
      `}
      <div class="form-field">
        <span>Conductors</span>
        ${mismatch && html`<div class="warning-banner" data-testid="current-mismatch">${mismatchText(mismatch, fromDevice, toDevice)}</div>`}
        <div class="kind-choice">
          ${kinds.map((k) => html`
            <label key=${k.value} class="radio-chip">
              <input type="radio" name="cable-kind" value=${k.value} checked=${values.kind === k.value}
                onChange=${() => setKind(k.value)} />
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
          <input type="text" value=${values.colors[conductor] ?? (cable ? '' : defaultColorFor(conductor))}
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

// Change the same properties on several cables at once. Blank fields leave
// each cable as it is; tags are added to each cable's own.
function BulkCableForm ({ cables, deviceNameById, onDone, onCancel }) {
  const [values, setValues] = useState({ gauge: '', gaugeUnit: '', length: '', lengthUnit: '', cableLabel: '', zoneId: '', clearZone: false })
  const [tagsText, setTagsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const addTags = parseTags(tagsText)
  const anything = Object.keys(buildBulkPayload({ ...values, addTags }, {})).length > 0

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const failed = []
    for (const cable of cables) {
      const payload = buildBulkPayload({ ...values, addTags }, cable)
      if (Object.keys(payload).length === 0) continue
      try {
        await putResource('wiringWireRuns', cable.id, payload)
      } catch (err) {
        failed.push(`${cableTitle(cable, deviceNameById)}: ${err.message}`)
      }
    }
    setSaving(false)
    if (failed.length > 0) setError(`${failed.length} of ${cables.length} cables could not be saved. ${failed.join('; ')}`)
    else onDone(`Changed ${cables.length} cable${cables.length === 1 ? '' : 's'}.`)
  }

  return html`
    <form class="inline-form" onSubmit=${submit}>
      <strong>Change ${cables.length} selected cable${cables.length === 1 ? '' : 's'}</strong>
      <p class="meta">Only the fields you fill in are changed. Empty fields leave every cable as it is.</p>
      <${ErrorBanner} message=${error} />
      <div class="form-field">
        <span>Gauge</span>
        <div class="row-actions">
          <input type="number" step="any" value=${values.gauge} onInput=${(e) => set('gauge', e.target.value)} />
          <select value=${values.gaugeUnit} onChange=${(e) => set('gaugeUnit', e.target.value)}>
            <option value="">(unchanged)</option><option value="AWG">AWG</option><option value="mm2">mm²</option>
          </select>
        </div>
      </div>
      <div class="form-field">
        <span>Length</span>
        <div class="row-actions">
          <input type="number" step="any" value=${values.length} onInput=${(e) => set('length', e.target.value)} />
          <select value=${values.lengthUnit} onChange=${(e) => set('lengthUnit', e.target.value)}>
            <option value="">(unchanged)</option><option value="m">m</option><option value="ft">ft</option>
          </select>
        </div>
      </div>
      <label class="form-field"><span>Cable label</span>
        <input type="text" value=${values.cableLabel} onInput=${(e) => set('cableLabel', e.target.value)} />
      </label>
      <label class="form-field"><span>Zone</span>
        <${ZoneField} value=${values.zoneId} onChange=${(v) => { set('zoneId', v); if (v) set('clearZone', false) }} />
        <small class="hint">Leave empty to keep each cable's zone.</small>
      </label>
      <label class="form-field"><span>Clear the zone</span>
        <input type="checkbox" class="checkbox-input" checked=${values.clearZone}
          onChange=${(e) => setValues((v) => ({ ...v, clearZone: e.target.checked, zoneId: e.target.checked ? '' : v.zoneId }))} />
      </label>
      <label class="form-field"><span>Add tags</span>
        <input type="text" value=${tagsText} placeholder="e.g. audio: main"
          onInput=${(e) => setTagsText(e.target.value)} />
        <small class="hint">Added to each cable's tags; existing tags stay.</small>
      </label>
      <div class="form-actions">
        <button type="submit" disabled=${saving || !anything}>${saving ? 'Saving…' : `Change ${cables.length} cable${cables.length === 1 ? '' : 's'}`}</button>
        <button type="button" onClick=${onCancel} disabled=${saving}>Cancel</button>
      </div>
    </form>
  `
}

// Small line icons for row actions (24x24, drawn with the current text colour).
const ROW_ICONS = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  remove: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  purge: '<circle cx="12" cy="12" r="9"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/><line x1="15.5" y1="8.5" x2="8.5" y2="15.5"/>',
  attachments: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  duplicate: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  history: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>'
}

function IconButton ({ icon, label, onClick, active, disabled }) {
  return html`
    <button class=${active ? 'icon-btn active' : 'icon-btn'} title=${label} aria-label=${label}
      onClick=${onClick} disabled=${disabled}
      dangerouslySetInnerHTML=${{ __html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ROW_ICONS[icon]}</svg>` }}></button>
  `
}

function CablesList () {
  const undo = useUndo()
  const settings = useSettings()
  const [reloadKey, setReloadKey] = useState(0)
  const [devKey, setDevKey] = useState(0)
  const [form, setForm] = useState(null) // null | 'create' | cable being edited
  const [showImport, setShowImport] = useState(false)
  const [notice, setNotice] = useState(null)
  const [attachmentsId, setAttachmentsId] = useState(null)
  const [historyId, setHistoryId] = useState(null)
  const [filter, setFilter] = useState({})
  const [query, setQuery] = useState('')
  const [showRemoved, setShowRemoved] = useShowRemoved('cables')
  const [picked, setPicked] = useState(() => new Set())
  const [bulk, setBulk] = useState(false)
  const { loading, error, items: cables } = useResourceList('wiringWireRuns', reloadKey)
  const { items: devices } = useResourceList('wiringDevices', devKey)
  const { items: circuits } = useResourceList('wiringCircuits', reloadKey)
  const { items: conduits } = useResourceList('wiringConduits')
  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]))
  const conduitNameById = new Map(conduits.map((c) => [c.id, c.name]))
  const endNames = (c) => [deviceNameById.get(c.fromDeviceId), deviceNameById.get(c.toDeviceId)]
  const visible = cables.filter((c) =>
    matchesFilter(c, filter) && matchesRemoved(c, showRemoved) && matchesSearch(c, query, endNames(c)))
  const removedCount = cables.filter((c) => c.status === 'removed').length
  const pickedCables = cables.filter((c) => picked.has(c.id))
  const allVisiblePicked = visible.length > 0 && visible.every((c) => picked.has(c.id))
  const togglePicked = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleAllVisible = () => setPicked((prev) => {
    const next = new Set(prev)
    for (const c of visible) {
      if (allVisiblePicked) next.delete(c.id)
      else next.add(c.id)
    }
    return next
  })

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

  const purgeCable = async (cable) => {
    const name = cableTitle(cable, deviceNameById)
    if (!window.confirm(`Delete "${name}" permanently? Its history and attachments are erased too, and this cannot be undone.`)) return
    try {
      const res = await fetch(`${ROUTES_BASE}/cables/${cable.id}/purge`, { method: 'DELETE' })
      if (!res.ok) throw new Error(apiErrorMessage(res.status))
      setPicked((prev) => { const next = new Set(prev); next.delete(cable.id); return next })
      setNotice(`Deleted "${name}" permanently.`)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setNotice(`Could not delete the cable: ${err.message}`)
    }
  }

  const removeCable = async (cable) => {
    if (!confirmRemove(cableTitle(cable, deviceNameById))) return
    const title = cableTitle(cable, deviceNameById)
    await deleteResource('wiringWireRuns', cable.id)
    setReloadKey((k) => k + 1)
    undo.offer({
      message: `Cable "${title}" removed.`,
      onUndo: async () => { await restoreResource('wiringWireRuns', cable.id); setReloadKey((k) => k + 1) }
    })
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
      ${pickedCables.length > 0 && !bulk && html`
        <div class="list-header">
          <span>${pickedCables.length} selected</span>
          <button onClick=${() => { setNotice(null); setForm(null); setBulk(true) }}>Change selected&hellip;</button>
          <button onClick=${() => setPicked(new Set())}>Clear selection</button>
        </div>
      `}
      ${bulk && pickedCables.length > 0 && html`
        <${BulkCableForm}
          cables=${pickedCables}
          deviceNameById=${deviceNameById}
          onDone=${(msg) => { setBulk(false); setPicked(new Set()); setNotice(msg); setReloadKey((k) => k + 1) }}
          onCancel=${() => setBulk(false)}
        />
      `}
      ${form && html`
        <${CableForm}
          key=${`${settings.defaultGaugeUnit}/${settings.defaultLengthUnit}/${form === 'create' ? 'new' : form.duplicateOf ? 'copy-' + form.duplicateOf.id : form.id}`}
          cable=${form === 'create' || form.duplicateOf ? null : form}
          prefill=${form !== 'create' && form.duplicateOf ? duplicateCablePrefill(cableToValues(form.duplicateOf)) : null}
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
      ${cables.length > 0 && html`
        <${ZoneTagFilter} items=${cables} filter=${filter} onChange=${setFilter}>
          <${ListControls} query=${query} onQuery=${setQuery} showRemoved=${showRemoved} onShowRemoved=${setShowRemoved}
            removedCount=${removedCount} label="Name, label, zone, tag" />
        <//>
      `}
      ${cables.length > 0 && visible.length === 0 && html`<div class="empty-state">No cables match.</div>`}
      ${visible.length > 0 && html`
        <table>
          <thead>
            <tr><th><input type="checkbox" class="checkbox-input" title="Select all shown" checked=${allVisiblePicked} onChange=${toggleAllVisible} /></th><th>From</th><th>To</th><th>Conductors</th><th>Cable</th><th>Conduits</th><th>Gauge</th><th>Length</th><th>Zone</th><th>Circuit</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${visible.flatMap((cable) => {
              const here = circuitsOfCable(cable.id, circuits)
              const rows = [html`
                <tr key=${cable.id}>
                  <td><input type="checkbox" class="checkbox-input" checked=${picked.has(cable.id)} onChange=${() => togglePicked(cable.id)} /></td>
                  <td><${DeviceLink} id=${cable.fromDeviceId} names=${deviceNameById} /></td>
                  <td><${DeviceLink} id=${cable.toDeviceId} names=${deviceNameById} /></td>
                  <td>${(cable.conductors || []).length === 0 ? 'Positive' : cable.conductors.map((c) => CONDUCTOR_LABELS[c.conductor] + (c.color ? ` (${c.color})` : '')).join(', ')}${cable.link ? html` <span class="badge link-badge" data-testid="link-badge">${cable.link}</span>` : ''}</td>
                  <td>${cable.cableLabel || '-'}</td>
                  <td>${(cable.conduitIds || []).map((id) => conduitNameById.get(id) || '?').join(' > ') || '-'}</td>
                  <td>${cable.gauge ? `${cable.gauge} ${cable.gaugeUnit || ''}` : '-'}</td>
                  <td>${cable.length ? `${cable.length} ${cable.lengthUnit || ''}` : '-'}</td>
                  <td>${cable.zone || '-'}${(cable.tags || []).length ? html`<div class="meta">${cable.tags.join(', ')}</div>` : ''}</td>
                  <td>${here.length ? here.map(({ circuit }) => circuit.name).join(', ') : '-'}</td>
                  <td><${StatusBadge} status=${cable.status} /></td>
                  <td class="actions-cell"><div class="row-actions">
                    <${IconButton} icon="edit" label="Edit" onClick=${() => { setNotice(null); setForm(cable) }} />
                    <${IconButton} icon="duplicate" label="Duplicate" onClick=${() => { setNotice(null); setForm({ duplicateOf: cable }) }} />
                    ${cable.status !== 'removed'
                      ? html`<${IconButton} icon="remove" label="Remove" onClick=${() => removeCable(cable)} />`
                      : html`<${IconButton} icon="purge" label="Delete permanently" onClick=${() => purgeCable(cable)} />`}
                    <${IconButton} icon="attachments" label=${attachmentsId === cable.id ? 'Hide attachments' : 'Attachments'}
                      active=${attachmentsId === cable.id} onClick=${() => setAttachmentsId(attachmentsId === cable.id ? null : cable.id)} />
                    <${IconButton} icon="history" label=${historyId === cable.id ? 'Hide history' : 'History'}
                      active=${historyId === cable.id} onClick=${() => setHistoryId(historyId === cable.id ? null : cable.id)} />
                  </div></td>
                </tr>
              `]
              if (attachmentsId === cable.id) {
                rows.push(html`<tr key="${cable.id}-attachments"><td colspan="12"><${AttachmentList} ownerType="wireRun" ownerId=${cable.id} /></td></tr>`)
              }
              if (historyId === cable.id) {
                rows.push(html`<tr key="${cable.id}-history"><td colspan="12"><${ChangeLog} kind="wireRun" id=${cable.id} /></td></tr>`)
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
  const [query, setQuery] = useState('')
  const [showRemoved, setShowRemoved] = useShowRemoved('circuits')
  const nameById = new Map(devices.map((d) => [d.id, d.name]))
  const endNames = (c) => c.derived ? [...c.derived.supplyDeviceIds, ...c.derived.endDeviceIds].map((id) => nameById.get(id)) : []
  const removedCount = items.filter((c) => c.status === 'removed').length
  const visible = items
    .filter((c) => circuitMatches(c, cables, filter) && matchesRemoved(c, showRemoved) && matchesSearch(c, query, endNames(c)))
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
      ${items.length > 0 && html`
        <${ZoneTagFilter} items=${cables} filter=${filter} onChange=${setFilter}>
          <${ListControls} query=${query} onQuery=${setQuery} showRemoved=${showRemoved} onShowRemoved=${setShowRemoved}
            removedCount=${removedCount} label="Name, device" />
        <//>
      `}
      ${items.length > 0 && visible.length === 0 && html`<div class="empty-state">No circuits match.</div>`}
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
function DiagramView ({ cables, deviceNameById, deviceIconById, deviceById = new Map(), live, onLiveError }) {
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
    const labelW = Math.max(90, n.label.length * 7 + 28) + (n.icon ? 36 : 0)
    // A box for the device's terminals and ports (relative to the node's corner),
    // as wide as the label needs.
    const hasPorts = ((deviceById.get(n.id) || {}).terminals || []).some((t) => t.port)
    // With ports, the name sits in a header row and the port labels need room beside it.
    n.box = deviceBox(deviceById.get(n.id) || { id: n.id, terminals: [] }, { x: 0, y: 0 }, { w: hasPorts ? Math.max(labelW, n.label.length * 7 + 120) : labelW })
    const portless = n.box.terminals.length === 0
    const height = portless ? (n.icon ? 48 : 40) : Math.max(n.icon ? 48 : 40, n.box.h)
    const width = portless ? labelW : n.box.w
    n.terminals = n.box.terminals
    g.setNode(n.id, { width, height })
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
          // A cable that names a terminal ends on that dot, not on the node's edge.
          const route = edgeData.points.map((p) => ({ x: p.x, y: p.y }))
          const named = endTerminals(wr)
          for (const [end, nodeId, index] of [['from', wr.fromDeviceId, 0], ['to', wr.toDeviceId, route.length - 1]]) {
            const node = nodes.find((n) => n.id === nodeId)
            const dot = node && named[end] ? node.terminals.find((t) => t.name === named[end]) : null
            const pos = node ? g.node(nodeId) : null
            if (dot && pos && route.length > 0) {
              route[index] = { x: pos.x - pos.width / 2 + dot.x, y: pos.y - pos.height / 2 + dot.y }
            }
          }
          const points = route.map((p) => `${p.x},${p.y}`).join(' ')
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
          const liveState = live ? live.info(n.id) : null
          const toggle = async () => {
            if (!liveState || !liveState.clickable) return
            try { await live.toggle(n.id) } catch (err) { onLiveError(err.message) }
          }
          return html`
            <g key=${n.id} transform="translate(${pos.x - pos.width / 2}, ${pos.y - pos.height / 2})"
              class=${live ? (liveState ? 'live-' + liveState.look + (liveState.clickable ? ' live-clickable' : '') : 'live-none') : ''}
              data-live=${liveState ? liveState.look : undefined} data-name=${n.label}
              onClick=${live ? toggle : undefined}>
              ${liveState && html`<title>${liveState.title}</title>`}
              <rect width=${pos.width} height=${pos.height} rx="6" class="diagram-node diagram-node-${n.kind}" />
              ${n.icon && html`<image href=${n.icon} x="6" y=${(pos.height - 36) / 2} width="36" height="36" preserveAspectRatio="xMidYMid meet" />`}
              <text x=${(pos.width + (n.icon ? 36 : 0)) / 2} y=${n.box.ports.length > 0 ? 18 : pos.height / 2 + 4} text-anchor="middle" class="diagram-label">
                ${n.label}
              </text>
              <${PortBlocks} box=${n.box} originX=${0} originY=${0} />
              ${liveState && liveState.look === 'locked' && html`<${LiveLock} x=${pos.width - 12} y=${12} size=${14} />`}
              ${liveState && html`<${LiveReading} x=${pos.width / 2} y=${n.box.bottomPorts ? 24 : pos.height - 4} size=${10} text=${liveState.reading} />`}
            </g>
          `
        })}
      </svg>
    </div>
  `
}

function CircuitDetail ({ circuitId, onBack, onNotFound = () => {} }) {
  const [circuit, setCircuit] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const { items: cables } = useResourceList('wiringWireRuns')
  const { items: devices } = useResourceList('wiringDevices')
  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]))
  const deviceIconById = new Map(devices.filter((d) => deviceIconUrl(d)).map((d) => [d.id, deviceIconUrl(d)]))
  const [liveOn, setLiveOn] = useState(false)
  const [liveError, setLiveError] = useState(null)
  const live = useLive(liveOn, 0, (id) => deviceNameById.get(id) || id)

  useEffect(() => {
    let cancelled = false
    fetchResource('wiringCircuits', circuitId)
      .then((data) => { if (!cancelled) setCircuit(data) })
      .catch((err) => { if (cancelled) return; if (err.status) onNotFound(); else setError(err.message) })
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
  const names = (ids) => ids.length === 0 ? '-' : ids.map((id, i) => html`${i > 0 ? ', ' : ''}<${DeviceLink} id=${id} names=${deviceNameById} />`)

  return html`
    <div>
      <${BackLink} onClick=${onBack}>Back to circuits<//>
      <${ErrorBanner} message=${error} />
      ${circuit && !editing && html`
        <div class="card">
          <h2>${circuit.name} <${StatusBadge} status=${circuit.status} /></h2>
          <div class="meta">${circuitFacts(circuit)}</div>
          ${d && html`
            <div class="meta">Protected by: ${d.protectorId ? html`<${DeviceLink} id=${d.protectorId} names=${deviceNameById} />` : 'nothing (no fuse or breaker)'}</div>
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
        <div class="row-actions">
          <button class=${liveOn ? 'active' : ''} data-testid="diagram-live" onClick=${() => { setLiveOn((v) => !v); setLiveError(null) }}>
            ${liveOn ? 'Live: on' : 'Live'}
          </button>
        </div>
        ${liveOn && html`<${LiveBar} live=${live} error=${live.error} />`}
        ${liveError && html`<div class="error-banner">${liveError}</div>`}
        <${DiagramView} cables=${[...feedCables, ...returnCables]} deviceNameById=${deviceNameById} deviceIconById=${deviceIconById} deviceById=${new Map(devices.map((d) => [d.id, d]))}
          live=${liveOn ? live : null} onLiveError=${setLiveError} />
      `}

      <h3>Cables</h3>
      ${d && feedCables.length + returnCables.length === 0 && html`<div class="empty-state">No cables.</div>`}
      ${feedCables.length + returnCables.length > 0 && html`
        <table>
          <thead><tr><th>From</th><th>To</th><th>Role</th><th>Cable</th><th>Gauge</th><th>Length</th></tr></thead>
          <tbody>
            ${[...feedCables, ...returnCables].map((c) => html`
              <tr key=${(c.isReturn ? 'r-' : 'f-') + c.id}>
                <td><${DeviceLink} id=${c.fromDeviceId} names=${deviceNameById} /></td>
                <td><${DeviceLink} id=${c.toDeviceId} names=${deviceNameById} /></td>
                <td>${c.isReturn ? 'Negative return' : 'Feed'}</td>
                <td><${RouteLink} tab="cables">${c.cableLabel || 'Cable'}<//></td>
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
  const [query, setQuery] = useState('')
  const [showRemoved, setShowRemoved] = useShowRemoved('devices')
  const removedCount = items.filter((d) => d.status === 'removed').length
  const visible = items.filter((d) =>
    matchesFilter(d, filter) && (!filter.role || (d.role || 'consumer') === filter.role) &&
    matchesRemoved(d, showRemoved) && matchesSearch(d, query))

  const createDevice = async (payload) => {
    await putResource('wiringDevices', newId(), formPayloadToDevice(payload))
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
          context=${{ devices: items }}
          onFieldChange=${newDeviceDefaults}
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
      ${items.length > 0 && html`
        <${ZoneTagFilter} items=${items} filter=${filter} onChange=${setFilter} withRole=${true}>
          <${ListControls} query=${query} onQuery=${setQuery} showRemoved=${showRemoved} onShowRemoved=${setShowRemoved}
            removedCount=${removedCount} label="Name, type, zone, tag" />
        <//>
      `}
      ${items.length > 0 && visible.length === 0 && html`<div class="empty-state">No devices match.</div>`}
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

// Ids of freshly duplicated devices: their page opens in the edit form, so the
// name can be changed at once. Not in the URL (forms stay out of it).
const editOnOpen = new Set()

// The battery details on the device page: the fields, the monitor, the paths
// and the bank the battery belongs to (from /derived).
function BatteryDetails ({ device, deviceNames }) {
  const [banks, setBanks] = useState(null)
  const isBattery = (device.role || 'consumer') === 'storage'
  useEffect(() => {
    if (!isBattery) return undefined
    let cancelled = false
    fetch(`${ROUTES_BASE}/derived`)
      .then((res) => (res.ok ? res.json() : { banks: [] }))
      .then((data) => { if (!cancelled) setBanks(data.banks || []) })
      .catch(() => { if (!cancelled) setBanks([]) })
    return () => { cancelled = true }
  }, [device.id, device.updatedAt, isBattery])
  const paths = [
    ['Voltage path', device.voltagePath], ['Current path', device.currentPath],
    ['State of charge path', device.socPath], ['Time remaining path', device.timeRemainingPath]
  ].filter(([, p]) => p)
  const age = installedAgeText(device.installedOn)
  const bank = banks && bankOfBattery(banks, device.id)
  const bankLines = describeBank(bank)
  const hasDetails = device.chemistry || device.purpose || device.capacityAh != null || device.usableFraction != null ||
    device.makeModel || device.installedOn
  if (!isBattery && paths.length === 0) return null
  return html`
    <div class="battery-details" data-testid="battery-details">
      ${hasDetails && html`
        <div class="meta">
          ${[
            device.chemistry && (CHEMISTRY_LABELS[device.chemistry] || device.chemistry),
            device.purpose && (PURPOSE_LABELS[device.purpose] || device.purpose),
            device.capacityAh != null && `${device.capacityAh} Ah`,
            device.usableFraction != null && `${fractionToPercent(device.usableFraction)} % usable`
          ].filter(Boolean).join(', ')}
        </div>
      `}
      ${device.makeModel && html`<div class="meta">Make and model: ${device.makeModel}</div>`}
      ${device.installedOn && html`<div class="meta">Installed on ${device.installedOn}${age ? ` (${age})` : ''}</div>`}
      ${device.monitorDeviceId && html`
        <div class="meta">Monitored by: <${DeviceLink} id=${device.monitorDeviceId} names=${deviceNames} /></div>
      `}
      ${paths.map(([label, p]) => html`<div class="meta" key=${label}>${label}: <code>${p}</code></div>`)}
      ${isBattery && bank && html`
        <div class="meta bank-summary" data-testid="battery-bank">
          ${bankLines.map((line, i) => html`<div key=${i}>${i === 0 ? html`<strong>${line}</strong>` : line}</div>`)}
          ${(bank.warnings || []).map((w, i) => html`<div class="warning-banner" key=${i}>${w.message || w}</div>`)}
        </div>
      `}
    </div>
  `
}

function DeviceDetail ({ deviceId, onBack, onNotFound = () => {} }) {
  const undo = useUndo()
  const [device, setDevice] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(() => editOnOpen.delete(deviceId))
  const [showHistory, setShowHistory] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const { items: circuits } = useResourceList('wiringCircuits')
  const { items: allDevices } = useResourceList('wiringDevices')
  const deviceNames = new Map(allDevices.map((d) => [d.id, d.name]))

  useEffect(() => {
    let cancelled = false
    fetchResource('wiringDevices', deviceId)
      .then((data) => { if (!cancelled) setDevice(data) })
      .catch((err) => { if (cancelled) return; if (err.status) onNotFound(); else setError(err.message) })
    return () => { cancelled = true }
  }, [deviceId, reloadKey])

  const saveDevice = async (payload) => {
    await putResource('wiringDevices', deviceId, formPayloadToDevice(payload))
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

  const duplicateDevice = async () => {
    setError(null)
    try {
      const names = Object.values(await fetchResourceMap('wiringDevices')).map((d) => d.name)
      const copyId = newId()
      await putResource('wiringDevices', copyId, duplicateDevicePayload(device, names))
      editOnOpen.add(copyId)
      window.location.hash = hashForState({ tab: 'devices', id: copyId })
    } catch (err) {
      setError(err.message)
    }
  }

  const removeDevice = async () => {
    if (!device || !confirmRemove(device.name)) return
    const name = device.name
    await deleteResource('wiringDevices', deviceId)
    onBack() // leaving the page first: it would otherwise finish the message below
    undo.offer({ message: `Device "${name}" removed.`, onUndo: () => restoreResource('wiringDevices', deviceId) })
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
          ${device.current && html`<div class="meta">Current: ${device.current === 'ac' ? 'AC' : 'DC'}</div>`}
          <${BatteryDetails} device=${device} deviceNames=${deviceNames} />
          ${device.signalkPath && html`
            <div class="meta">SignalK path: <code>${device.signalkPath}</code></div>
          `}
          ${device.switchPath && html`
            <div class="meta">Switch path: <code>${device.switchPath}</code></div>
          `}
          ${(device.confirmSwitching || device.neverRemote) && html`
            <div class="meta">
              ${device.neverRemote ? '\u{1F512} Never switched remotely' : 'Asks for confirmation before switching'}
            </div>
          `}
          ${device.meterPath && html`
            <div class="meta">Meter: <code>${device.meterPath}</code> (${device.meterUnit === 'W' ? 'watts' : 'amps'})</div>
          `}
          ${describeMeasured(device.measured, device.ratedPowerW).map((line, i) => html`
            <div class=${i === 0 ? 'meta measured' : 'meta'} key=${i}>${line}</div>
          `)}
          ${device.measured && device.measured.group && html`
            <div class="meta">${describeGroup(device.measured, (id) => (deviceNames.get(id) || id))}</div>
          `}
          ${device.notes && html`<p>${device.notes}</p>`}
          <div class="row-actions">
            <button onClick=${() => setEditing(true)}>Edit</button>
            <button onClick=${duplicateDevice} data-testid="device-duplicate">Duplicate</button>
            ${(device.role || 'consumer') === 'consumer' && device.status !== 'removed' && html`
              <button onClick=${() => setCalibrating((v) => !v)} data-testid="calibrate-open">Calibrate load</button>
            `}
            ${device.status !== 'removed' && html`<button onClick=${removeDevice}>Remove</button>`}
            <button onClick=${() => setShowHistory((v) => !v)}>
              ${showHistory ? 'Hide history' : 'History'}
            </button>
          </div>
        </div>
      `}
      ${device && calibrating && html`
        <${CalibrateDialog} device=${device} nameOf=${(id) => deviceNames.get(id) || id}
          onChanged=${() => setReloadKey((k) => k + 1)} onClose=${() => setCalibrating(false)} />
      `}
      ${device && editing && html`
        <div class="card">
          <${Form}
            fields=${DEVICE_FIELDS}
            initial=${deviceToFormValues(device)}
            context=${{ deviceId, acDeviceIds: acConsumerIds(circuits), devices: allDevices }}
            onFieldChange=${batteryDefaults}
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
  const { items: allRuns } = useResourceList('wiringWireRuns', reloadKey)
  const runById = new Map(allRuns.map((r) => [r.id, r]))
  const mixesOf = (conduit) => conduitCurrentMix((conduit.cableIds || []).map((id) => runById.get(id)).filter(Boolean)).mixed
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
            ${mixesOf(conduit) && html`<div class="meta" style="color: var(--warn)" data-testid="conduit-mix-line">Mixes AC and DC</div>`}
          </div>
          <${StatusBadge} status=${conduit.status} />
        </div>
      `)}
    </div>
  `
}

function ConduitDetail ({ conduitId, onBack, onNotFound = () => {} }) {
  const undo = useUndo()
  const [conduit, setConduit] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [toAdd, setToAdd] = useState('')
  const [mixNotice, setMixNotice] = useState(null)
  const { items: runs } = useResourceList('wiringWireRuns', reloadKey)
  const { items: devices } = useResourceList('wiringDevices')
  const { items: conduits } = useResourceList('wiringConduits', reloadKey)

  useEffect(() => {
    let cancelled = false
    fetchResource('wiringConduits', conduitId)
      .then((data) => { if (!cancelled) setConduit(data) })
      .catch((err) => { if (cancelled) return; if (err.status) onNotFound(); else setError(err.message) })
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
    const name = conduit.name
    await deleteResource('wiringConduits', conduitId)
    onBack() // leaving the page first: it would otherwise finish the message below
    undo.offer({ message: `Conduit "${name}" removed.`, onUndo: () => restoreResource('wiringConduits', conduitId) })
  }
  const setCables = (cableIds) => { setMixNotice(null); return guard(() => putResource('wiringConduits', conduitId, { cableIds })) }
  const addCable = () => {
    if (!toAdd) return
    const id = toAdd
    setToAdd('')
    const cableIds = [...(conduit.cableIds || []), id]
    const mix = conduitCurrentMix(cableIds.map((cid) => runById.get(cid)).filter(Boolean))
    // Never blocks: the cable is added, and the warning is shown after.
    const done = setCables(cableIds)
    setMixNotice(mix.mixed ? conduitMixText(mix, (r) => cableName(r, deviceNameById)) : null)
    return done
  }
  // Moves this conduit one place earlier or later in the cable's own list.
  const moveForCable = (run, delta) =>
    guard(() => putResource('wiringWireRuns', run.id, { conduitIds: moveInList(run.conduitIds || [], conduitId, delta) }))

  const cables = conduit ? (conduit.cableIds || []).map((id) => runById.get(id)).filter(Boolean) : []
  const candidates = conduit ? addableCables(runs, conduit) : []
  const mixText = conduitMixText(conduitCurrentMix(cables), (r) => cableName(r, deviceNameById))

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
      ${mixNotice && html`<div class="warning-banner" style="white-space: pre-line" data-testid="conduit-mix-notice"><strong>Added, but check this:</strong> ${mixNotice}</div>`}
      ${conduit && html`
        ${mixText && !mixNotice && html`<div class="warning-banner" style="white-space: pre-line" data-testid="conduit-mix-warning">${mixText}</div>`}
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

// The route lives in the address bar (see router.js). `route` mirrors it;
// navigate writes the hash only when it differs from the current one, so
// history is not spammed, and a hashchange (back, forward, a pasted link)
// parses it back.
function useRoute (onExternalChange) {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    // An unknown tab falls back to the default; the address bar follows.
    const settle = () => {
      const parsed = parseHash(window.location.hash)
      const hash = hashForState(parsed)
      if (window.location.hash && window.location.hash !== hash) window.history.replaceState(null, '', hash)
      setRoute(parsed)
    }
    settle()
    const onHash = () => { if (onExternalChange) onExternalChange(); settle() }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const navigate = (next, { replace = false } = {}) => {
    const hash = hashForState(next)
    const current = hashForState(parseHash(window.location.hash))
    if (hash !== current) {
      if (replace) window.history.replaceState(null, '', hash)
      else window.location.hash = hash
    }
    setRoute(parseHash(hash))
  }
  return [route, navigate]
}

function NotFoundNotice ({ message, onClose }) {
  return html`
    <div class="error-banner" role="status" data-testid="not-found">
      ${message} <button type="button" class="link-btn" onClick=${onClose}>Dismiss</button>
    </div>
  `
}

function AppBody () {
  const settings = useSettings()
  const [theme, toggleTheme] = useTheme(settings.autoTheme)
  const [notFound, setNotFound] = useState(null)
  const undo = useUndo()
  const [route, navigate] = useRoute(() => setNotFound(null))
  const { tab, id } = route

  // Leaving a view finishes whatever an open undo message was waiting to do.
  const go = (next, opts) => { setNotFound(null); undo.flush(); navigate(next, opts) }
  const switchTab = (nextTab) => go({ tab: nextTab, id: null })
  const open = (nextTab) => (nextId) => go({ tab: nextTab, id: nextId })
  const back = (nextTab) => () => go({ tab: nextTab, id: null })
  // An unknown or removed id shows the list with a short notice.
  const missing = (nextTab) => (message) => {
    navigate({ tab: nextTab, id: null }, { replace: true })
    setNotFound(message)
  }
  const named = { circuits: 'circuit', devices: 'device', conduits: 'conduit' }
  const detailMissing = (nextTab) => () => missing(nextTab)(`That ${named[nextTab]} was not found.`)
  const nav = [
    ['circuits', 'Circuits'], ['cables', 'Cables'], ['devices', 'Devices'], ['batteries', 'Batteries'], ['conduits', 'Conduits'],
    ['load', 'Load Summary'], ['zones', 'Zones'], ['schematics', 'Schematics'], ['floorplan', 'Floorplan']
  ]
  const cableForm = (props) => html`<${CableForm} ...${props} />`

  return html`
    <div>
      <header>
        <h1>Wiring Documentation</h1>
        <${ThemeToggle} theme=${theme} onToggle=${toggleTheme} />
      </header>
      <nav class="tabs">
        ${nav.map(([key, label]) => html`
          <button key=${key} class=${tab === key ? 'active' : ''} onClick=${() => switchTab(key)}>${label}</button>
        `)}
      </nav>
      <main>
      ${notFound && html`<${NotFoundNotice} message=${notFound} onClose=${() => setNotFound(null)} />`}
      ${tab === 'circuits' && !id && html`<${CircuitsList} onSelect=${open('circuits')} />`}
      ${tab === 'circuits' && id && html`
        <${CircuitDetail} key=${id} circuitId=${id} onBack=${back('circuits')} onNotFound=${detailMissing('circuits')} />
      `}
      ${tab === 'cables' && html`<${CablesList} />`}
      ${tab === 'devices' && !id && html`<${DevicesList} onSelect=${open('devices')} />`}
      ${tab === 'devices' && id && html`
        <${DeviceDetail} key=${id} deviceId=${id} onBack=${back('devices')} onNotFound=${detailMissing('devices')} />
      `}
      ${tab === 'conduits' && !id && html`<${ConduitsList} onSelect=${open('conduits')} />`}
      ${tab === 'conduits' && id && html`
        <${ConduitDetail} key=${id} conduitId=${id} onBack=${back('conduits')} onNotFound=${detailMissing('conduits')} />
      `}
      ${tab === 'batteries' && html`<${BatteriesTab} />`}
      ${tab === 'load' && html`<${LoadSummary} />`}
      ${tab === 'zones' && html`<${ZonesManager} />`}
      ${tab === 'schematics' && html`<${SchematicsTab} renderCableForm=${cableForm}
        selectedId=${id} onSelect=${open('schematics')} onNotFound=${missing('schematics')} />`}
      ${tab === 'floorplan' && html`<${FloorplanTab} renderCableForm=${cableForm}
        planId=${id} onPlanChange=${(planId) => go({ tab: 'floorplan', id: planId })} onNotFound=${missing('floorplan')} />`}
      </main>
    </div>
  `
}

function App () {
  return html`<${UndoProvider}><${AppBody} /><//>`
}

// index.html's "Loading…" placeholder is static markup, not something
// Preact rendered — Preact's diffing tries to reuse existing container
// children rather than replacing them outright, so it's left behind
// as a stray node unless cleared first.
const container = document.getElementById('app')
container.textContent = ''
render(html`<${App} />`, container)
