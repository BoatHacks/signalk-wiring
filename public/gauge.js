// Cable gauge lists and text. A gauge is stored as a number: the sizes above
// 1 AWG (1/0 to 4/0) are the numbers 0, -1, -2 and -3, so the column stays
// numeric and existing values stay valid.

export const AWG_SIZES = [18, 16, 14, 12, 10, 8, 6, 4, 2, 1, 0, -1, -2, -3]
export const MM2_SIZES = [0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95]
export const OTHER = 'other'

// 'AWG' or 'mm2' for a stored unit text, '' for none or unknown.
export function normalizeUnit (unit) {
  const text = String(unit || '').trim().toLowerCase()
  if (text === 'awg') return 'AWG'
  if (text === 'mm2' || text === 'mm²' || text === 'mm') return 'mm2'
  return ''
}

export function gaugeList (unit) {
  const u = normalizeUnit(unit)
  return u === 'AWG' ? AWG_SIZES : u === 'mm2' ? MM2_SIZES : []
}

// The size as written: "1/0" for 0 in AWG, "2.5" for 2.5 mm2.
export function gaugeLabel (value, unit) {
  const n = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return ''
  if (normalizeUnit(unit) !== 'mm2' && Number.isInteger(n) && n <= 0 && n >= -3) return `${1 - n}/0`
  return String(n)
}

// Shown wherever a gauge is shown: "1/0 AWG", "2.5 mm²", or "-" when none.
// Zero is a gauge (1/0 AWG), only null and undefined mean none.
export function formatGauge (value, unit) {
  const label = gaugeLabel(value, unit)
  if (label === '') return '-'
  const u = normalizeUnit(unit)
  const suffix = u === 'AWG' ? ' AWG' : u === 'mm2' ? ' mm²' : unit ? ` ${unit}` : ''
  return label + suffix
}

// True when the value is one of the standard sizes of the unit.
export function inGaugeList (value, unit) {
  const n = Number(value)
  return value !== '' && value !== null && value !== undefined && gaugeList(unit).includes(n)
}

// Dropdown options for a unit: the list, the current value when it is not in
// the list (so an existing non-standard value stays selectable), and "Other".
// Each option is { value, label }, the value being text.
export function gaugeOptions (unit, current) {
  const options = gaugeList(unit).map((n) => ({ value: String(n), label: gaugeLabel(n, unit) }))
  const n = Number(current)
  const has = current !== '' && current !== null && current !== undefined && Number.isFinite(n)
  if (has && !gaugeList(unit).includes(n)) options.push({ value: String(n), label: gaugeLabel(n, unit) })
  options.push({ value: OTHER, label: 'Other…' })
  return options
}

// Changing the unit keeps the value when it is in the new list, else clears it.
export function keepGaugeForUnit (value, newUnit) {
  return inGaugeList(value, newUnit) ? String(Number(value)) : ''
}

// Reads a gauge written as text: "1/0" to "4/0", "0" to "0000" (aught
// notation, 000 is 3/0), or a plain number with a decimal point or comma.
// Returns the stored number, or null when it cannot be read. Aught notation
// only applies to AWG, so a mm2 unit rejects it.
export function parseGauge (text, unit) {
  const raw = String(text === null || text === undefined ? '' : text).trim()
  if (raw === '') return null
  const mm = normalizeUnit(unit) === 'mm2'
  const slash = raw.match(/^(\d)\s*\/\s*0$/)
  if (slash) {
    const k = Number(slash[1])
    return !mm && k >= 1 && k <= 4 ? 1 - k : null
  }
  if (/^0{2,4}$/.test(raw)) return mm ? null : 1 - raw.length
  if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return null
  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n)) return null
  if (n <= 0) return !mm && Number.isInteger(n) && n >= -3 ? n : null
  return n
}
