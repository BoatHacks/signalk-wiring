'use strict'

// Battery banks (plan 0020), derived from the storage devices and the cables
// between them. Pure: no store, no clock. A cable between two storage devices
// joins them; its link type says how: series (batteries in a string) or
// parallel (strings side by side, the default for a cable with no link).
// Only series strings in parallel can be reduced; anything else is reported
// as a warning and gets no totals.

const { deriveCircuits } = require('./circuits')

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sum = (list) => list.reduce((a, b) => a + b, 0)
const unique = (list) => [...new Set(list)].sort(byString)

function deriveBanks ({ devices = [], cables = [], circuits } = {}) {
  const live = new Map(devices.filter((d) => d.status !== 'removed' && d.role === 'storage').map((d) => [d.id, d]))
  const links = cables
    .filter((c) => c.status !== 'removed' && c.fromDeviceId !== c.toDeviceId &&
      live.has(c.fromDeviceId) && live.has(c.toDeviceId))
    .sort((a, b) => byString(a.id, b.id))
  const circuitList = circuits || deriveCircuits({ devices, cables }).circuits

  // Group the batteries that are joined by any link.
  const parent = new Map([...live.keys()].map((id) => [id, id]))
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x }
  for (const c of links) {
    const a = find(c.fromDeviceId); const b = find(c.toDeviceId)
    if (a !== b) parent.set(b, a)
  }
  const groups = new Map()
  for (const id of [...live.keys()].sort(byString)) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, { ids: [], cables: [] })
    groups.get(root).ids.push(id)
  }
  for (const c of links) groups.get(find(c.fromDeviceId)).cables.push(c)

  return [...groups.values()]
    .map((g) => buildBank(g.ids, g.cables, live, circuitList))
    .sort((a, b) => byString(a.batteryIds[0], b.batteryIds[0]))
}

// Series chains and the parallel joins between them, or null when the links
// do not make series strings in parallel.
function reduceToStrings (ids, cables) {
  const series = new Map(ids.map((id) => [id, new Set()]))
  const parallel = []
  const seriesPairs = new Set()
  const parallelPairs = new Set()
  const pair = (c) => [c.fromDeviceId, c.toDeviceId].sort(byString).join('\n')
  for (const c of cables) {
    if (c.link === 'series') {
      series.get(c.fromDeviceId).add(c.toDeviceId)
      series.get(c.toDeviceId).add(c.fromDeviceId)
      seriesPairs.add(pair(c))
    } else {
      parallel.push(c)
      parallelPairs.add(pair(c))
    }
  }
  // The same two batteries joined both ways cannot be reduced.
  for (const p of seriesPairs) if (parallelPairs.has(p)) return null
  // A branch: a battery in series with more than two others.
  for (const set of series.values()) if (set.size > 2) return null

  const seen = new Set()
  const strings = []
  const walk = (start) => {
    const chain = [start]
    seen.add(start)
    let prev = null
    let at = start
    for (;;) {
      const next = [...series.get(at)].filter((n) => n !== prev).sort(byString)[0]
      if (next === undefined) return chain
      if (seen.has(next)) return null // a series cycle
      chain.push(next)
      seen.add(next)
      prev = at
      at = next
    }
  }
  // Chains start at an end (one series neighbour or none), lowest id first.
  for (const id of ids) {
    if (seen.has(id) || series.get(id).size > 1) continue
    const chain = walk(id)
    if (!chain) return null
    // Read the chain from its lower-id end.
    if (chain.length > 1 && byString(chain[chain.length - 1], chain[0]) < 0) chain.reverse()
    strings.push(chain)
  }
  if (seen.size !== ids.length) return null // what remains is a cycle
  strings.sort((a, b) => byString(a[0], b[0]))
  const stringOf = new Map()
  strings.forEach((s, i) => s.forEach((id) => stringOf.set(id, i)))
  // A parallel link inside one string cannot be reduced.
  for (const c of parallel) if (stringOf.get(c.fromDeviceId) === stringOf.get(c.toDeviceId)) return null
  return strings
}

