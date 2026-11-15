'use strict'

// Plan 0037 step 2: bus derivation, the advisory checks, and the bus load on
// circuits. Every case is worked out by hand in its comment.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const { Store } = require('../src/store')
const { deriveBus, checkBus, describeBuses, busWatts, LIMITS } = require('../src/buses')
const { registerRoutes } = require('../src/routes')
const { resolveSettings } = require('../src/settings')
const query = require('../src/query')

const dev = (id, extra = {}) => ({ id, name: id, status: 'active', ...extra })
const tap = (deviceId, dropLength, extra = {}) => ({ deviceId, dropLength, ...extra })
// A backbone that passes every check unless a test changes it.
const good = (extra = {}) => ({
  id: 'bb', name: 'Main', cableClass: 'mini', length: 40, lengthUnit: 'm', terminatorA: true, terminatorB: true, supplyRatingA: 4,
  taps: [tap('gps', 1, { along: 5 }), tap('mfd', 2, { along: 10, powerFeed: true, fedFromDeviceId: 'fuse' }), tap('wind', 3, { along: 20 })],
  ...extra
})
const devs = [dev('gps', { len: 2 }), dev('mfd', { len: 4 }), dev('wind', { len: 1 }), dev('fuse', { role: 'distribution' })]
const verdictOf = (bb, devices, id) => checkBus(bb, devices).checks.find((c) => c.id === id).verdict

test('deriveBus: devices, lengths, drops, LEN, terminators and the power feed', () => {
  // Drops 1 + 2 + 3 = 6 m, longest 3 m; LEN 2 + 4 + 1 = 7, so 7 x 0.05 = 0.35 A;
  // two terminators; the feed is the mfd tap from the fuse.
  const d = deriveBus(good(), devs)
  assert.equal(d.deviceCount, 3)
  assert.equal(d.lengthM, 40)
  assert.equal(d.totalDropM, 6)
  assert.equal(d.longestDropM, 3)
  assert.equal(d.terminatorCount, 2)
  assert.equal(d.lenTotal, 7)
  assert.equal(d.impliedCurrentA, 0.35)
  assert.deepEqual(d.lenUnknownDeviceIds, [])
  assert.equal(d.powerFeed.deviceId, 'mfd')
  assert.equal(d.powerFeed.fedFromName, 'fuse')
  // Feet are converted: 100 ft = 30.48 m. A removed device is not on the bus.
  assert.equal(deriveBus(good({ length: 100, lengthUnit: 'ft' }), devs).lengthM, 30.48)
  const gone = deriveBus(good(), devs.map((x) => (x.id === 'wind' ? { ...x, status: 'removed' } : x)))
  assert.equal(gone.deviceCount, 2)
  assert.equal(gone.totalDropM, 3)
  // A device on two ports counts once: LEN 2 once, drops add.
  const two = deriveBus(good({ taps: [tap('gps', 1, { port: 'A' }), tap('gps', 2, { port: 'B' })] }), devs)
  assert.equal(two.deviceCount, 1)
  assert.equal(two.totalDropM, 3)
  assert.equal(two.lenTotal, 2)
})

test('a good backbone passes every check', () => {
  const r = checkBus(good(), devs)
  assert.equal(r.verdict, 'ok')
  assert.deepEqual(r.checks.map((c) => c.id), ['length', 'drop', 'drops-total', 'devices', 'terminators', 'len', 'power-feed'])
  for (const c of r.checks) {
    assert.ok(c.reasoning.length > 0, c.id)
    assert.ok(c.sources.length > 0 && c.sources.every((s) => s.url.startsWith('https://')), c.id)
  }
  assert.match(r.note, /Advisory/)
})

test('backbone length by class', () => {
  // mini limit 100 m: 40 ok, 90 is 90 % so a warning, 101 fails. maxi has the same limit, 100 m (the user chose the strictest figure).
  const v = (cableClass, length) => verdictOf(good({ cableClass, length }), devs, 'length')
  assert.equal(v('mini', 40), 'ok')
  assert.equal(v('mini', 90), 'warning')
  assert.equal(v('mini', 101), 'fail')
  assert.equal(v('micro', 101), 'fail')
  assert.equal(v('maxi', 40), 'ok')
  assert.equal(v('maxi', 91), 'warning')
  assert.equal(v('maxi', 101), 'fail')
  // 300 ft = 91.44 m, a warning for mini.
  assert.equal(verdictOf(good({ length: 300, lengthUnit: 'ft' }), devs, 'length'), 'warning')
})

