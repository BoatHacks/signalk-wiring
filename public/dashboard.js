// The pure part of the Dashboard (plan 0038): statistics, the failed checks
// overview, live power in and out, battery cards and the switches that are on.
// No browser, no Preact: the page is public/dashboardView.js and the tests are
// test/dashboard.test.mjs. Nothing here decides anything new: the verdicts come
// from the cable and bus checks, the figures from the load summary, the banks
// from the server; this file only counts, sums and orders them.

import { hashForState } from './router.js'
import { checkAll, countVerdicts, lengthMetres, isNonPower } from './cableChecks.js'
import { effectiveCableRoute } from './floorplan.js'
import { loadFigures } from './measured.js'
import { allBanks, bankTitle } from './batteries.js'
import { stateFromValue } from './live.js'
import { batteryInputs, bankReadingInput, formatDuration, STALE_MS } from './liveBattery.js'
import { deviceBox } from './schematic.js'
import { findOverlaps } from './schematicLayout.js'

export { STALE_MS }

export const WORST_CABLES = 5
export const WORST_BUSES = 3
export const DEFAULT_BANK_VOLTS = 12

const CHARGER_TYPE = /solar|mppt|alternator|charger|dc-dc|dc\/dc/i
const PROTECTOR_TYPE = /fuse|breaker/i
const VERDICT_RANK = { fail: 0, warning: 1, cannot: 2, ok: 3 }

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const active = (r) => r && r.status !== 'removed'
const stripSelf = (path) => String(path || '').replace(/^vessels\.self\./, '')
const roleOf = (d) => d.role || 'consumer'
const numberOf = (v) => {
  const x = v !== null && typeof v === 'object' && 'value' in v ? v.value : v
  return finite(x) ? x : null
}
const nameOf = (device, id) => (device && device.name) || id

// ---- Placement ----

const hasPosition = (d) => d.posX != null || d.posY != null || d.posZ != null

// Is the device drawn on a floorplan: placed itself, or inside an enclosure
// (at any depth) that is.
export function onFloorplan (device, deviceById) {
  const seen = new Set()
  for (let d = device; d && !seen.has(d.id); d = deviceById.get(d.parentId)) {
    seen.add(d.id)
    if (hasPosition(d)) return true
    if (!d.parentId) return false
  }
  return false
}

// The ids of the devices drawn on some active schematic page, with whatever
// sits inside an enclosure that is drawn (an enclosure stands for its contents).
export function schematicPlaced (devices, schematics) {
  const byId = new Map(devices.map((d) => [d.id, d]))
  const direct = new Set()
  for (const s of schematics || []) {
    if (!active(s)) continue
    for (const p of s.devices || []) direct.add(p.deviceId)
  }
  const out = new Set()
  for (const d of devices) {
    const seen = new Set()
    for (let at = d; at && !seen.has(at.id); at = byId.get(at.parentId)) {
      seen.add(at.id)
      if (direct.has(at.id)) { out.add(d.id); break }
      if (!at.parentId) break
    }
  }
  return out
}

// The circuits that carry a cable, supply or return side, by the derived ids
// (the same ones the cable check uses).
function circuitsForCable (cable, circuits) {
  return circuits.filter((c) => (c.derived.cableIds || []).includes(cable.id) || (c.derived.returnCableIds || []).includes(cable.id))
}

// ---- Statistics ----

// How long a cable is and where the figure comes from: the recorded length, else
// the one measured along its drawn route (waypoints, else its conduits), else none.
export function cableLengthOf (cable, devicesById, conduitsById) {
  const recorded = lengthMetres(cable.length, cable.lengthUnit)
  if (recorded !== null) return { metres: recorded, source: 'recorded' }
  const route = effectiveCableRoute(cable, null, devicesById, conduitsById)
  if (route.source !== 'none' && route.length > 0) return { metres: route.length, source: 'measured' }
  return { metres: null, source: 'none' }
}

