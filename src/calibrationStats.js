'use strict'

// The arithmetic of load calibration (plan 0017). Pure: samples in, numbers
// out, so it is tested with synthetic series (test/calibrationStats.test.js).
// Readings are in the meter's unit (amps or watts); toWatts() turns a result
// into watts at the end.

const mean = (xs) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length)

// Sample standard deviation; 0 for fewer than two values.
function stddev (xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1))
}

const round = (x, digits = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** digits) / 10 ** digits : x)

// ---- Delta: baseline, on, baseline, repeated ----
//
// cycles: [{ before: [values], on: [values], after: [values] }]
// One cycle's step is the mean while on minus the mean of the baselines
// either side of it. The result is the average step with its spread (the
// sample standard deviation of the steps), the noise of the baselines, and
// warnings. peak is the highest reading while on, above the baseline.
//
// Warnings: 'noisy' (baseline noise or spread large against the step),
// 'drift' (the baseline moved during a cycle by a good part of the step),
// 'small-step' (the step is not clearly above the noise), 'no-step'
// (nothing changed), 'few-cycles' (fewer than two usable cycles).
function deltaStats (cycles) {
  const usable = cycles.filter((c) => c.before.length > 0 && c.on.length > 0 && c.after.length > 0)
  const steps = []
  const peaks = []
  const drifts = []
  const baselineValues = []
  for (const c of usable) {
    const base = (mean(c.before) + mean(c.after)) / 2
    steps.push(mean(c.on) - base)
    peaks.push(Math.max(...c.on) - base)
    drifts.push(Math.abs(mean(c.after) - mean(c.before)))
    baselineValues.push(c.before, c.after)
  }
  if (steps.length === 0) {
    return { average: NaN, peak: NaN, spread: 0, noise: 0, steps: [], warnings: ['no-step'], confidence: 'low' }
  }
  const average = mean(steps)
  const spread = stddev(steps)
  // Noise: the typical scatter of a baseline stretch around its own mean.
  const noise = mean(baselineValues.map((b) => stddev(b)))
  const maxDrift = Math.max(...drifts)
  const size = Math.abs(average)

  const warnings = []
  if (usable.length < 2) warnings.push('few-cycles')
  if (size < 1e-9) warnings.push('no-step')
  else if (size < 3 * noise) warnings.push('small-step')
  if (size > 0 && (spread > 0.1 * size || noise > 0.25 * size)) warnings.push('noisy')
  if (size > 0 && maxDrift > 0.25 * size) warnings.push('drift')

  const confidence = warnings.length === 0 ? 'high' : warnings.length === 1 && warnings[0] !== 'no-step' && warnings[0] !== 'small-step' ? 'medium' : 'low'
  return {
    average: round(average),
    peak: round(Math.max(...peaks)),
    spread: round(spread),
    noise: round(noise),
    maxDrift: round(maxDrift),
    steps: steps.map((s) => round(s)),
    warnings,
    confidence
  }
}

