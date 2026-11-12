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
    voltageDropLimitCritical: dropLimit(o.voltageDropLimitCritical, DROP_LIMIT_CRITICAL),
    voltageDropLimitNormal: dropLimit(o.voltageDropLimitNormal, DROP_LIMIT_NORMAL)
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

module.exports = { DROP_LIMIT_MIN, DROP_LIMIT_MAX, resolveSettings, createSettingsProvider }
