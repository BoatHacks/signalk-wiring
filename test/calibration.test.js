'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')
const { createRunner, watchPatch } = require('../src/calibration')

// A fake clock: sleeping moves time on and yields to the event loop so a
// test can act as the user between ticks.
function fakeClock () {
  let t = 1000000
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; await new Promise((resolve) => setImmediate(resolve)) }
  }
}

const wobble = (n, amp) => amp * Math.sin(n * 2.3)

// A boat with one lamp: `load` is what the lamp draws when on, `hand` is the
// physical state of the lamp (a hand-switched lamp is toggled by the test).
function setup (opts = {}) {
  const {
    base = 10, load = 3, amp = 0.02, kettle = false, silentAfterMs = null, switchRejects = false, deaf = false,
    flat = false, negative = false, timings = { baselineS: 3, settleS: 2, measureS: 3, repeats: 3, sampleMs: 1000, watchS: 40, responseS: 4, silentS: 5, promptS: 30 }
  } = opts
  const store = new Store(':memory:')
  const lamp = store.create('device', { name: 'Cabin lamp' })
  const relay = store.create('device', { name: 'Relay', role: 'distribution', switch_path: 'x.state' })
  const clock = fakeClock()
  const startedAt = clock.now()
  const world = { on: false, switchState: false, commands: [], n: 0 }
  const read = () => {
    world.n++
    if (silentAfterMs !== null && clock.now() - startedAt > silentAfterMs) return null
    let drawn = 0
    if (world.on && !flat) {
      drawn = kettle ? ((Math.floor((clock.now() - startedAt) / 1000) % 20) < 10 ? load : 0) : load
    }
    return { value: (base + drawn) * (negative ? -1 : 1) + wobble(world.n, amp), at: clock.now() }
  }
  const readSwitch = () => (deaf ? false : world.switchState)
  const switchTo = async (id, on) => {
    world.commands.push(on)
    if (switchRejects) throw new Error('PUT refused')
    world.switchState = on
    if (!deaf) world.on = on
  }
  const runner = createRunner({ store, read, readSwitch, switchTo, clock })
  const params = (extra = {}) => ({
    deviceId: lamp.id, deviceName: 'Cabin lamp', method: 'delta', meter: { path: 'm.current', unit: 'A' },
    voltage: 12, switchDeviceId: relay.id, timings, ...extra
  })
  return { store, lamp, relay, runner, world, params, clock }
}

// Plays the user: runs `act(status)` between ticks until the run ends.
async function drive (runner, act = () => {}) {
  while (runner.isRunning()) {
    act(runner.status())
    await new Promise((resolve) => setImmediate(resolve))
  }
  await runner.whenIdle()
}

test('delta, switched by the plugin: three cycles give the load in watts, flagged as an estimate for an amps meter', async () => {
  const { runner, store, params, world } = setup()
  const record = runner.start(params())
  assert.equal(record.status, 'running')
  await drive(runner)

  const run = store.getRun(record.id)
  assert.equal(run.status, 'done')
  assert.ok(Math.abs(run.avg_w - 36) < 1.5, `avg ${run.avg_w}`)
  assert.ok(run.peak_w >= run.avg_w)
  assert.equal(run.duty_cycle, 1)
  assert.equal(run.estimate, 1)
  assert.equal(run.confidence, 'high')
  assert.equal(run.details.repeats, 3)
  assert.ok(run.samples.length > 10)
  assert.equal(run.review, 'pending')
  // on, off, on, off, on, off, and a final off to leave it as found
  assert.deepEqual(world.commands.slice(0, 6), [true, false, true, false, true, false])
  assert.equal(world.on, false)
  assert.equal(runner.status().state, 'done')
})

test('delta with a watt meter is not an estimate and a group result lists its consumers', async () => {
  const { runner, store, params, lamp, relay } = setup({ load: 36, base: 5 })
  const other = store.create('device', { name: 'Other lamp' })
  const record = runner.start(params({
    meter: { path: 'm.power', unit: 'W' }, voltage: null, deviceId: relay.id, consumerIds: [lamp.id, other.id]
  }))
  await drive(runner)
  const run = store.getRun(record.id)
  assert.equal(run.status, 'done')
  assert.ok(Math.abs(run.avg_w - 36) < 1)
  assert.equal(run.estimate, 0)
  assert.deepEqual(run.consumer_ids, [lamp.id, other.id])
})

