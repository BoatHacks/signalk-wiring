'use strict'

const CONVENTIONS = ['freestyle', 'abyc-e11', 'din-en-iso-13297']
const GAUGE_UNITS = ['AWG', 'mm2']
const LENGTH_UNITS = ['m', 'ft']
const DROP_LIMIT_MIN = 0.5
const DROP_LIMIT_MAX = 20
const DROP_LIMIT_CRITICAL = 3
const DROP_LIMIT_NORMAL = 10

// A voltage drop limit in percent: a number from 0.5 to 20, else the default.
function dropLimit (value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= DROP_LIMIT_MIN && value <= DROP_LIMIT_MAX
    ? value
    : fallback
}

const DASHBOARD_MAX_ENTRIES = 12
const DASHBOARD_LABEL_MAX = 40
const DASHBOARD_PATH_MAX = 200
const DASHBOARD_VOLTAGE_MIN = 1
const DASHBOARD_VOLTAGE_MAX = 100
const DASHBOARD_UNITS = ['W', 'A']
// Dotted SignalK names, for example electrical.batteries.house.current.
const SIGNALK_PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/

function validPath (value) {
  return typeof value === 'string' && value.length <= DASHBOARD_PATH_MAX && SIGNALK_PATH.test(value)
}

// One Dashboard source entry, or the reason it is unusable. A watt entry
// carries no voltage; an amp entry keeps a fixed voltage, a voltage path,
// both or neither (neither is shown as "no voltage" and left out of sums).
function resolveDashboardEntry (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'not an object' }
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (label.length < 1 || label.length > DASHBOARD_LABEL_MAX) return { reason: 'label must be 1 to 40 characters' }
  if (!validPath(raw.path)) return { reason: 'path is not a dotted SignalK path' }
  if (!DASHBOARD_UNITS.includes(raw.unit)) return { reason: 'unit must be W or A' }
  let voltage = null
  let voltagePath = null
  if (raw.unit === 'A') {
    if (raw.voltage !== undefined && raw.voltage !== null && raw.voltage !== '') {
      const v = raw.voltage
      if (typeof v !== 'number' || !Number.isFinite(v) || v < DASHBOARD_VOLTAGE_MIN || v > DASHBOARD_VOLTAGE_MAX) {
        return { reason: 'voltage must be a number from 1 to 100' }
      }
      voltage = v
    }
    if (raw.voltagePath !== undefined && raw.voltagePath !== null && raw.voltagePath !== '') {
      if (!validPath(raw.voltagePath)) return { reason: 'voltage path is not a dotted SignalK path' }
      voltagePath = raw.voltagePath
    }
  }
  return { entry: { label, path: raw.path, unit: raw.unit, voltage, voltagePath } }
}

// A Dashboard source list: the valid entries in order (at most 12) and a
// note for every entry that was dropped, with its 1-based position.
function resolveDashboardList (list, name) {
  const entries = []
  const dropped = []
  if (list === undefined || list === null) return { entries, dropped }
  if (!Array.isArray(list)) return { entries, dropped: [`${name}: not a list`] }
  list.forEach((raw, i) => {
    const r = resolveDashboardEntry(raw)
    if (!r.entry) dropped.push(`${name} ${i + 1}: ${r.reason}`)
    else if (entries.length >= DASHBOARD_MAX_ENTRIES) dropped.push(`${name} ${i + 1}: more than ${DASHBOARD_MAX_ENTRIES} entries`)
    else entries.push(r.entry)
  })
  return { entries, dropped }
}

// What was dropped from the Dashboard lists in these options, for the
// plugin status line.
function settingsWarnings (options) {
  const o = options || {}
  return [
    ...resolveDashboardList(o.dashboardInputs, 'Dashboard input').dropped,
    ...resolveDashboardList(o.dashboardOutputs, 'Dashboard output').dropped
  ]
}

// Plugin options come from the admin UI's config form and may be missing
// (first start) or stale (an option value removed in a later version), so
// each one falls back to its default rather than propagating a bad value.
function resolveSettings (options) {
  const o = options || {}
  return {
    convention: CONVENTIONS.includes(o.convention) ? o.convention : 'freestyle',
    defaultGaugeUnit: GAUGE_UNITS.includes(o.defaultGaugeUnit) ? o.defaultGaugeUnit : 'AWG',
    defaultLengthUnit: LENGTH_UNITS.includes(o.defaultLengthUnit) ? o.defaultLengthUnit : 'm',
    autoTheme: o.autoTheme === true,
    showFloorplan: o.showFloorplan !== false,
    voltageDropLimitCritical: dropLimit(o.voltageDropLimitCritical, DROP_LIMIT_CRITICAL),
    voltageDropLimitNormal: dropLimit(o.voltageDropLimitNormal, DROP_LIMIT_NORMAL),
    dashboardInputs: resolveDashboardList(o.dashboardInputs, 'Dashboard input').entries,
    dashboardOutputs: resolveDashboardList(o.dashboardOutputs, 'Dashboard output').entries
  }
}

// Read-only resource provider exposing the settings at
// /signalk/v2/api/resources/wiringSettings/config. The webapp loads
// anonymously and the plugin's own routes are admin-gated, so the
// resource API is the only way for it to read the settings.
function createSettingsProvider (settings) {
  const type = 'wiringSettings'
  return {
    type,
    methods: {
      listResources: async () => ({ config: settings }),
      getResource: async (id) => {
        if (id !== 'config') throw new Error(`${type} resource not found: ${id}`)
        return settings
      },
      setResource: async () => {
        throw new Error(`${type} is read-only; change it in the plugin configuration`)
      },
      deleteResource: async () => {
        throw new Error(`${type} is read-only; change it in the plugin configuration`)
      }
    }
  }
}

module.exports = { DROP_LIMIT_MIN, DROP_LIMIT_MAX, DASHBOARD_MAX_ENTRIES, resolveSettings, settingsWarnings, createSettingsProvider }
