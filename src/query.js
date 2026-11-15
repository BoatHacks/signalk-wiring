'use strict'

// The read-only query routes (plan 0036): search across devices and cables,
// trace a device toward its supply and toward its loads, the load summary and
// the cable checks. Everything here works on the same resources the web app
// reads (the resource providers' lists), and the load and check numbers come
// from the browser modules public/loadCalc.js and public/cableChecks.js, so the
// server and the web app cannot disagree. Those are ES modules and this file is
// CommonJS, so they are loaded with a dynamic import() (Node 22.13 or newer).

const path = require('path')
const { pathToFileURL } = require('url')
const { createResourceProvider } = require('./resources')
const { contentsOf, pathOf } = require('./enclosures')

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

let modules = null
function webModules () {
  if (!modules) {
    const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'public', file)).href)
    modules = Promise.all([load('cableChecks.js'), load('loadCalc.js')])
      .then(([checks, load]) => ({ checks, load }))
      .catch((err) => { modules = null; throw err })
  }
  return modules
}

// The resources the web app reads, as the resource providers serve them.
async function loadResources (store) {
  const list = async (kind, type) => Object.values(await createResourceProvider(store, kind, type).methods.listResources())
  const [devices, cables, conduits, circuits] = await Promise.all([
    list('device', 'wiringDevices'),
    list('wireRun', 'wiringWireRuns'),
    list('conduit', 'wiringConduits'),
    list('circuit', 'wiringCircuits')
  ])
  return { devices, cables, conduits, circuits }
}

const live = (item) => item.status !== 'removed'
const lower = (v) => String(v == null ? '' : v).toLowerCase()
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function cableName (cable, deviceById) {
  if (cable.cableLabel) return cable.cableLabel
  const end = (id) => (deviceById.get(id) || {}).name || id
  return `${end(cable.fromDeviceId)} to ${end(cable.toDeviceId)}`
}

// ---- Search ---------------------------------------------------------------

// What a record can be found by: field, label for the "why", weight for an
// exact match (a prefix counts 0.8 of it, a word start 0.7, a contained
// fragment 0.5).
const DEVICE_FIELDS = [
  ['name', 'name', 100], ['type', 'type', 40], ['makeModel', 'make and model', 35], ['tags', 'tag', 40],
  ['zone', 'zone', 25], ['signalkPath', 'SignalK path', 20], ['notes', 'notes', 12]
]
const CABLE_FIELDS = [
  ['cableLabel', 'label', 100], ['name', 'name', 90], ['tags', 'tag', 40], ['zone', 'zone', 25],
  ['switchRef', 'switch reference', 20], ['notes', 'notes', 12]
]

function matchStrength (value, token) {
  if (value === token) return 1
  if (value.startsWith(token)) return 0.8
  if (value.split(/[^a-z0-9]+/).some((w) => w.startsWith(token))) return 0.7
  if (value.includes(token)) return 0.5
  return 0
}

// Scores one record against the search words. Every word must match
// somewhere; the best field per word counts. Returns null for no match.
function scoreRecord (record, fields, tokens) {
  let score = 0
  const why = []
  for (const token of tokens) {
    let best = null
    for (const [key, label, weight] of fields) {
      const raw = record[key]
      const values = Array.isArray(raw) ? raw : [raw]
      for (const value of values) {
        if (value == null || value === '') continue
        const strength = matchStrength(lower(value), token)
        if (strength > 0 && (!best || strength * weight > best.points)) {
          best = { points: strength * weight, text: `${label} ${strength === 1 ? 'is' : 'contains'} "${value}"` }
        }
      }
    }
    if (!best) return null
    score += best.points
    if (!why.includes(best.text)) why.push(best.text)
  }
  return { score, why }
}

