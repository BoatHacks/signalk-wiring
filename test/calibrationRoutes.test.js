'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')
const { registerLiveRoutes } = require('../src/liveRoutes')

function createFakeRouter () {
  const handlers = {}
  const access = {}
  const make = (level) => {
    const reg = {}
    for (const method of ['get', 'post']) {
      reg[method] = (routePath, ...fns) => { handlers[`${method} ${routePath}`] = fns; access[`${method} ${routePath}`] = level; return reg }
    }
    return reg
  }
  const router = make('admin')
  router.access = (level) => make(level)
  router.accessOf = (method, routePath) => access[`${method} ${routePath}`]
  router.invoke = (method, routePath, req, res) => {
    const fns = handlers[`${method} ${routePath}`]
    assert.ok(fns, `no handler for ${method} ${routePath}`)
    let i = 0
    const next = () => { const fn = fns[i++]; if (fn) return fn(req, res, next) }
    return next()
  }
  return router
}

class FakeRes {
  constructor () { this.statusCode = 200; this.done = new Promise((resolve) => { this.resolve = resolve }) }
  status (code) { this.statusCode = code; return this }
  json (body) { this.body = body; this.resolve(); return this }
}

function fakeClock () {
  let t = 5000000
  return { now: () => t, sleep: async (ms) => { t += ms; await new Promise((resolve) => setImmediate(resolve)) } }
}

// Boat: battery - fuse - relay - splice - lamp A, lamp B; battery - bare lamp. A meter on the fuse.
function setup () {
  const store = new Store(':memory:')
  const bat = store.create('device', { name: 'Battery', role: 'storage', nominal_voltage: 12 })
  const fuse = store.create('device', { name: 'Fuse', role: 'distribution', trip_rating_a: 10, meter_path: 'm.current', meter_unit: 'A' })
  const relay = store.create('device', { name: 'Relay', role: 'distribution', switch_path: 'sw.state' })
  const splice = store.create('device', { name: 'Splice', role: 'distribution' })
  const a = store.create('device', { name: 'Lamp A' })
  const b = store.create('device', { name: 'Lamp B' })
  const pump = store.create('device', { name: 'Bilge pump', type: 'Bilge pump' })
  const wire = (from, to) => store.create('wireRun', { from_device_id: from.id, to_device_id: to.id })
  wire(bat, fuse); wire(fuse, relay); wire(relay, splice); wire(splice, a); wire(splice, b); wire(relay, pump)

  const clock = fakeClock()
  const world = { on: false, n: 0, commands: [] }
  const app = {
    getSelfPath: (p) => {
      if (p === 'sw.state') return { value: world.on }
      if (p === 'm.current') { world.n++; return { value: 5 + (world.on ? 3 : 0) + 0.02 * Math.sin(world.n * 2.3), timestamp: new Date(clock.now()).toISOString() } }
      return undefined
    },
    putSelfPath: async (p, v) => { world.commands.push(v); world.on = v; return { state: 'COMPLETED', statusCode: 200 } },
    debug: () => {}
  }
  const router = createFakeRouter()
  const live = registerLiveRoutes(router, () => store, { app, clock })
  const call = async (method, routePath, body, params = {}, query = {}) => {
    const res = new FakeRes()
    const req = { body, params, query, skPrincipal: { identifier: 'tester' } }
    router.invoke(method, routePath, req, res)
    await res.done
    return res
  }
  const settle = async () => {
    for (let i = 0; i < 2000; i++) {
      const s = (await call('get', '/calibration/status')).body
      if (s.state !== 'running') return s
      await new Promise((resolve) => setImmediate(resolve))
    }
    throw new Error('run did not finish')
  }
  const timings = { baselineS: 2, settleS: 1, measureS: 2, repeats: 2, sampleMs: 1000, responseS: 3, silentS: 5, promptS: 20 }
  return { store, router, call, settle, live, world, timings, a, b, pump, relay, fuse }
}

test('calibration routes: starting and answering need read-write, reading status read-only', () => {
  const { router } = setup()
  assert.equal(router.accessOf('post', '/calibration/runs'), 'readwrite')
  assert.equal(router.accessOf('post', '/calibration/runs/:id/accept'), 'readwrite')
  assert.equal(router.accessOf('post', '/calibration/cancel'), 'readwrite')
  assert.equal(router.accessOf('get', '/calibration/status'), 'readonly')
  assert.equal(router.accessOf('get', '/calibration/runs'), 'readonly')
})

