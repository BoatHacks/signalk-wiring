// The Changes tab, pure parts (plan 0033): turning a stored log entry into
// words, the date range presets, the query for GET /changelog, where a group
// links to, and merging pages of groups. No DOM here, so all of it is tested.

import { gaugeLabel } from './gauge.js'

export const KIND_LABELS = {
  device: 'Devices',
  wireRun: 'Cables',
  conduit: 'Conduits',
  zone: 'Zones',
  plan: 'Plans',
  schematic: 'Schematics',
  circuit: 'Circuits'
}

// The kinds in the order the filter shows them. Circuits are derived from the
// cables, so their entries stay out unless the kind is picked.
export const KIND_ORDER = ['device', 'wireRun', 'conduit', 'zone', 'plan', 'schematic', 'circuit']

const KIND_SINGULAR = {
  device: 'device', wireRun: 'cable', conduit: 'conduit', zone: 'zone', plan: 'plan', schematic: 'schematic', circuit: 'circuit'
}

export function kindName (kind) {
  return KIND_SINGULAR[kind] || kind
}

// Field label and unit text per column. A label of null hides the field (it
// repeats another one in the same entry, or is bookkeeping).
const COMMON = {
  name: { label: 'name' },
  notes: { label: 'notes' },
  zone: { label: 'zone' },
  zone_id: { label: 'zone', ref: 'zone' },
  status: { label: 'status' },
  tags: { label: 'tags' }
}

const FIELDS = {
  device: {
    type: { label: 'type' },
    role: { label: 'role' },
    icon_attachment_id: { label: 'icon', opaque: true },
    rated_power_w: { label: 'rated power', unit: 'W' },
    trip_rating_a: { label: 'trip rating', unit: 'A' },
    rated_ac_a: { label: 'rated AC current', unit: 'A' },
    rated_ac_v: { label: 'rated AC voltage', unit: 'V' },
    rated_dc_a: { label: 'rated DC current', unit: 'A' },
    rated_dc_v: { label: 'rated DC voltage', unit: 'V' },
    nominal_voltage: { label: 'nominal voltage', unit: 'V' },
    power_factor: { label: 'power factor' },
    current: { label: 'current draw', opaque: true },
    switch_path: { label: 'switch path' },
    confirm_switching: { label: 'confirm switching', bool: true },
    never_remote: { label: 'never switch remotely', bool: true },
    meter_path: { label: 'meter path' },
    meter_unit: { label: 'meter unit' },
    chemistry: { label: 'chemistry' },
    purpose: { label: 'purpose' },
    capacity_ah: { label: 'capacity', unit: 'Ah' },
    usable_fraction: { label: 'usable share', percent: true },
    make_model: { label: 'make and model' },
    installed_on: { label: 'installed on' },
    monitor_device_id: { label: 'monitored by', device: true },
    voltage_path: { label: 'voltage path' },
    current_path: { label: 'current path' },
    soc_path: { label: 'state of charge path' },
    time_remaining_path: { label: 'time remaining path' },
    schematic_box_color: { label: 'box color' },
    schematic_icon_color: { label: 'icon color' },
    pos_x: { label: 'position', position: true },
    pos_y: { label: 'position', position: true },
    pos_z: { label: 'position', position: true },
    parent_id: { label: 'inside', device: true },
    terminals: { label: 'terminals', list: 'terminals' }
  },
  wireRun: {
    from_device_id: { label: 'from', device: true },
    to_device_id: { label: 'to', device: true },
    gauge: { label: 'gauge', gauge: true },
    gauge_unit: { label: 'gauge unit' },
    length: { label: 'length', lengthUnit: true },
    length_unit: { label: 'length unit' },
    cable_label: { label: 'label' },
    switch_ref: { label: 'switch' },
    link: { label: 'link' },
    route: { label: 'route' },
    conductors: { label: 'conductors', list: 'conductors' }
  },
  conduit: {
    kind: { label: 'type' },
    inner_diameter: { label: 'inner diameter', diameterUnit: true },
    diameter_unit: { label: 'diameter unit' },
    route: { label: 'route' }
  },
  zone: {},
  plan: {
    view: { label: 'view' },
    filename: { label: 'image file' },
    z_min: { label: 'lowest level' },
    z_max: { label: 'highest level' },
    calibration: { label: 'scale calibration', opaque: true }
  },
  circuit: {
    key: { label: 'cables', opaque: true },
    cable_ids: { label: 'cables', opaque: true },
    voltage: { label: 'voltage', unit: 'V' },
    convention: { label: 'wire color convention' },
    meter_path: { label: 'meter path' },
    meter_unit: { label: 'meter unit' }
  },
  schematic: {
    enclosure_id: { label: 'inside', device: true },
    devices: { label: 'devices', list: 'schematicDevices' },
    wires: { label: 'cables', list: 'schematicWires' },
    stubs: { label: 'cable stubs', list: 'schematicWires' },
    zone_shapes: { label: 'zone areas', list: 'zoneShapes' }
  }
}

