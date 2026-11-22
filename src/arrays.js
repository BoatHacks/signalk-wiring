'use strict'

// Solar arrays (plan 0048), derived from the Solar panel devices and the cables
// between them. Pure: no store, no clock. A cable between two panels joins them;
// its link type says how: series (panels in a string) or parallel (strings side
// by side, the default for a cable with no link). Only series strings in
// parallel can be reduced; anything else is reported as a warning and gets no
// totals. The reduction is shared with the battery banks (src/seriesParallel.js).
//
// Input
//   devices: [{ id, name, type, role, status, ratedPowerW?, vocV?, iscA?, vmpV?,
//               impA?, vocTempCoeff?, pvMaxV?, pvMaxA?, pvMaxW? }]
//   cables:  [{ id, fromDeviceId, toDeviceId, status, link?, conductors? }]
//   coldTemperatureC: the lowest expected cell temperature (default -10)
//
// Output: one array per group of linked panels (a lone panel is an array of one):
//   { panelIds, cableIds, strings, layout, voc, vocCold, vmp, iscA, impA, powerW,
//     controllerIds, checks, missing, complete, assumedCoeff, coldTemperatureC,
//     warnings }
// Wording of the checks is advisory.

const { reduceToStrings, isSolarPanelType } = require('./seriesParallel')

const DEFAULT_COLD_C = -10
const ASSUMED_COEFF = -0.30 // % per degree C, used when a panel has none entered
const STC_C = 25
const NOTE_FROM = 0.9
const VMP_SPREAD = 0.05
const POSITIVE = new Set(['positive', 'line'])
const PASS_ROLES = new Set(['distribution', 'enclosure'])

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sum = (list) => list.reduce((a, b) => a + b, 0)
const unique = (list) => [...new Set(list)].sort(byString)
const round = (v, digits = 2) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits)
const fmt = (v, unit) => `${round(v, 1)} ${unit}`

const FIELD_OF = { vocV: 'vocV', iscA: 'iscA', vmpV: 'vmpV', impA: 'impA', ratedPowerW: 'ratedPowerW' }

function deriveArrays ({ devices = [], cables = [], coldTemperatureC } = {}) {
  const cold = typeof coldTemperatureC === 'number' && Number.isFinite(coldTemperatureC) ? coldTemperatureC : DEFAULT_COLD_C
  const live = new Map(devices.filter((d) => d.status !== 'removed' && isSolarPanelType(d.type)).map((d) => [d.id, d]))
  const allLive = new Map(devices.filter((d) => d.status !== 'removed').map((d) => [d.id, d]))
  const links = cables
    .filter((c) => c.status !== 'removed' && c.fromDeviceId !== c.toDeviceId &&
      live.has(c.fromDeviceId) && live.has(c.toDeviceId))
    .sort((a, b) => byString(a.id, b.id))

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

  const feeders = downstreamIndex(cables, live)
  return [...groups.values()]
    .map((g) => buildArray(g.ids, g.cables, live, allLive, feeders, cold))
    .sort((a, b) => byString(a.panelIds[0], b.panelIds[0]))
}

// device id -> the devices its positive conductors lead to, panel links left out.
function downstreamIndex (cables, panels) {
  const next = new Map()
  for (const cable of cables) {
    if (cable.status === 'removed') continue
    if (panels.has(cable.fromDeviceId) && panels.has(cable.toDeviceId)) continue
    const conductors = cable.conductors && cable.conductors.length > 0 ? cable.conductors : [{ conductor: 'positive' }]
    const conductor = conductors.find((c) => POSITIVE.has(c.conductor))
    if (!conductor) continue
    const from = conductor.fromDeviceId || cable.fromDeviceId
    const to = conductor.toDeviceId || cable.toDeviceId
    if (!next.has(from)) next.set(from, [])
    next.get(from).push(to)
  }
  return next
}

