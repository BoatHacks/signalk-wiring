// Battery details (plan 0020), the parts the browser uses. The server has the
// same table and helpers in src/batteries.js; test/batteries.test.mjs keeps
// both equal.

export const CHEMISTRIES = ['flooded', 'agm', 'gel', 'lifepo4', 'lithium', 'other']
export const PURPOSES = ['house', 'starter', 'thruster', 'windlass', 'motor', 'other']
export const LINKS = ['series', 'parallel']

export const CHEMISTRY_LABELS = {
  flooded: 'Flooded lead-acid',
  agm: 'AGM',
  gel: 'Gel',
  lifepo4: 'LiFePO4',
  lithium: 'Other lithium',
  other: 'Other'
}

export const PURPOSE_LABELS = {
  house: 'House',
  starter: 'Starter',
  thruster: 'Thruster',
  windlass: 'Windlass',
  motor: 'Motor (propulsion)',
  other: 'Other'
}

// Per chemistry: the nominal voltage of one 12 V battery and the usable
// fraction of its capacity. null means no default.
export const CHEMISTRY_DEFAULTS = {
  flooded: { nominalVoltage: 12, usableFraction: 0.5 },
  agm: { nominalVoltage: 12, usableFraction: 0.5 },
  gel: { nominalVoltage: 12, usableFraction: 0.5 },
  lifepo4: { nominalVoltage: 12.8, usableFraction: 0.8 },
  lithium: { nominalVoltage: null, usableFraction: 0.8 },
  other: { nominalVoltage: null, usableFraction: null }
}

// Type names that imply a chemistry or a purpose, matched case-insensitively
// on the whole name.
export const TYPE_CHEMISTRY = {
  'lead-acid battery': 'flooded',
  'agm battery': 'agm',
  'lifepo4 battery': 'lifepo4'
}
export const TYPE_PURPOSE = {
  'starter battery': 'starter',
  'house battery': 'house'
}

const norm = (type) => (typeof type === 'string' ? type.trim().toLowerCase() : '')

export function typeChemistry (type) {
  return TYPE_CHEMISTRY[norm(type)] || null
}

export function typePurpose (type) {
  return TYPE_PURPOSE[norm(type)] || null
}

export function chemistryDefaults (chemistry) {
  return CHEMISTRY_DEFAULTS[chemistry] || { nominalVoltage: null, usableFraction: null }
}

// ---- Bank cards for the Batteries tab (pure) ----

const TITLE_MAX_NAMES = 3

function nameOf (device, id) {
  return (device && device.name) || id
}

// "Cabin battery" for a bank of one, else the names joined with " + ", capped
// at three names and "+ N more".
export function bankTitle (bank, deviceById) {
  const names = bank.batteryIds.map((id) => nameOf(deviceById.get(id), id))
  if (names.length <= TITLE_MAX_NAMES) return names.join(' + ') || 'Battery'
  return names.slice(0, TITLE_MAX_NAMES).join(' + ') + ` + ${names.length - TITLE_MAX_NAMES} more`
}

// A number with fixed decimals, or "-" when there is none.
export function fmtNumber (value, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return value.toFixed(decimals)
}

export function fmtVolts (v) { return v == null ? '-' : fmtNumber(v, 1) + ' V' }
export function fmtAh (v) { return v == null ? '-' : fmtNumber(v, 0) + ' Ah' }
export function fmtKwh (wh) { return wh == null ? '-' : fmtNumber(wh / 1000, 1) + ' kWh' }

const MISSING_FIELD_TEXT = { capacityAh: 'capacity', nominalVoltage: 'voltage' }

// One sentence per battery that lacks data, or '' when the bank is complete.
export function incompleteText (bank, deviceById) {
  if (!bank.missing || bank.missing.length === 0) return ''
  return bank.missing.map((m) => {
    const fields = (m.fields || []).map((f) => MISSING_FIELD_TEXT[f] || f)
    return `${nameOf(deviceById.get(m.deviceId), m.deviceId)} has no ${fields.join(' or ')} set`
  }).join('. ')
}

