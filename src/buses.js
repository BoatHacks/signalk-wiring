'use strict'

// NMEA 2000 buses (plan 0037): what a backbone and its taps imply, the
// advisory checks, and the load a bus puts on the circuit that feeds it. Pure:
// no database, so it is cheap to test with small boats (test/buses.test.js).
// The web app reads the results from GET /buses instead of keeping a copy.
//
// Input shapes are the resource shapes (camelCase):
//   backbone: { id, name, cableClass, length, lengthUnit, terminatorA,
//               terminatorB, supplyRatingA, status,
//               taps: [{ deviceId, port, dropLength (m), along, powerFeed,
//                        fedFromDeviceId }] }
//   device:   { id, name, status, len, ratedPowerW }
// The limits are in busLimits.json with their sources; docs/bus-checks.md
// explains them.

const LIMITS = require('./busLimits.json')

const TO_METRES = { m: 1, ft: 0.3048, in: 0.0254, cm: 0.01, mm: 0.001 }
const ADVISORY_NOTE = 'Advisory, not a guarantee. These are planning figures from manufacturers\' public guides; the bus manufacturer\'s own instructions and your installer decide.'
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const round = (v, digits = 3) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits)

// A length in meters, or null when it is missing or its unit is unknown.
function toMetres (value, unit) {
  if (!isNumber(value)) return null
  const factor = unit ? TO_METRES[String(unit).trim().toLowerCase()] : 1
  return factor === undefined ? null : value * factor
}

function liveDevices (devices) {
  return new Map((devices || []).filter((d) => d.status !== 'removed').map((d) => [d.id, d]))
}

// Everything worked out about one backbone. `circuits` (derived circuits) is
// optional; with it the circuit the power feed joins is named.
function deriveBus (backbone, devices, circuits) {
  const live = liveDevices(devices)
  const taps = (backbone.taps || [])
    .filter((t) => live.has(t.deviceId))
    .map((t) => {
      const d = live.get(t.deviceId)
      return {
        deviceId: t.deviceId,
        deviceName: d.name,
        port: t.port ?? null,
        dropLengthM: isNumber(t.dropLength) ? t.dropLength : null,
        along: isNumber(t.along) ? t.along : null,
        len: isNumber(d.len) ? d.len : null,
        ratedPowerW: isNumber(d.ratedPowerW) ? d.ratedPowerW : null,
        powerFeed: Boolean(t.powerFeed),
        fedFromDeviceId: t.fedFromDeviceId ?? null
      }
    })
  const deviceIds = [...new Set(taps.map((t) => t.deviceId))].sort(byString)
  const unique = deviceIds.map((id) => live.get(id))
  const drops = taps.map((t) => t.dropLengthM).filter((v) => v !== null)
  const lens = unique.map((d) => (isNumber(d.len) ? d.len : null))
  const lenKnown = lens.filter((v) => v !== null)
  const lenTotal = lenKnown.reduce((a, b) => a + b, 0)
  const feedTap = taps.find((t) => t.powerFeed) || null
  const fedFrom = feedTap && live.get(feedTap.fedFromDeviceId)
  const circuit = feedTap && circuits ? circuitOfSource(circuits, feedTap.fedFromDeviceId) : null
  return {
    backboneId: backbone.id,
    name: backbone.name,
    cableClass: backbone.cableClass || null,
    lengthM: toMetres(backbone.length, backbone.lengthUnit),
    lengthUnit: backbone.lengthUnit || null,
    supplyRatingA: isNumber(backbone.supplyRatingA) ? backbone.supplyRatingA : null,
    taps,
    deviceIds,
    deviceCount: deviceIds.length,
    totalDropM: drops.reduce((a, b) => a + b, 0),
    longestDropM: drops.length > 0 ? Math.max(...drops) : null,
    dropsMissing: taps.filter((t) => t.dropLengthM === null).map((t) => t.deviceId),
    terminatorCount: (backbone.terminatorA ? 1 : 0) + (backbone.terminatorB ? 1 : 0),
    lenTotal: lenKnown.length > 0 ? lenTotal : null,
    lenUnknownDeviceIds: deviceIds.filter((id, i) => lens[i] === null),
    impliedCurrentA: lenKnown.length > 0 ? round(lenTotal * LIMITS.lenCurrentA) : null,
    powerFeed: feedTap
      ? { deviceId: feedTap.deviceId, deviceName: feedTap.deviceName, fedFromDeviceId: feedTap.fedFromDeviceId, fedFromName: fedFrom ? fedFrom.name : null }
      : null,
    circuit: circuit ? { key: circuit.key, protectorId: circuit.protectorId } : null
  }
}