function fieldSpec (kind, field) {
  return (FIELDS[kind] && FIELDS[kind][field]) || COMMON[field] || null
}

function isEmpty (v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

function clip (text, max = 60) {
  const s = String(text)
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}

function sentenceCase (text) {
  const s = String(text || '').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

function numberText (v) {
  const n = Number(v)
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : clip(v)
}

function deviceText (id, names) {
  if (isEmpty(id)) return null
  return (names && names.get && names.get(id)) || 'an unknown device'
}

// The text of one value of a field, without its unit.
function valueText (spec, value, ctx) {
  if (isEmpty(value)) return null
  if (spec.bool) return Number(value) ? 'yes' : 'no'
  if (spec.percent) return `${numberText(Number(value) * 100)} %`
  if (spec.device) return deviceText(value, ctx.names)
  if (spec.ref === 'zone') return (ctx.zones && ctx.zones.get && ctx.zones.get(value)) || 'another zone'
  if (Array.isArray(value)) return clip(value.join(', '))
  if (typeof value === 'object') return 'changed'
  if (typeof value === 'number') return numberText(value)
  return clip(value)
}

// "gauge: 6 to 10 mm2", "rated power: 40 to 60 W", "notes cleared".
function changeText (label, before, after, unitBefore, unitAfter) {
  const sameUnit = unitBefore === unitAfter
  const withUnit = (text, unit) => (unit ? `${text} ${unit}` : text)
  const b = before === null ? null : sameUnit ? before : withUnit(before, unitBefore)
  const a = after === null ? null : sameUnit ? withUnit(after, unitAfter) : withUnit(after, unitAfter)
  if (b === null && a === null) return `${label} changed`
  if (b === null) return `${label} set to ${a}`
  if (a === null) return `${label} cleared (was ${b})`
  return `${label}: ${b} to ${a}`
}

const LIST_LABELS = {
  terminals: (t) => t.name || t.conductor || 'terminal',
  conductors: (c) => `${c.conductor || 'conductor'}${c.color ? ' ' + c.color : ''}`,
  schematicDevices: (d, ctx) => deviceText(d.deviceId, ctx.names) || 'a device',
  schematicWires: (w) => w.wireRunId || 'a cable',
  zoneShapes: (z, ctx) => (ctx.zones && ctx.zones.get && ctx.zones.get(z.zoneId)) || 'a zone area'
}

// "terminals added: L+, L-; removed: Spare" or "terminals changed".
function listChange (label, listKind, before, after, ctx) {
  const b = Array.isArray(before) ? before : []
  const a = Array.isArray(after) ? after : []
  const name = LIST_LABELS[listKind] || (() => 'item')
  const counts = (list) => {
    const m = new Map()
    for (const item of list) m.set(name(item, ctx), (m.get(name(item, ctx)) || 0) + 1)
    return m
  }
  const cb = counts(b)
  const ca = counts(a)
  const added = []
  const removed = []
  for (const [k, n] of ca) for (let i = 0; i < n - (cb.get(k) || 0); i++) added.push(k)
  for (const [k, n] of cb) for (let i = 0; i < n - (ca.get(k) || 0); i++) removed.push(k)
  const parts = []
  if (added.length) parts.push(`added: ${clip(added.join(', '), 80)}`)
  if (removed.length) parts.push(`removed: ${clip(removed.join(', '), 80)}`)
  if (parts.length === 0) return `${label} changed`
  return `${label} ${parts.join('; ')}`
}

function fallbackLine (field) {
  return `${String(field).replace(/_/g, ' ')} changed`
}

function entryTime (entry) {
  return entry && entry.timestamp
}

// What the removal of an enclosure took with it.
function contentsLine (diff) {
  const count = (list, one, many) => (Array.isArray(list) && list.length ? `${list.length} ${list.length === 1 ? one : many}` : null)
  const parts = [count(diff.devices, 'device', 'devices'), count(diff.cables, 'cable', 'cables'), count(diff.schematics, 'page', 'pages')]
  return parts.filter(Boolean).join(', ')
}

// The field lines of an update. Fields that repeat another field of the same
// entry (the unit of a gauge, the zone id beside the zone) are folded in.
function updateLines (kind, diff, ctx) {
  const lines = []
  const seen = new Set()
  const pos = ['pos_x', 'pos_y', 'pos_z']
  for (const [field, change] of Object.entries(diff || {})) {
    if (seen.has(field)) continue
    const spec = fieldSpec(kind, field)
    const before = change && typeof change === 'object' && 'before' in change ? change.before : undefined
    const after = change && typeof change === 'object' && 'after' in change ? change.after : undefined
    if (!spec || (change && typeof change === 'object' && !('before' in change) && !('after' in change))) {
      lines.push(fallbackLine(field))
      continue
    }
    if (field === 'zone_id' && 'zone' in diff) continue
    if (spec.opaque) {
      lines.push(isEmpty(before) && !isEmpty(after) ? `${spec.label} set` : !isEmpty(before) && isEmpty(after) ? `${spec.label} cleared` : `${spec.label} changed`)
      continue
    }
    if (spec.list) {
      lines.push(listChange(spec.label, spec.list, before, after, ctx))
      continue
    }
    if (spec.position) {
      for (const p of pos) seen.add(p)
      lines.push('position changed')
      continue
    }
    if (spec.gauge || spec.lengthUnit || spec.diameterUnit) {
      const unitField = spec.gauge ? 'gauge_unit' : spec.lengthUnit ? 'length_unit' : 'diameter_unit'
      seen.add(unitField)
      const unitChange = diff[unitField]
      const current = (ctx.units && ctx.units[unitField]) || ''
      const ub = unitChange ? unitChange.before || '' : current
      const ua = unitChange ? unitChange.after || '' : current
      const text = (v, u) => {
        if (isEmpty(v)) return null
        return spec.gauge && gaugeLabel(v, u) !== '' ? gaugeLabel(v, u) : numberText(v)
      }
      lines.push(changeText(spec.label, text(before, ub), text(after, ua), ub, ua))
      continue
    }
    const unit = spec.unit || ''
    lines.push(changeText(spec.label, valueText(spec, before, ctx), valueText(spec, after, ctx), unit, unit))
  }
  return lines
}

// A stored entry as { title, lines, tone }. kind is the record kind; ctx
// optionally carries { names: Map of device id to name, zones: Map of zone id
// to name } so references read as names. Anything not known is described
// plainly, never dropped.
export function describeEntry (kind, entry, ctx = {}) {
  const summary = String((entry && entry.summary) || '')
  const diff = (entry && entry.diff) || {}
  const lower = summary.toLowerCase()
  if (lower === 'created') return { title: 'Created', lines: [], tone: 'created', time: entryTime(entry) }
  if (lower === 'removed') return { title: 'Removed', lines: [], tone: 'removed', time: entryTime(entry) }
  if (lower.startsWith('restored')) return { title: 'Restored', lines: [], tone: 'restored', time: entryTime(entry) }
  if (lower === 'permanently deleted') return { title: 'Permanently deleted', lines: [], tone: 'purged', time: entryTime(entry) }
  if (lower === 'removed with contents') {
    const line = contentsLine(diff)
    return { title: 'Removed with its contents', lines: line ? [line] : [], tone: 'removed', time: entryTime(entry) }
  }
  if (lower === 'deleted') return { title: `Deleted ${kindName(kind)}`, lines: [], tone: 'purged', time: entryTime(entry) }
  if (lower === 'updated') {
    const lines = updateLines(kind, diff, ctx)
    return { title: 'Changed', lines: lines.length ? lines : ['details changed'], tone: 'updated', time: entryTime(entry) }
  }
  if (lower === 'merged') {
    return { title: 'Merged into another zone', lines: [], tone: 'updated', time: entryTime(entry) }
  }
  if (lower === 'conduits changed') {
    return { title: 'Conduits changed', lines: [], tone: 'updated', time: entryTime(entry) }
  }
  if (lower === 'cable assigned' || lower === 'cable unassigned') {
    return { title: sentenceCase(summary), lines: [], tone: 'updated', time: entryTime(entry) }
  }
  const extra = []
  if (diff && typeof diff.by === 'string' && diff.by) extra.push(`by ${diff.by}`)
  if (diff && typeof diff.reason === 'string' && diff.reason) extra.push(clip(diff.reason))
  return { title: sentenceCase(summary) || 'Changed', lines: extra, tone: 'updated', time: entryTime(entry) }
}

// ---- date range ----

export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: 'custom', label: 'Custom' }
]
export const DEFAULT_RANGE = '30'