// Installed battery capacity over all banks. A bank's energy is its own figure
// when the server has one, else its capacity at the bank voltage, else at 12 V
// (counted in `assumed12`, so the page can say so). A bank with no capacity is
// counted in `unknown`.
export function batteryTotals (banks) {
  let ah = 0
  let wh = 0
  let assumed12 = 0
  let unknown = 0
  for (const b of banks) {
    if (!finite(b.capacityAh)) { unknown++; continue }
    ah += b.capacityAh
    if (finite(b.energyWh)) wh += b.energyWh
    else if (finite(b.voltage)) wh += b.capacityAh * b.voltage
    else { wh += b.capacityAh * DEFAULT_BANK_VOLTS; assumed12++ }
  }
  return { banks: banks.length, ah, wh, assumed12, unknown }
}

const share = (n, of) => (of > 0 ? n / of : null)

// Everything the Statistics card shows, from the resource lists.
//   data: { devices, cables, circuits, conduits, zones, schematics, plans, backbones, banks }
export function dashboardStats (data) {
  const devices = (data.devices || []).filter(active)
  const cables = (data.cables || []).filter(active)
  const circuits = (data.circuits || []).filter((c) => active(c) && c.derived)
  const conduits = (data.conduits || []).filter(active)
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const conduitById = new Map(conduits.map((c) => [c.id, c]))

  const byRole = {}
  for (const d of devices) byRole[roleOf(d)] = (byRole[roleOf(d)] || 0) + 1

  const length = { totalM: 0, recorded: 0, measured: 0, none: 0 }
  for (const c of cables) {
    const l = cableLengthOf(c, deviceById, conduitById)
    if (l.source === 'none') length.none++
    else { length.totalM += l.metres; length[l.source]++ }
  }

  const unprotected = circuits.filter((c) => c.derived.unprotected).length

  // The sum of every consumer once, at its measured peak or its rating. The
  // Load Summary shows the same figures per circuit, where a device that
  // feeds two circuits counts on both.
  let ratedW = 0
  let unrated = 0
  for (const d of devices) {
    if (roleOf(d) !== 'consumer') continue
    const f = loadFigures(d)
    if (f.source === null) unrated++
    else ratedW += f.peakW
  }

  const power = cables.filter((c) => !isNonPower(c))
  const circuitsOf = (cable) => circuitsForCable(cable, circuits)
  const noVoltage = (cable) => !circuitsOf(cable).some((c) => finite(c.derived.voltage) && c.derived.voltage > 0)
  const protectorsNoRating = devices.filter((d) => PROTECTOR_TYPE.test(d.type || '') && !finite(d.tripRatingA)).length

  const onSchematic = schematicPlaced(devices, data.schematics)
  const floorplanCount = devices.filter((d) => onFloorplan(d, deviceById)).length
  const schematicCount = devices.filter((d) => onSchematic.has(d.id)).length

  return {
    devices: { total: devices.length, byRole },
    cables: cables.length,
    circuits: circuits.length,
    conduits: conduits.length,
    zones: (data.zones || []).length,
    schematics: (data.schematics || []).filter(active).length,
    floorplans: (data.plans || []).filter(active).length,
    backbones: (data.backbones || []).filter(active).length,
    cableLength: length,
    protection: { protected: circuits.length - unprotected, unprotected },
    battery: batteryTotals(allBanks(devices, data.banks || [])),
    consumerLoad: { watts: ratedW, unrated },
    completeness: {
      cablesNoGauge: power.filter((c) => !finite(Number(c.gauge)) || c.gauge === null || c.gauge === '').length,
      cablesNoLength: cables.filter((c) => lengthMetres(c.length, c.lengthUnit) === null).length,
      cablesNoVoltage: power.filter(noVoltage).length,
      consumersUnrated: unrated,
      protectorsNoRating,
      onFloorplan: { count: floorplanCount, of: devices.length, share: share(floorplanCount, devices.length) },
      onSchematic: { count: schematicCount, of: devices.length, share: share(schematicCount, devices.length) }
    }
  }
}

// ---- Failed checks ----

const cableLabel = (cable, deviceById) =>
  cable.cableLabel || `${nameOf(deviceById.get(cable.fromDeviceId), '?')} to ${nameOf(deviceById.get(cable.toDeviceId), '?')}`

// The place a cable's record is shown: its circuit, else the Cables tab.
function cableHref (cable, circuits) {
  const c = circuitsForCable(cable, circuits)[0]
  return c ? hashForState({ tab: 'circuits', id: c.id }) : hashForState({ tab: 'cables' })
}

