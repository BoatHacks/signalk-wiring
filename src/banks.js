'use strict'

// Battery banks (plan 0020), derived from the storage devices and the cables
// between them. Pure: no store, no clock. A cable between two storage devices
// joins them; its link type says how: series (batteries in a string) or
// parallel (strings side by side, the default for a cable with no link).
// Only series strings in parallel can be reduced; anything else is reported
// as a warning and gets no totals.

const { deriveCircuits } = require('./circuits')
const { reduceToStrings } = require('./seriesParallel')

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
    .map((g) => buildBank(g.ids, g.cables, live, circuitList, directProtectors(g.ids, cables, circuitList)))
    .sort((a, b) => byString(a.batteryIds[0], b.batteryIds[0]))
}

// The fuses and breakers that sit on a bank's own output: walking back from the
// protector along the positive cables reaches a battery of the bank before
// another protector. Every circuit further downstream (behind a main fuse, on a
// bus bar) also traces back to the battery, but it is protected by the main
// fuse, not by its own fuse as far as the bank is concerned.
const POSITIVE = new Set(['positive', 'line'])
function directProtectors (ids, cables, circuitList) {
  const idSet = new Set(ids)
  const protectors = new Set(circuitList.map((c) => c.protectorId).filter(Boolean))
  const feeders = new Map() // device id -> devices that feed it
  for (const cable of cables) {
    if (cable.status === 'removed' || cable.link === 'series' || cable.link === 'parallel') continue
    const conductor = (cable.conductors || []).find((c) => POSITIVE.has(c.conductor))
    if (!conductor) continue
    const from = conductor.fromDeviceId || cable.fromDeviceId
    const to = conductor.toDeviceId || cable.toDeviceId
    if (!feeders.has(to)) feeders.set(to, [])
    feeders.get(to).push(from)
  }
  const direct = new Set()
  for (const p of protectors) {
    const seen = new Set([p])
    const stack = [p]
    while (stack.length) {
      const node = stack.pop()
      for (const prev of feeders.get(node) || []) {
        if (seen.has(prev)) continue
        seen.add(prev)
        if (idSet.has(prev)) { direct.add(p); continue }
        if (protectors.has(prev)) continue
        stack.push(prev)
      }
    }
  }
  return direct
}

function buildBank (ids, cables, live, circuitList, direct) {
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
      .filter((c) => c.protectorId && direct.has(c.protectorId) && (c.supplyDeviceIds || []).some((id) => idSet.has(id)))
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