// The circuit a power source or protector belongs to: the one it protects,
// else one it supplies, else one it sits in. Sorted by key, so the same data
// always gives the same answer. null when none.
function circuitOfSource (circuits, deviceId) {
  const sorted = [...circuits].sort((a, b) => byString(a.key, b.key))
  return sorted.find((c) => c.protectorId === deviceId) ||
    sorted.find((c) => (c.supplyDeviceIds || []).includes(deviceId)) ||
    sorted.find((c) => (c.deviceIds || []).includes(deviceId)) || null
}

// What the bus draws from the circuit that feeds it. A device with a LEN
// counts LEN x 0.05 A (turned into watts with the circuit voltage by
// busWatts); one without counts its rated power; one with neither is unknown.
function busLoad (backbone, devices) {
  const bus = deriveBus(backbone, devices)
  const live = liveDevices(devices)
  let fallbackWatts = 0
  let fallbackCount = 0
  let unknownCount = 0
  for (const id of bus.deviceIds) {
    const d = live.get(id)
    if (isNumber(d.len)) continue
    if (isNumber(d.ratedPowerW)) { fallbackWatts += d.ratedPowerW; fallbackCount++ } else unknownCount++
  }
  const lenCount = bus.deviceCount - fallbackCount - unknownCount
  return {
    backboneId: backbone.id,
    name: backbone.name,
    lenTotal: bus.lenTotal,
    lenCurrentA: bus.lenTotal === null ? 0 : round(bus.lenTotal * LIMITS.lenCurrentA, 6),
    fallbackWatts,
    lenCount,
    fallbackCount,
    unknownCount,
    fromBus: true
  }
}

// The watts of bus loads at a circuit voltage (12 V when the circuit has none).
function busWatts (busLoads, voltage) {
  const v = voltage > 0 ? voltage : LIMITS.defaultBusVoltageV
  return (busLoads || []).reduce((sum, b) => sum + b.lenCurrentA * v + b.fallbackWatts, 0)
}

// Puts the load of each powered bus on the circuit its power feed joins:
// `busLoads` on that circuit. Circuits no bus feeds are returned as they were.
function attachBusLoads (circuits, backbones, devices) {
  const live = liveDevices(devices)
  const added = new Map()
  for (const bb of [...(backbones || [])].sort((a, b) => byString(a.id, b.id))) {
    if (bb.status === 'removed') continue
    const feed = (bb.taps || []).find((t) => t.powerFeed && live.has(t.deviceId) && live.has(t.fedFromDeviceId))
    if (!feed) continue
    const circuit = circuitOfSource(circuits, feed.fedFromDeviceId)
    if (!circuit) continue
    if (!added.has(circuit.key)) added.set(circuit.key, [])
    added.get(circuit.key).push(busLoad(bb, devices))
  }
  if (added.size === 0) return circuits
  return circuits.map((c) => (added.has(c.key) ? { ...c, busLoads: added.get(c.key) } : c))
}

// ---- Checks ---------------------------------------------------------------

const RANK = { fail: 3, warning: 2, cannot: 1, ok: 0 }
const sourcesOf = (ids) => ids.map((id) => ({ id, ...LIMITS.sources[id] }))
const names = (bus, ids) => ids.map((id) => (bus.taps.find((t) => t.deviceId === id) || {}).deviceName || id).join(', ')
const needs = (list) => list.join(' and ')
const fmt = (n) => String(round(n, 2))

function result (id, title, verdict, used, reasoning, sourceIds, missing = []) {
  return { id, title, verdict, used, missing, reasoning, sources: sourcesOf(sourceIds) }
}