// ---- Watch: a device runs and the meter is watched ----
//
// samples: [[seconds, value]] in time order. baseline: optional values read
// with the device off, used to take the resting reading off and to know the
// noise. The device counts as on when a reading above the resting level is
// higher than the threshold: `threshold` if given, otherwise 10 percent of
// the peak, and never less than three times the baseline noise.
//
// Returns the peak, the average over the whole watch (what the energy
// check wants), the average while on, and the duty cycle (the share of the
// time on, weighting each reading by the time it stands for).
function watchStats (samples, { baseline = [], threshold = null, thresholdFraction = 0.1 } = {}) {
  const rest = baseline.length > 0 ? mean(baseline) : 0
  const noise = baseline.length > 1 ? stddev(baseline) : 0
  if (samples.length === 0) {
    return { average: NaN, averageOn: NaN, peak: NaN, dutyCycle: NaN, threshold: NaN, noise, rest, warnings: ['no-data'], confidence: 'low' }
  }
  const adjusted = samples.map(([t, v]) => [t, Math.max(0, v - rest)])
  const peak = Math.max(...adjusted.map((s) => s[1]))
  const floor = 3 * noise
  const level = threshold != null && Number.isFinite(threshold) ? threshold : Math.max(thresholdFraction * peak, floor)

  // Each reading stands for the time up to the next one (the last one for
  // as long as the typical gap).
  const gaps = adjusted.slice(1).map((s, i) => s[0] - adjusted[i][0])
  const typical = gaps.length > 0 ? mean(gaps) : 1
  const weights = adjusted.map((s, i) => (i < adjusted.length - 1 ? gaps[i] : typical))
  const total = weights.reduce((a, b) => a + b, 0)
  let energy = 0
  let onTime = 0
  let onEnergy = 0
  adjusted.forEach(([, v], i) => {
    energy += v * weights[i]
    if (v > level) { onTime += weights[i]; onEnergy += v * weights[i] }
  })

  const warnings = []
  if (peak < 1e-9) warnings.push('no-step')
  else if (peak < 3 * noise) warnings.push('small-step')
  if (adjusted.length < 5) warnings.push('few-samples')
  if (peak > 0 && noise > 0.25 * peak) warnings.push('noisy')
  const confidence = warnings.length === 0 ? 'high' : warnings.length === 1 && warnings[0] !== 'no-step' && warnings[0] !== 'small-step' ? 'medium' : 'low'
  return {
    average: round(total > 0 ? energy / total : NaN),
    averageOn: round(onTime > 0 ? onEnergy / onTime : NaN),
    peak: round(peak),
    dutyCycle: round(total > 0 ? onTime / total : NaN),
    threshold: round(level),
    noise: round(noise),
    rest: round(rest),
    warnings,
    confidence
  }
}

// ---- Noticing a clear step in a live reading ----
//
// recent: the latest readings, oldest first. baseline: { mean, noise } of the
// reading before the step. A step is seen when the last `settled` readings
// all sit clearly away from the baseline in the same direction (more than
// `minStep` and more than five times the noise) and agree with each other.
function detectStep (recent, baseline, { settled = 3, minStep = 0 } = {}) {
  if (recent.length < settled) return { stepped: false }
  const tail = recent.slice(-settled)
  const level = mean(tail)
  const delta = level - baseline.mean
  const need = Math.max(minStep, 5 * (baseline.noise || 0), 1e-9)
  if (Math.abs(delta) <= need) return { stepped: false }
  const scatter = Math.max(...tail) - Math.min(...tail)
  if (scatter > Math.abs(delta) * 0.3) return { stepped: false }
  return { stepped: true, direction: delta > 0 ? 'up' : 'down', level: round(level), delta: round(delta) }
}

// Keeps the shape of a long series in at most `max` points: each bucket
// keeps its last point, plus the highest point so a peak is never lost.
function downsample (samples, max = 300) {
  if (samples.length <= max) return samples
  const out = []
  const size = samples.length / max
  for (let i = 0; i < max; i++) {
    const bucket = samples.slice(Math.floor(i * size), Math.floor((i + 1) * size))
    if (bucket.length === 0) continue
    const top = bucket.reduce((a, b) => (b[1] > a[1] ? b : a))
    const last = bucket[bucket.length - 1]
    out.push(last === top ? last : top)
  }
  return out
}

// A reading in the meter's unit as watts. Amps need the circuit voltage and
// assume a power factor of 1, so such a result is an estimate. Returns
// { value, estimate } or { value: null } when amps cannot be converted.
function toWatts (value, unit, voltage) {
  if (unit === 'W') return { value, estimate: false }
  if (unit === 'A' && Number.isFinite(voltage) && voltage > 0) return { value: round(value * voltage), estimate: true }
  return { value: null, estimate: true }
}

module.exports = { mean, stddev, deltaStats, watchStats, detectStep, downsample, toWatts, round }
