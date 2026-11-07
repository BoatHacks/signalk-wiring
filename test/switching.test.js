'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Store } = require('../src/store')
const { registerLiveRoutes } = require('../src/liveRoutes')
const { stateFromValue, valueForState, selfPath } = require('../src/switching')

// ---- Pure value handling ----

test('the state of a path is understood from booleans, numbers and words, wrapped or bare', () => {
  assert.equal(stateFromValue(true), true)
  assert.equal(stateFromValue(0), false)
  assert.equal(stateFromValue(1), true)
  assert.equal(stateFromValue({ value: 1, timestamp: 'x' }), true)
  assert.equal(stateFromValue('ON'), true)
  assert.equal(stateFromValue('off'), false)
  assert.equal(stateFromValue('weird'), null)
  assert.equal(stateFromValue(undefined), null)
  assert.equal(stateFromValue(null), null)
})

test('the value sent follows the format the path holds now', () => {
  assert.equal(valueForState(true, false), false)
  assert.equal(valueForState({ value: false }, true), true)
  assert.equal(valueForState(0, true), 1)
  assert.equal(valueForState({ value: 1 }, false), 0)
  assert.equal(valueForState('on', false), 'off')
  assert.equal(valueForState('OFF', true), 'ON')
  assert.equal(valueForState('Closed', false), 'Open')
  assert.equal(valueForState(undefined, true), true) // nothing to go by: SignalK's boolean
})

test('a vessels.self prefix is dropped from a path', () => {
  assert.equal(selfPath(' vessels.self.electrical.switches.a.state '), 'electrical.switches.a.state')
  assert.equal(selfPath('electrical.switches.a.state'), 'electrical.switches.a.state')
})

// ---- The routes ----

function createFakeRouter () {
  const handlers = {}
  const access = {}
  const make = (level) => {
    const reg = {}
    for (const method of ['get', 'post']) {
      reg[method] = (routePath, ...fns) => {
        handlers[`${method} ${routePath}`] = fns
        access[`${method} ${routePath}`] = level
        return reg
      }
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
  constructor () {
    this.statusCode = 200
    this.done = new Promise((resolve) => { this.resolve = resolve })
  }

  status (code) { this.statusCode = code; return this }
  json (body) { this.body = body; this.resolve(); return this }
}

class FakeReq extends EventEmitter {
  constructor (body, principal = 'tester') {
    super()
    this.body = body
    this.query = {}
    this.params = {}
    this.skPrincipal = { identifier: principal }
  }
}

// A boat: battery - fuse - relay(s) - lamps. Every switch path starts holding `initial`.
function setup ({ initial = false, putReply = { state: 'COMPLETED', statusCode: 200 } } = {}) {
  const store = new Store(':memory:')
  const bat = store.create('device', { name: 'Battery', role: 'storage', nominal_voltage: 12 })
  const fuse = store.create('device', { name: 'Fuse', role: 'distribution', trip_rating_a: 10 })
  const relay = store.create('device', { name: 'Cabin relay', role: 'distribution', switch_path: 'electrical.switches.bank.0.3.state' })
  const splice = store.create('device', { name: 'Splice', role: 'distribution' })
  const a = store.create('device', { name: 'Lamp A' })
  const b = store.create('device', { name: 'Lamp B' })
  const bare = store.create('device', { name: 'Bare lamp' })
  const wire = (from, to) => store.create('wireRun', { from_device_id: from.id, to_device_id: to.id })
  wire(bat, fuse); wire(fuse, relay); wire(relay, splice); wire(splice, a); wire(splice, b); wire(bat, bare)

  const puts = []
  const values = { 'electrical.switches.bank.0.3.state': initial }
  const app = {
    getSelfPath: (p) => (p in values ? { value: values[p] } : undefined),
    putSelfPath: async (p, v) => { puts.push([p, v]); return typeof putReply === 'function' ? putReply(p, v) : putReply },
    debug: () => {}
  }
  const router = createFakeRouter()
  registerLiveRoutes(router, () => store, { app, putTimeoutMs: 50 })
  const post = async (body) => {
    const res = new FakeRes()
    router.invoke('post', '/switch', new FakeReq(body), res)
    await res.done
    return res
  }
  return { store, router, post, puts, relay, a, b, bare, values }
}

test('the switch route needs read-write access, the live route read-only access', () => {
  const { router } = setup()
  assert.equal(router.accessOf('post', '/switch'), 'readwrite')
  assert.equal(router.accessOf('get', '/live'), 'readonly')
})

test('switching a lamp operates the relay that feeds it, in the format the path holds, and logs it', async () => {
  const { post, puts, a, b, relay, store } = setup({ initial: false })
  const res = await post({ consumerId: a.id, state: true })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(puts, [['electrical.switches.bank.0.3.state', true]])
  assert.equal(res.body.switchDeviceId, relay.id)
  assert.deepEqual(res.body.consumerIds.sort(), [a.id, b.id].sort())
  const log = store.changeLog('device', relay.id)
  const entry = log[log.length - 1]
  assert.equal(entry.summary, 'switched on')
  const diff = JSON.parse(entry.diff_json)
  assert.equal(diff.by, 'tester')
  assert.equal(diff.requestedFor, a.id)
  assert.equal(diff.outcome, 'ok')
})

test('a numeric path gets 0 and 1', async () => {
  const { post, puts, a } = setup({ initial: 1 })
  await post({ consumerId: a.id, state: false })
  assert.deepEqual(puts, [['electrical.switches.bank.0.3.state', 0]])
})

test('a lamp with no switch in line is refused with 409', async () => {
  const { post, puts, bare } = setup()
  const res = await post({ consumerId: bare.id, state: true })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.reason, 'no-switch')
  assert.equal(puts.length, 0)
})

test('never remote is refused with 403, even when the lamp only shares the relay with the locked device', async () => {
  const { post, puts, store, b, a } = setup()
  store.update('device', b.id, { never_remote: true })
  const res = await post({ consumerId: a.id, state: true })
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.reason, 'never-remote')
  assert.equal(puts.length, 0)
  const log = store.changeLog('device', res.body.switchDeviceId)
  assert.match(log[log.length - 1].summary, /refused/)
})

