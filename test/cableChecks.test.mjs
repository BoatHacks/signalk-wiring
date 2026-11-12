import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  checkCable, checkAll, circuitInput, chooseCurrent, deratingFactor, bundleCount, ampacityFor,
  resistivity, lengthMetres, isSignalOnly, powerConductorCount, badgesFor, wireMark, countVerdicts, DEFAULT_LIMITS,
  liveAmpsByCircuit, pathMidpoint, explain, ADVISORY_NOTE
} from '../public/cableChecks.js'
import { AMPACITY_A, AWG_AREA_MM2, SOURCES, DERATING } from '../public/cableAmpacity.js'
import { AWG_SIZES, MM2_SIZES } from '../public/gauge.js'

// Copper resistivity used throughout: 0.0185 ohm mm2/m at 20 C, coefficient
// 0.00393 per K, operating at 50 C:
//   rho = 0.0185 * (1 + 0.00393 * 30) = 0.0185 * 1.1179 = 0.02068115 ohm mm2/m
const RHO = 0.02068115
const near = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`)

// A circuit input as circuitInput() makes it.
const circ = (o = {}) => ({
  id: 'c1', name: 'Test', ratingA: null, voltage: 12, ac: false, critical: false,
  ratedA: null, measuredA: null, powerFactor: 1, ...o
})
const cable = (o = {}) => ({
  id: 'w1', status: 'active', gauge: 4, gaugeUnit: 'mm2', length: 5, lengthUnit: 'm',
  conductors: [{ conductor: 'positive' }, { conductor: 'negative' }], ...o
})

test('the table covers every gauge the form offers and only rises with size', () => {
  for (const n of AWG_SIZES) assert.ok(AMPACITY_A.AWG[String(n)] > 0, `AWG ${n}`)
  for (const n of MM2_SIZES) assert.ok(AMPACITY_A.mm2[String(n)] > 0, `mm2 ${n}`)
  const awg = AWG_SIZES.map((n) => AMPACITY_A.AWG[String(n)])
  const mm2 = MM2_SIZES.map((n) => AMPACITY_A.mm2[String(n)])
  for (let i = 1; i < awg.length; i++) assert.ok(awg[i] >= awg[i - 1])
  for (let i = 1; i < mm2.length; i++) assert.ok(mm2[i] >= mm2[i - 1])
  for (const v of [...awg, ...mm2]) assert.equal(v % 5, 0, 'rounded down to 5 A')
  for (const n of AWG_SIZES) assert.ok(AWG_AREA_MM2[String(n)] > 0)
})

test('the table is the lower of the sources, rounded down to 5 A (hand check)', () => {
  // 10 AWG: single conductor 60 A (30 C source), up to three conductors 55 A
  // (40 C source): the lower, 55, rounds down to 55.
  assert.equal(AMPACITY_A.AWG['10'], 55)
  // 6 AWG: 120 and 96; lower 96, rounded down to 95.
  assert.equal(AMPACITY_A.AWG['6'], 95)
  // 4/0 (stored -3): 445 and 332; lower 332, rounded down to 330.
  assert.equal(AMPACITY_A.AWG['-3'], 330)
  // 2.5 mm2: interpolated 37.3 A, manufacturer 29 A; lower 29, down to 25.
  assert.equal(AMPACITY_A.mm2['2.5'], 25)
  // 25 mm2: interpolated 133.0, manufacturer 170; lower 133.0, down to 130.
  assert.equal(AMPACITY_A.mm2['25'], 130)
})

test('the data file cites every source with a URL and docs list them too', () => {
  const docs = fs.readFileSync(new URL('../docs/cable-checks.md', import.meta.url), 'utf8')
  for (const s of SOURCES) {
    assert.match(s.url, /^https:\/\//)
    assert.ok(docs.includes(s.url), `docs/cable-checks.md names ${s.url}`)
  }
  const data = fs.readFileSync(new URL('../public/cableAmpacity.js', import.meta.url), 'utf8')
  const text = data + docs
  assert.ok(!/[\u2013\u2014]/.test(text), 'no em or en dashes')
})

test('ampacityFor finds sizes and refuses unknown ones', () => {
  assert.deepEqual(ampacityFor(4, 'mm2'), { baseA: 35, areaMm2: 4 })
  assert.deepEqual(ampacityFor('10', 'AWG'), { baseA: 55, areaMm2: 5.26 })
  assert.deepEqual(ampacityFor(0, 'AWG'), { baseA: 215, areaMm2: 53.49 }) // 1/0
  assert.equal(ampacityFor(3, 'mm2'), null) // not a table size
  assert.equal(ampacityFor(4, ''), null)
  assert.equal(ampacityFor(null, 'mm2'), null)
  assert.equal(ampacityFor('', 'AWG'), null)
})

test('derating factors by number of current-carrying conductors', () => {
  assert.deepEqual([1, 2, 3, 4, 6, 7, 24, 25, 100].map(deratingFactor), [1, 1, 0.7, 0.6, 0.6, 0.5, 0.5, 0.35, 0.35])
  assert.ok(DERATING.length > 0)
})

test('conductor counting: earth and signal do not count; none listed is one positive', () => {
  assert.equal(powerConductorCount({ conductors: [] }), 1)
  assert.equal(powerConductorCount({ conductors: [{ conductor: 'line' }, { conductor: 'neutral' }, { conductor: 'earth' }] }), 2)
  assert.equal(powerConductorCount({ conductors: [{ conductor: 'positive' }, { conductor: 'signal' }] }), 1)
  assert.equal(isSignalOnly({ conductors: [{ conductor: 'signal' }] }), true)
  assert.equal(isSignalOnly({ conductors: [{ conductor: 'signal' }, { conductor: 'positive' }] }), false)
  assert.equal(isSignalOnly({ conductors: [] }), false)
})

test('bundleCount adds the conductors of the other cables in the same conduits', () => {
  const a = { id: 'a', conduitIds: ['k1'], conductors: [{ conductor: 'positive' }, { conductor: 'negative' }] }
  const b = { id: 'b', conduitIds: ['k1'], conductors: [{ conductor: 'positive' }] }
  const c = { id: 'c', conduitIds: ['k1'], conductors: [{ conductor: 'signal' }] }
  const gone = { id: 'd', status: 'removed', conduitIds: ['k1'], conductors: [{ conductor: 'positive' }] }
  const alone = { id: 'e', conduitIds: [], conductors: [{ conductor: 'positive' }] }
  const conduits = [{ id: 'k1', cableIds: ['a', 'b', 'c', 'd'] }]
  // a: 2, b: 1, signal c: 0, removed d: ignored = 3
  assert.equal(bundleCount(a, [a, b, c, gone, alone], conduits), 3)
  assert.equal(bundleCount(alone, [a, b, c, gone, alone], conduits), 1)
  assert.equal(bundleCount(a, [a, b, c, gone], [{ id: 'k1', status: 'removed', cableIds: ['a', 'b'] }]), 2)
})

test('resistivity and length helpers', () => {
  near(resistivity(), RHO)
  assert.equal(lengthMetres(5, 'm'), 5)
  near(lengthMetres(10, 'ft'), 3.048)
  assert.equal(lengthMetres('', 'm'), null)
  assert.equal(lengthMetres(0, 'm'), null)
})

test('chooseCurrent: rated, else protection, and measured only raises', () => {
  assert.deepEqual(chooseCurrent({ measuredA: null, ratedA: 8, ratingA: 20 }), { amps: 8, source: 'rated power' })
  assert.deepEqual(chooseCurrent({ measuredA: null, ratedA: null, ratingA: 20 }), { amps: 20, source: 'protection rating' })
  assert.deepEqual(chooseCurrent({ measuredA: 12, ratedA: 8, ratingA: 20 }), { amps: 12, source: 'measured' })
  assert.deepEqual(chooseCurrent({ measuredA: 5, ratedA: 8, ratingA: 20 }), { amps: 8, source: 'rated power' })
  assert.deepEqual(chooseCurrent({ measuredA: 5, ratedA: null, ratingA: 20 }), { amps: 20, source: 'protection rating' })
  assert.deepEqual(chooseCurrent({ measuredA: 25, ratedA: null, ratingA: 20 }), { amps: 25, source: 'measured' })
  assert.deepEqual(chooseCurrent({ measuredA: 5, ratedA: null, ratingA: null }), { amps: 5, source: 'measured' })
  assert.deepEqual(chooseCurrent({ measuredA: null, ratedA: null, ratingA: null }), { amps: null, source: null })
})

test('DC voltage drop from rated power, against both limits', () => {
  // 4 mm2 cable, 5 m, 12 V, 100 W rated: I = 100 / 12 = 8.33333 A.
  // Round trip 2 * 5 = 10 m; R = 0.02068115 * 10 / 4 = 0.05170288 ohm.
  // Drop = 8.33333 * 0.05170288 = 0.430857 V = 3.5905 % of 12 V.
  // Normal limit 10 %: ok. Critical limit 3 %: warning.
  const circuit = circ({ ratingA: 20, ratedA: 100 / 12 })
  const normal = checkCable(cable(), { circuits: [circuit] })
  near(normal.drop.roundTripM, 10)
  near(normal.drop.resistanceOhm, 0.05170288, 1e-7)
  near(normal.drop.currentA, 8.333333, 1e-5)
  assert.equal(normal.drop.currentSource, 'rated power')
  near(normal.drop.dropV, 0.430857, 1e-5)
  near(normal.drop.dropPercent, 3.5905, 1e-3)
  assert.equal(normal.drop.limitKind, 'normal')
  assert.equal(normal.drop.limitPercent, 10)
  assert.equal(normal.verdict, 'ok')
  const critical = checkCable(cable(), { circuits: [{ ...circuit, critical: true }] })
  assert.equal(critical.drop.limitKind, 'critical')
  assert.equal(critical.drop.limitPercent, 3)
  assert.equal(critical.drop.verdict, 'warning')
  assert.equal(critical.verdict, 'warning')
})

test('the limits are settable; a drop exactly at the limit is ok', () => {
  const circuit = circ({ ratingA: 20, ratedA: 100 / 12 })
  const r = checkCable(cable(), { circuits: [circuit], limits: { normal: 3 } })
  assert.equal(r.drop.limitPercent, 3)
  assert.equal(r.verdict, 'warning') // 3.59 % over 3 %
  const r2 = checkCable(cable(), { circuits: [circuit], limits: { normal: 3.5905 + 0.01 } })
  assert.equal(r2.verdict, 'ok')
  assert.deepEqual(DEFAULT_LIMITS, { critical: 3, normal: 10 })
})

test('feet are converted before the round trip', () => {
  // 16.404 ft = 5.0000 m (16.404 * 0.3048 = 4.99998), so about the same as the metric case.
  const r = checkCable(cable({ length: 10, lengthUnit: 'ft' }), { circuits: [circ({ ratingA: 20, ratedA: 100 / 12 })] })
  near(r.drop.lengthM, 3.048)
  near(r.drop.roundTripM, 6.096)
})

test('AWG sizes use their area: 10 AWG, 10 m, protection rating as the current', () => {
  // 10 AWG = 5.26 mm2, base 55 A. 12 V, 30 A protection, no rated power: I = 30 A
  // from the protection rating. Round trip 20 m; R = 0.02068115 * 20 / 5.26 = 0.0786355 ohm.
  // Drop = 30 * 0.0786355 = 2.359066 V = 19.659 % of 12 V: warning (normal limit 10 %).
  const r = checkCable(cable({ gauge: 10, gaugeUnit: 'AWG', length: 10 }), { circuits: [circ({ ratingA: 30 })] })
  assert.equal(r.drop.currentSource, 'protection rating')
  near(r.drop.resistanceOhm, 0.0786355, 1e-6)
  near(r.drop.dropPercent, 19.659, 1e-2)
  assert.equal(r.verdict, 'warning')
  assert.equal(r.ampacity.verdict, 'ok') // 30 A <= 55 A
})

test('a measured current raises the estimate but never lowers it', () => {
  const base = { ratingA: 20, ratedA: 100 / 12 }
  const higher = checkCable(cable(), { circuits: [circ({ ...base, measuredA: 12 })] })
  assert.equal(higher.drop.currentSource, 'measured')
  near(higher.drop.currentA, 12)
  // 12 A * 0.05170288 = 0.620435 V = 5.1703 %
  near(higher.drop.dropPercent, 5.1703, 1e-3)
  const lower = checkCable(cable(), { circuits: [circ({ ...base, measuredA: 2 })] })
  assert.equal(lower.drop.currentSource, 'rated power')
  near(lower.drop.currentA, 100 / 12, 1e-6)
})

test('AC: line and neutral round trip, power factor, 230 V', () => {
  // 2.5 mm2, 20 m, 1500 W at power factor 0.8 on 230 V: VA = 1500 / 0.8 = 1875,
  // I = 1875 / 230 = 8.152174 A. Round trip 40 m: R = 0.02068115 * 40 / 2.5 = 0.3308984 ohm.
  // Drop = I * R * pf = 8.152174 * 0.3308984 * 0.8 = 2.158034 V = 0.93828 % of 230 V.
  const ac = cable({
    gauge: 2.5, length: 20, conductors: [{ conductor: 'line' }, { conductor: 'neutral' }, { conductor: 'earth' }]
  })
  const r = checkCable(ac, { circuits: [circ({ voltage: 230, ac: true, ratingA: 10, ratedA: 1875 / 230, powerFactor: 0.8 })] })
  near(r.drop.currentA, 8.152174, 1e-5)
  near(r.drop.resistanceOhm, 0.3308984, 1e-6)
  assert.equal(r.drop.powerFactor, 0.8)
  near(r.drop.dropV, 2.158034, 1e-4)
  near(r.drop.dropPercent, 0.93828, 1e-4)
  assert.equal(r.verdict, 'ok')
  // Ampacity: 2.5 mm2 base 25 A, two current-carrying conductors (earth not counted): factor 1.
  assert.equal(r.ampacity.conductorCount, 2)
  assert.equal(r.ampacity.deratedA, 25)
  // 10 A protection <= 25 A and 8.15 A load: ok.
})

test('ampacity against the protection: derating decides', () => {
  // 10 AWG base 55 A. Three current-carrying conductors in a bundle: factor 0.7,
  // derated 55 * 0.7 = 38.5 A. A 40 A fuse is more than the cable can carry: fail.
  const c = cable({ gauge: 10, gaugeUnit: 'AWG' })
  const fail = checkCable(c, { circuits: [circ({ ratingA: 40 })], count: 3 })
  near(fail.ampacity.deratedA, 38.5)
  assert.equal(fail.ampacity.verdict, 'fail')
  assert.deepEqual(fail.ampacity.issues, ['protection'])
  assert.equal(fail.verdict, 'fail')
  // A 35 A fuse is within 38.5 A: ok. Alone (two conductors) a 40 A fuse is within 55 A.
  assert.equal(checkCable(c, { circuits: [circ({ ratingA: 35 })], count: 3 }).ampacity.verdict, 'ok')
  assert.equal(checkCable(c, { circuits: [circ({ ratingA: 40 })], count: 2 }).ampacity.verdict, 'ok')
  // Seven conductors: 55 * 0.5 = 27.5 A, so 30 A fails.
  const seven = checkCable(c, { circuits: [circ({ ratingA: 30 })], count: 7 })
  near(seven.ampacity.deratedA, 27.5)
  assert.equal(seven.ampacity.verdict, 'fail')
})

test('ampacity against a known load when nothing protects the circuit', () => {
  // 2.5 mm2 base 25 A, two conductors, no derating. 360 W on 12 V = 30 A > 25 A: fail on the load.
  const r = checkCable(cable({ gauge: 2.5 }), { circuits: [circ({ ratedA: 30 })] })
  assert.equal(r.ampacity.verdict, 'fail')
  assert.deepEqual(r.ampacity.issues, ['load'])
  assert.equal(r.ampacity.loadSource, 'rated power')
  assert.equal(r.ampacity.protectionA, null)
  // A measured 31 A on a 20 W load raises it too.
  const m = checkCable(cable({ gauge: 2.5 }), { circuits: [circ({ ratedA: 2, measuredA: 31 })] })
  assert.deepEqual(m.ampacity.issues, ['load'])
  assert.equal(m.ampacity.loadSource, 'measured')
  // Protection rating alone is check 1, not a load: a 20 A fuse on 25 A is fine.
  const ok = checkCable(cable({ gauge: 2.5 }), { circuits: [circ({ ratingA: 20 })] })
  assert.equal(ok.ampacity.verdict, 'ok')
  assert.equal(ok.ampacity.loadA, null)
})

test('signal-only cables are exempt; mixed cables are checked on the power conductors', () => {
  const sig = cable({ conductors: [{ conductor: 'signal' }], gauge: '', length: '' })
  assert.deepEqual(checkCable(sig, { circuits: [] }), { verdict: 'exempt', exempt: true, missing: [] })
  assert.deepEqual(badgesFor(checkCable(sig)), [])
  assert.equal(wireMark(checkCable(sig)), null)
  // positive + signal: one power conductor, factor 1. 4 mm2 = 35 A: a 40 A fuse fails.
  const mixed = cable({ conductors: [{ conductor: 'positive' }, { conductor: 'signal' }] })
  const r = checkCable(mixed, { circuits: [circ({ ratingA: 40 })], count: powerConductorCount(mixed) })
  assert.equal(r.ampacity.conductorCount, 1)
  assert.equal(r.verdict, 'fail')
  // checkAll leaves exempt cables out of the results
  const results = checkAll({
    cables: [sig, { ...mixed, id: 'w2' }], circuits: [], devices: [], conduits: []
  })
  assert.deepEqual([...results.keys()], ['w2'])
})

test('missing data: each case names what is missing', () => {
  const full = { circuits: [circ({ ratingA: 20, ratedA: 5 })] }
  const noGauge = checkCable(cable({ gauge: '' }), full)
  assert.equal(noGauge.verdict, 'cannot')
  assert.deepEqual(noGauge.missing, ['gauge'])
  const oddGauge = checkCable(cable({ gauge: 3 }), full) // 3 mm2 is not a table size
  assert.deepEqual(oddGauge.missing, ['gauge'])
  const noLength = checkCable(cable({ length: '' }), full)
  assert.equal(noLength.verdict, 'ok') // the ampacity check could be made
  assert.deepEqual(noLength.missing, ['length'])
  assert.equal(noLength.drop.verdict, 'cannot')
  assert.deepEqual(badgesFor(noLength).map((b) => b.text), ['cannot check: needs length'])
  const noVoltage = checkCable(cable(), { circuits: [circ({ ratingA: 20, voltage: null })] })
  assert.deepEqual(noVoltage.missing, ['voltage'])
  assert.equal(noVoltage.ampacity.verdict, 'ok')
  const noCircuit = checkCable(cable(), { circuits: [] })
  assert.equal(noCircuit.verdict, 'cannot')
  assert.deepEqual(noCircuit.missing, ['circuit'])
  const noCurrent = checkCable(cable(), { circuits: [circ()] })
  assert.equal(noCurrent.verdict, 'cannot')
  assert.deepEqual(noCurrent.missing, ['fuse or breaker rating or rated load'])
  const several = checkCable(cable({ gauge: '', length: '' }), { circuits: [circ({ voltage: null })] })
  assert.deepEqual(several.missing, ['gauge', 'fuse or breaker rating or rated load', 'length', 'voltage'])
  assert.equal(badgesFor(several)[0].text, 'cannot check: needs gauge, fuse or breaker rating or rated load, length and voltage')
})

test('a return cable shared by two circuits carries both', () => {
  // Fuses 10 A and 15 A add to 25 A on a shared 2.5 mm2 return (25 A): ok.
  const a = circ({ id: 'a', name: 'A', ratingA: 10, ratedA: 4 })
  const b = circ({ id: 'b', name: 'B', ratingA: 15, ratedA: 6 })
  const r = checkCable(cable({ gauge: 2.5 }), { circuits: [a, b] })
  assert.equal(r.ampacity.protectionA, 25)
  assert.equal(r.ampacity.verdict, 'ok')
  assert.equal(r.ampacity.loadA, 10) // 4 + 6 rated
  assert.deepEqual(r.circuits, ['A', 'B'])
  // One circuit with no rated load makes the sum unknown, so the protection rating stands in for the drop.
  const c = circ({ id: 'c', name: 'C', ratingA: 5 })
  const partial = checkCable(cable({ gauge: 2.5 }), { circuits: [a, c] })
  assert.equal(partial.drop.currentSource, 'protection rating')
  assert.equal(partial.drop.currentA, 15)
})

test('circuitInput: rated amps, power factor, critical devices, partial ratings', () => {
  const devices = new Map([
    ['l1', { id: 'l1', status: 'active', role: 'consumer', type: 'Cabin light', ratedPowerW: 24 }],
    ['p1', { id: 'p1', status: 'active', role: 'consumer', type: 'Bilge pump', ratedPowerW: 48 }],
    ['x1', { id: 'x1', status: 'active', role: 'consumer', type: 'Fan' }],
    ['h1', { id: 'h1', status: 'active', role: 'consumer', type: 'Heater', ratedPowerW: 1000, powerFactor: 0.5 }],
    ['sw', { id: 'sw', status: 'active', role: 'distribution', type: 'Fridge', ratedPowerW: 5 }]
  ])
  const dc = circuitInput({
    id: 'c', name: 'Lights', status: 'active',
    derived: { ratingA: 10, voltage: 12, ac: false, endDeviceIds: ['l1', 'p1'], deviceIds: ['l1', 'p1', 'sw'] }
  }, devices, new Map())
  assert.equal(dc.ratedA, 6) // 72 W / 12 V
  assert.equal(dc.critical, true) // the bilge pump
  assert.equal(dc.ratingA, 10)
  assert.equal(dc.measuredA, null)
  // An unrated consumer makes the sum partial: no rated current.
  assert.equal(circuitInput({ id: 'c', derived: { voltage: 12, endDeviceIds: ['l1', 'x1'], deviceIds: ['l1', 'x1'] } }, devices).ratedA, null)
  // AC: 1000 W at pf 0.5 on 230 V is 2000 VA = 8.695652 A
  const ac = circuitInput({ id: 'a', derived: { voltage: 230, ac: true, endDeviceIds: ['h1'], deviceIds: ['h1'] } }, devices)
  near(ac.ratedA, 2000 / 230)
  assert.equal(ac.powerFactor, 0.5)
  assert.equal(ac.critical, false)
  // Live amps raise: a live 3 A on the 6 A circuit changes nothing in the choice, but is carried.
  const live = circuitInput({ id: 'c', derived: { voltage: 12, endDeviceIds: ['l1'], deviceIds: ['l1'] } }, devices, new Map([['c', 3]]))
  assert.equal(live.measuredA, 3)
  // no voltage: no rated current
  assert.equal(circuitInput({ id: 'c', derived: { endDeviceIds: ['l1'], deviceIds: ['l1'] } }, devices).ratedA, null)
})

test('checkAll joins cables to circuits through positive and return cable ids', () => {
  const devices = [
    { id: 'p1', status: 'active', role: 'consumer', type: 'Bilge pump', ratedPowerW: 60 }
  ]
  const circuits = [{
    id: 'c1', status: 'active', name: 'Bilge',
    derived: { ratingA: 10, voltage: 12, ac: false, cableIds: ['w1'], returnCableIds: ['w2'], endDeviceIds: ['p1'], deviceIds: ['p1'] }
  }]
  const cables = [
    cable({ id: 'w1', conductors: [{ conductor: 'positive' }], gauge: 1.5, length: 8 }),
    cable({ id: 'w2', conductors: [{ conductor: 'negative' }], gauge: 1.5, length: 8 })
  ]
  const results = checkAll({ cables, circuits, devices, conduits: [], limits: { critical: 3, normal: 10 } })
  // 60 W / 12 V = 5 A. 1.5 mm2, 8 m, round trip 16 m: R = 0.02068115 * 16 / 1.5 = 0.2205989 ohm.
  // Drop = 5 * 0.2205989 = 1.1029945 V = 9.1916 %: critical (bilge pump) limit 3 %: warning.
  const r = results.get('w1')
  assert.equal(r.drop.limitKind, 'critical')
  near(r.drop.dropPercent, 9.1916, 1e-3)
  assert.equal(r.verdict, 'warning')
  assert.equal(results.get('w2').verdict, 'warning')
  const counts = countVerdicts(results)
  assert.deepEqual(counts, { ok: 0, warning: 2, fail: 0, cannot: 0 })
})

test('badges and the wire mark', () => {
  const fail = checkCable(cable({ gauge: 10, gaugeUnit: 'AWG' }), { circuits: [circ({ ratingA: 40, voltage: 12 })], count: 3 })
  // Drop with the 40 A protection as the current: 5 m, round trip 10 m, 5.26 mm2:
  // R = 0.02068115 * 10 / 5.26 = 0.0393179 ohm; 40 * 0.0393179 = 1.572716 V = 13.1 % of 12 V, over 10 %.
  assert.deepEqual(badgesFor(fail).map((b) => b.text), ['cable too small', 'voltage drop high'])
  const mark = wireMark(fail)
  assert.equal(mark.verdict, 'fail')
  assert.match(mark.text, /Cable too small for 38.5 A/)
  assert.match(mark.text, /Advisory only/)
  const ok = checkCable(cable(), { circuits: [circ({ ratingA: 20, ratedA: 2 })] })
  assert.deepEqual(badgesFor(ok).map((b) => b.text), ['checks ok'])
  assert.equal(wireMark(ok), null)
  const warn = checkCable(cable(), { circuits: [circ({ ratingA: 20, ratedA: 100 / 12, critical: true })] })
  assert.deepEqual(badgesFor(warn).map((b) => b.text), ['voltage drop high'])
  assert.match(wireMark(warn).text, /Voltage drop 3.6 % is over the critical limit of 3 %/)
  assert.equal(wireMark(checkCable(cable(), { circuits: [] })), null)
})

test('liveAmpsByCircuit sums the live meters of the consumers a circuit ends at', () => {
  const live = { consumers: {
    a: { meters: [{ path: 'electrical.a.current', unit: 'A' }] },
    b: { meters: [{ path: 'electrical.b.power', unit: 'W' }] },
    c: { meters: [{ path: 'electrical.c.current', unit: 'A', lowConfidence: true }] }
  } }
  const values = new Map([['electrical.a.current', 2], ['electrical.b.power', 24], ['electrical.c.current', 9]])
  const circuits = [
    { id: 'x', derived: { voltage: 12, endDeviceIds: ['a', 'b', 'c'] } },
    { id: 'y', derived: { voltage: 12, endDeviceIds: ['c'] } },
    { id: 'z', derived: { voltage: 12, endDeviceIds: ['a'] } }
  ]
  // x: 2 A + 24 W / 12 V = 2 + 2 = 4 A; the low-confidence meter is ignored; y has no reading
  const out = liveAmpsByCircuit(circuits, live, values)
  assert.equal(out.get('x'), 4)
  assert.equal(out.has('y'), false)
  assert.equal(out.get('z'), 2)
  assert.equal(liveAmpsByCircuit(circuits, null, values).size, 0)
  assert.equal(liveAmpsByCircuit(circuits, live, new Map()).size, 0)
})

test('pathMidpoint is halfway along the length', () => {
  assert.deepEqual(pathMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }]), { x: 5, y: 0 })
  // lengths 10 and 30: the middle is 20 along, 10 into the second segment
  assert.deepEqual(pathMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }]), { x: 10, y: 10 })
  assert.equal(pathMidpoint([{ x: 1, y: 1 }]), null)
  assert.deepEqual(pathMidpoint([{ x: 2, y: 3 }, { x: 2, y: 3 }]), { x: 2, y: 3 })
})

test('explain names each number and its source, and carries the advisory note', () => {
  const r = checkCable(cable(), { circuits: [circ({ ratingA: 20, ratedA: 100 / 12, critical: true })] })
  const e = explain(r)
  const text = e.sections.flatMap((s) => s.lines).join('\n')
  assert.match(text, /Table figure 35 A/)
  assert.match(text, /Fuse or breaker: 20 A \(protection rating\)/)
  assert.match(text, /Load: 8.3 A \(rated power/)
  assert.match(text, /round trip 10 m/)
  assert.match(text, /3\.6 % of the voltage, against the critical limit of 3 %/)
  assert.equal(e.note, ADVISORY_NOTE)
  assert.match(ADVISORY_NOTE, /Advisory/)
  assert.ok(e.assumptions.some((l) => /105 C insulation, 30 C ambient/.test(l)))
  const missing = explain(checkCable(cable({ length: '' }), { circuits: [circ({ ratingA: 20 })] }))
  assert.match(missing.sections[1].lines[0], /Not checked: needs length/)
  assert.equal(explain(checkCable(cable({ conductors: [{ conductor: 'signal' }] }))), null)
})
