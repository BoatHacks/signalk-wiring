// The cable checks (plan 0034, issue #10): is a cable big enough for the fuse
// or breaker that protects it and for its load, and is the voltage drop along
// it acceptable. Pure and tested (test/cableChecks.test.mjs). The checks are
// advice, not a safety guarantee; docs/cable-checks.md has the table, its
// sources and the assumptions.
//
// A result is { verdict, ... } with the verdict one of
//   'ok', 'warning', 'fail', 'cannot' (something needed is missing) or
//   'exempt' (a cable whose conductors are all signal, data or earth: not checked).
// It carries the numbers used and where each came from, so the reasoning can
// be shown next to it.

import { AMPACITY_A, ASSUMPTIONS, DERATING, awgAreaMm2 } from './cableAmpacity.js'
import { normalizeUnit } from './gauge.js'
import { isCriticalType } from './deviceTypes.js'

export const DEFAULT_LIMITS = { critical: 3, normal: 10 }
const POWER = new Set(['positive', 'negative', 'line', 'neutral'])
const FEET_TO_M = 0.3048

// The conductor types of a cable; none listed is a single positive conductor.
function conductorTypes (cable) {
  const list = (cable.conductors || []).map((c) => c.conductor)
  return list.length === 0 ? ['positive'] : list
}

// A cable whose conductors are all signal or data is not checked at all.
export function isSignalOnly (cable) {
  const types = (cable.conductors || []).map((c) => c.conductor)
  return types.length > 0 && types.every((t) => t === 'signal')
}

// A cable with no current-carrying conductor (signal, data and antenna cables,
// earth-only cables, or a mix of those) is not checked at all: nothing to size
// and no voltage drop that matters.
export function isNonPower (cable) {
  const types = (cable.conductors || []).map((c) => c.conductor)
  return types.length > 0 && types.every((t) => t === 'signal' || t === 'earth')
}

// Current-carrying conductors of a cable: positive, negative, AC line and
// neutral. Earth and signal conductors carry no load current.
export function powerConductorCount (cable) {
  return conductorTypes(cable).filter((t) => POWER.has(t)).length
}

// How many current-carrying conductors the cable shares a bundle with: its own
// plus those of every other live cable in any conduit it passes through. Only
// conduits are known to the app; a cable with none counts its own.
export function bundleCount (cable, cables, conduits) {
  const mine = new Set(cable.conduitIds || [])
  const mates = new Map([[cable.id, cable]])
  for (const conduit of conduits || []) {
    if (conduit.status === 'removed' || !mine.has(conduit.id)) continue
    for (const id of conduit.cableIds || []) {
      const other = (cables || []).find((c) => c.id === id)
      if (other && other.status !== 'removed') mates.set(id, other)
    }
  }
  let count = 0
  for (const c of mates.values()) count += powerConductorCount(c)
  return Math.max(1, count)
}

// The multiplier for n current-carrying conductors in one bundle.
export function deratingFactor (n) {
  return DERATING.find((row) => n <= row.upTo).factor
}

// { baseA, areaMm2 } for a gauge and unit, or null when the table has no such
// size (including an unknown unit).
export function ampacityFor (gauge, unit) {
  const u = normalizeUnit(unit)
  const n = Number(gauge)
  if (gauge === '' || gauge === null || gauge === undefined || !Number.isFinite(n) || !u) return null
  const baseA = AMPACITY_A[u][String(n)]
  if (baseA === undefined) return null
  const areaMm2 = u === 'AWG' ? awgAreaMm2(n) : n
  return { baseA, areaMm2 }
}

// Resistivity of the conductor at the operating temperature, ohm mm2 per m.
export function resistivity () {
  const { rho20OhmMm2PerM, tempCoefficientPerK, operatingC } = ASSUMPTIONS
  return rho20OhmMm2PerM * (1 + tempCoefficientPerK * (operatingC - 20))
}

export function lengthMetres (length, unit) {
  const n = Number(length)
  if (length === '' || length === null || length === undefined || !Number.isFinite(n) || n <= 0) return null
  return String(unit || '').trim().toLowerCase() === 'ft' ? n * FEET_TO_M : n
}

// The cables a circuit covers on the positive side and on the return side.
export function circuitsForCable (cable, circuits) {
  return (circuits || []).filter((c) =>
    (c.cableIds || []).includes(cable.id) || (c.returnCableIds || []).includes(cable.id))
}

