'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { Store } = require('../src/store')
const { registerRoutes } = require('../src/routes')
const { resolveSettings } = require('../src/settings')
const query = require('../src/query')

// A router that keeps the handlers and the access level of each route, and
// calls a route the way the server would (the handlers may answer later).
function harness (store, settings) {
  const routes = {}
  const registrar = (level) => {
    const r = {}
    for (const method of ['get', 'put', 'post', 'delete']) {
      r[method] = (routePath, ...handlers) => { routes[`${method} ${routePath}`] = { level, handlers }; return r }
    }
    return r
  }
  const router = { ...registrar('admin'), access: (level) => registrar(level) }
  registerRoutes(router, () => store, os.tmpdir(), () => settings || resolveSettings({}))
  const call = (key, { params = {}, query: q = {} } = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, status (c) { this.statusCode = c; return this }, json (body) { resolve({ status: this.statusCode, body }) } }
    const req = { params, query: q }
    let i = 0
    const next = () => { const h = routes[key].handlers[i++]; if (h) h(req, res, next) }
    next()
  })
  return { routes, call }
}

// Battery -> main fuse -> bus -> (enclosure holding a breaker -> pump), and a light.
function smallBoat (store) {
  const battery = store.create('device', { name: 'House battery', role: 'storage', type: 'battery', nominal_voltage: 12, zone: 'Engine room', tags: JSON.stringify(['power']) })
  const fuse = store.create('device', { name: 'Main fuse', role: 'distribution', type: 'fuse', trip_rating_a: 100 })
  const box = store.create('device', { name: 'Switch panel', role: 'enclosure', zone: 'Saloon' })
  const breaker = store.create('device', { name: 'Pump breaker', role: 'distribution', type: 'breaker', trip_rating_a: 10, parent_id: box.id })
  const pump = store.create('device', { name: 'Bilge pump', role: 'consumer', type: 'bilge pump', rated_power_w: 60, zone: 'Bilge', notes: 'Rule 500 style' })
  const light = store.create('device', { name: 'Cabin light', role: 'consumer', type: 'light', rated_power_w: 12, zone: 'Saloon' })
  const wire = (id, from, to, extra = {}) => store.create('wireRun', { id, from_device_id: from.id, to_device_id: to.id, gauge: 10, gauge_unit: 'AWG', length: 3, length_unit: 'm', ...extra })
  const c1 = wire('w1', battery, fuse, { cable_label: 'Main feed' })
  const c2 = wire('w2', fuse, breaker)
  const c3 = wire('w3', breaker, pump, { cable_label: 'Pump feed' })
  const c4 = wire('w4', fuse, light)
  return { battery, fuse, box, breaker, pump, light, cables: [c1, c2, c3, c4] }
}

test('search ranks an exact name above a word start above a fragment, and says why', async () => {
  const store = new Store(':memory:')
  smallBoat(store)
  store.create('device', { name: 'Pumpkin heater', role: 'consumer' })
  const { call } = harness(store)
  const { status, body } = await call('get /search', { query: { q: 'pump' } })
  assert.equal(status, 200)
  const names = body.results.map((r) => r.name)
  assert.equal(names[0], 'Pump breaker')
  assert.ok(names.includes('Pumpkin heater'))
  assert.ok(names.includes('Pump breaker'))
  assert.ok(body.results.every((r) => r.kind && r.id && r.name && r.why.length > 0))
  assert.ok(body.results[0].score >= body.results[body.results.length - 1].score)
  store.close()
})

test('search filters by kind, zone and role, and finds cables by label', async () => {
  const store = new Store(':memory:')
  smallBoat(store)
  const { call } = harness(store)
  let r = await call('get /search', { query: { q: 'feed', kind: 'cable' } })
  assert.deepEqual(r.body.results.map((x) => x.name).sort(), ['Main feed', 'Pump feed'])
  assert.ok(r.body.results.every((x) => x.kind === 'cable'))
  r = await call('get /search', { query: { zone: 'saloon' } })
  assert.deepEqual(r.body.results.map((x) => x.name).sort(), ['Cabin light', 'Switch panel'])
  r = await call('get /search', { query: { role: 'storage' } })
  assert.deepEqual(r.body.results.map((x) => x.name), ['House battery'])
  r = await call('get /search', { query: { q: 'power', role: 'storage' } })
  assert.equal(r.body.results[0].why[0], 'tag contains "power"'.replace('contains', 'is'))
  r = await call('get /search', { query: { q: 'rule' } })
  assert.equal(r.body.results[0].name, 'Bilge pump')
  assert.match(r.body.results[0].why[0], /notes/)
  store.close()
})

