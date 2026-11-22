// Solar arrays (plan 0048), the parts the browser uses. The server derives the
// arrays (src/arrays.js, GET /derived); these helpers only format them.

import { fmtNumber } from './batteries.js'

// A device of type "Solar panel", matched on the whole name, ignoring case.
export const isSolarPanel = (device) =>
  Boolean(device) && typeof device.type === 'string' && /^\s*solar panel\s*$/i.test(device.type)

// Which solar fields a device form shows: the panel figures for a Solar panel,
// the PV limits and paths for a charge controller (an MPPT or solar charger,
// or any converter with a PV port).
const PANEL_KEYS = ['vocV', 'iscA', 'vmpV', 'impA', 'vocTempCoeff']
const CONTROLLER_KEYS = ['pvMaxV', 'pvMaxA', 'pvMaxW', 'pvVoltagePath', 'pvPowerPath']
export function solarFieldVisible (key, values) {
  const v = values || {}
  if (PANEL_KEYS.includes(key)) return isSolarPanel(v)
  if (CONTROLLER_KEYS.includes(key)) {
    if ((v.role || 'consumer') !== 'converter') return false
    const ports = Array.isArray(v.terminals) ? v.terminals.map((t) => String(t.port || t.name || '')) : []
    return /mppt|solar/i.test(String(v.type || '')) || ports.some((p) => /^pv\b/i.test(p))
  }
  return true
}

const nameOf = (d, id) => (d && d.name) || id
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const fmtV = (v) => (num(v) === null ? '-' : `${fmtNumber(v)} V`)
export const fmtA = (v) => (num(v) === null ? '-' : `${fmtNumber(v)} A`)
export const fmtW = (v) => (num(v) === null ? '-' : `${Math.round(v)} W`)

// The card title: the panel names joined, capped like a bank title.
export function arrayTitle (array, deviceById) {
  const names = array.panelIds.map((id) => nameOf(deviceById.get(id), id))
  return names.length <= 3 ? names.join(' + ') : `${names.slice(0, 3).join(' + ')} + ${names.length - 3} more`
}

const FIELD_WORDS = {
  vocV: 'Voc', iscA: 'Isc', vmpV: 'Vmp', impA: 'Imp', ratedPowerW: 'rated power'
}

// "Port has no Voc or Isc set. Middle has no Vmp set", or '' when complete.
export function missingText (array, deviceById) {
  return (array.missing || []).map((m) => {
    const words = m.fields.map((f) => FIELD_WORDS[f] || f)
    return `${nameOf(deviceById.get(m.deviceId), m.deviceId)} has no ${words.join(' or ')} set`
  }).join('. ')
}

// The strings as names: "A + B + C | D + E + F", or '' for one panel.
export function stringsText (array, deviceById) {
  const strings = array.strings || []
  if (strings.length === 0 || (strings.length === 1 && strings[0].length <= 1)) return ''
  return strings.map((s) => s.map((id) => nameOf(deviceById.get(id), id)).join(' + ')).join(' | ')
}

// Solar panels that are in no array of the list get an array of one, so the tab
// never hides a panel when the server sent no array for it.
export function singlePanelArrays (devices, arrays) {
  const inArray = new Set()
  for (const a of arrays) for (const id of a.panelIds) inArray.add(id)
  return devices
    .filter((d) => isSolarPanel(d) && d.status !== 'removed' && !inArray.has(d.id))
    .map((d) => {
      const fields = ['vocV', 'iscA', 'vmpV', 'impA', 'ratedPowerW'].filter((k) => num(d[k]) === null)
      return {
        panelIds: [d.id], cableIds: [], strings: [[d.id]], layout: null,
        voc: num(d.vocV), vocCold: null, vmp: num(d.vmpV), iscA: num(d.iscA), impA: num(d.impA), powerW: num(d.ratedPowerW),
        controllerIds: [], coldTemperatureC: null, assumedCoeff: false,
        complete: fields.length === 0, missing: fields.length ? [{ deviceId: d.id, fields }] : [],
        checks: [], warnings: []
      }
    })
}

export function allArrays (devices, arrays) {
  return [...arrays, ...singlePanelArrays(devices, arrays)]
    .sort((a, b) => (a.panelIds[0] < b.panelIds[0] ? -1 : a.panelIds[0] > b.panelIds[0] ? 1 : 0))
}

// The marks of a check level, as words so they are not only colour.
export const LEVEL_LABELS = { ok: 'OK', note: 'Note', warning: 'Check' }

// The checks that are warnings, for the Dashboard.
export function arrayWarnings (arrays) {
  const out = []
  for (const a of arrays || []) {
    for (const c of a.checks || []) if (c.level === 'warning') out.push({ array: a, check: c })
    for (const w of a.warnings || []) out.push({ array: a, check: { level: 'warning', ...w } })
  }
  return out
}

// The PV readings of a controller from the map of SignalK values.
const strip = (path) => String(path || '').replace(/^vessels\.self\./, '')
export function pvReading (controller, values) {
  if (!controller) return null
  const read = (p) => (p ? num(values.get(strip(p))) : null)
  const volts = read(controller.pvVoltagePath)
  const watts = read(controller.pvPowerPath)
  if (volts === null && watts === null) return null
  return [volts === null ? null : fmtV(volts), watts === null ? null : fmtW(watts)].filter(Boolean).join(', ')
}

export function pvPathsToWatch (devices) {
  const paths = new Set()
  for (const d of devices) {
    if (d.status === 'removed') continue
    for (const k of ['pvVoltagePath', 'pvPowerPath']) if (d[k]) paths.add(strip(d[k]))
  }
  return [...paths].sort()
}
