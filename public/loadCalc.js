// The pure part of the Load Summary: the load of one circuit, the one line
// about the cable checks and what an incomplete circuit is missing. It lives
// apart from the page (loadSummary.js) so the server's query routes can use
// the very same code (src/query.js).

import { loadFigures } from './measured.js'

// Pure and unit-tested (test/loadSummary.test.mjs). Sums rated wattage
// across the consumers a derived circuit ends at (plan 0014), converts to
// amps with the circuit's voltage, and compares against the rating of the
// fuse or breaker that protects it. On an AC circuit a consumer's optional
// power factor turns its watts into volt-amperes first (a blank one counts
// as 1). Nulls propagate rather than being treated as zero: "unknown" and
// "definitely fine" are different answers a load check shouldn't blur.
//
// Known simplification: a device's full rated wattage is attributed to
// *every* circuit that feeds it, even though in reality it draws from at
// most one at a time in most cases (e.g. a primary/backup-fed device).
// Correct handling needs per-cable power, which isn't data this plugin
// collects. `LoadSummary`'s own UI states this, not just this comment.
// The watts of the bus loads of a circuit (src/buses.js has the same sum).
export function busWattsOf (busLoads, voltage) {
  const v = voltage > 0 ? voltage : 12
  return busLoads.reduce((sum, b) => sum + b.lenCurrentA * v + b.fallbackWatts, 0)
}

export function calculateCircuitLoad (circuit, deviceById) {
  const derived = circuit.derived || { endDeviceIds: [], deviceIds: [], ac: false, ratingA: null, voltage: null }
  const ac = Boolean(derived.ac)

  const seenDeviceIds = new Set()
  const seenGroups = new Set()
  let totalWatts = 0
  let totalVa = 0
  let averageWatts = 0
  let knownDeviceCount = 0
  let unknownWattageCount = 0
  let measuredCount = 0
  let estimateCount = 0
  let groupCount = 0

  for (const id of derived.endDeviceIds) {
    const device = deviceById.get(id)
    if (!device || device.status !== 'active' || seenDeviceIds.has(device.id)) continue
    // Only consumers draw from the circuit; sources, storage, switches and
    // converters sit on it without adding load of their own.
    if (device.role && device.role !== 'consumer') continue
    seenDeviceIds.add(device.id)
    knownDeviceCount++
    // A device with an accepted calibration run counts at its measured peak
    // (the breaker check) and measured average (energy); any other at its
    // nameplate rating. A measured figure already includes the power factor,
    // so none is applied to it. A group figure, measured on a switch shared
    // by several consumers, covers all of them, so it is counted once.
    const figures = loadFigures(device)
    if (figures.source === null) {
      unknownWattageCount++
    } else if (figures.source === 'measured') {
      measuredCount++
      if (figures.estimate) estimateCount++
      if (figures.group) {
        const key = figures.group.switchDeviceId
        if (seenGroups.has(key)) continue
        seenGroups.add(key)
        groupCount++
      }
      totalWatts += figures.peakW
      totalVa += figures.peakW
      averageWatts += figures.avgW
    } else {
      totalWatts += figures.peakW
      const pf = ac && device.powerFactor > 0 && device.powerFactor <= 1 ? device.powerFactor : 1
      totalVa += figures.peakW / pf
      averageWatts += figures.avgW
    }
  }

  // Plan 0037: a powered NMEA 2000 bus adds its load here, LEN x 0.05 A at
  // the circuit voltage (12 V when none is known), devices without a LEN at
  // their rated power. A bus device with neither counts as unknown wattage.
  const busLoads = derived.busLoads || []
  const bus = busLoads.length > 0
    ? { busWatts: busWattsOf(busLoads, derived.voltage), busUnknownCount: busLoads.reduce((n, b) => n + b.unknownCount, 0), fromBus: true }
    : null
  if (bus) {
    totalWatts += bus.busWatts
    totalVa += bus.busWatts
    averageWatts += bus.busWatts
    unknownWattageCount += bus.busUnknownCount
  }

  const voltage = derived.voltage || null
  const rating = derived.ratingA || null
  const amps = voltage ? totalVa / voltage : null
  const overRating = amps != null && rating != null && amps > rating

  return {
    ...(bus || {}),
    deviceCount: knownDeviceCount,
    unknownWattageCount,
    totalWatts,
    averageWatts,
    measuredCount,
    estimateCount,
    groupCount,
    source: measuredCount === 0 ? 'rated' : measuredCount === knownDeviceCount - unknownWattageCount ? 'measured' : 'mixed',
    amps,
    overRating,
    missingVoltage: !voltage,
    // No supply found at all (the circuit is not wired back to a battery or a
    // source), as opposed to a supply that has no nominal voltage.
    missingSupply: !voltage && Array.isArray(derived.supplyDeviceIds) && derived.supplyDeviceIds.length === 0,
    // No fuse or breaker protects it, so there is no rating to set.
    unprotected: derived.unprotected === true,
    missingRating: rating == null,
    voltage,
    ratingA: rating,
    ac
  }
}

// The one line about the cable checks, or null when there is nothing to say:
// "Cable checks (advisory): 2 cables too small or with a high voltage drop,
// 3 cannot be checked, 9 ok." Counts come from countVerdicts().
export function checkSummaryLine (counts) {
  const total = counts.ok + counts.warning + counts.fail + counts.cannot
  if (total === 0) return null
  const parts = []
  if (counts.fail > 0) parts.push(`${counts.fail} too small`)
  if (counts.warning > 0) parts.push(`${counts.warning} with a high voltage drop`)
  if (counts.cannot > 0) parts.push(`${counts.cannot} cannot be checked yet`)
  parts.push(`${counts.ok} ok`)
  return `Cable checks (advisory): ${parts.join(', ')}.`
}