function buildBank (ids, cables, live, circuitList) {
  const members = ids.map((id) => live.get(id))
  const warnings = []
  const strings = reduceToStrings(ids, cables)
  const idSet = new Set(ids)

  const chemistries = unique(members.map((d) => d.chemistry).filter(Boolean))
  if (chemistries.length > 1) {
    warnings.push({ code: 'mixed-chemistries', message: `Mixed chemistries in one bank: ${chemistries.join(', ')}.` })
  }
  for (const c of cables) {
    if (c.link === 'series') continue
    const a = num(live.get(c.fromDeviceId).nominalVoltage)
    const b = num(live.get(c.toDeviceId).nominalVoltage)
    if (a !== null && b !== null && a !== b) {
      warnings.push({
        code: 'parallel-voltage-mismatch',
        cableId: c.id,
        message: `A parallel link joins batteries of different voltage (${a} V and ${b} V).`
      })
    }
  }

  const missing = []
  for (const d of members) {
    const fields = []
    if (num(d.capacityAh) === null) fields.push('capacityAh')
    if (num(d.nominalVoltage) === null) fields.push('nominalVoltage')
    if (fields.length) missing.push({ deviceId: d.id, fields })
  }

  const bank = {
    batteryIds: ids,
    cableIds: cables.map((c) => c.id).sort(byString),
    strings: strings || [],
    layout: null,
    voltage: null,
    capacityAh: null,
    usableAh: null,
    energyWh: null,
    usableEnergyWh: null,
    complete: missing.length === 0 && strings !== null,
    missing,
    chemistries,
    monitorDeviceIds: unique(members.map((d) => d.monitorDeviceId).filter(Boolean)),
    protectedBy: unique(circuitList
      .filter((c) => c.protectorId && (c.supplyDeviceIds || []).some((id) => idSet.has(id)))
      .map((c) => c.protectorId)),
    warnings
  }

  if (!strings) {
    warnings.push({
      code: 'not-reducible',
      message: 'These links do not make series strings in parallel (a cycle, a branch or a mixed link), so no totals are given.'
    })
    return bank
  }

  const lengths = unique(strings.map((s) => s.length))
  if (lengths.length === 1) {
    bank.layout = { series: strings[0].length, parallel: strings.length, label: `${strings[0].length}S${strings.length}P` }
  } else {
    warnings.push({ code: 'uneven-strings', message: 'The strings have different numbers of batteries.' })
  }

  // A string's voltage needs every nominal voltage in it; its capacity is its
  // weakest known battery. Unknown values are left out, never made up.
  const volts = strings.map((s) => {
    const v = s.map((id) => num(live.get(id).nominalVoltage))
    return v.every((x) => x !== null) ? sum(v) : null
  }).filter((v) => v !== null)
  if (volts.length) {
    bank.voltage = Math.min(...volts)
    if (new Set(volts).size > 1) {
      warnings.push({ code: 'strings-differ-in-voltage', message: `The strings differ in voltage (${unique(volts.map(String)).join(' V, ')} V).` })
    }
  }
  const caps = strings.map((s) => {
    const c = s.map((id) => num(live.get(id).capacityAh)).filter((x) => x !== null)
    return c.length ? Math.min(...c) : null
  }).filter((c) => c !== null)
  if (caps.length) bank.capacityAh = sum(caps)
  const fractions = members.map((d) => num(d.usableFraction)).filter((x) => x !== null)
  if (bank.capacityAh !== null && fractions.length) bank.usableAh = bank.capacityAh * Math.min(...fractions)
  if (bank.voltage !== null && bank.capacityAh !== null) bank.energyWh = bank.voltage * bank.capacityAh
  if (bank.voltage !== null && bank.usableAh !== null) bank.usableEnergyWh = bank.voltage * bank.usableAh
  return bank
}

module.exports = { deriveBanks }
