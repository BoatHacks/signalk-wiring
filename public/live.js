// The Live mode (plan 0017): which consumers are on, switching them from the
// floorplan, circuit diagram and schematics, and live meter readings. The
// plugin knows what can be switched (GET /live) and sends commands
// (POST /switch); the browser reads states and meter values from the
// SignalK stream, which needs no special permission.
//
// The first half is pure and tested (test/live.test.mjs); the second is the
// browser plumbing (a hook, a WebSocket with REST polling as a fallback).

import { useState, useEffect, useRef } from './vendor/preact-standalone.module.js'
import { batteryInputs, batteryReading, batteryPathsToWatch, STALE_MS } from './liveBattery.js'

const ROUTES_BASE = '/plugins/signalk-wiring'
const ON_WORDS = new Set(['on', 'true', '1', 'enabled', 'closed', 'high', 'yes'])
const OFF_WORDS = new Set(['off', 'false', '0', 'disabled', 'open', 'low', 'no'])

// ---- Pure ----

// What a switch path's value means: true, false, or null when unknown.
export function stateFromValue (value) {
  const v = value !== null && typeof value === 'object' && 'value' in value ? value.value : value
  if (typeof v === 'boolean') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
  if (typeof v === 'string') {
    const word = v.trim().toLowerCase()
    if (ON_WORDS.has(word)) return true
    if (OFF_WORDS.has(word)) return false
  }
  return null
}

const stripSelf = (path) => String(path || '').replace(/^vessels\.self\./, '')