// What an "incomplete" circuit is missing and what to do about it, or null
// when nothing is. Shown as a line under the badge and as its tooltip.
export function incompleteReason (load) {
  const parts = []
  if (load.missingVoltage) {
    parts.push(load.missingSupply
      ? 'No supply: this circuit is not wired back to a battery or a source, so its voltage is unknown'
      : 'No voltage: set the nominal voltage on the supply')
  }
  if (load.missingRating) {
    parts.push(load.unprotected
      ? 'No fuse or breaker: nothing to compare the load with'
      : 'No rating: set the trip rating of the fuse or breaker')
  }
  return parts.length ? parts.join('. ') : null
}

// ---- The load behind a fuse (plan 0043) ----

const POSITIVE = new Set(['positive', 'line'])
const CHARGING_FEED = /solar|mppt|alternator|charger/i

function feedEnds (cable) {
  const conductor = (cable.conductors || []).find((c) => POSITIVE.has(c.conductor))
  return {
    from: (conductor && conductor.fromDeviceId) || cable.fromDeviceId,
    to: (conductor && conductor.toDeviceId) || cable.toDeviceId
  }
}

// For each circuit id, the ids of the circuits behind it, direct and further.
// Circuit B is directly behind circuit A when B's feed starts at a device that
// A's cables end at (a bus bar, a switch, a converter). A circuit fed only by a
// charging source (an alternator, a solar controller, a charger) has nothing
// behind it: its fuse limits what the source puts in, not what loads take out.
// `circuits` are the derived circuits, `cables` the cable records and
// `deviceById` a Map of devices.
export function circuitsBehind (circuits, cables, deviceById = new Map()) {
  const cableById = new Map(cables.map((c) => [c.id, c]))
  const ends = new Map()
  for (const circuit of circuits) {
    if (!circuit.derived) continue
    const from = new Set()
    const to = new Set()
    for (const id of circuit.derived.cableIds || []) {
      const cable = cableById.get(id)
      if (!cable || cable.status === 'removed') continue
      const e = feedEnds(cable)
      if (e.from) from.add(e.from)
      if (e.to) to.add(e.to)
    }
    const boundary = [...from].filter((d) => !to.has(d))
    const chargingOnly = boundary.length > 0 && boundary.every((id) => {
      const d = deviceById.get(id)
      return d && CHARGING_FEED.test(d.type || '')
    })
    ends.set(circuit.id, { to, boundary: new Set(boundary), chargingOnly })
  }
  const direct = new Map()
  for (const a of circuits) {
    const ea = ends.get(a.id)
    const next = []
    if (ea && !ea.chargingOnly) {
      for (const b of circuits) {
        if (b.id === a.id) continue
        const eb = ends.get(b.id)
        if (eb && [...eb.boundary].some((d) => ea.to.has(d))) next.push(b.id)
      }
    }
    direct.set(a.id, next)
  }
  const behind = new Map()
  for (const a of circuits) {
    const seen = new Set([a.id])
    const queue = [...(direct.get(a.id) || [])]
    const found = []
    while (queue.length > 0) {
      const id = queue.shift()
      if (seen.has(id)) continue
      seen.add(id)
      found.push(id)
      queue.push(...(direct.get(id) || []))
    }
    behind.set(a.id, found)
  }
  return behind
}

// The load of a circuit with everything behind it: one synthetic circuit with
// the consumers and bus loads of the circuit and of each circuit behind it, each
// device once, run through calculateCircuitLoad so the sum is made by the same
// function as an own total. Converter losses are not counted.
export function calculateBehindLoad (circuit, behindCircuits, deviceById) {
  const endDeviceIds = new Set(circuit.derived.endDeviceIds || [])
  const busLoads = []
  const busSeen = new Set()
  const addBus = (c) => {
    for (const b of (c.derived && c.derived.busLoads) || []) {
      const key = b.id || b.busId || JSON.stringify(b)
      if (busSeen.has(key)) continue
      busSeen.add(key)
      busLoads.push(b)
    }
  }
  addBus(circuit)
  for (const c of behindCircuits) {
    for (const id of (c.derived && c.derived.endDeviceIds) || []) endDeviceIds.add(id)
    addBus(c)
  }
  const load = calculateCircuitLoad({ ...circuit, derived: { ...circuit.derived, endDeviceIds: [...endDeviceIds], busLoads } }, deviceById)
  return { ...load, circuitCount: behindCircuits.length }
}

// Whether a row is a finding: over its rating on its own, over it with
// everything behind it, or incomplete.
export function loadFindings (load, behindLoad) {
  const overOwn = Boolean(load.overRating)
  const overBehind = Boolean(behindLoad && behindLoad.overRating && !load.overRating)
  return { overOwn, overBehind, over: overOwn || overBehind, incomplete: !overOwn && !overBehind && incompleteReason(load) !== null }
}

// "55 circuits: 0 over rating, 1 incomplete, 54 ok", from the findings of every
// circuit, shown or folded.
export function loadSummaryLine (findings) {
  const total = findings.length
  if (total === 0) return null
  const over = findings.filter((f) => f.over).length
  const incomplete = findings.filter((f) => f.incomplete).length
  return `${total} ${total === 1 ? 'circuit' : 'circuits'}: ${over} over rating, ${incomplete} incomplete, ${total - over - incomplete} ok`
}

// A circuit is shown when it has a consumer of its own or behind it (or a bus
// load), or a finding; the rest are folded.
export function isShownCircuit (load, behindLoad, finding) {
  const carries = (l) => Boolean(l) && (l.deviceCount > 0 || (l.busWatts || 0) > 0)
  return carries(load) || carries(behindLoad) || finding.over || finding.incomplete
}