// The strings of a bank as names, "A + B | C + D", or '' for a single battery.
export function stringsText (bank, deviceById) {
  const strings = bank.strings || []
  if (strings.length === 0 || (strings.length === 1 && strings[0].length <= 1)) return ''
  return strings.map((s) => s.map((id) => nameOf(deviceById.get(id), id)).join(' + ')).join(' | ')
}

// Storage devices that are in no bank of the list get a bank of one, so the
// tab never hides a battery when the server sent no bank for it.
export function singleBatteryBanks (devices, banks) {
  const inBank = new Set()
  for (const b of banks) for (const id of b.batteryIds) inBank.add(id)
  return devices
    .filter((d) => d.role === 'storage' && d.status !== 'removed' && !inBank.has(d.id))
    .map((d) => {
      const cap = typeof d.capacityAh === 'number' ? d.capacityAh : null
      const volt = typeof d.nominalVoltage === 'number' ? d.nominalVoltage : null
      const frac = typeof d.usableFraction === 'number' ? d.usableFraction : null
      const missing = []
      const fields = []
      if (cap == null) fields.push('capacityAh')
      if (volt == null) fields.push('nominalVoltage')
      if (fields.length) missing.push({ deviceId: d.id, fields })
      const complete = missing.length === 0
      return {
        batteryIds: [d.id],
        cableIds: [],
        strings: [[d.id]],
        layout: null,
        voltage: volt,
        capacityAh: cap,
        usableAh: cap != null && frac != null ? cap * frac : null,
        energyWh: complete ? cap * volt : null,
        usableEnergyWh: complete && frac != null ? cap * volt * frac : null,
        complete,
        missing,
        chemistries: d.chemistry ? [d.chemistry] : [],
        monitorDeviceIds: d.monitorDeviceId ? [d.monitorDeviceId] : [],
        protectedBy: [],
        warnings: []
      }
    })
}

// All cards: the served banks plus a bank of one for each stray battery,
// sorted by the first battery id like the server does.
export function allBanks (devices, banks) {
  return [...banks, ...singleBatteryBanks(devices, banks)]
    .sort((a, b) => (a.batteryIds[0] < b.batteryIds[0] ? -1 : a.batteryIds[0] > b.batteryIds[0] ? 1 : 0))
}

// ---- Device form and page helpers (plan 0020, step 3) ----

const BATTERY_KEYS = [
  'chemistry', 'purpose', 'capacityAh', 'usablePercent', 'makeModel', 'installedOn', 'monitorDeviceId'
]
const MONITOR_PATH_KEYS = ['voltagePath', 'currentPath', 'socPath', 'timeRemainingPath']
const MONITOR_TYPE = /shunt|monitor|bms/i

// Which battery fields the device form shows. The details belong to storage
// devices; the four monitor paths also to a shunt, battery monitor or BMS.
export function batteryFieldVisible (key, values) {
  const role = (values && values.role) || 'consumer'
  if (BATTERY_KEYS.includes(key)) return role === 'storage'
  if (MONITOR_PATH_KEYS.includes(key)) {
    return role === 'storage' || MONITOR_TYPE.test(String((values && values.type) || ''))
  }
  return true
}

const blankValue = (v) => v === null || v === undefined || String(v).trim() === '' || Number.isNaN(Number(v))

// The fraction 0 to 1 as the text of a percent field, and back (null when empty).
export function fractionToPercent (fraction) {
  return blankValue(fraction) ? '' : String(Math.round(Number(fraction) * 1000) / 10)
}

export function percentToFraction (percent) {
  return blankValue(percent) ? null : Math.round(Number(percent) * 10) / 1000
}

// A stored device as the form values it starts from (usableFraction shows as a
// percent), and the form payload back to a device (usablePercent becomes
// usableFraction; an empty one is null so clearing works).
export function deviceToFormValues (device) {
  return device ? { ...device, usablePercent: fractionToPercent(device.usableFraction) } : device
}

export function formPayloadToDevice (payload) {
  if (!('usablePercent' in payload)) return payload
  const { usablePercent, ...rest } = payload
  rest.usableFraction = percentToFraction(usablePercent)
  return rest
}

