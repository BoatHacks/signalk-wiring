// Layer switches, role filter and focus on selection for the floorplan
// (plan 0027). Pure apart from the storage argument, which defaults to the
// browser's localStorage and may be missing or throw (private windows,
// blocked site data); the page then just uses the defaults.

import { roleLabel, ROLES } from './roles.js'

const STORAGE_KEY = 'wiring.floorLayers'

export const LAYER_SWITCHES = [
  { key: 'names', label: 'Names' },
  { key: 'devices', label: 'Devices' },
  { key: 'cables', label: 'Cables' },
  { key: 'conduits', label: 'Conduits' }
]

// Everything on, no role hidden.
export function defaultLayers () {
  return { names: true, devices: true, cables: true, conduits: true, hiddenRoles: [] }
}

// Anything stored that is not understood falls back to the default for that field.
export function sanitizeLayers (raw) {
  const out = defaultLayers()
  if (!raw || typeof raw !== 'object') return out
  for (const { key } of LAYER_SWITCHES) if (typeof raw[key] === 'boolean') out[key] = raw[key]
  if (Array.isArray(raw.hiddenRoles)) out.hiddenRoles = [...new Set(raw.hiddenRoles.filter((r) => typeof r === 'string'))].sort()
  return out
}

export function loadLayers (storage) {
  try {
    const text = (storage || globalThis.localStorage).getItem(STORAGE_KEY)
    return text ? sanitizeLayers(JSON.parse(text)) : defaultLayers()
  } catch (err) {
    return defaultLayers()
  }
}

export function saveLayers (layers, storage) {
  try {
    (storage || globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(sanitizeLayers(layers)))
  } catch (err) {
    // the choice just is not remembered
  }
}

export function toggleLayer (layers, key) {
  if (!LAYER_SWITCHES.some((s) => s.key === key)) return layers
  return { ...layers, [key]: !layers[key] }
}

export function toggleRole (layers, role) {
  const hidden = new Set(layers.hiddenRoles)
  if (hidden.has(role)) hidden.delete(role)
  else hidden.add(role)
  return { ...layers, hiddenRoles: [...hidden].sort() }
}

export function roleShown (layers, role) {
  return !layers.hiddenRoles.includes(role || 'consumer')
}

// The roles of the given devices, in the order of the role list; the filter
// offers only these. A device with no role is a consumer.
export function rolesPresent (devices) {
  const present = new Set(devices.map((d) => d.role || 'consumer'))
  const known = ROLES.map((r) => r.value).filter((v) => present.has(v))
  const other = [...present].filter((v) => !ROLES.some((r) => r.value === v)).sort()
  return [...known, ...other].map((value) => ({ value, label: roleLabel(value) }))
}

// True when the layers differ from the default, for the menu's hint.
export function layersChanged (layers) {
  const d = defaultLayers()
  return LAYER_SWITCHES.some(({ key }) => layers[key] !== d[key]) || layers.hiddenRoles.length > 0
}

// What stays at full strength while something is selected. null when nothing
// is selected, so nothing fades. A selected device keeps its own cables, a
// run its two ends, a circuit or a conduit its runs and devices (a conduit
// itself too).
//   sel: { deviceId, run, conduit, members }  members: { runIds, deviceIds }
export function focusSet (sel, wireRuns) {
  const { deviceId = null, run = null, conduit = null, members = null } = sel || {}
  if (!deviceId && !run && !conduit && !members) return null
  const deviceIds = new Set()
  const runIds = new Set()
  const conduitIds = new Set()
  if (deviceId) {
    deviceIds.add(deviceId)
    for (const r of wireRuns) {
      if (r.status !== 'removed' && (r.fromDeviceId === deviceId || r.toDeviceId === deviceId)) runIds.add(r.id)
    }
  }
  if (run) {
    runIds.add(run.id)
    if (run.fromDeviceId) deviceIds.add(run.fromDeviceId)
    if (run.toDeviceId) deviceIds.add(run.toDeviceId)
  }
  if (conduit) conduitIds.add(conduit.id)
  if (members) {
    for (const id of members.runIds || []) runIds.add(id)
    for (const id of members.deviceIds || []) deviceIds.add(id)
  }
  return { deviceIds, runIds, conduitIds }
}

export const FADED_OPACITY = 0.2