// params: { q, kind, zone, role, limit } as strings from the query string.
// Returns { error } for a bad request, else { query, total, results }.
function search ({ devices, cables }, params = {}) {
  const q = String(params.q || '').trim()
  const kind = params.kind || ''
  const zone = String(params.zone || '').trim()
  const role = String(params.role || '').trim()
  if (kind && kind !== 'device' && kind !== 'cable') return { error: 'kind must be device or cable' }
  if (!q && !zone && !role) return { error: 'give a search text (q), or a zone or role to list by' }
  let limit = DEFAULT_LIMIT
  if (params.limit !== undefined && params.limit !== '') {
    const n = Number.parseInt(params.limit, 10)
    if (!Number.isFinite(n) || n < 1) return { error: `limit must be a whole number from 1 to ${MAX_LIMIT}` }
    limit = Math.min(n, MAX_LIMIT)
  }
  const tokens = lower(q).split(/\s+/).filter(Boolean)
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const zoneOk = (r) => !zone || lower(r.zone) === lower(zone)

  const hits = []
  const consider = (kindName, record, fields, name, extra) => {
    if (!live(record) || !zoneOk(record)) return
    const scored = tokens.length > 0 ? scoreRecord({ ...record, name }, fields, tokens) : { score: 1, why: [zone ? `in zone "${zone}"` : `role is ${role}`] }
    if (!scored) return
    hits.push({ kind: kindName, id: record.id, name, ...extra, score: Math.round(scored.score * 10) / 10, why: scored.why })
  }
  if (kind !== 'cable') {
    for (const d of devices) {
      if (role && d.role !== role) continue
      consider('device', d, DEVICE_FIELDS, d.name || d.id, { type: d.type || null, role: d.role || 'consumer', zone: d.zone || null })
    }
  }
  if (kind !== 'device' && !role) {
    for (const c of cables) {
      consider('cable', c, CABLE_FIELDS, cableName(c, deviceById), {
        zone: c.zone || null,
        fromDeviceId: c.fromDeviceId,
        toDeviceId: c.toDeviceId
      })
    }
  }
  hits.sort((a, b) => b.score - a.score || byString(lower(a.name), lower(b.name)) || byString(a.id, b.id))
  return { query: { q, kind: kind || null, zone: zone || null, role: role || null, limit }, total: hits.length, results: hits.slice(0, limit) }
}

// ---- Trace ----------------------------------------------------------------

const POSITIVE = new Set(['positive', 'line'])
const carriesPower = (cable) => !cable.conductors || cable.conductors.length === 0 ||
  cable.conductors.some((c) => POSITIVE.has(c.conductor))

// Walks the cable graph from a device in one direction. A cable runs from the
// supply side (from) to the load side (to), so "down" follows from to to and
// "up" the other way. An enclosure stands for what it holds: starting at one
// starts at everything inside, and reaching one carries on inside it.
function walk (start, direction, { devices, cables }) {
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const powered = cables.filter((c) => live(c) && carriesPower(c) && deviceById.has(c.fromDeviceId) && deviceById.has(c.toDeviceId))
  const expand = (id) => {
    const d = deviceById.get(id)
    return d && d.role === 'enclosure' ? [id, ...contentsOf(devices, id)] : [id]
  }
  const next = (id) => powered
    .filter((c) => (direction === 'down' ? c.fromDeviceId : c.toDeviceId) === id)
    .sort((a, b) => byString(a.id, b.id))
  const far = (c) => (direction === 'down' ? c.toDeviceId : c.fromDeviceId)

  const startSet = new Set(expand(start))
  const depthOf = new Map([...startSet].map((id) => [id, 0]))
  const seenCables = new Map()
  const edges = new Map() // device -> devices reached from it, for cycle detection
  let queue = [...startSet]
  let depth = 0
  while (queue.length > 0) {
    depth++
    const following = []
    for (const id of queue) {
      for (const c of next(id)) {
        if (!seenCables.has(c.id)) seenCables.set(c.id, depth)
        if (!edges.has(id)) edges.set(id, new Set())
        for (const to of expand(far(c))) {
          edges.get(id).add(to)
          if (!depthOf.has(to)) { depthOf.set(to, depth); following.push(to) }
        }
      }
    }
    queue = following
  }

  const outDevices = [...depthOf].filter(([id]) => !startSet.has(id)).sort((a, b) => a[1] - b[1] || byString(a[0], b[0])).map(([id, d]) => {
    const dev = deviceById.get(id)
    return {
      id,
      name: dev.name || id,
      type: dev.type || null,
      role: dev.role || 'consumer',
      depth: d,
      enclosures: pathOf(devices, id).map((e) => (deviceById.get(e) || {}).name || e)
    }
  })
  const outCables = [...seenCables].sort((a, b) => a[1] - b[1] || byString(a[0], b[0])).map(([id, d]) => {
    const c = powered.find((x) => x.id === id)
    return {
      id,
      name: cableName(c, deviceById),
      fromDeviceId: c.fromDeviceId,
      toDeviceId: c.toDeviceId,
      depth: d,
      gauge: c.gauge == null ? null : c.gauge,
      gaugeUnit: c.gaugeUnit || null,
      length: c.length == null ? null : c.length,
      lengthUnit: c.lengthUnit || null
    }
  })
  return { devices: outDevices, cables: outCables, cycle: hasCycle(edges) }
}

// Whether the reached part of the graph loops back on itself.
function hasCycle (edges) {
  const state = new Map() // 1 on the path, 2 done
  const visit = (id) => {
    state.set(id, 1)
    for (const to of edges.get(id) || []) {
      const s = state.get(to)
      if (s === 1) return true
      if (!s && visit(to)) return true
    }
    state.set(id, 2)
    return false
  }
  for (const id of edges.keys()) if (!state.has(id) && visit(id)) return true
  return false
}