test('a flagged device needs confirmation, then goes through', async () => {
  const { post, puts, store, a, b } = setup()
  store.update('device', a.id, { confirm_switching: true })
  const asked = await post({ consumerId: b.id, state: false }) // b shares the relay with a
  assert.equal(asked.statusCode, 409)
  assert.equal(asked.body.confirmationRequired, true)
  assert.deepEqual(asked.body.consumerNames.sort(), ['Lamp A', 'Lamp B'])
  assert.equal(puts.length, 0)
  const confirmed = await post({ consumerId: b.id, state: false, confirmed: true })
  assert.equal(confirmed.statusCode, 200)
  assert.equal(puts.length, 1)
})

test('a switch device can be switched directly', async () => {
  const { post, puts, relay } = setup()
  const res = await post({ deviceId: relay.id, state: true })
  assert.equal(res.statusCode, 200)
  assert.equal(puts.length, 1)
  const missing = await post({ deviceId: 'nope', state: true })
  assert.equal(missing.statusCode, 404)
})

test('bad requests: no target, no state, unknown consumer', async () => {
  const { post, puts } = setup()
  assert.equal((await post({ state: true })).statusCode, 400)
  const noState = await post({ consumerId: 'x' })
  assert.equal(noState.statusCode, 400)
  assert.equal((await post({ consumerId: 'x', state: true })).statusCode, 404)
  assert.equal(puts.length, 0)
})

test('a server that refuses or does not answer gives 502 or 504 and the failure is logged', async () => {
  const refused = setup({ putReply: { state: 'COMPLETED', statusCode: 405, message: 'no handler' } })
  let res = await refused.post({ consumerId: refused.a.id, state: true })
  assert.equal(res.statusCode, 502)
  assert.match(res.body.error, /no handler/)
  const log = refused.store.changeLog('device', refused.relay.id)
  assert.match(log[log.length - 1].summary, /failed/)

  const silent = setup({ putReply: () => new Promise(() => {}) })
  res = await silent.post({ consumerId: silent.a.id, state: true })
  assert.equal(res.statusCode, 504)

  const thrown = setup({ putReply: () => { throw new Error('boom') } })
  res = await thrown.post({ consumerId: thrown.a.id, state: true })
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.error, 'boom')
})

test('a pending PUT (202) counts as accepted and says it is pending', async () => {
  const { post, a } = setup({ putReply: { state: 'PENDING', statusCode: 202 } })
  const res = await post({ consumerId: a.id, state: true })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.pending, true)
})

test('the body can come from the stream when no body parser ran', async () => {
  const { router, puts, a } = setup()
  const req = new FakeReq(undefined)
  req.body = undefined
  const res = new FakeRes()
  router.invoke('post', '/switch', req, res)
  setImmediate(() => { req.emit('data', Buffer.from(JSON.stringify({ consumerId: a.id, state: true }))); req.emit('end') })
  await res.done
  assert.equal(res.statusCode, 200)
  assert.equal(puts.length, 1)
})

test('the live route lists switchability, and answers 503 when the plugin is disabled', async () => {
  const { router, a } = setup()
  const res = new FakeRes()
  router.invoke('get', '/live', new FakeReq(), res)
  await res.done
  assert.equal(res.body.consumers[a.id].switchable, true)

  const off = createFakeRouter()
  registerLiveRoutes(off, () => null, { app: {} })
  const res2 = new FakeRes()
  off.invoke('get', '/live', new FakeReq(), res2)
  await res2.done
  assert.equal(res2.statusCode, 503)
})