// The converters reached walking downstream from the panels through switches,
// breakers, fuses, bars and enclosures. A converter ends the walk.
function findControllers (ids, allLive, next) {
  const seen = new Set(ids)
  const stack = [...ids]
  const found = []
  while (stack.length) {
    const at = stack.pop()
    for (const to of next.get(at) || []) {
      if (seen.has(to)) continue
      seen.add(to)
      const d = allLive.get(to)
      if (!d) continue
      if (d.role === 'converter') found.push(to)
      else if (PASS_ROLES.has(d.role)) stack.push(to)
    }
  }
  return unique(found)
}

function buildArray (ids, cables, live, allLive, next, cold) {
  const members = ids.map((id) => live.get(id))
  const warnings = []
  const checks = []
  const strings = reduceToStrings(ids, cables)

  const missing = []
  for (const d of members) {
    const fields = Object.keys(FIELD_OF).filter((k) => num(d[k]) === null)
    if (fields.length) missing.push({ deviceId: d.id, fields })
  }
  const coeffOf = (d) => (num(d.vocTempCoeff) !== null ? d.vocTempCoeff : ASSUMED_COEFF)
  const assumedCoeff = members.some((d) => num(d.vocTempCoeff) === null)

  const array = {
    panelIds: ids,
    cableIds: cables.map((c) => c.id).sort(byString),
    strings: strings || [],
    layout: null,
    voc: null,
    vocCold: null,
    vmp: null,
    iscA: null,
    impA: null,
    powerW: null,
    controllerIds: findControllers(ids, allLive, next),
    coldTemperatureC: cold,
    assumedCoeff,
    complete: missing.length === 0 && strings !== null,
    missing,
    checks,
    warnings
  }

  if (!strings) {
    warnings.push({
      code: 'not-reducible',
      message: 'These links do not make series strings in parallel (a cycle, a branch or a mixed link), so no totals are given.'
    })
    return array
  }

  const lengths = unique(strings.map((s) => s.length))
  if (lengths.length === 1) {
    array.layout = { series: strings[0].length, parallel: strings.length, label: `${strings[0].length}S${strings.length}P` }
  } else {
    warnings.push({ code: 'uneven-strings', message: 'The strings have different numbers of panels.' })
  }

  // A string value needs the figure on every panel in it; unknown values are
  // left out, never made up. Voltages add up along a string, the current is
  // that of the weakest panel; strings in parallel add their currents.
  const along = (s, f) => { const v = s.map((id) => f(live.get(id))); return v.every((x) => x !== null) ? v : null }
  const stringVals = strings.map((s) => {
    const voc = along(s, (d) => num(d.vocV))
    const vmp = along(s, (d) => num(d.vmpV))
    const isc = along(s, (d) => num(d.iscA))
    const imp = along(s, (d) => num(d.impA))
    const pw = along(s, (d) => num(d.ratedPowerW))
    const vocCold = voc && along(s, (d) => num(d.vocV) * (1 + coeffOf(d) / 100 * (cold - STC_C)))
    return {
      voc: voc && sum(voc),
      vocCold: vocCold && sum(vocCold),
      vmp: vmp && sum(vmp),
      isc: isc && Math.min(...isc),
      imp: imp && Math.min(...imp),
      power: pw && sum(pw)
    }
  })
  const all = (key) => (stringVals.every((s) => s[key] !== null) ? stringVals.map((s) => s[key]) : null)
  const voc = all('voc'); const vocCold = all('vocCold'); const vmp = all('vmp')
  const isc = all('isc'); const imp = all('imp'); const power = all('power')
  if (voc) array.voc = round(Math.max(...voc))
  if (vocCold) array.vocCold = round(Math.max(...vocCold))
  if (vmp) array.vmp = round(Math.min(...vmp))
  if (isc) array.iscA = round(sum(isc))
  if (imp) array.impA = round(sum(imp))
  if (power) array.powerW = round(sum(power), 0)

  if (vmp && strings.length > 1 && (Math.max(...vmp) - Math.min(...vmp)) / Math.max(...vmp) > VMP_SPREAD) {
    checks.push({
      code: 'strings-differ-in-vmp',
      level: 'note',
      message: `The strings differ in voltage at maximum power (${unique(vmp.map((v) => String(round(v, 1)))).join(' V, ')} V), so the higher ones will be pulled down to the lowest.`
    })
  }

  if (array.controllerIds.length === 0) {
    checks.push({ code: 'no-controller', level: 'note', message: 'No charge controller found downstream of this array.' })
    return array
  }
  for (const id of array.controllerIds) {
    const c = allLive.get(id)
    const name = c.name || id
    const level = (value, limit) => (value > limit ? 'warning' : value >= limit * NOTE_FROM ? 'note' : 'ok')
    const limit = (code, field, value, label) => {
      if (value === null) { checks.push({ code: `${code}-skipped`, level: 'note', controllerId: id, message: `${label} is missing, so ${name} cannot be checked (see missing data).` }); return null }
      if (num(c[field]) === null) { checks.push({ code: `${code}-no-limit`, level: 'note', controllerId: id, message: `${name} has no ${label.toLowerCase()} limit entered, so it cannot be checked.` }); return null }
      return c[field]
    }
    const vLimit = limit('voc', 'pvMaxV', array.vocCold, 'Cold open-circuit voltage')
    if (vLimit !== null) {
      checks.push({
        code: 'voc-cold',
        level: level(array.vocCold, vLimit),
        controllerId: id,
        value: array.vocCold,
        limit: vLimit,
        message: array.vocCold > vLimit
          ? `Open-circuit voltage at ${cold} C is ${fmt(array.vocCold, 'V')}, which may exceed the ${fmt(vLimit, 'V')} PV limit of ${name}.`
          : array.vocCold >= vLimit * NOTE_FROM
            ? `Open-circuit voltage at ${cold} C is ${fmt(array.vocCold, 'V')}, close to the ${fmt(vLimit, 'V')} PV limit of ${name}.`
            : `Open-circuit voltage at ${cold} C is ${fmt(array.vocCold, 'V')}, within the ${fmt(vLimit, 'V')} PV limit of ${name}.`
      })
    }
    const aLimit = limit('current', 'pvMaxA', array.iscA, 'Short-circuit current')
    if (aLimit !== null) {
      checks.push({
        code: 'current',
        level: level(array.iscA, aLimit),
        controllerId: id,
        value: array.iscA,
        limit: aLimit,
        message: array.iscA > aLimit
          ? `Short-circuit current ${fmt(array.iscA, 'A')} may exceed the ${fmt(aLimit, 'A')} PV input limit of ${name}.`
          : array.iscA >= aLimit * NOTE_FROM
            ? `Short-circuit current ${fmt(array.iscA, 'A')} is close to the ${fmt(aLimit, 'A')} PV input limit of ${name}.`
            : `Short-circuit current ${fmt(array.iscA, 'A')} is within the ${fmt(aLimit, 'A')} PV input limit of ${name}.`
      })
    }
    // Power only informs: more panel power than the controller can use is common and legal.
    if (array.powerW !== null && num(c.pvMaxW) !== null) {
      const over = array.powerW > c.pvMaxW
      checks.push({
        code: 'power',
        level: over ? 'note' : 'ok',
        controllerId: id,
        value: array.powerW,
        limit: c.pvMaxW,
        message: over
          ? `Panel power ${fmt(array.powerW, 'W')} is above the ${fmt(c.pvMaxW, 'W')} PV input rating of ${name}; the controller will limit the output, which is common.`
          : `Panel power ${fmt(array.powerW, 'W')} is within the ${fmt(c.pvMaxW, 'W')} PV input rating of ${name}.`
      })
    }
  }
  return array
}

module.exports = { deriveArrays, DEFAULT_COLD_C, ASSUMED_COEFF }