// A reading as short text: amps with two decimals below 10, watts whole.
export function formatReading (value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const v = Math.abs(value)
  if (unit === 'W') return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} W`
  return `${v >= 10 ? v.toFixed(1) : v.toFixed(2)} A`
}

// Everything the Live view shows about one device, or null when the device
// is neither a consumer nor a switch.
//   live:   the answer of GET /live ({ consumers, switches })
//   values: Map of SignalK path (without vessels.self.) -> value
// look is what to draw: 'on' | 'off' | 'unknown' | 'locked' | 'fixed'.
export function liveInfo (deviceId, live, values, nameOf = (id) => id, stamps = new Map(), now = Date.now()) {
  if (!live) return null
  const consumer = live.consumers && live.consumers[deviceId]
  const own = live.switches && live.switches[deviceId]
  const stateOf = (sw) => (sw ? stateFromValue(values.get(stripSelf(sw.switchPath))) : null)
  const toState = (b) => (b === true ? 'on' : b === false ? 'off' : 'unknown')

  if (consumer) {
    const sw = consumer.switchDeviceId ? live.switches[consumer.switchDeviceId] : null
    const state = toState(stateOf(sw))
    const clickable = consumer.switchable && !consumer.neverRemote
    const look = consumer.neverRemote ? 'locked' : !consumer.switchable ? 'fixed' : state
    const meter = (consumer.meters || []).find((m) => !m.lowConfidence)
    const reading = meter ? formatReading(values.get(stripSelf(meter.path)), meter.unit) : null
    const via = sw && sw.deviceId !== deviceId ? nameOf(sw.deviceId) : null
    const shared = consumer.sharedWith.map(nameOf)
    let title = nameOf(deviceId)
    if (look === 'locked') title += ': never switched remotely'
    else if (look === 'fixed') title += ': nothing in the wiring can switch it remotely'
    else title += `: ${state}`
    if (via && clickable) title += `. Switched through ${via}`
    if (shared.length > 0 && clickable) title += `, which also feeds ${shared.join(', ')}`
    if (consumer.confirm && clickable) title += '. Asks for confirmation'
    return { kind: 'consumer', look, state, clickable, reading, via, shared, title, confirm: consumer.confirm }
  }
  if (own) {
    const state = toState(stateOf(own))
    const clickable = !own.neverRemote
    const look = own.neverRemote ? 'locked' : state
    const others = own.consumerIds.map(nameOf)
    let title = `${nameOf(deviceId)}: ${state}`
    if (own.neverRemote) title = `${nameOf(deviceId)}: never switched remotely`
    else if (others.length > 0) title += `. Feeds ${others.join(', ')}`
    return { kind: 'switch', look, state, clickable, reading: null, via: null, shared: others, title, confirm: own.confirm }
  }
  const battery = live.batteries && live.batteries[deviceId]
  if (battery) {
    const inputs = batteryInputs(battery, values, stamps, now)
    const reading = batteryReading(inputs)
    return {
      kind: 'battery', look: 'battery', state: 'unknown', clickable: false, reading, stale: inputs.stale, inputs,
      via: null, shared: [], confirm: false,
      title: reading ? `${nameOf(deviceId)}: ${reading}` : `${nameOf(deviceId)}: no values yet`
    }
  }
  return null
}

// The text of the "are you sure" question for a switch that asks.
export function confirmText (body, wantOn) {
  const names = (body.consumerNames || []).filter(Boolean)
  const verb = wantOn ? 'on' : 'off'
  const through = body.switchDeviceName ? ` through ${body.switchDeviceName}` : ''
  return `Switch ${verb}${through}? This switches ${names.length ? names.join(', ') : 'the device'}.`
}

// The SignalK paths the Live view needs: the state of every switch and the
// first trustworthy meter of every consumer.
export function pathsToWatch (live) {
  const paths = new Set()
  if (!live) return []
  for (const sw of Object.values(live.switches || {})) if (sw.switchPath) paths.add(stripSelf(sw.switchPath))
  for (const c of Object.values(live.consumers || {})) {
    const meter = (c.meters || []).find((m) => !m.lowConfidence)
    if (meter) paths.add(stripSelf(meter.path))
  }
  for (const p of batteryPathsToWatch(live)) paths.add(p)
  return [...paths].sort()
}

// Applies the updates of a SignalK delta message to a map of values.
// Returns true when anything changed.
// `selfContext` is the vessel's own context from the server's hello message
// (`vessels.urn:mrn:imo:mmsi:...`): a real server answers a `vessels.self`
// subscription with deltas under that concrete context, not with `vessels.self`.
export function applyDelta (values, message, watching, stamps, now = Date.now(), selfContext = null) {
  if (!message || !Array.isArray(message.updates)) return false
  if (message.context && message.context !== 'vessels.self' && message.context !== selfContext) return false
  let changed = false
  for (const update of message.updates) {
    for (const item of update.values || []) {
      if (!item.path || item.value === undefined) continue
      if (watching && !watching.has(item.path)) continue
      if (values.get(item.path) !== item.value) { values.set(item.path, item.value); changed = true }
      if (stamps) {
        const at = Date.parse(update.timestamp)
        const stamp = Number.isFinite(at) ? at : now
        const before = stamps.get(item.path)
        stamps.set(item.path, stamp)
        if (typeof before === 'number' && now - before > STALE_MS) changed = true
      }
    }
  }
  return changed
}

// ---- Browser plumbing ----

export async function fetchLive () {
  const res = await fetch(`${ROUTES_BASE}/live`)
  if (res.status === 401 || res.status === 403) throw new Error('Log in to SignalK to use the Live view.')
  if (!res.ok) throw new Error(`The Live view could not be loaded (${res.status}).`)
  return res.json()
}

// Sends a switch command through the plugin. Resolves { status, body }.
export async function sendSwitch (target, state, confirmed = false) {
  const res = await fetch(`${ROUTES_BASE}/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, state, confirmed })
  })
  let body = null
  try { body = await res.json() } catch (e) { body = null }
  return { status: res.status, body: body || {} }
}