// The trace of one device. Returns null for an unknown or removed device.
function trace (resources, deviceId, direction = 'both') {
  const { devices, circuits } = resources
  const device = devices.find((d) => d.id === deviceId)
  if (!device || !live(device)) return null
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const group = new Set([deviceId, ...(device.role === 'enclosure' ? contentsOf(devices, deviceId) : [])])
  const out = {
    device: { id: device.id, name: device.name || device.id, type: device.type || null, role: device.role || 'consumer', zone: device.zone || null, enclosures: pathOf(devices, deviceId).map((e) => (deviceById.get(e) || {}).name || e) },
    direction
  }
  if (direction !== 'down') out.up = walk(deviceId, 'up', resources)
  if (direction !== 'up') out.down = walk(deviceId, 'down', resources)

  // The circuits the device is part of, and the fuse or breaker that protects each.
  const involved = circuits.filter((c) => c.status === 'active' && c.derived &&
    c.derived.deviceIds.some((id) => group.has(id)))
  out.circuits = involved.map((c) => {
    const protector = c.derived.protectorId ? deviceById.get(c.derived.protectorId) : null
    return {
      id: c.id,
      name: c.name,
      protectorId: c.derived.protectorId || null,
      protectorName: protector ? protector.name : null,
      ratingA: c.derived.ratingA == null ? null : c.derived.ratingA,
      unprotected: Boolean(c.derived.unprotected),
      voltage: c.derived.voltage == null ? null : c.derived.voltage,
      ac: Boolean(c.derived.ac),
      role: group.has(c.derived.protectorId) ? 'protected by this device' : c.derived.endDeviceIds.some((id) => group.has(id)) ? 'ends at this device' : 'passes this device'
    }
  })
  out.protection = [...new Map(involved.filter((c) => c.derived.protectorId).map((c) => [c.derived.protectorId, {
    deviceId: c.derived.protectorId,
    name: (deviceById.get(c.derived.protectorId) || {}).name || c.derived.protectorId,
    ratingA: c.derived.ratingA == null ? null : c.derived.ratingA,
    circuitIds: involved.filter((x) => x.derived.protectorId === c.derived.protectorId).map((x) => x.id)
  }])).values()]
  out.unprotected = involved.length > 0 && involved.every((c) => c.derived.unprotected)
  return out
}

// ---- Load summary and cable checks ---------------------------------------

async function loadSummary (store, resources) {
  const { load, checks } = await webModules()
  const { devices, cables, conduits, circuits } = resources
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const rows = circuits.filter((c) => c.status === 'active' && c.derived).map((circuit) => {
    const l = load.calculateCircuitLoad(circuit, deviceById)
    const reason = load.incompleteReason(l)
    return {
      id: circuit.id,
      name: circuit.name,
      load: l,
      status: l.overRating ? 'over-rating' : reason ? 'incomplete' : 'ok',
      incompleteReason: l.overRating ? null : reason
    }
  })
  const counts = { ok: 0, incomplete: 0, 'over-rating': 0 }
  for (const r of rows) counts[r.status]++
  return {
    note: 'A device fed by more than one circuit has its full wattage counted on each, which can overstate the load of a backup path. Advisory, not a certified calculation.',
    circuits: rows,
    counts,
    cableCheckSummary: load.checkSummaryLine(checks.countVerdicts(checks.checkAll({ cables, circuits, devices, conduits, limits: resources.limits }))),
    warnings: store.deriveAll().warnings
  }
}

async function cableChecks (resources) {
  const { checks } = await webModules()
  const { devices, cables, conduits, circuits, limits } = resources
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const results = checks.checkAll({ cables, circuits, devices, conduits, limits })
  const cableById = new Map(cables.map((c) => [c.id, c]))
  const items = [...results].sort((a, b) => byString(a[0], b[0])).map(([cableId, result]) => {
    const cable = cableById.get(cableId)
    return {
      cableId,
      name: cableName(cable, deviceById),
      fromDeviceId: cable.fromDeviceId,
      toDeviceId: cable.toDeviceId,
      verdict: result.verdict,
      result,
      explanation: checks.explain(result)
    }
  })
  return { limits, advisory: checks.ADVISORY_NOTE, counts: checks.countVerdicts(results), results: items }
}

// The drop limits the plugin settings give, as the web app reads them.
function limitsFromSettings (settings) {
  return { critical: settings.voltageDropLimitCritical, normal: settings.voltageDropLimitNormal }
}

module.exports = { search, trace, loadSummary, cableChecks, loadResources, limitsFromSettings, DEFAULT_LIMIT, MAX_LIMIT }