test('each drop at most 6 m, all drops together at most 78 m', () => {
  const many = (n, drop) => Array.from({ length: n }, (_, i) => tap(`d${i}`, drop))
  const manyDevs = (n) => Array.from({ length: n }, (_, i) => dev(`d${i}`, { len: 1 }))
  assert.equal(verdictOf(good({ taps: [tap('gps', 6)] }), devs, 'drop'), 'ok')
  assert.equal(verdictOf(good({ taps: [tap('gps', 6.5)] }), devs, 'drop'), 'fail')
  // 10 drops of 6 m = 60 m ok (below 70.2, 90 % of 78); 12 x 6 = 72 m is at least 90 % of 78: warning; 14 x 6 = 84 m fails.
  assert.equal(verdictOf(good({ taps: many(10, 6) }), manyDevs(10), 'drops-total'), 'ok')
  assert.equal(verdictOf(good({ taps: many(12, 6) }), manyDevs(12), 'drops-total'), 'warning')
  assert.equal(verdictOf(good({ taps: many(14, 6) }), manyDevs(14), 'drops-total'), 'fail')
  // 12 drops of 6 m = 72 m but the 13th has no length: still not over, so cannot.
  const partial = good({ taps: [...many(12, 6), tap('d12', null)] })
  const c = checkBus(partial, manyDevs(13)).checks.find((x) => x.id === 'drops-total')
  assert.equal(c.verdict, 'cannot')
  assert.deepEqual(c.missing, ['drop length'])
  assert.match(c.reasoning[0], /d12/)
})

test('at most 50 devices', () => {
  const n = (count) => ({ taps: Array.from({ length: count }, (_, i) => tap(`d${i}`, 0.1)), devices: Array.from({ length: count }, (_, i) => dev(`d${i}`, { len: 1 })) })
  // 44 ok, 45 is 90 % of 50 a warning, 50 a warning, 51 fails.
  for (const [count, want] of [[44, 'ok'], [45, 'warning'], [50, 'warning'], [51, 'fail']]) {
    const x = n(count)
    assert.equal(verdictOf(good({ taps: x.taps }), x.devices, 'devices'), want, String(count))
  }
})

test('exactly two terminators', () => {
  assert.equal(verdictOf(good({ terminatorA: true, terminatorB: false }), devs, 'terminators'), 'fail')
  assert.equal(verdictOf(good({ terminatorA: false, terminatorB: false }), devs, 'terminators'), 'fail')
  assert.equal(verdictOf(good(), devs, 'terminators'), 'ok')
})

test('LEN total against the supply rating', () => {
  const withLen = (total, rating) => {
    const d = [dev('x', { len: total })]
    return verdictOf(good({ taps: [tap('x', 1)], supplyRatingA: rating }), d, 'len')
  }
  // LEN 20 = 1.0 A against 5 A: ok. LEN 76 = 3.8 A against 4 A: 90 % of 4 is 3.6, a warning.
  // LEN 70 = 3.5 A against 4 A: not 3.6, but above the 3 A guide figure while the rating is above 3 A: a warning.
  // LEN 50 = 2.5 A against 4 A: ok. LEN 90 = 4.5 A against 4 A: fail. LEN 70 against 3 A: 3.5 > 3, fail.
  assert.equal(withLen(20, 5), 'ok')
  assert.equal(withLen(76, 4), 'warning')
  assert.equal(withLen(70, 4), 'warning')
  assert.equal(withLen(50, 4), 'ok')
  assert.equal(withLen(90, 4), 'fail')
  assert.equal(withLen(70, 3), 'fail')
})

test('a power feed is needed', () => {
  const noFeed = good({ taps: good().taps.map((t) => ({ ...t, powerFeed: false, fedFromDeviceId: null })) })
  assert.equal(verdictOf(noFeed, devs, 'power-feed'), 'fail')
  assert.equal(checkBus(noFeed, devs).verdict, 'fail')
})

test('cannot check names what is missing', () => {
  const bare = { id: 'b', name: 'Bare', taps: [tap('gps', null), tap('wind', 2)] }
  const r = checkBus(bare, [dev('gps'), dev('wind', { len: 1 })])
  const by = (id) => r.checks.find((c) => c.id === id)
  assert.equal(by('length').verdict, 'cannot')
  assert.deepEqual(by('length').missing, ['cable class', 'backbone length'])
  assert.equal(by('drop').verdict, 'cannot')
  assert.match(by('drop').reasoning[0], /gps/)
  assert.equal(by('len').verdict, 'cannot')
  assert.deepEqual(by('len').missing, ['supply rating', 'LEN of gps'])
  // Class given but length missing, and the other way round.
  assert.deepEqual(checkBus({ ...bare, cableClass: 'mini' }, []).checks[0].missing, ['backbone length'])
  assert.deepEqual(checkBus({ ...bare, length: 5 }, []).checks[0].missing, ['cable class'])
  // An unknown length unit cannot be converted.
  assert.deepEqual(checkBus({ ...bare, cableClass: 'mini', length: 5, lengthUnit: 'furlong' }, []).checks[0].missing, ['backbone length'])
  // No device has a LEN: the LEN needs the LENs.
  assert.deepEqual(checkBus({ ...good(), supplyRatingA: 4 }, [dev('gps'), dev('mfd'), dev('wind'), dev('fuse')]).checks.find((c) => c.id === 'len').missing,
    ['LEN of the devices'])
  // Over the rating with part of the LENs known is still a fail: the known part is a lower bound.
  // LEN 100 known on one device = 5 A against 4 A, the other device has none.
  const lb = checkBus(good({ taps: [tap('a', 1), tap('b', 1)] }), [dev('a', { len: 100 }), dev('b')])
  assert.equal(lb.checks.find((c) => c.id === 'len').verdict, 'fail')
})

