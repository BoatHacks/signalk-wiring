// Live readings of batteries (plan 0020): pure text and value helpers, no
// browser or Preact, so they are tested on the host (test/liveBattery.test.mjs).
// The monitor's own time remaining is only displayed, never computed.

export const STALE_MS = 60000

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const numberOf = (v) => {
  const x = v !== null && typeof v === 'object' && 'value' in v ? v.value : v
  return finite(x) ? x : null
}

// Seconds as "6 h 20 min", "45 min", "2 d 3 h" or "less than a minute".
export function formatDuration (seconds) {
  if (!finite(seconds) || seconds < 0) return null
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return 'less than a minute'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`
  return `${mins} min`
}

// The short reading of one battery or bank, for example
// "12.8 V, 87 %, 6 h 20 min". Inputs: voltage in volts, soc as a ratio 0..1,
// current in amps (positive flows out of the battery), timeRemaining in
// seconds. Anything missing is left out; null when nothing is known.
export function batteryReading ({ voltage, soc, current, timeRemaining, stale } = {}) {
  const parts = []
  if (finite(voltage)) parts.push(`${(Math.round(voltage * 10) / 10).toFixed(1)} V`)
  if (finite(soc)) parts.push(`${Math.round(Math.min(1, Math.max(0, soc)) * 100)} %`)
  if (finite(timeRemaining) && timeRemaining >= 0) parts.push(formatDuration(timeRemaining))
  else if (finite(current) && current <= 0) parts.push('not discharging')
  if (parts.length === 0) return null
  return parts.join(', ') + (stale ? ' (stale)' : '')
}

// The reading of a bank: per metric, the first battery that has a value.
// `list` is an array of { voltage, soc, current, timeRemaining, stale }.
export function bankReadingInput (list) {
  const out = {}
  const used = []
  for (const key of ['voltage', 'soc', 'current', 'timeRemaining']) {
    const source = list.find((x) => x && finite(x[key]))
    if (source) { out[key] = source[key]; used.push(source) }
  }
  out.stale = used.length > 0 && used.every((x) => x.stale)
  return out
}

export const bankReading = (list) => batteryReading(bankReadingInput(list))

// The numbers of one storage device from the map of values, or null when the
// device has no battery paths. Stamps are the times (ms) values arrived;
// a value older than STALE_MS is stale, and a device is stale when every
// value it has is stale.
//   paths:  { voltagePath, currentPath, socPath, timeRemainingPath } of GET /live
//   values: Map path -> value, stamps: Map path -> ms
const strip = (path) => String(path || '').replace(/^vessels\.self\./, '')
export function batteryInputs (paths, values, stamps = new Map(), now = Date.now()) {
  if (!paths) return null
  const read = (p) => (p ? numberOf(values.get(strip(p))) : null)
  const out = {
    voltage: read(paths.voltagePath),
    soc: read(paths.socPath),
    current: read(paths.currentPath),
    timeRemaining: read(paths.timeRemainingPath)
  }
  const present = [['voltage', paths.voltagePath], ['soc', paths.socPath], ['current', paths.currentPath],
    ['timeRemaining', paths.timeRemainingPath]].filter(([k]) => out[k] !== null)
  out.stale = present.length > 0 && present.every(([, p]) => {
    const at = stamps.get(strip(p))
    return typeof at === 'number' && now - at > STALE_MS
  })
  return out
}

export function batteryPathsToWatch (live) {
  const paths = new Set()
  for (const b of Object.values((live && live.batteries) || {})) {
    for (const k of ['voltagePath', 'currentPath', 'socPath', 'timeRemainingPath']) if (b[k]) paths.add(strip(b[k]))
  }
  return [...paths]
}
