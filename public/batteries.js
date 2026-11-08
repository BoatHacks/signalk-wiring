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