test('the limits file cites a source for every figure', () => {
  for (const key of ['backboneLength', 'dropLength', 'totalDropLength', 'maxDevices', 'terminator', 'supplyCurrent', 'lenCurrent', 'defaultBusVoltage']) {
    const ids = LIMITS[`${key}Sources`]
    assert.ok(ids && ids.length > 0, key)
    for (const id of ids) assert.match(LIMITS.sources[id].url, /^https:\/\//, id)
  }
  assert.doesNotMatch(JSON.stringify(LIMITS), new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']'))
})

// ---- the bus load on circuits ---------------------------------------------

// Battery (12 V) -> fuse 1 (5 A) -> lamp 1 (24 W); battery -> fuse 2 (10 A) -> lamp 2 (12 W).
function boat (store) {
  const mk = (name, extra) => store.create('device', { name, ...extra })
  const battery = mk('Battery', { role: 'storage', nominal_voltage: 12 })
  const fuse1 = mk('Fuse 1', { role: 'distribution', trip_rating_a: 5 })
  const fuse2 = mk('Fuse 2', { role: 'distribution', trip_rating_a: 10 })
  const lamp1 = mk('Lamp 1', { rated_power_w: 24 })
  const lamp2 = mk('Lamp 2', { rated_power_w: 12 })
  const wire = (id, a, b) => store.create('wireRun', { id, from_device_id: a.id, to_device_id: b.id, conductors: [{ conductor: 'positive' }] })
  wire('w1', battery, fuse1); wire('w2', fuse1, lamp1); wire('w3', battery, fuse2); wire('w4', fuse2, lamp2)
  return { battery, fuse1, fuse2, lamp1, lamp2, mk }
}

test('a boat without backbones is unchanged', async () => {
  const store = new Store(':memory:')
  boat(store)
  const { circuits } = store.deriveAll()
  assert.equal(circuits.length, 2)
  for (const c of circuits) assert.equal('busLoads' in c, false)
  const resources = await query.loadResources(store)
  resources.limits = { critical: 3, normal: 10 }
  const summary = await query.loadSummary(store, resources)
  for (const row of summary.circuits) assert.equal('fromBus' in row.load, false)
  // 24 W at 12 V is 2 A on fuse 1.
  const row = summary.circuits.find((r) => r.load.ratingA === 5)
  assert.equal(row.load.totalWatts, 24)
  assert.equal(row.load.amps, 2)
  assert.deepEqual(query.buses(store), { advisory: query.buses(store).advisory, counts: { ok: 0, warning: 0, fail: 0, cannot: 0 }, buses: [] })
  store.close()
})