test('only one run at a time, and bad parameters are refused before anything is recorded', async () => {
  const { runner, params, store } = setup()
  assert.throws(() => runner.start(params({ meter: { path: 'm', unit: 'A' }, voltage: null })), /voltage/)
  assert.throws(() => runner.start(params({ meter: { path: '', unit: 'W' } })), /meter path/)
  assert.throws(() => runner.start(params({ method: 'guess' })), /method/)
  assert.equal(store.listRuns({}).length, 0)
  runner.start(params())
  assert.throws(() => runner.start(params()), /already in progress/)
  await runner.cancel()
})

test('cancelling stops the run, switches the device back off and keeps the run as cancelled', async () => {
  const { runner, store, params, world } = setup()
  const record = runner.start(params())
  await drive(runner, (s) => { if (s.phase === 'measuring') runner.cancel() })
  const run = store.getRun(record.id)
  assert.equal(run.status, 'cancelled')
  assert.equal(world.on, false)
  assert.equal(runner.status().state, 'cancelled')
  assert.equal(runner.isRunning(), false)
  assert.throws(() => store.reviewRun(record.id, 'accepted'), /finished/)
})

test('a switch that does not respond fails the run and leaves the device off', async () => {
  const { runner, store, params } = setup({ deaf: true })
  const record = runner.start(params())
  await drive(runner)
  const run = store.getRun(record.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error, /did not respond/)
})

test('a switch command that is refused fails the run with the reason', async () => {
  const { runner, store, params } = setup({ switchRejects: true })
  const record = runner.start(params())
  await drive(runner)
  const run = store.getRun(record.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error, /PUT refused/)
})

test('a meter that goes silent fails the run', async () => {
  const { runner, store, params } = setup({ silentAfterMs: 8000 })
  const record = runner.start(params())
  await drive(runner)
  const run = store.getRun(record.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error, /silent/)
})

test('a meter that shows no change fails the run instead of recording zero', async () => {
  const { runner, store, params } = setup({ flat: true })
  const record = runner.start(params())
  await drive(runner)
  const run = store.getRun(record.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error, /no change/)
  assert.equal(run.avg_w, null)
})

test('delta by hand: prompts for each step, and a clear step in the meter continues by itself', async () => {
  const { runner, store, params, world } = setup()
  const record = runner.start(params({ switchDeviceId: null }))
  const seen = []
  await drive(runner, (s) => {
    if (!s.prompt) return
    if (!seen.includes(s.prompt.key + s.cycle)) seen.push(s.prompt.key + s.cycle)
    if (s.prompt.key === 'turn-off' && s.cycle === 0) runner.continueRun()
    // The user flips the lamp but never presses Continue (apart from the first check that it is off).
    if (s.prompt.key === 'turn-on') world.on = true
    if (s.prompt.key === 'turn-off') world.on = false
  })
  const run = store.getRun(record.id)
  assert.equal(run.status, 'done')
  assert.ok(Math.abs(run.avg_w - 36) < 2)
  assert.ok(seen.some((k) => k.startsWith('turn-on')))
  assert.ok(seen.some((k) => k.startsWith('turn-off')))
})

test('delta by hand with automatic continuing off: the user presses Continue', async () => {
  const { runner, store, params, world } = setup()
  const record = runner.start(params({ switchDeviceId: null, autoContinue: false, timings: { baselineS: 3, settleS: 2, measureS: 3, repeats: 2, sampleMs: 1000, promptS: 60, silentS: 5 } }))
  let presses = 0
  await drive(runner, (s) => {
    if (!s.prompt) return
    if (s.prompt.key === 'turn-on') world.on = true
    if (s.prompt.key === 'turn-off') world.on = false
    // Wait a few ticks so the test proves nothing continued on its own.
    if (s.prompt.stepDetected || world.n % 4 === 0) { runner.continueRun(); presses++ }
  })
  assert.equal(store.getRun(record.id).status, 'done')
  assert.ok(presses >= 5) // off, then on and off for each of two cycles
})

test('a hand-switched step that never comes times out the run', async () => {
  const { runner, store, params } = setup()
  const record = runner.start(params({ switchDeviceId: null, timings: { baselineS: 2, settleS: 1, measureS: 2, repeats: 1, sampleMs: 1000, promptS: 8, silentS: 5 } }))
  await drive(runner, (s) => { if (s.prompt && s.prompt.key === 'turn-off') runner.continueRun() })
  const run = store.getRun(record.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error, /Timed out/)
})