// What the check needs to know about a circuit, from a derived circuit
// resource ({ id, name, derived: { ratingA, voltage, ac, endDeviceIds,
// deviceIds } }), the devices by id and, optionally, live measured amps per
// circuit id. ratedA is the summed rated power over the voltage, null when the
// voltage is unknown or any consumer has no rated power (a partial sum would
// understate the load). On AC a consumer's power factor turns watts into
// volt-amperes; the circuit's powerFactor is the highest one set (1 if none),
// which is the one that gives the larger drop (a consumer with none set counts as 1).
export function circuitInput (circuit, deviceById, liveAmpsByCircuit) {
  const d = circuit.derived || {}
  const ac = Boolean(d.ac)
  const voltage = d.voltage > 0 ? d.voltage : null
  let va = 0
  let unrated = 0
  let measuredPeakW = 0
  let measured = false
  let powerFactor = 0
  for (const id of d.endDeviceIds || []) {
    const device = deviceById.get(id)
    if (!device || device.status !== 'active' || (device.role && device.role !== 'consumer')) continue
    const pf = ac && device.powerFactor > 0 && device.powerFactor <= 1 ? device.powerFactor : 1
    powerFactor = Math.max(powerFactor, pf)
    if (device.ratedPowerW != null) va += device.ratedPowerW / pf
    else unrated++
    if (device.measured && device.measured.peakW != null) { measured = true; measuredPeakW += device.measured.peakW }
  }
  const live = liveAmpsByCircuit && liveAmpsByCircuit.get ? liveAmpsByCircuit.get(circuit.id) : null
  let measuredA = null
  if (voltage && measured) measuredA = measuredPeakW / voltage
  if (live != null && Number.isFinite(live)) measuredA = Math.max(measuredA ?? 0, live)
  return {
    id: circuit.id,
    name: circuit.name || circuit.id,
    ratingA: d.ratingA > 0 ? d.ratingA : null,
    voltage,
    ac,
    critical: (d.deviceIds || []).some((id) => {
      const device = deviceById.get(id)
      return Boolean(device) && device.status !== 'removed' && isCriticalType(device.type)
    }),
    ratedA: voltage && unrated === 0 && va > 0 ? va / voltage : null,
    measuredA,
    powerFactor: ac && powerFactor > 0 ? powerFactor : 1
  }
}

// Combines the circuits a cable serves. A return cable shared by several
// circuits carries all of them, so currents and ratings add.
function combine (circuits) {
  const sum = (list) => (list.every((v) => v !== null) ? list.reduce((a, b) => a + b, 0) : null)
  const ratings = circuits.map((c) => c.ratingA)
  const voltages = circuits.map((c) => c.voltage).filter((v) => v !== null)
  const measured = circuits.map((c) => c.measuredA).filter((v) => v !== null)
  return {
    names: circuits.map((c) => c.name),
    ratingA: sum(ratings),
    ratedA: sum(circuits.map((c) => c.ratedA)),
    measuredA: measured.length > 0 ? measured.reduce((a, b) => a + b, 0) : null,
    voltage: voltages.length > 0 ? Math.min(...voltages) : null,
    ac: circuits.some((c) => c.ac),
    critical: circuits.some((c) => c.critical),
    powerFactor: Math.max(...circuits.map((c) => c.powerFactor || 1))
  }
}

// The load current to use, and where it came from. The base is the rated power
// over the voltage, else the rating of the protecting fuse or breaker (the
// worst case). A measured value can only raise it: a snapshot taken while a
// load is off would otherwise hide an overload. { amps, source } with source
// 'measured', 'rated power', 'protection rating' or null.
export function chooseCurrent ({ measuredA, ratedA, ratingA }) {
  let amps = null
  let source = null
  if (ratedA != null) { amps = ratedA; source = 'rated power' } else if (ratingA != null) { amps = ratingA; source = 'protection rating' }
  if (measuredA != null && (amps === null || measuredA > amps)) { amps = measuredA; source = 'measured' }
  return { amps, source }
}