// Live data for a view while `active` is true. Returns
//   { live, values, connected, error, info(deviceId), toggle(deviceId) }
// `toggle` flips a device, asking for confirmation where the plugin says so;
// it resolves null or throws an Error whose message can be shown.
export function useLive (active, reloadKey = 0, nameOf = (id) => id) {
  const [live, setLive] = useState(null)
  const [values, setValues] = useState(() => new Map())
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const valuesRef = useRef(new Map())
  const stampsRef = useRef(new Map())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    fetchLive()
      .then((data) => { if (!cancelled) { setLive(data); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [active, reloadKey])

  // Re-render now and then so values that stop arriving turn stale.
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [active])

  const watchKey = pathsToWatch(live).join('|')
  useEffect(() => {
    if (!active || !watchKey) return undefined
    const paths = watchKey.split('|')
    const watching = new Set(paths)
    let socket = null
    let retry = null
    let poll = null
    let failures = 0
    let stopped = false
    const publish = () => setValues(new Map(valuesRef.current))

    const startPolling = () => {
      if (poll) return
      const tick = async () => {
        let changed = false
        await Promise.all(paths.map(async (p) => {
          try {
            const res = await fetch(`/signalk/v1/api/vessels/self/${p.replace(/\./g, '/')}`)
            if (!res.ok) return
            const leaf = await res.json()
            const v = leaf && typeof leaf === 'object' && 'value' in leaf ? leaf.value : leaf
            const at = leaf && typeof leaf === 'object' && leaf.timestamp ? Date.parse(leaf.timestamp) : NaN
            stampsRef.current.set(p, Number.isFinite(at) ? at : Date.now())
            if (valuesRef.current.get(p) !== v) { valuesRef.current.set(p, v); changed = true }
          } catch (e) { /* try again next time */ }
        }))
        if (changed && !stopped) publish()
        if (!stopped) setConnected(true)
      }
      tick()
      poll = setInterval(tick, 3000)
    }

    const open = () => {
      if (stopped) return
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      let ws
      try { ws = new WebSocket(`${proto}//${window.location.host}/signalk/v1/stream?subscribe=none`) } catch (e) { startPolling(); return }
      socket = ws
      let selfContext = null
      ws.onopen = () => {
        failures = 0
        setConnected(true)
        ws.send(JSON.stringify({
          context: 'vessels.self',
          subscribe: paths.map((path) => ({ path, period: 1000, policy: 'fixed' }))
        }))
      }
      ws.onmessage = (event) => {
        let message
        try { message = JSON.parse(event.data) } catch (e) { return }
        if (message && typeof message.self === 'string') selfContext = message.self
        if (applyDelta(valuesRef.current, message, watching, stampsRef.current, Date.now(), selfContext)) publish()
      }
      ws.onclose = () => {
        setConnected(false)
        if (stopped) return
        failures++
        if (failures >= 3) { startPolling(); return }
        retry = setTimeout(open, Math.min(8000, 500 * 2 ** failures))
      }
      ws.onerror = () => { try { ws.close() } catch (e) { /* already closed */ } }
    }
    open()
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(poll)
      if (socket) { socket.onclose = null; try { socket.close() } catch (e) { /* already closed */ } }
      setConnected(false)
    }
  }, [active, watchKey])

  const info = (deviceId) => liveInfo(deviceId, live, values, nameOf, stampsRef.current, now)

  const toggle = async (deviceId) => {
    const current = liveInfo(deviceId, live, values, nameOf)
    if (!current || !current.clickable) return null
    const wantOn = current.state !== 'on'
    const target = live.consumers[deviceId] ? { consumerId: deviceId } : { deviceId }
    let result = await sendSwitch(target, wantOn)
    if (result.status === 409 && result.body.confirmationRequired) {
      if (!window.confirm(confirmText(result.body, wantOn))) return null
      result = await sendSwitch(target, wantOn, true)
    }
    if (result.status !== 200) {
      if (result.status === 401 || result.status === 403) throw new Error('Switching needs a read-write login to SignalK.')
      throw new Error(result.body.error || `The switch command failed (${result.status}).`)
    }
    return result.body
  }

  return { live, values, connected, error, info, toggle }
}