function startOfDay (date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

// { since, until } as ISO times for a preset, in the browser's local time.
// A custom range takes two dates (YYYY-MM-DD, either may be empty).
export function rangeFor (key, now = new Date(), custom = {}) {
  if (key === 'today') return { since: startOfDay(now).toISOString(), until: null }
  if (key === '7' || key === '30') {
    const days = Number(key)
    return { since: startOfDay(new Date(now.getTime() - (days - 1) * 86400000)).toISOString(), until: null }
  }
  const parse = (text, end) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''))
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return { since: parse(custom.from, false), until: parse(custom.to, true) }
}

// The query string of GET /changelog for the current filters.
export function buildQuery ({ range = DEFAULT_RANGE, custom = {}, kinds = [], text = '', cursor = null, id = null, entries = null, limit = null } = {}, now = new Date()) {
  const params = new URLSearchParams()
  const { since, until } = rangeFor(range, now, custom)
  if (since) params.set('since', since)
  if (until) params.set('until', until)
  if (kinds.length > 0) params.set('kind', KIND_ORDER.filter((k) => kinds.includes(k)).join(','))
  if (String(text).trim()) params.set('q', String(text).trim())
  if (cursor) params.set('cursor', cursor)
  if (id) params.set('id', id)
  if (entries) params.set('entries', String(entries))
  if (limit) params.set('limit', String(limit))
  const s = params.toString()
  return s ? `?${s}` : ''
}

