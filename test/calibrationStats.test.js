'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deltaStats, watchStats, detectStep, downsample, toWatts, mean, stddev } = require('../src/calibrationStats')

// A deterministic wobble so "noise" is repeatable: values within +-amp of the level.
const wobble = (level, amp, n, seed = 0) =>
  Array.from({ length: n }, (_, i) => level + amp * Math.sin((i + seed) * 2.3))

const cycle = (base, step, amp, n = 8, seed = 0, after = base) => ({
  before: wobble(base, amp, n, seed), on: wobble(base + step, amp, n, seed + 1), after: wobble(after, amp, n, seed + 2)
})

test('mean and stddev', () => {
  assert.equal(mean([1, 2, 3]), 2)
  assert.ok(Math.abs(stddev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.001)
  assert.equal(stddev([5]), 0)
})

test('delta: a clean step of 3 A on a flat baseline is 3 A with no warnings', () => {
  const result = deltaStats([cycle(10, 3, 0.02), cycle(10, 3, 0.02, 8, 5), cycle(10, 3, 0.02, 8, 9)])
  assert.ok(Math.abs(result.average - 3) < 0.05)
  assert.ok(result.spread < 0.05)
  assert.deepEqual(result.warnings, [])
  assert.equal(result.confidence, 'high')
  assert.ok(result.peak >= result.average)
})

test('delta: the baseline either side is averaged, so a steady drift is split evenly', () => {
  // The baseline drifts up by 0.3 A over each cycle; the step is still 3 A.
  const result = deltaStats([cycle(10, 3, 0.01, 8, 0, 10.3), cycle(10.3, 3, 0.01, 8, 3, 10.6), cycle(10.6, 3, 0.01, 8, 6, 10.9)])
  assert.ok(Math.abs(result.average - 2.85) < 0.1) // the on level is 3 A over the start of the cycle, the mid baseline is 0.15 A higher
  assert.ok(!result.warnings.includes('noisy'))
})

test('delta: a baseline that moves a lot in a cycle warns about drift', () => {
  const result = deltaStats([cycle(10, 2, 0.01, 8, 0, 11.5), cycle(10, 2, 0.01, 8, 3, 11.5), cycle(10, 2, 0.01, 8, 6, 11.5)])
  assert.ok(result.warnings.includes('drift'))
  assert.notEqual(result.confidence, 'high')
})

test('delta: readings that jump around warn that they are noisy and cost confidence', () => {
  const result = deltaStats([cycle(10, 2, 1.2), cycle(10, 2, 1.2, 8, 4), cycle(10, 2, 1.2, 8, 8)])
  assert.ok(result.warnings.includes('noisy'))
  assert.notEqual(result.confidence, 'high')
})

test('delta: repeats that disagree show up as spread', () => {
  const result = deltaStats([cycle(10, 2, 0.01), cycle(10, 3, 0.01, 8, 4), cycle(10, 4, 0.01, 8, 8)])
  assert.ok(Math.abs(result.average - 3) < 0.05)
  assert.ok(result.spread > 0.9)
  assert.ok(result.warnings.includes('noisy'))
})

test('delta: nothing changing is no-step, and a step lost in noise is small-step', () => {
  const flat = deltaStats([cycle(10, 0, 0), cycle(10, 0, 0, 8, 2), cycle(10, 0, 0, 8, 4)])
  assert.ok(flat.warnings.includes('no-step'))
  assert.equal(flat.confidence, 'low')
  const lost = deltaStats([cycle(10, 0.3, 1), cycle(10, 0.3, 1, 8, 3), cycle(10, 0.3, 1, 8, 6)])
  assert.ok(lost.warnings.includes('small-step'))
  assert.equal(lost.confidence, 'low')
})

test('delta: a single cycle works but warns, and no cycles is a failed result', () => {
  const one = deltaStats([cycle(10, 3, 0.01)])
  assert.ok(one.warnings.includes('few-cycles'))
  assert.ok(Math.abs(one.average - 3) < 0.05)
  const none = deltaStats([{ before: [], on: [], after: [] }])
  assert.ok(Number.isNaN(none.average))
  assert.equal(none.confidence, 'low')
})

test('watch: a steady load is on all the time at its level', () => {
  const samples = Array.from({ length: 60 }, (_, i) => [i, 100 + (i % 2)])
  const r = watchStats(samples)
  assert.ok(Math.abs(r.average - 100.5) < 0.6)
  assert.equal(r.peak, 101)
  assert.equal(r.dutyCycle, 1)
})

test('watch: a cycling kettle gives the average, the peak and the share of time on', () => {
  // 2000 W for 30 s, off for 30 s, twice over.
  const samples = []
  for (let t = 0; t < 120; t++) samples.push([t, t % 60 < 30 ? 2000 : 0])
  const r = watchStats(samples)
  assert.equal(r.peak, 2000)
  assert.ok(Math.abs(r.dutyCycle - 0.5) < 0.02)
  assert.ok(Math.abs(r.average - 1000) < 20)
  assert.ok(Math.abs(r.averageOn - 2000) < 1)
  assert.equal(r.threshold, 200)
})

test('watch: the threshold can be changed and the duty cycle follows', () => {
  // A hob that idles at 300 W between 1800 W bursts.
  const samples = []
  for (let t = 0; t < 100; t++) samples.push([t, t % 10 < 3 ? 1800 : 300])
  const low = watchStats(samples, { threshold: 100 })
  assert.equal(low.dutyCycle, 1)
  const high = watchStats(samples, { threshold: 1000 })
  assert.ok(Math.abs(high.dutyCycle - 0.3) < 0.02)
  assert.equal(high.threshold, 1000)
})

test('watch: the resting reading taken from a baseline is subtracted and sets a noise floor', () => {
  const baseline = wobble(40, 2, 20)
  const samples = Array.from({ length: 30 }, (_, i) => [i, 40 + (i < 10 ? 0 : 500)])
  const r = watchStats(samples, { baseline })
  assert.ok(Math.abs(r.peak - 500) < 3)
  assert.ok(Math.abs(r.dutyCycle - 2 / 3) < 0.05)
  assert.ok(r.threshold >= 3 * r.noise)
})

test('watch: no data and too few samples are said so', () => {
  assert.deepEqual(watchStats([]).warnings, ['no-data'])
  assert.ok(watchStats([[0, 5], [1, 5]]).warnings.includes('few-samples'))
  assert.ok(watchStats(Array.from({ length: 10 }, (_, i) => [i, 0])).warnings.includes('no-step'))
})

test('step detection: needs a settled, clear, steady change', () => {
  const base = { mean: 10, noise: 0.05 }
  assert.equal(detectStep([10, 10.01, 9.99, 10], base).stepped, false)
  assert.equal(detectStep([10, 10, 13], base).stepped, false) // not yet settled
  const up = detectStep([10, 12.9, 13, 13.1], base)
  assert.deepEqual([up.stepped, up.direction], [true, 'up'])
  const down = detectStep([13, 10.1, 10, 10], { mean: 13, noise: 0.05 })
  assert.deepEqual([down.stepped, down.direction], [true, 'down'])
  assert.equal(detectStep([10, 11, 12, 13], base).stepped, false) // still climbing
  assert.equal(detectStep([10, 10.2, 10.3, 10.2], { mean: 10, noise: 0.2 }).stepped, false) // inside the noise
})

test('downsample keeps the peak and the length limit', () => {
  const samples = Array.from({ length: 1000 }, (_, i) => [i, i === 437 ? 99 : 1])
  const out = downsample(samples, 100)
  assert.ok(out.length <= 100)
  assert.ok(out.some((s) => s[1] === 99))
  assert.equal(downsample(samples.slice(0, 10), 100).length, 10)
})

test('watts: a watt meter is used as is, amps need a voltage and are an estimate', () => {
  assert.deepEqual(toWatts(36, 'W', null), { value: 36, estimate: false })
  assert.deepEqual(toWatts(3, 'A', 12), { value: 36, estimate: true })
  assert.equal(toWatts(3, 'A', null).value, null)
})

test('a meter that counts the load as negative gives the same positive result', () => {
  const up = deltaStats([cycle(10, 3, 0.02), cycle(10, 3, 0.02, 8, 5)])
  const flip = (c) => ({ before: c.before.map((v) => -v), on: c.on.map((v) => -v), after: c.after.map((v) => -v) })
  const down = deltaStats([flip(cycle(10, 3, 0.02)), flip(cycle(10, 3, 0.02, 8, 5))])
  assert.equal(down.inverted, true)
  assert.equal(up.inverted, false)
  assert.ok(Math.abs(down.average - up.average) < 0.01)
  assert.ok(Math.abs(down.peak - up.peak) < 0.1)

  const samples = []
  for (let t = 0; t < 60; t++) samples.push([t, t % 20 < 10 ? -105 : -5])
  const r = watchStats(samples, { baseline: [-5, -5, -5, -5] })
  assert.equal(r.inverted, true)
  assert.equal(r.peak, 100)
  assert.ok(Math.abs(r.dutyCycle - 0.5) < 0.02)
})