test('search needs a text, a zone or a role, rejects bad values, skips removed records', async () => {
  const store = new Store(':memory:')
  const boat = smallBoat(store)
  const { call } = harness(store)
  assert.equal((await call('get /search', {})).status, 400)
  assert.equal((await call('get /search', { query: { q: 'x', kind: 'plan' } })).status, 400)
  assert.equal((await call('get /search', { query: { q: 'x', limit: '0' } })).status, 400)
  store.remove('device', boat.light.id)
  const r = await call('get /search', { query: { q: 'cabin light', kind: 'device' } })
  assert.equal(r.body.total, 0)
  store.close()
})

test('search caps results: 25 by default, the limit up to 100, larger limits clamp to 100', async () => {
  const store = new Store(':memory:')
  for (let i = 0; i < 130; i++) store.create('device', { name: `Lamp ${i}`, role: 'consumer' })
  const { call } = harness(store)
  let r = await call('get /search', { query: { q: 'lamp' } })
  assert.equal(r.body.results.length, 25)
  assert.equal(r.body.total, 130)
  r = await call('get /search', { query: { q: 'lamp', limit: '7' } })
  assert.equal(r.body.results.length, 7)
  r = await call('get /search', { query: { q: 'lamp', limit: '500' } })
  assert.equal(r.body.results.length, 100)
  assert.equal(r.body.query.limit, 100)
  // The same query gives the same order.
  const again = await call('get /search', { query: { q: 'lamp', limit: '7' } })
  assert.deepEqual(again.body.results, (await call('get /search', { query: { q: 'lamp', limit: '7' } })).body.results)
  store.close()
})

test('trace follows the cables up toward the supply and down toward the loads, through an enclosure', async () => {
  const store = new Store(':memory:')
  const boat = smallBoat(store)
  const { call } = harness(store)
  const r = await call('get /trace/:deviceId', { params: { deviceId: boat.pump.id } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.up.devices.map((d) => d.name), ['Pump breaker', 'Main fuse', 'House battery'])
  assert.deepEqual(r.body.up.devices.map((d) => d.depth), [1, 2, 3])
  assert.deepEqual(r.body.up.cables.map((c) => c.id), ['w3', 'w2', 'w1'])
  assert.deepEqual(r.body.up.devices[0].enclosures, ['Switch panel'])
  assert.deepEqual(r.body.down.devices, [])
  assert.equal(r.body.up.cycle, false)
  // The pump is on the circuit the pump breaker protects.
  assert.equal(r.body.protection[0].name, 'Pump breaker')
  assert.equal(r.body.protection[0].ratingA, 10)
  assert.equal(r.body.circuits[0].protectorName, 'Pump breaker')
  assert.equal(r.body.unprotected, false)
  store.close()
})

test('trace down from the fuse reaches every load; direction limits the answer; an enclosure stands for what it holds', async () => {
  const store = new Store(':memory:')
  const boat = smallBoat(store)
  const { call } = harness(store)
  let r = await call('get /trace/:deviceId', { params: { deviceId: boat.fuse.id }, query: { direction: 'down' } })
  assert.equal(r.body.up, undefined)
  assert.deepEqual(r.body.down.devices.map((d) => d.name).sort(), ['Bilge pump', 'Cabin light', 'Pump breaker'])
  r = await call('get /trace/:deviceId', { params: { deviceId: boat.box.id }, query: { direction: 'both' } })
  assert.deepEqual(r.body.up.devices.map((d) => d.name), ['Main fuse', 'House battery'])
  assert.deepEqual(r.body.down.devices.map((d) => d.name), ['Bilge pump'])
  assert.equal((await call('get /trace/:deviceId', { params: { deviceId: boat.fuse.id }, query: { direction: 'sideways' } })).status, 400)
  assert.equal((await call('get /trace/:deviceId', { params: { deviceId: 'nope' } })).status, 404)
  store.close()
})

test('trace survives a loop of cables and says so', async () => {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'A', role: 'distribution' })
  const b = store.create('device', { name: 'B', role: 'distribution' })
  const c = store.create('device', { name: 'C', role: 'distribution' })
  const wire = (from, to) => store.create('wireRun', { from_device_id: from.id, to_device_id: to.id })
  wire(a, b); wire(b, c); wire(c, a)
  const { call } = harness(store)
  const r = await call('get /trace/:deviceId', { params: { deviceId: a.id } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.down.devices.map((d) => d.name).sort(), ['B', 'C'])
  assert.equal(r.body.down.cycle, true)
  assert.equal(r.body.up.cycle, true)
  store.close()
})

