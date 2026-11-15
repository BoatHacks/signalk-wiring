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

  const voltage = derived.voltage || null
  const rating = derived.ratingA || null
  const amps = voltage ? totalVa / voltage : null
  const overRating = amps != null && rating != null && amps > rating

  return {
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
  if (load.missingVoltage) parts.push('No voltage: set the nominal voltage on the supply')
  if (load.missingRating) parts.push('No rating: set the trip rating of the fuse or breaker')
  return parts.length ? parts.join('. ') : null
}