test('watch: a cycling kettle gives average, peak and duty cycle, and the run can be stopped early', async () => {
  const { runner, store, params, world } = setup({ kettle: true, load: 1000, base: 50 })
  const record = runner.start(params({
    method: 'watch', switchDeviceId: null, meter: { path: 'm.power', unit: 'W' }, voltage: null,
    timings: { baselineS: 4, watchS: 60, sampleMs: 1000, promptS: 30, silentS: 5 }
  }))
  await drive(runner, (s) => {
    if (s.prompt && s.prompt.key === 'watch-off') runner.continueRun()
    if (s.prompt && s.prompt.key === 'watch-on') { world.on = true; runner.continueRun() }
  })
  const run = store.getRun(record.id)
  assert.equal(run.status, 'done')
  assert.ok(Math.abs(run.peak_w - 1000) < 20, `peak ${run.peak_w}`)
  assert.ok(Math.abs(run.duty_cycle - 0.5) < 0.1, `duty ${run.duty_cycle}`)
  assert.ok(Math.abs(run.avg_w - 500) < 80, `avg ${run.avg_w}`)
  assert.equal(run.estimate, 0)
  assert.ok(run.details.threshold > 0)
  assert.ok(Array.isArray(run.details.baseline))

  // A second run, stopped after a few seconds, keeps what it saw.
  const second = runner.start(params({
    method: 'watch', switchDeviceId: null, meter: { path: 'm.power', unit: 'W' }, voltage: null,
    timings: { baselineS: 3, watchS: 600, sampleMs: 1000, promptS: 30, silentS: 5 }
  }))
  let watched = 0
  await drive(runner, (s) => {
    if (s.prompt && s.prompt.key === 'watch-off') runner.continueRun()
    if (s.prompt && s.prompt.key === 'watch-on') { world.on = true; runner.continueRun() }
    if (s.phase === 'watching' && ++watched > 12) runner.finish()
  })
  const early = store.getRun(second.id)
  assert.equal(early.status, 'done')
  assert.ok(early.samples.length >= 10 && early.samples.length < 40)
})

test('recomputing a watch run with another threshold changes the duty cycle but not the peak', () => {
  const samples = []
  for (let t = 0; t < 100; t++) samples.push([t, t % 10 < 3 ? 1800 : 300])
  const low = watchPatch({ samples, unit: 'W', threshold: 100 })
  const high = watchPatch({ samples, unit: 'W', threshold: 1000 })
  assert.equal(low.duty_cycle, 1)
  assert.ok(Math.abs(high.duty_cycle - 0.3) < 0.02)
  assert.equal(low.peak_w, high.peak_w)
  const amps = watchPatch({ samples: samples.map(([t, v]) => [t, v / 100]), unit: 'A', voltage: 12 })
  assert.equal(amps.estimate, 1)
  assert.equal(amps.peak_w, 216)
})

test('a meter that counts the load as negative (a discharge current) still gives a positive load, switched or by hand', async () => {
  const auto = setup({ negative: true })
  const record = auto.runner.start(auto.params())
  await drive(auto.runner)
  const run = auto.store.getRun(record.id)
  assert.equal(run.status, 'done')
  assert.ok(Math.abs(run.avg_w - 36) < 1.5, `avg ${run.avg_w}`)
  assert.equal(run.details.inverted, true)

  const hand = setup({ negative: true })
  const second = hand.runner.start(hand.params({ switchDeviceId: null }))
  await drive(hand.runner, (s) => {
    if (!s.prompt) return
    if (s.prompt.key === 'turn-off' && s.cycle === 0) hand.runner.continueRun()
    if (s.prompt.key === 'turn-on') hand.world.on = true
    if (s.prompt.key === 'turn-off') hand.world.on = false
  })
  const byHand = hand.store.getRun(second.id)
  assert.equal(byHand.status, 'done')
  assert.ok(Math.abs(byHand.avg_w - 36) < 2, `avg ${byHand.avg_w}`)

  const watch = setup({ negative: true, kettle: true, load: 1000, base: 50 })
  const third = watch.runner.start(watch.params({
    method: 'watch', switchDeviceId: null, meter: { path: 'm.power', unit: 'W' }, voltage: null,
    timings: { baselineS: 4, watchS: 60, sampleMs: 1000, promptS: 30, silentS: 5 }
  }))
  await drive(watch.runner, (s) => {
    if (s.prompt && s.prompt.key === 'watch-off') watch.runner.continueRun()
    if (s.prompt && s.prompt.key === 'watch-on') watch.world.on = true // the step is noticed by itself
  })
  const kettle = watch.store.getRun(third.id)
  assert.equal(kettle.status, 'done')
  assert.ok(Math.abs(kettle.peak_w - 1000) < 20, `peak ${kettle.peak_w}`)
  assert.ok(Math.abs(kettle.duty_cycle - 0.5) < 0.15, `duty ${kettle.duty_cycle}`)
})
