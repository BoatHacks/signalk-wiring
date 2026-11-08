'use strict'

// Load calibration runs (plan 0017): switch a device on and off, or watch it
// run, while a meter is read, and work out what it really draws. The runner
// is a state machine over injected functions so it can be tested with fake
// time and a fake meter:
//
//   read(path)              -> { value, at } | null   the meter now (at: ms since epoch, optional)
//   readSwitch(deviceId)    -> true | false | null    the switch state, null when unknown
//   switchTo(deviceId, on)  -> Promise                rejects when the command fails
//   clock                   -> { now(), sleep(ms) }
//
// Runs execute in the plugin, not the browser, so they go on when the
// browser closes. One run at a time. The statistics are in
// src/calibrationStats.js.

const { deltaStats, watchStats, detectStep, downsample, toWatts, mean, stddev, round } = require('./calibrationStats')

const DEFAULT_TIMINGS = {
  baselineS: 5, // how long each baseline stretch is recorded
  settleS: 5, // wait after a switch before measuring
  measureS: 5, // how long the device is measured while on
  repeats: 3,
  sampleMs: 1000,
  watchS: 120, // how long a watch run lasts
  responseS: 10, // how long a switch has to answer
  silentS: 15, // a meter without a fresh reading this long fails the run
  promptS: 300 // how long to wait for a hand-switched step
}

class RunStopped extends Error {
  constructor (kind, message) { super(message); this.kind = kind } // 'cancelled' | 'failed'
}

const realClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

