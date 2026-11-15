// The history client of the Dashboard (plan 0038): small sparklines of the last
// hour from the standard SignalK history routes, when a history provider is
// installed. The first half is pure and tested (test/history.test.mjs) and takes
// the fetch function as an argument; the second is a hook.
//
// A server with no history provider answers the provider list with an empty
// object or an error. That is not a failure: the sparklines are simply not
// shown. A failing request for one path leaves that path without a sparkline.

import { useState, useEffect, useRef } from './vendor/preact-standalone.module.js'

export const HISTORY_BASE = '/signalk/v2/api/history'
export const HISTORY_DURATION = 'PT1H'
export const HISTORY_RESOLUTION_S = 60
export const HISTORY_REFRESH_MS = 5 * 60 * 1000
export const HISTORY_CONCURRENCY = 3
export const HISTORY_MAX_PATHS = 30

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

// The URL of the last hour of one path, averaged per minute.
export function valuesUrl (path) {
  const p = String(path).replace(/^vessels\.self\./, '')
  return `${HISTORY_BASE}/values?paths=${encodeURIComponent(p + ':average')}&duration=${HISTORY_DURATION}&resolution=${HISTORY_RESOLUTION_S}`
}

export const providersUrl = () => `${HISTORY_BASE}/_providers`

// Does the answer of the provider list name at least one provider?
export function hasProvider (body) {
  return Boolean(body) && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0
}

// Asks the provider list. Any failure, a missing route included, is "none".
export async function providersAvailable (fetchFn) {
  try {
    const res = await fetchFn(providersUrl())
    if (!res.ok) return false
    return hasProvider(await res.json())
  } catch (e) {
    return false
  }
}

// The samples of one answer of /values as [{ t, v }], oldest first, v null for
// a gap. The first value column is used. Rows without a readable time are skipped.
export function parseSeries (body) {
  const rows = body && Array.isArray(body.data) ? body.data : []
  const out = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const t = typeof row[0] === 'number' ? row[0] : Date.parse(row[0])
    if (!Number.isFinite(t)) continue
    out.push({ t, v: finite(row[1]) ? row[1] : null })
  }
  return out.sort((a, b) => a.t - b.t)
}

// The series of one path, or null when the request failed or answered badly.
export async function fetchSeries (fetchFn, path) {
  try {
    const res = await fetchFn(valuesUrl(path))
    if (!res.ok) return null
    return parseSeries(await res.json())
  } catch (e) {
    return null
  }
}

// Runs `task` over `items` with at most `limit` at a time. Results in order.
export async function mapLimit (items, limit, task) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await task(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// Time to ask again? Never while the page is hidden; otherwise when nothing
// was fetched yet or the last fetch is `everyMs` old.
export function shouldRefresh ({ lastAt, now, hidden, everyMs = HISTORY_REFRESH_MS }) {
  if (hidden) return false
  if (typeof lastAt !== 'number') return true
  return now - lastAt >= everyMs
}

// Fetches the series of the paths that have none yet or an old one. Returns a
// new Map path -> { at, points } (points null when that request failed); the
// previous map is kept for paths that were not due. At most HISTORY_MAX_PATHS.
export async function refreshSeries (fetchFn, paths, previous, now, everyMs = HISTORY_REFRESH_MS) {
  const wanted = [...new Set(paths)].slice(0, HISTORY_MAX_PATHS)
  const next = new Map()
  const due = []
  for (const p of wanted) {
    const old = previous.get(p)
    if (old && now - old.at < everyMs) next.set(p, old)
    else due.push(p)
  }
  await mapLimit(due, HISTORY_CONCURRENCY, async (p) => {
    next.set(p, { at: now, points: await fetchSeries(fetchFn, p) })
  })
  return next
}

// The polyline of a series in a box, as a list of runs of [x, y] points: a gap
// (null sample) ends a run, so nothing is drawn across missing data. The
// vertical range fits the samples with a little room; a flat series sits in the
// middle. Returns null when there are fewer than two real samples.
export function sparkline (points, width, height, pad = 2) {
  const real = (points || []).filter((p) => p.v !== null)
  if (real.length < 2) return null
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const lo = Math.min(...real.map((p) => p.v))
  const hi = Math.max(...real.map((p) => p.v))
  const x = (t) => (t1 === t0 ? width / 2 : pad + ((t - t0) / (t1 - t0)) * (width - 2 * pad))
  const y = (v) => (hi === lo ? height / 2 : height - pad - ((v - lo) / (hi - lo)) * (height - 2 * pad))
  const runs = []
  let run = []
  for (const p of points) {
    if (p.v === null) { if (run.length) runs.push(run); run = []; continue }
    run.push([Math.round(x(p.t) * 10) / 10, Math.round(y(p.v) * 10) / 10])
  }
  if (run.length) runs.push(run)
  return { runs, min: lo, max: hi, last: real[real.length - 1].v }
}

// An SVG path string of the runs; a run of one sample is a short dot.
export function sparklinePath (runs) {
  return runs.map((r) => (r.length === 1
    ? `M${r[0][0]} ${r[0][1]}h0.1`
    : 'M' + r.map(([x, y]) => `${x} ${y}`).join(' L'))).join(' ')
}

// ---- Browser plumbing ----

// History for the paths while `enabled` is true. Returns
//   { available, series }   available: null (asking), true or false
// series is a Map path -> points (null when that request failed). Nothing is
// asked while the page is hidden; the page asks again when it is shown after
// the refresh time, and every minute checks whether the refresh time is up.
export function useHistory (paths, enabled) {
  const [state, setState] = useState({ available: null, series: new Map() })
  const cache = useRef({ available: null, series: new Map(), lastAt: null })
  const key = [...new Set(paths)].sort().join('|')

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    let busy = false
    const wanted = key ? key.split('|') : []
    const run = async (force) => {
      if (busy || cancelled) return
      const hidden = typeof document !== 'undefined' && document.hidden
      const now = Date.now()
      const c = cache.current
      const missing = wanted.some((p) => !c.series.has(p))
      if (!force && !missing && !shouldRefresh({ lastAt: c.lastAt, now, hidden })) return
      if (hidden) return
      busy = true
      try {
        if (c.available === null) c.available = await providersAvailable((u) => fetch(u))
        if (cancelled) return
        if (c.available && wanted.length > 0) {
          c.series = await refreshSeries((u) => fetch(u), wanted, c.series, now)
          c.lastAt = now
        }
        if (!cancelled) setState({ available: c.available, series: new Map([...c.series].map(([p, v]) => [p, v.points])) })
      } finally {
        busy = false
      }
    }
    run(false)
    const timer = setInterval(() => run(false), 60000)
    const onVisible = () => { if (!document.hidden) run(false) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, key])

  return state
}