// The ampacity checks, or the reasons they cannot be made.
function ampacityCheck (table, factor, count, c) {
  const missing = []
  if (!table) missing.push('gauge')
  if (!c) missing.push('circuit')
  else if (c.ratingA === null && c.ratedA === null && c.measuredA === null) missing.push('fuse or breaker rating or rated load')
  if (missing.length > 0) return { verdict: 'cannot', missing }
  const deratedA = table.baseA * factor
  // The load the cable is checked against: a known load, not the protection
  // rating used as a stand-in (that is check 1 already).
  const load = chooseCurrent({ measuredA: c.measuredA, ratedA: c.ratedA, ratingA: null })
  const issues = []
  if (c.ratingA !== null && c.ratingA > deratedA) issues.push('protection')
  if (load.amps !== null && load.amps > deratedA) issues.push('load')
  return {
    verdict: issues.length > 0 ? 'fail' : 'ok',
    issues,
    baseA: table.baseA,
    deratingFactor: factor,
    conductorCount: count,
    deratedA,
    protectionA: c.ratingA,
    loadA: load.amps,
    loadSource: load.source,
    missing: []
  }
}

function dropCheck (table, lengthM, c, limits) {
  const missing = []
  if (!table) missing.push('gauge')
  if (lengthM === null) missing.push('length')
  if (!c) missing.push('circuit')
  else {
    if (c.voltage === null) missing.push('voltage')
    if (c.ratingA === null && c.ratedA === null && c.measuredA === null) missing.push('fuse or breaker rating or rated load')
  }
  if (missing.length > 0) return { verdict: 'cannot', missing }
  const current = chooseCurrent(c)
  const roundTripM = lengthM * 2
  const rho = resistivity()
  const resistanceOhm = rho * roundTripM / table.areaMm2
  const pf = c.ac ? c.powerFactor : 1
  const dropV = current.amps * resistanceOhm * pf
  const dropPercent = dropV / c.voltage * 100
  const limitKind = c.critical ? 'critical' : 'normal'
  const limitPercent = limits[limitKind]
  return {
    verdict: dropPercent > limitPercent ? 'warning' : 'ok',
    lengthM,
    roundTripM,
    areaMm2: table.areaMm2,
    rhoOhmMm2PerM: rho,
    resistanceOhm,
    currentA: current.amps,
    currentSource: current.source,
    ac: c.ac,
    powerFactor: pf,
    voltageV: c.voltage,
    dropV,
    dropPercent,
    limitPercent,
    limitKind,
    missing: []
  }
}

// Checks one cable.
//   cable: a wire run ({ id, gauge, gaugeUnit, length, lengthUnit, conductors, conduitIds })
//   ctx:   { circuits: the circuit inputs (see circuitInput) of the circuits
//            the cable serves, count: current-carrying conductors in its
//            bundle (bundleCount), limits: { critical, normal } in percent }
export function checkCable (cable, ctx = {}) {
  if (isNonPower(cable)) return { verdict: 'exempt', exempt: true, missing: [] }
  const limits = { ...DEFAULT_LIMITS, ...(ctx.limits || {}) }
  const circuits = ctx.circuits || []
  const c = circuits.length > 0 ? combine(circuits) : null
  const table = ampacityFor(cable.gauge, cable.gaugeUnit)
  const count = ctx.count || powerConductorCount(cable) || 1
  const factor = deratingFactor(count)
  const lengthM = lengthMetres(cable.length, cable.lengthUnit)

  const ampacity = ampacityCheck(table, factor, count, c)
  const drop = dropCheck(table, lengthM, c, limits)
  const made = [ampacity, drop].filter((r) => r.verdict !== 'cannot')

  let verdict
  let missing
  if (made.length === 0) {
    verdict = 'cannot'
    missing = [...new Set([...ampacity.missing, ...drop.missing])]
  } else {
    verdict = made.some((r) => r.verdict === 'fail') ? 'fail' : made.some((r) => r.verdict === 'warning') ? 'warning' : 'ok'
    missing = [...new Set([...ampacity.missing, ...drop.missing])]
  }
  return {
    verdict,
    exempt: false,
    missing,
    ampacity,
    drop,
    circuits: c ? c.names : [],
    assumptions: { ...ASSUMPTIONS, limits }
  }
}

