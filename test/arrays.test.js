'use strict'

// Plan 0048: golden cases for the pure solar array derivation.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveArrays } = require('../src/arrays')

const panel = (id, extra = {}) => ({
  id, name: id, type: 'Solar panel', role: 'source', status: 'active',
  ratedPowerW: 240, vocV: 44.11, iscA: 6.5, vmpV: 37.89, impA: 6.2, vocTempCoeff: -0.3, ...extra
})
const mppt = (extra = {}) => ({ id: 'mppt', name: 'MPPT', type: 'MPPT charger', role: 'converter', status: 'active', pvMaxV: 150, pvMaxA: 35, pvMaxW: 1000, ...extra })
const breaker = { id: 'brk', name: 'PV breaker', type: 'Breaker', role: 'distribution', status: 'active', tripRatingA: 10 }
let n = 0
const link = (a, b, kind, extra = {}) => ({ id: `c${String(++n).padStart(3, '0')}`, fromDeviceId: a, toDeviceId: b, status: 'active', link: kind, ...extra })
const feed = (a, b) => link(a, b, null, { conductors: [{ conductor: 'positive' }] })
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} is not near ${b}`)
const codes = (a) => a.checks.map((c) => c.code)
const check = (a, code) => a.checks.find((c) => c.code === code)

const threeS = () => ({
  devices: [panel('a'), panel('b'), panel('c'), breaker, mppt()],
  cables: [link('a', 'b', 'series'), link('b', 'c', 'series'), feed('a', 'brk'), feed('brk', 'mppt')]
})

test('one panel is an array of one', () => {
  const [arr] = deriveArrays({ devices: [panel('a')], cables: [] })
  assert.deepEqual(arr.panelIds, ['a'])
  assert.deepEqual(arr.strings, [['a']])
  assert.equal(arr.layout.label, '1S1P')
  assert.equal(arr.voc, 44.11)
  assert.equal(arr.complete, true)
})

test('a non-panel device and a removed panel are not in any array', () => {
  const arrays = deriveArrays({ devices: [panel('a'), panel('b', { status: 'removed' }), { id: 'x', name: 'x', type: 'Wind generator', role: 'source', status: 'active' }], cables: [] })
  assert.equal(arrays.length, 1)
})

test('the real boat: three panels in series', () => {
  const [arr, ...rest] = deriveArrays(threeS())
  assert.equal(rest.length, 0)
  assert.deepEqual(arr.strings, [['a', 'b', 'c']])
  assert.equal(arr.layout.label, '3S1P')
  near(arr.voc, 132.33)
  near(arr.vmp, 113.67)
  assert.equal(arr.iscA, 6.5)
  assert.equal(arr.impA, 6.2)
  assert.equal(arr.powerW, 720)
  assert.deepEqual(arr.controllerIds, ['mppt'])
})

test('cold voltage uses the coefficient and the cold temperature', () => {
  const [arr] = deriveArrays({ ...threeS(), coldTemperatureC: -10 })
  // 132.33 x (1 + (-0.3 / 100) x (-10 - 25)) = 132.33 x 1.105
  near(arr.vocCold, 132.33 * 1.105, 0.05)
  assert.equal(arr.assumedCoeff, false)
  const colder = deriveArrays({ ...threeS(), coldTemperatureC: -20 })[0]
  assert.ok(colder.vocCold > arr.vocCold)
})

test('a missing coefficient assumes -0.30 %/C and says so', () => {
  const d = threeS()
  d.devices = d.devices.map((x) => (x.id === 'b' ? { ...x, vocTempCoeff: null } : x))
  const [arr] = deriveArrays(d)
  assert.equal(arr.assumedCoeff, true)
  near(arr.vocCold, 132.33 * 1.105, 0.05)
})

test('two parallel strings of two: voltage of one string, currents add', () => {
  const [arr] = deriveArrays({
    devices: [panel('a'), panel('b'), panel('c'), panel('d')],
    cables: [link('a', 'b', 'series'), link('c', 'd', 'series'), link('a', 'c', 'parallel')]
  })
  assert.equal(arr.layout.label, '2S2P')
  near(arr.vmp, 75.78)
  near(arr.iscA, 13)
  assert.equal(arr.powerW, 960)
})

test('a plain cable between panels counts as parallel', () => {
  const [arr] = deriveArrays({ devices: [panel('a'), panel('b')], cables: [link('a', 'b', null)] })
  assert.equal(arr.layout.label, '1S2P')
})

test('the weakest panel limits a string current', () => {
  const [arr] = deriveArrays({
    devices: [panel('a'), panel('b', { iscA: 5, impA: 4.8 })],
    cables: [link('a', 'b', 'series')]
  })
  assert.equal(arr.iscA, 5)
  assert.equal(arr.impA, 4.8)
})

test('missing figures name the panel and leave the totals out', () => {
  const [arr] = deriveArrays({ devices: [panel('a'), panel('b', { vocV: null })], cables: [link('a', 'b', 'series')] })
  assert.equal(arr.complete, false)
  assert.deepEqual(arr.missing, [{ deviceId: 'b', fields: ['vocV'] }])
  assert.equal(arr.voc, null)
  assert.equal(arr.vocCold, null)
  assert.equal(arr.vmp, 75.78)
})

test('a series cycle, a branch and a mixed link are not reducible', () => {
  const cyc = deriveArrays({ devices: [panel('a'), panel('b'), panel('c')], cables: [link('a', 'b', 'series'), link('b', 'c', 'series'), link('c', 'a', 'series')] })[0]
  assert.equal(cyc.warnings[0].code, 'not-reducible')
  assert.equal(cyc.vmp, null)
  assert.equal(cyc.complete, false)
  const branch = deriveArrays({ devices: [panel('a'), panel('b'), panel('c'), panel('d')], cables: [link('a', 'b', 'series'), link('a', 'c', 'series'), link('a', 'd', 'series')] })[0]
  assert.equal(branch.warnings[0].code, 'not-reducible')
  const mixed = deriveArrays({ devices: [panel('a'), panel('b')], cables: [link('a', 'b', 'series'), link('a', 'b', 'parallel')] })[0]
  assert.equal(mixed.warnings[0].code, 'not-reducible')
})

test('uneven strings warn and parallel strings of unlike voltage get a note', () => {
  const [arr] = deriveArrays({
    devices: [panel('a'), panel('b'), panel('c')],
    cables: [link('a', 'b', 'series'), link('a', 'c', 'parallel')]
  })
  assert.equal(arr.warnings[0].code, 'uneven-strings')
  assert.ok(codes(arr).includes('strings-differ-in-vmp'))
  near(arr.vmp, 37.89)
})

test('the controller is found through the PV breaker; none gives a note', () => {
  assert.deepEqual(deriveArrays(threeS())[0].controllerIds, ['mppt'])
  const [arr] = deriveArrays({ devices: [panel('a'), breaker], cables: [feed('a', 'brk')] })
  assert.deepEqual(arr.controllerIds, [])
  assert.deepEqual(codes(arr), ['no-controller'])
})

test('voltage check: ok under 90 %, note from 90 %, warning above the limit', () => {
  const at = (pvMaxV) => check(deriveArrays({ ...threeS(), devices: threeS().devices.map((d) => (d.id === 'mppt' ? { ...d, pvMaxV } : d)) })[0], 'voc-cold')
  const cold = 132.33 * 1.105 // 146.2 V
  assert.equal(at(250).level, 'ok')
  assert.equal(at(Math.ceil(cold / 0.95)).level, 'note')
  assert.equal(at(145).level, 'warning')
  assert.match(at(145).message, /may exceed/)
  assert.match(at(250).message, /within/)
})

test('current check: weakest string current, summed across strings', () => {
  const d = (pvMaxA) => ({
    devices: [panel('a'), panel('b'), breaker, mppt({ pvMaxA })],
    cables: [link('a', 'b', 'parallel'), feed('a', 'brk'), feed('brk', 'mppt')]
  })
  assert.equal(check(deriveArrays(d(35))[0], 'current').level, 'ok')
  assert.equal(check(deriveArrays(d(13.5))[0], 'current').level, 'note')
  assert.equal(check(deriveArrays(d(12))[0], 'current').level, 'warning')
})

test('power check is a note at most, never a warning', () => {
  const d = (pvMaxW) => ({ ...threeS(), devices: threeS().devices.map((x) => (x.id === 'mppt' ? { ...x, pvMaxW } : x)) })
  assert.equal(check(deriveArrays(d(1000))[0], 'power').level, 'ok')
  assert.equal(check(deriveArrays(d(500))[0], 'power').level, 'note')
})

test('a controller with no limits entered is skipped with a note', () => {
  const d = threeS()
  d.devices = d.devices.map((x) => (x.id === 'mppt' ? { ...x, pvMaxV: null, pvMaxA: null, pvMaxW: null } : x))
  const [arr] = deriveArrays(d)
  assert.deepEqual(codes(arr), ['voc-no-limit', 'current-no-limit'])
  assert.ok(arr.checks.every((c) => c.level === 'note'))
})

test('missing panel data skips the checks that need it', () => {
  const d = threeS()
  d.devices = d.devices.map((x) => (x.id === 'c' ? { ...x, vocV: null, iscA: null } : x))
  const codesOf = codes(deriveArrays(d)[0])
  assert.deepEqual(codesOf, ['voc-skipped', 'current-skipped', 'power'])
})

test('two arrays are told apart and sorted', () => {
  const arrays = deriveArrays({ devices: [panel('b'), panel('a'), panel('c')], cables: [link('b', 'c', 'series')] })
  assert.deepEqual(arrays.map((a) => a.panelIds), [['a'], ['b', 'c']])
})