test('a shared relay gives a group result on the switch, which is then accepted', async () => {
  const { call, settle, a, b, relay, store, timings, world } = setup()
  // Lamp A and Lamp B share the relay with the bilge pump, which starts as confirm-before-switching.
  const asked = await call('post', '/calibration/runs', { deviceId: a.id, method: 'delta', timings })
  assert.equal(asked.statusCode, 409)
  assert.equal(asked.body.confirmationRequired, true)

  const started = await call('post', '/calibration/runs', { deviceId: a.id, method: 'delta', timings, confirmed: true })
  assert.equal(started.statusCode, 201)
  assert.equal(started.body.group, true)
  assert.equal(started.body.run.deviceId, relay.id)
  assert.equal(started.body.run.consumerIds.length, 3)

  const busy = await call('post', '/calibration/runs', { deviceId: b.id, method: 'delta', timings, confirmed: true })
  assert.equal(busy.statusCode, 409)
  assert.match(busy.body.error, /in progress/)

  const done = await settle()
  assert.equal(done.state, 'done')
  assert.equal(world.on, false)
  const runs = (await call('get', '/calibration/runs', undefined, {}, { deviceId: relay.id })).body
  assert.equal(runs.length, 1)
  assert.ok(Math.abs(runs[0].avgW - 36) < 2)

  const accepted = await call('post', '/calibration/runs/:id/accept', {}, { id: runs[0].id })
  assert.equal(accepted.body.review, 'accepted')
  assert.equal(store.latestAcceptedRun(a.id).id, runs[0].id)
  const rejected = await call('post', '/calibration/runs/:id/reject', {}, { id: runs[0].id })
  assert.equal(rejected.body.review, 'rejected')
  assert.equal((await call('post', '/calibration/runs/:id/accept', {}, { id: 'nope' })).statusCode, 404)
})

test('a never-remote device cannot be calibrated by switching, but can by hand', async () => {
  const { call, settle, a, store, timings } = setup()
  store.update('device', a.id, { never_remote: true })
  const refused = await call('post', '/calibration/runs', { deviceId: a.id, method: 'delta', timings, confirmed: true })
  assert.equal(refused.statusCode, 403)
  const byHand = await call('post', '/calibration/runs', { deviceId: a.id, method: 'delta', hand: true, timings })
  assert.equal(byHand.statusCode, 201)
  assert.equal(byHand.body.group, false)
  assert.equal((await call('post', '/calibration/cancel', {})).body.ok, true)
  assert.equal((await settle()).state, 'cancelled')
})

test('bad starts: unknown device, not a consumer, no meter, bad method', async () => {
  const { call, fuse, store, timings } = setup()
  assert.equal((await call('post', '/calibration/runs', { deviceId: 'nope', method: 'delta' })).statusCode, 404)
  assert.equal((await call('post', '/calibration/runs', { deviceId: fuse.id, method: 'delta' })).statusCode, 400)
  const lonely = store.create('device', { name: 'Lonely' })
  const noMeter = await call('post', '/calibration/runs', { deviceId: lonely.id, method: 'delta', hand: true })
  assert.equal(noMeter.statusCode, 400)
  assert.match(noMeter.body.error, /meter/)
  assert.equal((await call('post', '/calibration/runs', { deviceId: lonely.id, method: 'guess', hand: true, meter: { path: 'x', unit: 'W' } })).statusCode, 400)
  assert.equal(store.listRuns({}).length, 0)
})

test('a watch run is driven by Continue calls and its threshold can be changed before accepting', async () => {
  const { call, settle, a, world, timings } = setup()
  const started = await call('post', '/calibration/runs', {
    deviceId: a.id, method: 'watch', timings: { ...timings, watchS: 20 }, meter: { path: 'm.current', unit: 'A' }
  })
  assert.equal(started.statusCode, 201)
  for (let i = 0; i < 3000; i++) {
    const s = (await call('get', '/calibration/status')).body
    if (s.state !== 'running') break
    if (s.prompt && s.prompt.key === 'watch-on') world.on = true
    if (s.prompt) await call('post', '/calibration/continue', {})
    await new Promise((resolve) => setImmediate(resolve))
  }
  const status = (await call('get', '/calibration/status')).body
  assert.equal(status.state, 'done')
  const run = (await call('get', '/calibration/runs')).body[0]
  assert.equal(run.method, 'watch')
  const recomputed = await call('post', '/calibration/runs/:id/recompute', { threshold: 100 }, { id: run.id })
  assert.equal(recomputed.statusCode, 200)
  assert.equal(recomputed.body.details.threshold, 100)
  assert.equal(recomputed.body.dutyCycle, 0) // nothing is above 100 A
  const bad = await call('post', '/calibration/runs/:id/recompute', { threshold: -1 }, { id: run.id })
  assert.equal(bad.statusCode, 400)
})

test('idle status before any run, and stopping the plugin cancels a run in progress', async () => {
  const { call, live, a, timings } = setup()
  assert.equal((await call('get', '/calibration/status')).body.state, 'idle')
  await call('post', '/calibration/runs', { deviceId: a.id, method: 'delta', hand: true, timings })
  await live.stopRuns()
  assert.equal((await call('get', '/calibration/status')).body.state, 'idle')
})
