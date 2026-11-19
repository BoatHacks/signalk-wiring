// The boat's wiring data file (wiring-data.mjs) and how it maps onto the
// plugin's resources. Pure functions only, so they can be tested without a
// server. The format is described in wiring-data.example.mjs.

import { createHash } from 'node:crypto'

export const ROLES = ['consumer', 'source', 'storage', 'distribution', 'converter', 'enclosure', 'ground']
export const CONDUCTORS = ['positive', 'negative', 'line', 'neutral', 'earth', 'signal']
const AC = new Set(['line', 'neutral'])
const DC = new Set(['positive', 'negative'])

// 1/0 to 4/0 AWG are stored by the plugin as 0 to -3.
const AWG_OUGHT = { '1/0': 0, '2/0': -1, '3/0': -2, '4/0': -3, '0': 0, '00': -1, '000': -2, '0000': -3 }

// A stable RFC 4122 v5-style UUID from a name, so reseeding updates records
// in place. The namespace keeps two boats (or two data files) apart.
export function deriveId (namespace, kind, key) {
  const h = createHash('sha1').update(`${namespace}/${kind}/${key}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

// The data module's exports, with defaults filled in. Cables accept short
// field names (c, g, len) and long ones (conductors, gauge, length).
export function normalizeData (mod) {
  const units = { gauge: 'AWG', length: 'ft', ...(mod.units || {}) }
  const cables = (mod.cables || []).map((c) => ({
    ...c,
    conductors: c.conductors || c.c || [{ conductor: 'positive' }],
    gauge: c.gauge !== undefined ? c.gauge : c.g,
    length: c.length !== undefined ? c.length : c.len
  }))
  return {
    namespace: mod.namespace,
    units,
    zones: mod.zones || [],
    devices: mod.devices || [],
    cables,
    conduits: mod.conduits || [],
    circuitNames: mod.circuitNames || {},
    groupNames: mod.groupNames || [],
    retired: { devices: [], cables: [], conduits: [], ...(mod.retired || {}) }
  }
}

export function gaugeValue (gauge, unit) {
  if (gauge === undefined || gauge === null || gauge === '') return null
  if (typeof gauge === 'string') {
    const s = gauge.trim()
    if (unit === 'AWG' && s in AWG_OUGHT) return AWG_OUGHT[s]
    const n = Number(s)
    if (!Number.isFinite(n)) throw new Error(`gauge "${gauge}" is not a number or an AWG size like 4/0`)
    return n
  }
  return gauge
}

// Every problem found, as messages. An empty list means the data can be seeded.
export function validateData (data) {
  const errors = []
  if (!data.namespace || typeof data.namespace !== 'string') {
    errors.push('export a `namespace` string (for example the boat name) so record ids stay stable')
  }
  if (!['AWG', 'mm2'].includes(data.units.gauge)) errors.push('units.gauge must be AWG or mm2')
  if (!['m', 'ft'].includes(data.units.length)) errors.push('units.length must be m or ft')

  const devices = new Map()
  for (const d of data.devices) {
    if (!d.key) { errors.push(`a device has no key: ${JSON.stringify(d).slice(0, 80)}`); continue }
    if (devices.has(d.key)) errors.push(`duplicate device key ${d.key}`)
    devices.set(d.key, d)
    if (!d.name) errors.push(`device ${d.key} has no name`)
    if (d.role && !ROLES.includes(d.role)) errors.push(`device ${d.key}: role must be one of ${ROLES.join(', ')}`)
    for (const t of d.terminals || []) {
      if (!t.name) errors.push(`device ${d.key}: a terminal has no name`)
      if (!CONDUCTORS.includes(t.conductor)) errors.push(`device ${d.key}: terminal ${t.name} conductor must be one of ${CONDUCTORS.join(', ')}`)
    }
  }
  for (const d of data.devices) {
    for (const ref of ['monitor', 'parent']) {
      if (d[ref] && !devices.has(d[ref])) errors.push(`device ${d.key}: ${ref} ${d[ref]} is not a device key`)
    }
  }

  const cables = new Map()
  for (const c of data.cables) {
    if (!c.key) { errors.push(`a cable has no key: ${JSON.stringify(c).slice(0, 80)}`); continue }
    if (cables.has(c.key)) errors.push(`duplicate cable key ${c.key}`)
    cables.set(c.key, c)
    for (const end of ['from', 'to']) {
      if (!devices.has(c[end])) errors.push(`cable ${c.key}: ${end} ${c[end]} is not a device key`)
    }
    const types = []
    for (const k of c.conductors) {
      if (!CONDUCTORS.includes(k.conductor)) {
        errors.push(`cable ${c.key}: conductor must be one of ${CONDUCTORS.join(', ')}`)
        continue
      }
      types.push(k.conductor)
      for (const end of ['from', 'to']) {
        if (k[end] && !devices.has(k[end])) errors.push(`cable ${c.key}: conductor lands on ${k[end]}, not a device key`)
      }
    }
    if (types.some((t) => AC.has(t)) && types.some((t) => DC.has(t))) {
      errors.push(`cable ${c.key}: a cable cannot carry both AC and DC`)
    }
    if (c.link) {
      if (!['series', 'parallel'].includes(c.link)) errors.push(`cable ${c.key}: link must be series or parallel`)
      const a = devices.get(c.from); const b = devices.get(c.to)
      if (a && b && (a.role !== 'storage' || b.role !== 'storage')) errors.push(`cable ${c.key}: a link only joins two storage devices`)
    }
    try {
      const g = gaugeValue(c.gauge, data.units.gauge)
      if (g !== null && g <= 0 && (data.units.gauge !== 'AWG' || !Number.isInteger(g) || g < -3)) {
        errors.push(`cable ${c.key}: gauge ${c.gauge} is not valid (1/0 to 4/0 AWG are written "1/0" .. "4/0" or 0 .. -3)`)
      }
    } catch (err) {
      errors.push(`cable ${c.key}: ${err.message}`)
    }
  }

  const conduitKeys = new Set()
  for (const k of data.conduits) {
    if (!k.key) { errors.push('a conduit has no key'); continue }
    if (conduitKeys.has(k.key)) errors.push(`duplicate conduit key ${k.key}`)
    conduitKeys.add(k.key)
    for (const ck of k.cables || []) if (!cables.has(ck)) errors.push(`conduit ${k.key}: ${ck} is not a cable key`)
  }

  for (const key of Object.keys(data.circuitNames)) {
    if (!devices.has(key)) errors.push(`circuitNames: ${key} is not a device key (name circuits by their fuse or breaker)`)
  }
  for (const [keys, name] of data.groupNames) {
    if (!Array.isArray(keys) || !name) errors.push('groupNames entries are [[device keys], name]')
    else for (const k of keys) if (!devices.has(k)) errors.push(`groupNames "${name}": ${k} is not a device key`)
  }
  for (const k of data.retired.devices) if (devices.has(k)) errors.push(`retired device ${k} is still in devices`)
  for (const k of data.retired.cables) if (cables.has(k)) errors.push(`retired cable ${k} is still in cables`)
  for (const k of data.retired.conduits) if (conduitKeys.has(k)) errors.push(`retired conduit ${k} is still in conduits`)
  return errors
}

// Fields the seed handles itself and never sends as they are.
const DEVICE_LOCAL = new Set(['key', 'monitor', 'parent', 'photos', 'zone'])

export function deviceBody (d, ns, { withRefs = true } = {}) {
  const out = {}
  for (const [k, v] of Object.entries(d)) if (!DEVICE_LOCAL.has(k)) out[k] = v
  out.tags = d.tags || []
  if (d.zone) out.zone = d.zone
  if (withRefs && d.monitor) out.monitorDeviceId = deriveId(ns, 'device', d.monitor)
  if (withRefs && d.parent) out.parentId = deriveId(ns, 'device', d.parent)
  return out
}

export function cableBody (c, ns, units) {
  const dev = (key) => deriveId(ns, 'device', key)
  const body = {
    fromDeviceId: dev(c.from),
    toDeviceId: dev(c.to),
    conductors: c.conductors.map((k) => {
      const out = { conductor: k.conductor }
      if (k.color) out.color = k.color
      if (k.from) out.fromDeviceId = dev(k.from)
      if (k.to) out.toDeviceId = dev(k.to)
      if (k.fromTerminal) out.fromTerminal = k.fromTerminal
      if (k.toTerminal) out.toTerminal = k.toTerminal
      return out
    }),
    tags: c.tags || [],
    notes: c.notes || null
  }
  const g = gaugeValue(c.gauge, units.gauge)
  if (g !== null) { body.gauge = g; body.gaugeUnit = c.gaugeUnit || units.gauge }
  if (c.length !== undefined && c.length !== null) { body.length = c.length; body.lengthUnit = c.lengthUnit || units.length }
  for (const k of ['link', 'zone', 'cableLabel', 'switchRef', 'protocol']) if (c[k]) body[k] = c[k]
  return body
}

const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

// The plugin names a new circuit once and carries the name over when its key
// changes, so a circuit seeded cable by cable can keep a name from an earlier
// state ("Unprotected: <id>" after its fuse arrived). Returns a fresh default
// name for such a circuit, or null when its name is fine. `deviceName` maps
// device id to name.
export function staleNameFix (circuit, deviceName) {
  const d = circuit.derived
  if (!d) return null
  const stale = (!d.unprotected && circuit.name.startsWith('Unprotected:')) || UUID_IN.test(circuit.name)
  if (!stale) return null
  if (!d.unprotected && d.protectorId) return deviceName.get(d.protectorId) || null
  const ends = (d.endDeviceIds && d.endDeviceIds.length ? d.endDeviceIds : d.deviceIds || []).map((i) => deviceName.get(i)).filter(Boolean)
  return ends.length ? `Unprotected: ${ends.join(', ')}` : null
}

// The name and other editable fields for a derived circuit, or null.
// `circuit` is a wiringCircuits resource (with `derived`).
export function circuitPatch (circuit, data) {
  const derived = circuit.derived
  if (!derived) return null
  const ns = data.namespace
  for (const [key, patch] of Object.entries(data.circuitNames)) {
    if (derived.protectorId === deriveId(ns, 'device', key)) {
      return typeof patch === 'string' ? { name: patch } : patch
    }
  }
  const members = new Set(derived.deviceIds || [])
  for (const [keys, name] of data.groupNames) {
    if (keys.every((k) => members.has(deriveId(ns, 'device', k)))) return { name }
  }
  return null
}