// Checks every live cable. Returns a Map of cable id to result, exempt cables
// left out (nothing is shown for them).
//   cables, circuits (derived circuit resources), devices, conduits: the lists
//   limits: { critical, normal } percent; liveAmps: optional Map of circuit id
//   to measured amps from the live values the page already has.
export function checkAll ({ cables, circuits, devices, conduits, limits, liveAmps }) {
  const deviceById = new Map((devices || []).map((d) => [d.id, d]))
  const inputs = (circuits || [])
    .filter((c) => c.status === 'active' && c.derived)
    .map((c) => ({ circuit: c, input: circuitInput(c, deviceById, liveAmps) }))
  const results = new Map()
  for (const cable of cables || []) {
    if (cable.status === 'removed') continue
    const mine = inputs
      .filter(({ circuit }) => (circuit.derived.cableIds || []).includes(cable.id) ||
        (circuit.derived.returnCableIds || []).includes(cable.id))
      .map(({ input }) => input)
    const result = checkCable(cable, { circuits: mine, count: bundleCount(cable, cables, conduits), limits })
    if (!result.exempt) results.set(cable.id, result)
  }
  return results
}

// Counts of each verdict over a results map.
export function countVerdicts (results) {
  const counts = { ok: 0, warning: 0, fail: 0, cannot: 0 }
  for (const r of results.values()) if (counts[r.verdict] !== undefined) counts[r.verdict]++
  return counts
}

// The short badge words for a result: 'cable too small', 'voltage drop high'
// and a muted 'cannot check: needs ...' naming what is missing.
export function badgesFor (result) {
  if (!result || result.verdict === 'exempt') return []
  const out = []
  if (result.ampacity && result.ampacity.verdict === 'fail') out.push({ kind: 'fail', text: 'cable too small' })
  if (result.drop && result.drop.verdict === 'warning') out.push({ kind: 'warning', text: 'voltage drop high' })
  if (result.missing.length > 0) {
    out.push({ kind: 'cannot', text: `cannot check: needs ${joinNeeds(result.missing)}` })
  } else if (out.length === 0) {
    out.push({ kind: 'ok', text: 'checks ok' })
  }
  return out
}

function joinNeeds (list) {
  if (list.length <= 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

// The marks of a schematic wire: its result when it is a warning or a fail,
// with the one-line reason for hover or tap; null otherwise.
export function wireMark (result) {
  if (!result || (result.verdict !== 'warning' && result.verdict !== 'fail')) return null
  const reasons = []
  if (result.ampacity && result.ampacity.verdict === 'fail') {
    const a = result.ampacity
    const why = []
    if (a.issues.includes('protection')) why.push(`the ${fmt(a.protectionA)} A fuse or breaker is more than the cable can carry`)
    if (a.issues.includes('load')) why.push(`the load of ${fmt(a.loadA)} A is more than the cable can carry`)
    reasons.push(`Cable too small for ${fmt(a.deratedA)} A: ${why.join(' and ')}`)
  }
  if (result.drop && result.drop.verdict === 'warning') {
    const d = result.drop
    reasons.push(`Voltage drop ${d.dropPercent.toFixed(1)} % is over the ${d.limitKind} limit of ${d.limitPercent} %`)
  }
  return { verdict: result.verdict, text: `${reasons.join('. ')}. Advisory only.` }
}

const fmt = (n) => (Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10))
export { fmt as formatNumber }

// ---- Live current, the reasoning text and the schematic mark position ----

// Measured amps per circuit id from what the Live view already has: the first
// trustworthy meter of each consumer a circuit ends at (amps as they are,
// watts over the circuit voltage). Only circuits with at least one reading are
// in the map. A circuit with some consumers unmetered gives the readings that
// exist, which can only be a low estimate; the check only lets a measured
// figure raise the current, so that is the safe direction.
//   live: the answer of GET /live ({ consumers });  values: Map of SignalK path
//   (without vessels.self.) to value;  circuits: derived circuit resources.
export function liveAmpsByCircuit (circuits, live, values) {
  const out = new Map()
  if (!live || !live.consumers || !values) return out
  const strip = (path) => String(path || '').replace(/^vessels\.self\./, '')
  for (const circuit of circuits || []) {
    const d = circuit.derived
    if (!d) continue
    let amps = 0
    let any = false
    for (const id of d.endDeviceIds || []) {
      const consumer = live.consumers[id]
      const meter = consumer && (consumer.meters || []).find((m) => !m.lowConfidence)
      if (!meter) continue
      const v = values.get(strip(meter.path))
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (meter.unit === 'W') {
        if (!(d.voltage > 0)) continue
        amps += Math.abs(v) / d.voltage
      } else amps += Math.abs(v)
      any = true
    }
    if (any) out.set(circuit.id, amps)
  }
  return out
}

// The point halfway along a path (a list of { x, y }), by length; null for a
// path of fewer than two points.
export function pathMidpoint (path) {
  if (!path || path.length < 2) return null
  let total = 0
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  if (total === 0) return { x: path[0].x, y: path[0].y }
  let left = total / 2
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    if (left <= seg && seg > 0) {
      const t = left / seg
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }
    }
    left -= seg
  }
  const last = path[path.length - 1]
  return { x: last.x, y: last.y }
}