function createRunner ({ store, read, readSwitch = () => null, switchTo, clock = realClock }) {
  let current = null // { status, cancel, finishEarly, continueNow, promise }
  let last = null // the status of the most recent run

  const idle = () => ({ state: 'idle' })

  function status () {
    return current ? { ...current.status, prompt: current.status.prompt && { ...current.status.prompt } } : last || idle()
  }

  function isRunning () { return Boolean(current) }

  // Starts a run and resolves with the run record at once; the run goes on in
  // the background. params:
  //   deviceId        the device the result is about (consumer, or the switch for a group)
  //   deviceName      for prompts
  //   method          'delta' | 'watch'
  //   meter           { path, unit: 'A'|'W' }
  //   voltage         volts, needed for an amps meter
  //   switchDeviceId  set to let the plugin do the switching; null to switch by hand
  //   consumerIds     the consumers a group result covers, or null
  //   timings         overrides of DEFAULT_TIMINGS
  //   autoContinue    continue by itself when a hand-switched step is seen (default true)
  //   thresholdFraction  the "on" level as a share of the peak (watch), default 0.1
  function start (params) {
    if (current) throw new Error('a calibration run is already in progress')
    const meter = params.meter || {}
    if (!meter.path) throw new Error('a run needs a meter path')
    if (!['A', 'W'].includes(meter.unit)) throw new Error('the meter unit must be A or W')
    if (meter.unit === 'A' && !(params.voltage > 0)) throw new Error('a voltage is needed to turn amps into watts')
    if (!['delta', 'watch'].includes(params.method)) throw new Error('method must be delta or watch')
    const timings = { ...DEFAULT_TIMINGS, ...(params.timings || {}) }
    const auto = params.method === 'delta' && Boolean(params.switchDeviceId)

    const record = store.createRun({
      device_id: params.deviceId,
      switch_device_id: params.switchDeviceId || null,
      consumer_ids: params.consumerIds && params.consumerIds.length > 1 ? params.consumerIds : null,
      method: params.method,
      meter_path: meter.path,
      meter_unit: meter.unit,
      voltage: params.voltage || null,
      estimate: meter.unit === 'A' ? 1 : 0,
      started_at: new Date(clock.now()).toISOString(),
      params: { timings, auto, autoContinue: params.autoContinue !== false, thresholdFraction: params.thresholdFraction || 0.1, meterSource: meter.source || null }
    })

    const state = {
      status: {
        runId: record.id, deviceId: params.deviceId, method: params.method, state: 'running', phase: 'starting',
        message: 'Starting', prompt: null, live: null, cycle: 0, cycles: params.method === 'delta' ? timings.repeats : 1,
        progress: { done: 0, total: 1 }, startedAt: clock.now(), error: null, auto
      },
      cancelRequested: false,
      finishRequested: false,
      continueRequested: false
    }
    current = state
    state.promise = execute(state, record, params, meter, timings, auto)
      .catch(() => {})
      .then(() => { last = state.status; current = null })
    return record
  }

  async function execute (state, record, params, meter, timings, auto) {
    const st = state.status
    const sampleMs = timings.sampleMs
    const startAt = clock.now()
    let lastFresh = startAt
    let originalSwitch = null
    let switched = false
    const allSamples = [] // [seconds, value]
    const t0 = startAt

    const setPhase = (phase, message, extra = {}) => { Object.assign(st, { phase, message, ...extra }) }
    const checkStop = () => {
      if (state.cancelRequested) throw new RunStopped('cancelled', 'cancelled')
    }
    const step = (inc = 1) => { st.progress = { done: Math.min(st.progress.total, st.progress.done + inc), total: st.progress.total } }

    // One reading: updates the live value, keeps track of a silent meter.
    function readMeter () {
      const r = read(meter.path)
      const now = clock.now()
      const fresh = r && Number.isFinite(r.value) && (r.at == null || now - r.at <= timings.silentS * 1000)
      if (fresh) {
        lastFresh = now
        st.live = { value: r.value, unit: meter.unit, at: now }
        return r.value
      }
      if (now - lastFresh > timings.silentS * 1000) {
        throw new RunStopped('failed', `The meter ${meter.path} went silent: no fresh reading for ${timings.silentS} seconds.`)
      }
      return null
    }

    // Records readings for `seconds`; returns the values.
    async function sample (seconds, keep = true) {
      const end = clock.now() + seconds * 1000
      const values = []
      for (;;) {
        checkStop()
        const v = readMeter()
        if (v !== null) {
          values.push(v)
          if (keep) allSamples.push([round((clock.now() - t0) / 1000, 1), v])
        }
        if (clock.now() >= end) break
        await clock.sleep(sampleMs)
      }
      return values
    }

    async function wait (seconds) {
      const end = clock.now() + seconds * 1000
      while (clock.now() < end) {
        checkStop()
        readMeter() // a silent meter fails the run even while settling
        await clock.sleep(Math.min(sampleMs, Math.max(1, end - clock.now())))
      }
    }

    // Waits for the user to press Continue, or (when allowed) for the meter to
    // show a clear step in the expected direction.
    async function prompt (key, text, expect) {
      setPhase('waiting', text, { prompt: { key, text, stepDetected: false, autoContinue: state.autoContinue } })
      state.continueRequested = false
      const recent = []
      const end = clock.now() + timings.promptS * 1000
      for (;;) {
        checkStop()
        const v = readMeter()
        if (v !== null) {
          recent.push(v)
          if (recent.length > 6) recent.shift()
        }
        if (state.continueRequested) break
        if (state.finishRequested && key === 'watch-on') break
        if (expect && v !== null) {
          const seen = detectStep(recent, expect.baseline, { minStep: expect.minStep })
          if (seen.stepped && (expect.direction === 'any' || seen.direction === expect.direction)) {
            st.prompt.stepDetected = true
            if (params.autoContinue !== false) break
          }
        }
        if (clock.now() > end) throw new RunStopped('failed', 'Timed out waiting for the device to be switched.')
        await clock.sleep(sampleMs)
      }
      st.prompt = null
      state.continueRequested = false
    }

    async function setSwitch (on) {
      checkStop()
      setPhase(on ? 'switching-on' : 'switching-off', on ? 'Switching on' : 'Switching off')
      try {
        await switchTo(params.switchDeviceId, on)
      } catch (err) {
        throw new RunStopped('failed', `The switch command failed: ${err.message}`)
      }
      switched = true
      // Wait for the switch to say it got there; with no feedback, carry on.
      const end = clock.now() + timings.responseS * 1000
      let known = false
      for (;;) {
        checkStop()
        const now = readSwitch(params.switchDeviceId)
        if (now === on) return
        if (now !== null) known = true
        if (clock.now() >= end) break
        readMeter()
        await clock.sleep(Math.min(sampleMs, 500))
      }
      if (known) throw new RunStopped('failed', 'The switch did not respond: its state did not change.')
    }

    try {
      st.progress = { done: 0, total: params.method === 'delta' ? timings.repeats * (auto ? 4 : 5) + 1 : 4 }
      state.autoContinue = params.autoContinue !== false

      if (params.method === 'delta') {
        const cycles = []
        if (auto) {
          originalSwitch = readSwitch(params.switchDeviceId)
          if (originalSwitch === true) { await setSwitch(false); await wait(timings.settleS) }
        } else {
          await prompt('turn-off', `Make sure ${params.deviceName || 'the device'} is off, then press Continue.`)
        }
        setPhase('baseline', 'Recording the resting reading', { cycle: 1 })
        let before = await sample(timings.baselineS)
        step()
        for (let i = 1; i <= timings.repeats; i++) {
          st.cycle = i
          const base = { mean: mean(before), noise: stddev(before) }
          if (auto) await setSwitch(true)
          else await prompt('turn-on', `Turn on ${params.deviceName || 'the device'}, then press Continue.`, { baseline: base, direction: 'any' })
          step()
          setPhase('settling', 'Waiting for the reading to settle')
          await wait(timings.settleS)
          setPhase('measuring', 'Measuring with the device on', { cycle: i })
          const on = await sample(timings.measureS)
          step()
          const onBase = { mean: mean(on), noise: stddev(on) }
          const backDirection = mean(on) > base.mean ? 'down' : 'up'
          if (auto) await setSwitch(false)
          else await prompt('turn-off', `Turn off ${params.deviceName || 'the device'}, then press Continue.`, { baseline: onBase, direction: backDirection })
          step()
          setPhase('settling', 'Waiting for the reading to settle')
          await wait(timings.settleS)
          setPhase('baseline', 'Recording the resting reading', { cycle: i })
          const after = await sample(timings.baselineS)
          step()
          cycles.push({ before, on, after })
          before = after
        }
        const stats = deltaStats(cycles)
        finishDelta(record, params, meter, stats, allSamples, timings)
      } else {
        await prompt('watch-off', `Make sure ${params.deviceName || 'the device'} is off, then press Continue.`)
        setPhase('baseline', 'Recording the resting reading')
        const baseline = await sample(timings.baselineS, false)
        step()
        const resting = { baseline: { mean: mean(baseline), noise: stddev(baseline) }, direction: 'any' }
        await prompt('watch-on', `Turn on ${params.deviceName || 'the device'} and use it as you normally would, then press Continue. The watch of ${timings.watchS} seconds starts then.`, resting)
        step()
        setPhase('watching', 'Watching the meter', { watchS: timings.watchS })
        const watchStart = clock.now()
        const samples = []
        for (;;) {
          checkStop()
          const v = readMeter()
          if (v !== null) samples.push([round((clock.now() - watchStart) / 1000, 1), v])
          st.watched = Math.round((clock.now() - watchStart) / 1000)
          if (state.finishRequested || clock.now() - watchStart >= timings.watchS * 1000) break
          await clock.sleep(sampleMs)
        }
        step()
        finishWatch(record, params, meter, samples, baseline, timings)
      }
      step(100)
      st.state = 'done'
      setPhase('done', 'Finished')
    } catch (err) {
      const stopped = err instanceof RunStopped ? err : new RunStopped('failed', `Unexpected error: ${err.message}`)
      st.state = stopped.kind === 'cancelled' ? 'cancelled' : 'failed'
      st.error = stopped.kind === 'cancelled' ? null : stopped.message
      st.prompt = null
      setPhase(st.state, stopped.kind === 'cancelled' ? 'Cancelled' : stopped.message)
      store.updateRun(record.id, {
        status: st.state, ended_at: new Date(clock.now()).toISOString(), error: st.error,
        samples: downsample(allSamples, 300)
      })
    } finally {
      // Leave the device as it was found, whatever happened.
      if (auto && switched) {
        try { await switchTo(params.switchDeviceId, originalSwitch === true) } catch (e) { /* best effort */ }
      }
    }
  }

  function finishDelta (record, params, meter, stats, allSamples, timings) {
    const unit = meter.unit
    const avg = toWatts(stats.average, unit, params.voltage)
    const peak = toWatts(stats.peak, unit, params.voltage)
    const failed = !Number.isFinite(stats.average) || stats.warnings.includes('no-step') || stats.average <= 0 || stats.average < stats.noise
    store.updateRun(record.id, {
      status: failed ? 'failed' : 'done',
      error: failed ? 'The meter showed no change when the device was switched.' : null,
      ended_at: new Date(clock.now()).toISOString(),
      avg_w: failed ? null : avg.value,
      peak_w: failed ? null : peak.value,
      duty_cycle: failed ? null : 1,
      confidence: stats.confidence,
      estimate: unit === 'A' ? 1 : 0,
      samples: downsample(allSamples, 300),
      details: {
        unit, voltage: params.voltage || null, warnings: stats.warnings, spread: stats.spread, noise: stats.noise, inverted: stats.inverted,
        maxDrift: stats.maxDrift, steps: stats.steps, repeats: timings.repeats, rawAverage: stats.average, rawPeak: stats.peak
      }
    })
    if (failed) throw new RunStopped('failed', 'The meter showed no change when the device was switched.')
  }

  function finishWatch (record, params, meter, samples, baseline, timings) {
    const patch = watchPatch({
      samples, baseline, unit: meter.unit, voltage: params.voltage, thresholdFraction: params.thresholdFraction || 0.1
    })
    store.updateRun(record.id, {
      status: 'done', ended_at: new Date(clock.now()).toISOString(), ...patch,
      samples: downsample(samples, 300),
      details: { ...patch.details, baseline: downsample(baseline.map((v, i) => [i, v]), 40).map((s) => s[1]), watchS: timings.watchS }
    })
  }

  async function cancel () {
    if (!current) return false
    current.cancelRequested = true
    await current.promise
    return true
  }

  // Press Continue on a prompt.
  function continueRun () {
    if (!current || !current.status.prompt) return false
    current.continueRequested = true
    return true
  }

  // Stop a watch early and keep what was seen.
  function finish () {
    if (!current || !['watching', 'waiting'].includes(current.status.phase)) return false
    current.finishRequested = true
    return true
  }

  function whenIdle () { return current ? current.promise : Promise.resolve() }

  return { start, status, isRunning, cancel, continueRun, finish, whenIdle }
}

// The numbers stored for a watch run, from its samples. Also used to
// recompute a run when the "on" threshold is changed before accepting it.
// `threshold` is in the meter's unit.
function watchPatch ({ samples, baseline = [], unit, voltage, threshold = null, thresholdFraction = 0.1 }) {
  const stats = watchStats(samples, { baseline, threshold, thresholdFraction })
  const avg = toWatts(stats.average, unit, voltage)
  const peak = toWatts(stats.peak, unit, voltage)
  const avgOn = toWatts(stats.averageOn, unit, voltage)
  return {
    avg_w: avg.value,
    peak_w: peak.value,
    duty_cycle: stats.dutyCycle,
    confidence: stats.confidence,
    estimate: unit === 'A' ? 1 : 0,
    details: {
      unit, voltage: voltage || null, warnings: stats.warnings, threshold: stats.threshold, noise: stats.noise,
      rest: stats.rest, inverted: stats.inverted, averageOnW: avgOn.value, rawAverage: stats.average, rawPeak: stats.peak
    }
  }
}

module.exports = { createRunner, watchPatch, DEFAULT_TIMINGS }