// The time remaining path that goes with a state of charge path: the standard
// `...stateOfCharge` tail becomes `...timeRemaining`. Null for any other path.
export function timeRemainingSuggestion (socPath) {
  const path = typeof socPath === 'string' ? socPath.trim() : ''
  return /\.stateOfCharge$/.test(path) ? path.replace(/stateOfCharge$/, 'timeRemaining') : null
}

// True when a field is empty or holds some chemistry's default, so a value the
// user typed or stored by hand is never replaced.
const isEmptyOrDefault = (value, pick) => {
  if (blankValue(value)) return true
  return Object.values(CHEMISTRY_DEFAULTS).some((d) => d[pick] !== null && Number(d[pick]) === Number(value))
}

// Form hook: the values to set when the chemistry changes. Nominal voltage and
// Usable (%) follow the chemistry while the user has not set them.
export function chemistryFill (chemistry, values, touched = {}) {
  if (!chemistry) return {}
  const defaults = chemistryDefaults(chemistry)
  const extra = {}
  if (!touched.nominalVoltage && isEmptyOrDefault(values.nominalVoltage, 'nominalVoltage')) {
    extra.nominalVoltage = defaults.nominalVoltage === null ? '' : String(defaults.nominalVoltage)
  }
  if (!touched.usablePercent && isEmptyOrDefault(percentToFraction(values.usablePercent), 'usableFraction')) {
    extra.usablePercent = fractionToPercent(defaults.usableFraction)
  }
  return extra
}

// Form hook for a new device: the type presets chemistry and purpose while
// untouched, and the chemistry in turn fills voltage and usable.
export function typeBatteryFill (type, values, touched = {}) {
  const extra = {}
  if (!touched.chemistry) {
    const chemistry = typeChemistry(type)
    if (chemistry) {
      extra.chemistry = chemistry
      Object.assign(extra, chemistryFill(chemistry, values, touched))
    }
  }
  if (!touched.purpose) {
    const purpose = typePurpose(type)
    if (purpose) extra.purpose = purpose
  }
  return extra
}

// Form hook: the time remaining path follows the state of charge path while it
// is empty or an earlier suggestion (ends in `.timeRemaining`) and untouched.
export function socPathFill (socPath, values, touched = {}) {
  if (touched.timeRemainingPath) return null
  const current = values.timeRemainingPath || ''
  if (current !== '' && !/\.timeRemaining$/.test(current)) return null
  return { timeRemainingPath: timeRemainingSuggestion(socPath) || '' }
}

// "installed 3 years ago", "installed 5 months ago", "installed 12 days ago".
// Null for an empty or unreadable date. `now` is a Date (for tests).
export function installedAgeText (isoDate, now = new Date()) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return null
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  const ny = now.getUTCFullYear()
  const nm = now.getUTCMonth() + 1
  const nd = now.getUTCDate()
  let months = (ny - y) * 12 + (nm - m)
  if (nd < d) months -= 1
  if (months < 0) return 'installed in the future'
  if (months >= 12) {
    const years = Math.floor(months / 12)
    return `installed ${years} ${years === 1 ? 'year' : 'years'} ago`
  }
  if (months >= 1) return `installed ${months} ${months === 1 ? 'month' : 'months'} ago`
  const days = Math.floor((Date.UTC(ny, nm - 1, nd) - Date.UTC(y, m - 1, d)) / 86400000)
  if (days <= 0) return 'installed today'
  return `installed ${days} ${days === 1 ? 'day' : 'days'} ago`
}

// The bank (from /derived) a battery belongs to, or null.
export function bankOfBattery (banks, deviceId) {
  return (banks || []).find((b) => (b.batteryIds || []).includes(deviceId)) || null
}

// Short lines describing a bank for the battery page.
export function describeBank (bank) {
  if (!bank) return []
  const size = (bank.batteryIds || []).length
  const lines = [size <= 1 ? 'Bank of one' : `Bank of ${size}${bank.layout ? `, ${bank.layout.label}` : ''}`]
  const facts = []
  if (bank.voltage != null) facts.push(`${bank.voltage} V`)
  if (bank.capacityAh != null) facts.push(`${bank.capacityAh} Ah`)
  if (bank.usableAh != null) facts.push(`${bank.usableAh} Ah usable`)
  if (facts.length) lines.push(facts.join(', '))
  return lines
}