// Where a group's header links to: { tab, id }, or null for a record that is
// gone for good. Cables and zones have no page of their own, only their tab.
export function recordRoute (group) {
  if (!group || group.status === 'purged') return null
  switch (group.kind) {
    case 'device': return { tab: 'devices', id: group.id }
    case 'circuit': return { tab: 'circuits', id: group.id }
    case 'conduit': return { tab: 'conduits', id: group.id }
    case 'schematic': return { tab: 'schematics', id: group.id }
    case 'plan': return { tab: 'floorplan', id: group.id }
    case 'wireRun': return { tab: 'cables', id: null }
    case 'zone': return { tab: 'zones', id: null }
    default: return null
  }
}

// Appends the next page of groups, ordered as the server gave them. A record
// that shows up again (its latest entry moved while paging) keeps its first place.
export function appendGroups (current, next) {
  const have = new Set(current.map((g) => `${g.kind}:${g.id}`))
  return current.concat(next.filter((g) => !have.has(`${g.kind}:${g.id}`)))
}

// Replaces one group by its full version (after "Show more").
export function replaceGroup (groups, full) {
  return groups.map((g) => (g.kind === full.kind && g.id === full.id ? { ...g, entries: full.entries, more: 0 } : g))
}

// How many entries "Show more" will add.
export function moreLabel (group) {
  return `Show ${group.more} more`
}