function checkBus (backbone, devices) {
  const bus = deriveBus(backbone, devices)
  const warn = LIMITS.warnFraction
  const checks = []

  // 1. Backbone length for its cable class.
  {
    const missing = []
    if (!bus.cableClass) missing.push('cable class')
    else if (LIMITS.backboneLengthM[bus.cableClass] === undefined) missing.push('a known cable class')
    if (bus.lengthM === null) missing.push('backbone length')
    const limit = LIMITS.backboneLengthM[bus.cableClass]
    const used = { lengthM: bus.lengthM === null ? null : round(bus.lengthM), limitM: limit ?? null, cableClass: bus.cableClass }
    if (missing.length > 0) {
      checks.push(result('length', 'Backbone length', 'cannot', used, [`Not checked: needs ${needs(missing)}.`], LIMITS.backboneLengthSources, missing))
    } else {
      const v = bus.lengthM > limit ? 'fail' : bus.lengthM >= warn * limit ? 'warning' : 'ok'
      checks.push(result('length', 'Backbone length', v, used, [
        `Backbone ${fmt(bus.lengthM)} m, limit ${limit} m for ${bus.cableClass} cable.`,
        v === 'fail' ? 'Longer than the limit.' : v === 'warning' ? `Within ${Math.round((1 - warn) * 100)} % of the limit.` : 'Within the limit.',
        LIMITS.backboneLengthNote
      ], LIMITS.backboneLengthSources))
    }
  }

  // 2. Each drop at most the drop limit. A drop over the limit fails even when
  // other drops are unmeasured.
  {
    const lim = LIMITS.dropLengthM
    const over = bus.taps.filter((t) => t.dropLengthM !== null && t.dropLengthM > lim)
    const used = { longestDropM: bus.longestDropM === null ? null : round(bus.longestDropM), limitM: lim, tooLong: over.map((t) => t.deviceId) }
    if (over.length > 0) {
      checks.push(result('drop', 'Each drop', 'fail', used, [`Longer than ${lim} m: ${over.map((t) => `${t.deviceName} ${fmt(t.dropLengthM)} m`).join(', ')}.`], LIMITS.dropLengthSources))
    } else if (bus.dropsMissing.length > 0) {
      checks.push(result('drop', 'Each drop', 'cannot', used, [`Not checked: needs the drop length of ${names(bus, bus.dropsMissing)}.`], LIMITS.dropLengthSources, ['drop length']))
    } else {
      checks.push(result('drop', 'Each drop', 'ok', used, [bus.taps.length === 0 ? 'No drops.' : `Longest drop ${fmt(bus.longestDropM)} m, limit ${lim} m.`], LIMITS.dropLengthSources))
    }
  }

  // 3. All drops together.
  {
    const lim = LIMITS.totalDropLengthM
    const used = { totalDropM: round(bus.totalDropM), limitM: lim, missingDrops: bus.dropsMissing.length }
    const lines = [`Drops add up to ${fmt(bus.totalDropM)} m, limit ${lim} m.`, LIMITS.totalDropLengthNote]
    if (bus.totalDropM > lim) checks.push(result('drops-total', 'All drops together', 'fail', used, lines, LIMITS.totalDropLengthSources))
    else if (bus.dropsMissing.length > 0) {
      checks.push(result('drops-total', 'All drops together', 'cannot', used, [`Not checked: needs the drop length of ${names(bus, bus.dropsMissing)}. The known drops add up to ${fmt(bus.totalDropM)} m.`], LIMITS.totalDropLengthSources, ['drop length']))
    } else checks.push(result('drops-total', 'All drops together', bus.totalDropM >= warn * lim ? 'warning' : 'ok', used, lines, LIMITS.totalDropLengthSources))
  }

  // 4. Device count.
  {
    const lim = LIMITS.maxDevices
    const v = bus.deviceCount > lim ? 'fail' : bus.deviceCount >= warn * lim ? 'warning' : 'ok'
    checks.push(result('devices', 'Number of devices', v, { deviceCount: bus.deviceCount, limit: lim }, [`${bus.deviceCount} device${bus.deviceCount === 1 ? '' : 's'}, limit ${lim}.`], LIMITS.maxDevicesSources))
  }

  // 5. Exactly two terminators.
  {
    const n = bus.terminatorCount
    checks.push(result('terminators', 'Terminators', n === LIMITS.terminators ? 'ok' : 'fail', { terminatorCount: n, required: LIMITS.terminators }, [
      `${n} terminator${n === 1 ? '' : 's'} marked, ${LIMITS.terminators} needed, one at each end.`
    ], LIMITS.terminatorSources))
  }

  // 6. LEN total against the supply rating.
  {
    const missing = []
    if (bus.supplyRatingA === null) missing.push('supply rating')
    if (bus.lenTotal === null) missing.push('LEN of the devices')
    else if (bus.lenUnknownDeviceIds.length > 0) missing.push(`LEN of ${names(bus, bus.lenUnknownDeviceIds)}`)
    const used = { lenTotal: bus.lenTotal, impliedCurrentA: bus.impliedCurrentA, supplyRatingA: bus.supplyRatingA, lenCurrentA: LIMITS.lenCurrentA, supplyCurrentA: LIMITS.supplyCurrentA }
    const sources = [...LIMITS.lenCurrentSources, ...LIMITS.supplyCurrentSources]
    const cur = bus.impliedCurrentA
    const lines = cur === null ? [] : [`LEN total ${fmt(bus.lenTotal)}, so ${fmt(bus.lenTotal)} x ${LIMITS.lenCurrentA} A = ${fmt(cur)} A.`]
    // More than the rating fails even when some LEN is unknown: the known part is a lower bound.
    if (cur !== null && bus.supplyRatingA !== null && cur > bus.supplyRatingA) {
      checks.push(result('len', 'Bus load against the supply', 'fail', used, [...lines, `More than the supply rating of ${fmt(bus.supplyRatingA)} A.`], sources))
    } else if (missing.length > 0) {
      checks.push(result('len', 'Bus load against the supply', 'cannot', used, [`Not checked: needs ${needs(missing)}.`, ...lines], sources, missing))
    } else if (cur >= warn * bus.supplyRatingA || (cur > LIMITS.supplyCurrentA && bus.supplyRatingA > LIMITS.supplyCurrentA)) {
      checks.push(result('len', 'Bus load against the supply', 'warning', used, [...lines, `Supply rating ${fmt(bus.supplyRatingA)} A.`, `Close to the rating, or above the ${LIMITS.supplyCurrentA} A (${Math.round(LIMITS.supplyCurrentA / LIMITS.lenCurrentA)} LEN) figure of the lowest guide. ${LIMITS.supplyCurrentNote}`], sources))
    } else {
      checks.push(result('len', 'Bus load against the supply', 'ok', used, [...lines, `Supply rating ${fmt(bus.supplyRatingA)} A.`], sources))
    }
  }

  // 7. A power feed.
  {
    const ok = bus.powerFeed !== null
    checks.push(result('power-feed', 'Power feed', ok ? 'ok' : 'fail', { powerFeed: bus.powerFeed }, [
      ok ? `Fed at ${bus.powerFeed.deviceName} from ${bus.powerFeed.fedFromName || 'a source'}.` : 'No tap is marked as the power feed: the bus has no supply.'
    ], ['actisense-fundamentals']))
  }

  const verdict = checks.reduce((w, c) => (RANK[c.verdict] > RANK[w] ? c.verdict : w), 'ok')
  return {
    backboneId: backbone.id,
    verdict,
    checks,
    assumptions: [
      `1 LEN is ${LIMITS.lenCurrentA * 1000} mA; a device without a LEN counts as unknown.`,
      'Drop lengths are in meters. Where sources disagree the lower figure is used.',
      `A figure within ${Math.round((1 - warn) * 100)} % of its limit is a warning.`
    ],
    note: ADVISORY_NOTE
  }
}

// One entry per live backbone: the record, what is derived from it and its checks.
function describeBuses (backbones, devices, circuits) {
  return (backbones || []).filter((b) => b.status !== 'removed').sort((a, b) => byString(a.id, b.id)).map((b) => {
    const check = checkBus(b, devices)
    return { id: b.id, name: b.name, derived: deriveBus(b, devices, circuits), verdict: check.verdict, checks: check.checks, assumptions: check.assumptions, note: check.note }
  })
}

module.exports = { LIMITS, ADVISORY_NOTE, toMetres, deriveBus, checkBus, describeBuses, busLoad, busWatts, attachBusLoads, circuitOfSource }
