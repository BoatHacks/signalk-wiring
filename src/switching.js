'use strict'

// Sending a switch command to the SignalK server on behalf of the webapp or
// a calibration run (plan 0017). The webapp never PUTs itself: it asks here,
// and this refuses never-remote devices, asks for confirmation where a device
// is flagged, sends the PUT through the server API and writes each action to
// the log. Reading states needs no special permission, so the browser reads
// them from the SignalK stream and this module is only the command side.

const PUT_TIMEOUT_MS = 10000
const ON_WORDS = new Set(['on', 'true', '1', 'enabled', 'closed', 'high', 'yes'])
const OFF_WORDS = new Set(['off', 'false', '0', 'disabled', 'open', 'low', 'no'])

// A path as stored may carry the "vessels.self." prefix; the server API
// wants it without.
function selfPath (path) {
  return String(path || '').trim().replace(/^vessels\.self\./, '')
}

// SignalK leaves are { value, ... }; getSelfPath hands back the leaf, and a
// test double may hand back the bare value.
function unwrap (leaf) {
  return leaf !== null && typeof leaf === 'object' && !Array.isArray(leaf) && 'value' in leaf ? leaf.value : leaf
}

// What a switch path's current value means: true, false, or null when it is
// missing or not understood.
function stateFromValue (value) {
  const v = unwrap(value)
  if (typeof v === 'boolean') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
  if (typeof v === 'string') {
    const word = v.trim().toLowerCase()
    if (ON_WORDS.has(word)) return true
    if (OFF_WORDS.has(word)) return false
  }
  return null
}

// The value to send for a wanted state, in the format the path holds now:
// booleans stay booleans, numbers stay 0/1, words keep their spelling and
// case. With nothing to go by, SignalK's own convention is a boolean.
function valueForState (current, state) {
  const v = unwrap(current)
  if (typeof v === 'number') return state ? 1 : 0
  if (typeof v === 'string') {
    const word = v.trim()
    const lower = word.toLowerCase()
    const pairs = [['on', 'off'], ['true', 'false'], ['1', '0'], ['enabled', 'disabled'], ['closed', 'open'], ['high', 'low'], ['yes', 'no']]
    const pair = pairs.find((p) => p.includes(lower)) || pairs[0]
    const out = state ? pair[0] : pair[1]
    if (word === word.toUpperCase() && word !== word.toLowerCase()) return out.toUpperCase()
    if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) return out[0].toUpperCase() + out.slice(1)
    return out
  }
  return Boolean(state)
}

const noop = () => {}

// `app` is the SignalK plugin app: putSelfPath, getSelfPath, debug.
function createSwitcher ({ app, timeoutMs = PUT_TIMEOUT_MS }) {
  const debug = (msg) => { if (app && typeof app.debug === 'function') app.debug(msg) }

  // The current state of a path as the server holds it, or null.
  function readState (path) {
    if (!app || typeof app.getSelfPath !== 'function') return null
    return stateFromValue(app.getSelfPath(selfPath(path)))
  }

  // Sends a state to a path. Resolves { ok, status, pending, value, message }.
  async function put (path, state) {
    const target = selfPath(path)
    const current = app.getSelfPath ? app.getSelfPath(target) : undefined
    const value = valueForState(current, state)
    let timer
    try {
      const reply = await Promise.race([
        Promise.resolve(app.putSelfPath(target, value, noop)),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs) })
      ])
      if (reply && reply.timedOut) return { ok: false, status: 504, value, message: 'the server did not answer the switch command in time' }
      const code = reply && reply.statusCode !== undefined ? reply.statusCode : 200
      if (code === 200) return { ok: true, status: 200, pending: false, value }
      if (code === 202) return { ok: true, status: 202, pending: true, value }
      return { ok: false, status: 502, value, message: (reply && reply.message) || `the server refused the switch command (${code})` }
    } catch (err) {
      return { ok: false, status: 502, value, message: err.message }
    } finally {
      clearTimeout(timer)
    }
  }

  // Works out what a request would switch and whether it is allowed.
  // request: { consumerId } or { deviceId }, plus state and confirmed.
  // Resolves { status, body } where status 200 means "go ahead" in `plan`.
  function plan (store, request) {
    const live = store.deriveSwitching()
    let switchDeviceId
    let consumerIds
    let confirm
    let neverRemote
    if (request.consumerId) {
      const consumer = live.consumers[request.consumerId]
      if (!consumer) return { status: 404, body: { error: `consumer not found: ${request.consumerId}` } }
      if (!consumer.switchable) {
        return { status: 409, body: { error: 'nothing in the wiring can switch this device remotely', reason: 'no-switch' } }
      }
      switchDeviceId = consumer.switchDeviceId
      consumerIds = [request.consumerId, ...consumer.sharedWith]
      confirm = consumer.confirm
      neverRemote = consumer.neverRemote
    } else if (request.deviceId) {
      const sw = live.switches[request.deviceId]
      if (!sw) return { status: 404, body: { error: `no switch path on device: ${request.deviceId}` } }
      switchDeviceId = request.deviceId
      consumerIds = sw.consumerIds
      confirm = sw.confirm
      neverRemote = sw.neverRemote
    } else {
      return { status: 400, body: { error: 'consumerId or deviceId is required' } }
    }
    const sw = live.switches[switchDeviceId]
    const names = (ids) => ids.map((id) => (store.get('device', id) || {}).name || id)
    const info = { switchDeviceId, switchDeviceName: names([switchDeviceId])[0], consumerIds, consumerNames: names(consumerIds) }
    if (neverRemote) {
      return { status: 403, body: { error: 'this device is set to never be switched remotely', reason: 'never-remote', ...info } }
    }
    if (confirm && !request.confirmed) {
      return { status: 409, body: { error: 'confirmation required', confirmationRequired: true, reason: 'confirm', ...info } }
    }
    return { status: 200, switchPath: sw.switchPath, info }
  }

  // The whole action: plan, send, log. Resolves { status, body }.
  async function switchTo (store, request, user) {
    if (typeof request.state !== 'boolean') return { status: 400, body: { error: 'state must be true or false' } }
    const planned = plan(store, request)
    if (planned.status !== 200) {
      if (planned.status === 403 || planned.status === 409) {
        store.logAction('device', planned.body.switchDeviceId || request.deviceId || request.consumerId,
          `switch ${request.state ? 'on' : 'off'} refused`, { by: user, reason: planned.body.reason })
      }
      return { status: planned.status, body: planned.body }
    }
    const { info } = planned
    const result = await put(planned.switchPath, request.state)
    const summary = `switched ${request.state ? 'on' : 'off'}`
    store.logAction('device', info.switchDeviceId, result.ok ? summary : `${summary} failed`, {
      by: user, path: planned.switchPath, value: result.value, consumers: info.consumerIds,
      requestedFor: request.consumerId || null, outcome: result.ok ? (result.pending ? 'pending' : 'ok') : result.message
    })
    debug(`switch ${planned.switchPath} -> ${JSON.stringify(result.value)} by ${user}: ${result.ok ? 'ok' : result.message}`)
    if (!result.ok) return { status: result.status, body: { error: result.message, ...info } }
    return {
      status: 200,
      body: { ok: true, pending: Boolean(result.pending), path: planned.switchPath, state: request.state, value: result.value, ...info }
    }
  }

  return { plan, put, readState, switchTo }
}

module.exports = { createSwitcher, stateFromValue, valueForState, selfPath, unwrap }