test('every query route is registered for read-only users and answers 503 while the plugin is stopped', async () => {
  const store = new Store(':memory:')
  const { routes } = harness(store)
  for (const key of ['get /search', 'get /trace/:deviceId', 'get /load-summary', 'get /checks']) {
    assert.equal(routes[key].level, 'readonly', key)
  }
  const stopped = harness(null)
  assert.equal((await stopped.call('get /checks')).status, 503)
  store.close()
})

// The web app's own calculation, from the same resources, for comparison.
async function webCalculation (store, settings) {
  const checks = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'cableChecks.js')).href)
  const load = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'loadSummary.js')).href).catch(() => null)
  const calc = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'loadCalc.js')).href)
  const resources = await query.loadResources(store)
  const limits = { critical: settings.voltageDropLimitCritical, normal: settings.voltageDropLimitNormal }
  const results = checks.checkAll({ ...resources, limits })
  const deviceById = new Map(resources.devices.map((d) => [d.id, d]))
  const loads = resources.circuits.filter((c) => c.status === 'active' && c.derived).map((c) => [c.id, calc.calculateCircuitLoad(c, deviceById)])
  return { checks, calc, load, results, loads, resources, limits }
}

async function compare (store, settings) {
  const { call } = harness(store, settings)
  const web = await webCalculation(store, settings)
  const summary = (await call('get /load-summary')).body
  assert.equal(summary.circuits.length, web.loads.length)
  for (const [id, expected] of web.loads) {
    const row = summary.circuits.find((c) => c.id === id)
    assert.deepEqual(row.load, JSON.parse(JSON.stringify(expected)), `load of ${id}`)
    assert.equal(row.status, expected.overRating ? 'over-rating' : web.calc.incompleteReason(expected) ? 'incomplete' : 'ok')
  }
  assert.deepEqual(summary.warnings, store.deriveAll().warnings)
  assert.equal(summary.cableCheckSummary, web.calc.checkSummaryLine(web.checks.countVerdicts(web.results)))

  const checks = (await call('get /checks')).body
  assert.deepEqual(checks.counts, web.checks.countVerdicts(web.results))
  assert.equal(checks.results.length, web.results.size)
  for (const item of checks.results) {
    const expected = web.results.get(item.cableId)
    assert.equal(item.verdict, expected.verdict)
    assert.deepEqual(item.result, JSON.parse(JSON.stringify(expected)))
    assert.deepEqual(item.explanation, JSON.parse(JSON.stringify(web.checks.explain(expected))))
  }
  assert.deepEqual(checks.limits, web.limits)
  return { summary, checks }
}

test('load-summary and checks equal the web app calculation on a small boat, with the plugin limits', async () => {
  const store = new Store(':memory:')
  smallBoat(store)
  const settings = resolveSettings({ voltageDropLimitNormal: 1, voltageDropLimitCritical: 0.5 })
  const { summary, checks } = await compare(store, settings)
  assert.ok(summary.circuits.length >= 2)
  assert.ok(checks.results.length >= 3)
  assert.deepEqual(checks.limits, { critical: 0.5, normal: 1 })
  // Tight limits change the verdicts compared with the defaults.
  const loose = await compare(store, resolveSettings({}))
  assert.notDeepEqual(loose.checks.counts, checks.counts)
  store.close()
})

test('load-summary and checks equal the web app calculation on the demo database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-demo-'))
  const copy = path.join(dir, 'wiring.db')
  fs.copyFileSync(path.join(__dirname, '..', 'demo', 'wiring.db'), copy)
  const store = new Store(copy)
  const { summary, checks } = await compare(store, resolveSettings({}))
  assert.ok(summary.circuits.length > 5)
  assert.ok(checks.results.length > 5)
  const total = Object.values(checks.counts).reduce((a, b) => a + b, 0)
  assert.equal(total, checks.results.length)
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