function verdictText (result) {
  if (result.verdict === 'cannot') return 'cannot check'
  const parts = []
  if (result.ampacity && result.ampacity.verdict === 'fail') parts.push('too small')
  if (result.drop && result.drop.verdict === 'warning') parts.push('high voltage drop')
  return parts.join(', ') || result.verdict
}

// What needs attention, advisory only.
//   data: { devices, cables, circuits, conduits, schematics, limits, buses }
//   buses: the answer of GET /buses (or null)
export function dashboardChecks (data) {
  const devices = (data.devices || []).filter(active)
  const cables = (data.cables || []).filter(active)
  const circuits = (data.circuits || []).filter((c) => active(c) && c.derived)
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const results = checkAll({ cables, circuits, devices, conduits: data.conduits, limits: data.limits })
  const counts = countVerdicts(results)

  const worstCables = cables
    .filter((c) => results.has(c.id) && results.get(c.id).verdict !== 'ok')
    .map((c) => ({ c, r: results.get(c.id), label: cableLabel(c, deviceById) }))
    .sort((a, b) => VERDICT_RANK[a.r.verdict] - VERDICT_RANK[b.r.verdict] || a.label.localeCompare(b.label))
    .slice(0, WORST_CABLES)
    .map(({ c, r, label }) => ({ id: c.id, label, verdict: r.verdict, text: verdictText(r), href: cableHref(c, circuits) }))

  const busList = (data.buses && data.buses.buses) || []
  const busCounts = { ok: 0, warning: 0, fail: 0, cannot: 0 }
  for (const b of busList) if (busCounts[b.verdict] !== undefined) busCounts[b.verdict]++
  const worstBuses = busList
    .filter((b) => b.verdict !== 'ok')
    .sort((a, b) => (VERDICT_RANK[a.verdict] ?? 4) - (VERDICT_RANK[b.verdict] ?? 4) || a.name.localeCompare(b.name))
    .slice(0, WORST_BUSES)
    .map((b) => ({ id: b.id, name: b.name, verdict: b.verdict, href: hashForState({ tab: 'buses', id: b.id }) }))

  const unprotected = circuits
    .filter((c) => c.derived.unprotected)
    .map((c) => ({ id: c.id, name: c.name, href: hashForState({ tab: 'circuits', id: c.id }) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const inCircuit = new Set()
  for (const c of circuits) for (const id of [...(c.derived.cableIds || []), ...(c.derived.returnCableIds || [])]) inCircuit.add(id)
  const noCircuit = cables
    .filter((c) => !isNonPower(c) && !inCircuit.has(c.id))
    .map((c) => ({ id: c.id, label: cableLabel(c, deviceById), href: hashForState({ tab: 'cables' }) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const onSchematic = schematicPlaced(devices, data.schematics)
  const unplaced = devices
    .filter((d) => !onFloorplan(d, deviceById) && !onSchematic.has(d.id))
    .map((d) => ({ id: d.id, name: d.name, href: hashForState({ tab: 'devices', id: d.id }) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const overlaps = []
  for (const s of (data.schematics || []).filter(active)) {
    const boxes = (s.devices || [])
      .map((p) => ({ device: deviceById.get(p.deviceId), p }))
      .filter(({ device }) => device)
      .map(({ device, p }) => deviceBox(device, { x: p.x, y: p.y }))
    const n = findOverlaps(boxes).length
    if (n > 0) overlaps.push({ id: s.id, name: s.name, pairs: n, href: hashForState({ tab: 'schematics', id: s.id }) })
  }
  overlaps.sort((a, b) => a.name.localeCompare(b.name))

  const attention = counts.fail + counts.warning + counts.cannot + busCounts.fail + busCounts.warning + busCounts.cannot +
    unprotected.length + noCircuit.length + unplaced.length + overlaps.length
  return { cables: counts, worstCables, buses: busCounts, worstBuses, unprotected, noCircuit, unplaced, overlaps, attention }
}

// ---- Live readings ----

// One reading as watts. `read(path)` gives { value, at } or null.
//   status: 'ok' (counted), 'stale' (older than a minute), 'nodata' (nothing
//   yet), 'novoltage' (amps with no voltage to turn them into watts)
function readingWatts ({ path, unit, voltage, voltagePath }, values, stamps, now) {
  const fresh = (p) => {
    const at = stamps.get(p)
    return !(typeof at === 'number' && now - at > STALE_MS)
  }
  const p = stripSelf(path)
  const raw = numberOf(values.get(p))
  if (raw === null) return { status: 'nodata', watts: null, raw: null }
  const stale = !fresh(p)
  const magnitude = Math.abs(raw)
  if (unit === 'W') return { status: stale ? 'stale' : 'ok', watts: magnitude, raw: magnitude }
  let volts = null
  let voltsStale = false
  if (voltagePath) {
    const vp = stripSelf(voltagePath)
    const v = numberOf(values.get(vp))
    if (v !== null && v > 0) { volts = v; voltsStale = !fresh(vp) }
  }
  if (volts === null && finite(voltage) && voltage > 0) volts = voltage
  if (volts === null) return { status: 'novoltage', watts: null, raw: magnitude }
  return { status: stale || voltsStale ? 'stale' : 'ok', watts: magnitude * volts, raw: magnitude }
}

function sumSide (entries) {
  const counted = entries.filter((e) => e.status === 'ok')
  return {
    entries,
    counted: counted.length,
    totalW: counted.length > 0 ? counted.reduce((s, e) => s + e.watts, 0) : null
  }
}

// A configured side: the entries in the order entered.
export function configuredSide (list, values, stamps = new Map(), now = Date.now()) {
  const entries = list.map((e) => ({
    label: e.label, path: stripSelf(e.path), unit: e.unit, source: 'configured',
    ...readingWatts(e, values, stamps, now)
  }))
  return { mode: 'configured', notMetered: [], ...sumSide(entries) }
}

// Sources that feed power in: the source role, and converters that charge.
export function isChargingSource (device) {
  const role = roleOf(device)
  return role === 'source' || (role === 'converter' && CHARGER_TYPE.test(device.type || ''))
}

// The automatic input: each source or charging converter once, by its meter.
// A device with no meter is listed as not metered, never guessed. Two devices
// that name the same meter path are one reading.
export function autoInputSide (devices, values, stamps = new Map(), now = Date.now()) {
  const entries = []
  const notMetered = []
  const seen = new Set()
  const sources = devices.filter((d) => active(d) && isChargingSource(d)).sort((a, b) => nameOf(a, a.id).localeCompare(nameOf(b, b.id)))
  for (const d of sources) {
    if (!d.meterPath) { notMetered.push({ deviceId: d.id, label: d.name }); continue }
    const path = stripSelf(d.meterPath)
    if (seen.has(path)) continue
    seen.add(path)
    const volts = finite(d.nominalVoltage) ? d.nominalVoltage : finite(d.ratedDcV) ? d.ratedDcV : null
    entries.push({
      label: d.name, path, unit: d.meterUnit === 'W' ? 'W' : 'A', source: 'device', deviceId: d.id,
      ...readingWatts({ path, unit: d.meterUnit === 'W' ? 'W' : 'A', voltage: volts }, values, stamps, now)
    })
  }
  return { mode: 'auto', notMetered, ...sumSide(entries) }
}

// The automatic output: the first trustworthy meter of every consumer, each
// meter path once. A meter that sits upstream measures every consumer behind
// it. When one chosen meter's consumers are all covered by another chosen,
// outer meter, the inner one is already inside that reading and is left out,
// so the same flow is never added twice.
//   live: the answer of GET /live;  circuits: the circuit resources (names)
export function autoOutputSide (live, devices, circuits, values, stamps = new Map(), now = Date.now()) {
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const circuitById = new Map((circuits || []).map((c) => [c.id, c]))
  const consumers = (live && live.consumers) || {}
  const trusted = (c) => (c.meters || []).filter((m) => !m.lowConfidence)

  // meter path -> the consumers that list it among their trustworthy meters
  const covers = new Map()
  for (const [id, c] of Object.entries(consumers)) {
    for (const m of trusted(c)) {
      const p = stripSelf(m.path)
      if (!covers.has(p)) covers.set(p, new Set())
      covers.get(p).add(id)
    }
  }

  const chosen = new Map() // path -> { meter, consumerId, consumerIds: Set }
  const notMetered = []
  for (const id of Object.keys(consumers).sort()) {
    const d = deviceById.get(id)
    if (!d || !active(d)) continue
    const meter = trusted(consumers[id])[0]
    if (!meter) { notMetered.push({ deviceId: id, label: d.name }); continue }
    const p = stripSelf(meter.path)
    if (!chosen.has(p)) chosen.set(p, { meter, consumerId: id, consumerIds: new Set() })
    chosen.get(p).consumerIds.add(id)
  }

  const paths = [...chosen.keys()].sort()
  const subset = (a, b) => [...a].every((x) => b.has(x))
  const kept = paths.filter((q) => !paths.some((p) => {
    if (p === q) return false
    const cq = chosen.get(q).consumerIds
    const cp = covers.get(p)
    if (!subset(cq, cp)) return false
    const strict = cp.size > cq.size || !subset(cp, covers.get(q) || new Set())
    // an equal pair: the path that sorts first stays
    return strict || p < q
  }))

  const entries = kept.map((p) => {
    const { meter, consumerId, consumerIds } = chosen.get(p)
    const owner = meter.deviceId ? deviceById.get(meter.deviceId) : null
    const circuit = meter.circuitId ? circuitById.get(meter.circuitId) : null
    const first = deviceById.get(consumerId)
    const label = owner ? owner.name : circuit ? circuit.name : first ? first.name : p
    const unit = meter.unit === 'W' ? 'W' : 'A'
    const c = consumers[consumerId]
    const volts = finite(c.voltage) ? c.voltage : owner && finite(owner.nominalVoltage) ? owner.nominalVoltage : null
    return {
      label, path: p, unit, source: 'device', deviceId: meter.deviceId || consumerId, consumers: consumerIds.size,
      ...readingWatts({ path: p, unit, voltage: volts }, values, stamps, now)
    }
  })
  return { mode: 'auto', notMetered, ...sumSide(entries) }
}

// ---- Battery cards ----

const firstPath = (bank, paths, key) => {
  const p = bank.batteryIds.map((id) => paths[id] && paths[id][key]).find(Boolean)
  return p ? stripSelf(p) : null
}

// One card per bank: the numbers of the first battery that has each metric
// (the same rule as the Batteries tab). `net` is the sum over banks of
// current times voltage, positive when power flows out of the batteries
// (the SignalK sign); banks that share one current path count once and stale
// banks are left out.
export function batteryCards (devices, banks, live, values, stamps = new Map(), now = Date.now()) {
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const paths = (live && live.batteries) || {}
  const cards = []
  const usedCurrent = new Set()
  let netW = 0
  let netCount = 0
  for (const bank of allBanks(devices, banks || [])) {
    const inputs = bank.batteryIds.map((id) => batteryInputs(paths[id], values, stamps, now)).filter(Boolean)
    const r = bankReadingInput(inputs)
    const hasData = [r.voltage, r.soc, r.current, r.timeRemaining].some(finite)
    cards.push({
      key: bank.batteryIds.join('+'),
      deviceId: bank.batteryIds[0],
      title: bankTitle(bank, deviceById),
      voltage: finite(r.voltage) ? r.voltage : null,
      soc: finite(r.soc) ? Math.min(1, Math.max(0, r.soc)) : null,
      current: finite(r.current) ? r.current : null,
      timeRemaining: finite(r.timeRemaining) && r.timeRemaining >= 0 ? r.timeRemaining : null,
      timeText: finite(r.timeRemaining) ? formatDuration(r.timeRemaining) : null,
      stale: Boolean(r.stale),
      hasData,
      socPath: firstPath(bank, paths, 'socPath'),
      voltagePath: firstPath(bank, paths, 'voltagePath'),
      href: hashForState({ tab: 'batteries' })
    })
    if (finite(r.current) && finite(r.voltage) && !r.stale) {
      const source = bank.batteryIds.map((id) => paths[id] && paths[id].currentPath).find(Boolean)
      const key = source ? stripSelf(source) : bank.batteryIds.join('+')
      if (!usedCurrent.has(key)) {
        usedCurrent.add(key)
        netW += r.current * r.voltage
        netCount++
      }
    }
  }
  return { cards, netW: netCount > 0 ? netW : null }
}

// ---- Switches that are on ----

// The switchable consumers that are on now, each with the switch that feeds
// it, plus how many are off or unknown. Read only: the Dashboard sends nothing.
export function switchesOn (live, values, devices) {
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const on = []
  let off = 0
  let unknown = 0
  const consumers = (live && live.consumers) || {}
  const switches = (live && live.switches) || {}
  for (const [id, c] of Object.entries(consumers)) {
    if (!c.switchable || !c.switchDeviceId) continue
    const sw = switches[c.switchDeviceId]
    const state = sw ? stateFromValue(values.get(stripSelf(sw.switchPath))) : null
    if (state === true) {
      on.push({
        id, name: nameOf(deviceById.get(id), id),
        via: c.switchDeviceId !== id ? nameOf(deviceById.get(c.switchDeviceId), c.switchDeviceId) : null,
        href: hashForState({ tab: 'devices', id })
      })
    } else if (state === false) off++
    else unknown++
  }
  on.sort((a, b) => a.name.localeCompare(b.name))
  return { on, off, unknown }
}

// ---- Which paths the page needs ----

// Every SignalK path the Dashboard reads, for the one shared subscription:
// the configured entries and their voltage paths, the device meters, the
// battery paths and the switch states.
export function dashboardPaths ({ settings, live, devices }) {
  const paths = new Set()
  const entries = [...(settings.dashboardInputs || []), ...(settings.dashboardOutputs || [])]
  for (const e of entries) {
    paths.add(stripSelf(e.path))
    if (e.voltagePath) paths.add(stripSelf(e.voltagePath))
  }
  if (live) {
    for (const sw of Object.values(live.switches || {})) if (sw.switchPath) paths.add(stripSelf(sw.switchPath))
    for (const c of Object.values(live.consumers || {})) {
      for (const m of c.meters || []) if (!m.lowConfidence) paths.add(stripSelf(m.path))
    }
    for (const b of Object.values(live.batteries || {})) {
      for (const k of ['voltagePath', 'currentPath', 'socPath', 'timeRemainingPath']) if (b[k]) paths.add(stripSelf(b[k]))
    }
  }
  for (const d of devices || []) if (active(d) && isChargingSource(d) && d.meterPath) paths.add(stripSelf(d.meterPath))
  return [...paths].sort()
}

// The two sides of the live power card: the configured list when a side has
// entries, else the automatic rule.
export function liveFlows ({ settings, live, devices, circuits, values, stamps, now }) {
  const devs = (devices || []).filter(active)
  const inputs = (settings.dashboardInputs || []).length > 0
    ? configuredSide(settings.dashboardInputs, values, stamps, now)
    : autoInputSide(devs, values, stamps, now)
  const outputs = (settings.dashboardOutputs || []).length > 0
    ? configuredSide(settings.dashboardOutputs, values, stamps, now)
    : autoOutputSide(live, devs, circuits, values, stamps, now)
  return { inputs, outputs }
}

// The paths whose last hour is drawn as a sparkline: every entry of both
// sides and the charge of each battery bank, once each.
export function historyPaths (flows, cards) {
  const paths = []
  for (const side of [flows.inputs, flows.outputs]) for (const e of side.entries) paths.push(e.path)
  for (const c of cards) if (c.socPath) paths.push(c.socPath)
  return [...new Set(paths)]
}

// ---- Text ----

// Watts as short text: whole watts, kilowatts from 1000 W.
export function formatWatts (w) {
  if (!finite(w)) return null
  const v = Math.abs(w)
  if (v >= 1000) return `${(Math.round(v / 100) / 10).toFixed(1)} kW`
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} W`
}

// Metres as "1.2 km" from 1000 m, else whole metres from 100, else one decimal.
export function formatMetres (m) {
  if (!finite(m)) return null
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toFixed(1)} km`
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10} m`
}

export const percentText = (fraction) => (finite(fraction) ? `${Math.round(fraction * 100)} %` : '-')

// What a battery net flow means in words.
export function netText (netW) {
  if (!finite(netW)) return null
  if (Math.abs(netW) < 1) return 'balanced'
  return `${netW > 0 ? 'discharging' : 'charging'} ${formatWatts(netW)}`
}
