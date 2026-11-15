import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  valuesUrl, providersUrl, hasProvider, providersAvailable, parseSeries, fetchSeries, mapLimit, shouldRefresh,
  refreshSeries, sparkline, sparklinePath, HISTORY_REFRESH_MS, HISTORY_MAX_PATHS
} from '../public/history.js'

const ok = (body) => ({ ok: true, json: async () => body })
const fail = (status) => ({ ok: false, status, json: async () => ({}) })

test('the values request is one hour at one minute, averaged, with the path encoded', () => {
  assert.equal(
    valuesUrl('electrical.batteries.0.current'),
    '/signalk/v2/api/history/values?paths=electrical.batteries.0.current%3Aaverage&duration=PT1H&resolution=60'
  )
  assert.match(valuesUrl('vessels.self.a.b'), /paths=a\.b%3Aaverage/)
  assert.equal(providersUrl(), '/signalk/v2/api/history/_providers')
})

test('a provider list with an entry means history is available', () => {
  assert.equal(hasProvider({ questdb: { isDefault: true } }), true)
  assert.equal(hasProvider({}), false)
  assert.equal(hasProvider(null), false)
  assert.equal(hasProvider([]), false)
  assert.equal(hasProvider('x'), false)
})

test('providersAvailable: present, absent, failing and throwing', async () => {
  assert.equal(await providersAvailable(async () => ok({ questdb: {} })), true)
  assert.equal(await providersAvailable(async () => ok({})), false)
  assert.equal(await providersAvailable(async () => fail(404)), false)
  assert.equal(await providersAvailable(async () => { throw new Error('offline') }), false)
  assert.equal(await providersAvailable(async () => ({ ok: true, json: async () => { throw new Error('bad json') } })), false)
})

test('parseSeries: rows to samples, null kept as a gap, rows without a time skipped, oldest first', () => {
  const body = {
    data: [
      ['2026-01-01T00:02:00Z', 3],
      ['2026-01-01T00:01:00Z', null],
      ['nonsense', 9],
      ['2026-01-01T00:00:00Z', 1.5],
      ['2026-01-01T00:03:00Z', 'x'],
      'junk'
    ]
  }
  const s = parseSeries(body)
  assert.deepEqual(s.map((p) => p.v), [1.5, null, 3, null])
  assert.equal(s[0].t, Date.parse('2026-01-01T00:00:00Z'))
  assert.deepEqual(parseSeries(null), [])
  assert.deepEqual(parseSeries({}), [])
})

test('fetchSeries: an answer, an error status and a thrown error', async () => {
  assert.equal((await fetchSeries(async () => ok({ data: [[1000, 2]] }), 'a.b'))[0].v, 2)
  assert.equal(await fetchSeries(async () => fail(500), 'a.b'), null)
  assert.equal(await fetchSeries(async () => { throw new Error('x') }, 'a.b'), null)
})

test('mapLimit never runs more than the limit at once and keeps the order', async () => {
  let running = 0
  let peak = 0
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    return n * 2
  })
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14])
  assert.equal(peak, 3)
  assert.deepEqual(await mapLimit([], 3, async (x) => x), [])
})

test('shouldRefresh: first time yes, then every five minutes, never while hidden', () => {
  assert.equal(shouldRefresh({ lastAt: null, now: 1000, hidden: false }), true)
  assert.equal(shouldRefresh({ lastAt: undefined, now: 1000, hidden: false }), true)
  assert.equal(shouldRefresh({ lastAt: 0, now: HISTORY_REFRESH_MS - 1, hidden: false }), false)
  assert.equal(shouldRefresh({ lastAt: 0, now: HISTORY_REFRESH_MS, hidden: false }), true)
  assert.equal(shouldRefresh({ lastAt: null, now: 1000, hidden: true }), false)
  assert.equal(shouldRefresh({ lastAt: 0, now: HISTORY_REFRESH_MS * 10, hidden: true }), false)
})

test('refreshSeries: one request per path, only the due ones again, failures kept as null', async () => {
  const calls = []
  const fetchFn = async (url) => {
    calls.push(decodeURIComponent(url.match(/paths=([^&]*)/)[1]))
    if (url.includes('bad')) return fail(500)
    return ok({ data: [[1000, 1]] })
  }
  const first = await refreshSeries(fetchFn, ['a', 'b', 'bad', 'a'], new Map(), 1000)
  assert.deepEqual(calls.sort(), ['a:average', 'b:average', 'bad:average'])
  assert.equal(first.get('bad').points, null)
  assert.equal(first.get('a').points.length, 1)
  calls.length = 0
  // four minutes later nothing is due; a new path is fetched alone
  const second = await refreshSeries(fetchFn, ['a', 'b', 'c'], first, 1000 + 4 * 60000)
  assert.deepEqual(calls, ['c:average'])
  assert.equal(second.get('a').at, 1000)
  calls.length = 0
  // five minutes after the first fetch everything but c is due again
  await refreshSeries(fetchFn, ['a', 'b', 'c'], second, 1000 + HISTORY_REFRESH_MS)
  assert.deepEqual(calls.sort(), ['a:average', 'b:average'])
})

test('refreshSeries asks for at most the maximum number of paths', async () => {
  let n = 0
  const paths = Array.from({ length: HISTORY_MAX_PATHS + 10 }, (_, i) => 'p' + i)
  const out = await refreshSeries(async () => { n++; return ok({ data: [] }) }, paths, new Map(), 0)
  assert.equal(n, HISTORY_MAX_PATHS)
  assert.equal(out.size, HISTORY_MAX_PATHS)
})

test('sparkline: points fit the box, the lowest value at the bottom, gaps split the line', () => {
  const pts = [{ t: 0, v: 0 }, { t: 10, v: 10 }, { t: 20, v: null }, { t: 30, v: 5 }, { t: 40, v: 10 }]
  const s = sparkline(pts, 100, 20, 0)
  assert.deepEqual(s.runs, [[[0, 20], [25, 0]], [[75, 10], [100, 0]]])
  assert.equal(s.min, 0)
  assert.equal(s.max, 10)
  assert.equal(s.last, 10)
  assert.equal(sparklinePath(s.runs), 'M0 20 L25 0 M75 10 L100 0')
})

test('sparkline: a flat series is a line in the middle, too few samples draw nothing', () => {
  const s = sparkline([{ t: 0, v: 3 }, { t: 10, v: 3 }], 100, 20, 0)
  assert.deepEqual(s.runs, [[[0, 10], [100, 10]]])
  assert.equal(sparkline([{ t: 0, v: 3 }], 100, 20), null)
  assert.equal(sparkline([{ t: 0, v: null }, { t: 1, v: null }], 100, 20), null)
  assert.equal(sparkline([], 100, 20), null)
  assert.equal(sparkline(null, 100, 20), null)
  assert.equal(sparklinePath([[[5, 5]]]), 'M5 5h0.1')
})