export const ADVISORY_NOTE = 'Advisory only. This is not a safety guarantee: check the cable against the maker\'s data and the rules that apply to your boat.'
export const TABLE_URL = 'https://github.com/BoatHacks/signalk-wiring/blob/main/docs/cable-checks.md'

const SOURCE_TEXT = {
  measured: 'measured',
  'rated power': 'rated power of the consumers over the circuit voltage',
  'protection rating': 'rating of the protecting fuse or breaker, as the worst case'
}

// The reasoning for a result as plain lines: { heading, lines } sections, the
// assumptions and the advisory note. Everything the verdict rests on is named
// with where it came from.
export function explain (result) {
  if (!result || result.exempt) return null
  const sections = []
  const a = result.ampacity
  if (a) {
    const lines = []
    if (a.verdict === 'cannot') lines.push(`Not checked: needs ${joinNeeds(a.missing)}.`)
    else {
      lines.push(`Table figure ${fmt(a.baseA)} A (our table, copper, 105 C insulation, 30 C ambient).`)
      lines.push(`${a.conductorCount} current-carrying conductor${a.conductorCount === 1 ? '' : 's'} in the bundle: factor ${a.deratingFactor}, so ${fmt(a.deratedA)} A allowed.`)
      if (a.protectionA !== null) {
        lines.push(`Fuse or breaker: ${fmt(a.protectionA)} A (protection rating). ${a.issues.includes('protection') ? 'More than the cable can carry.' : 'Within what the cable can carry.'}`)
      }
      if (a.loadA !== null) {
        lines.push(`Load: ${fmt(a.loadA)} A (${SOURCE_TEXT[a.loadSource]}). ${a.issues.includes('load') ? 'More than the cable can carry.' : 'Within what the cable can carry.'}`)
      }
    }
    sections.push({ heading: 'Cable size', verdict: a.verdict, lines })
  }
  const d = result.drop
  if (d) {
    const lines = []
    if (d.verdict === 'cannot') lines.push(`Not checked: needs ${joinNeeds(d.missing)}.`)
    else {
      lines.push(`Length ${fmt(d.lengthM)} m, round trip ${fmt(d.roundTripM)} m (feed plus return), ${fmt(d.areaMm2)} mm2 copper at ${result.assumptions.operatingC} C: ${(d.resistanceOhm).toPrecision(3)} ohm.`)
      lines.push(`Current ${fmt(d.currentA)} A (${SOURCE_TEXT[d.currentSource]}).${d.ac ? ` AC, power factor ${d.powerFactor}.` : ''}`)
      lines.push(`Voltage ${fmt(d.voltageV)} V (nominal voltage of the circuit).`)
      lines.push(`Drop ${d.dropV.toFixed(2)} V, ${d.dropPercent.toFixed(1)} % of the voltage, against the ${d.limitKind} limit of ${d.limitPercent} %${d.limitKind === 'critical' ? ' (the circuit has a critical device)' : ''}.`)
    }
    sections.push({ heading: 'Voltage drop', verdict: d.verdict, lines })
  }
  const as = result.assumptions
  const assumptions = [
    `${as.material}, ${as.insulationC} C insulation, ${as.ambientC} C ambient for the whole boat.`,
    'Each cable is checked alone, its return taken as the same size and length.',
    'A measured current can only raise the figure used.'
  ]
  return { sections, assumptions, note: ADVISORY_NOTE, circuits: result.circuits }
}