test('the bus load reaches the circuit, the load summary and the cable checks; two backbones', async () => {
  const store = new Store(':memory:')
  const { fuse1, fuse2, mk } = boat(store)
  const mfd = mk('MFD', { len: 4 })
  const gps = mk('GPS', { len: 2 })
  const radio = mk('Radio', { rated_power_w: 10 })
  const depth = mk('Depth', { len: 10 })
  const gate = mk('Gateway', { len: 3 })
  // Bus 1 is fed from fuse 1: LEN 4 + 2 + 3 (gateway) = 9 = 0.45 A; at 12 V that is 5.4 W;
  // the radio has no LEN and counts its rated 10 W. Bus total 15.4 W.
  // Circuit 1: lamp 24 W + 15.4 W = 39.4 W, 39.4 / 12 = 3.28333 A against the 5 A fuse.
  const b1 = store.create('backbone', {
    name: 'Bus 1', cable_class: 'mini', length: 20, length_unit: 'm', terminator_a: true, terminator_b: true, supply_rating_a: 4,
    taps: [
      { deviceId: mfd.id, dropLength: 1, powerFeed: true, fedFromDeviceId: fuse1.id },
      { deviceId: gps.id, dropLength: 1 }, { deviceId: radio.id, dropLength: 2 }, { deviceId: gate.id, port: 'NMEA 2000 A', dropLength: 1 }
    ]
  })
  // Bus 2 is fed from fuse 2: LEN 10 + 3 (the gateway sits on both) = 13 = 0.65 A, 7.8 W.
  // Circuit 2: lamp 12 W + 7.8 W = 19.8 W, 1.65 A against the 10 A fuse.
  const b2 = store.create('backbone', {
    name: 'Bus 2', cable_class: 'micro', length: 10, length_unit: 'm', terminator_a: true, terminator_b: true, supply_rating_a: 3,
    taps: [{ deviceId: depth.id, dropLength: 1, powerFeed: true, fedFromDeviceId: fuse2.id }, { deviceId: gate.id, port: 'NMEA 2000 B', dropLength: 1 }]
  })
  const derived = store.deriveAll()
  const c1 = derived.circuits.find((c) => c.protectorId === fuse1.id)
  const c2 = derived.circuits.find((c) => c.protectorId === fuse2.id)
  assert.equal(c1.busLoads.length, 1)
  assert.equal(c1.busLoads[0].backboneId, b1.id)
  assert.equal(c1.busLoads[0].fromBus, true)
  assert.equal(c1.busLoads[0].lenTotal, 9)
  assert.equal(c1.busLoads[0].fallbackWatts, 10)
  assert.ok(Math.abs(busWatts(c1.busLoads, 12) - 15.4) < 1e-9)
  assert.ok(Math.abs(busWatts(c2.busLoads, 12) - 7.8) < 1e-9)
  assert.equal(c2.busLoads[0].backboneId, b2.id)

  const resources = await query.loadResources(store)
  resources.limits = { critical: 3, normal: 10 }
  const summary = await query.loadSummary(store, resources)
  const r1 = summary.circuits.find((r) => r.load.ratingA === 5).load
  assert.equal(r1.fromBus, true)
  assert.ok(Math.abs(r1.busWatts - 15.4) < 1e-9)
  assert.ok(Math.abs(r1.totalWatts - 39.4) < 1e-9)
  assert.ok(Math.abs(r1.amps - 39.4 / 12) < 1e-9)
  const r2 = summary.circuits.find((r) => r.load.ratingA === 10).load
  assert.ok(Math.abs(r2.amps - 1.65) < 1e-9)

  // The cable checks see the same figure: rated current of circuit 1.
  const { circuitInput } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'cableChecks.js')).href)
  const deviceById = new Map(resources.devices.map((d) => [d.id, d]))
  const rec = resources.circuits.find((c) => c.derived && c.derived.protectorId === fuse1.id)
  assert.ok(Math.abs(circuitInput(rec, deviceById).ratedA - 39.4 / 12) < 1e-9)

  // GET /buses: both backbones with derived data, the circuit named, and the checks.
  const routes = {}
  const registrar = (level) => { const r = {}; for (const m of ['get', 'put', 'post', 'delete']) r[m] = (p, ...h) => { routes[`${m} ${p}`] = h; return r }; return r }
  registerRoutes({ ...registrar('admin'), access: () => registrar('readonly') }, () => store, os.tmpdir(), () => resolveSettings({}))
  const body = await new Promise((resolve) => {
    const res = { status () { return this }, json: resolve }
    const hs = routes['get /buses']; let i = 0
    const req = {}
    const next = () => { const h = hs[i++]; if (h) h(req, res, next) }
    next()
  })
  assert.equal(body.buses.length, 2)
  const x1 = body.buses.find((b) => b.id === b1.id)
  assert.equal(x1.derived.deviceCount, 4)
  assert.equal(x1.derived.lenTotal, 9)
  assert.equal(x1.derived.circuit.key, c1.key)
  assert.ok(x1.derived.circuit.id)
  // Bus 1: no radio LEN, so the LEN check cannot be made and says so.
  assert.equal(x1.checks.find((c) => c.id === 'len').verdict, 'cannot')
  assert.deepEqual(x1.checks.find((c) => c.id === 'len').missing, ['LEN of Radio'])
  // Bus 2: LEN 13 = 0.65 A against 3 A, ok.
  assert.equal(body.buses.find((b) => b.id === b2.id).checks.find((c) => c.id === 'len').verdict, 'ok')
  assert.equal(body.counts.ok + body.counts.warning + body.counts.fail + body.counts.cannot, 2)
  // Removing a backbone takes its load away.
  store.remove('backbone', b1.id)
  assert.equal('busLoads' in store.deriveAll().circuits.find((c) => c.protectorId === fuse1.id), false)
  assert.equal(describeBuses(store.busInputs().backbones, store.busInputs().busDevices).length, 1)
  store.close()
})
