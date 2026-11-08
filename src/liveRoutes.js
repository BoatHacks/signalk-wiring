'use strict'

// Routes of plan 0017: what can be switched and metered, the switch command,
// and (further down) calibration runs. Switching and calibrating need a
// read-write login; reading what is switchable needs a logged-in user.
// Where the server has no router.access (before signalk-server 2.36), the
// default admin-only rule applies, which is stricter and so safe.

const { createSwitcher, selfPath, unwrap } = require('./switching')
const { createRunner, watchPatch } = require('./calibration')
const { runToResource } = require('./resources')

// The JSON body of a request: the server's body parser has usually read it
// already; otherwise read the stream.
function jsonBody (req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body)
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 100000) { reject(new Error('request body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch (err) { reject(new Error('the body is not valid JSON')) }
    })
    req.on('error', reject)
  })
}

const userOf = (req) => (req.skPrincipal && req.skPrincipal.identifier) || (req.user && req.user.id) || 'unknown'

function registerLiveRoutes (router, getStore, services = {}) {
  const requireStore = (req, res, next) => {
    const store = getStore()
    if (!store) {
      res.status(503).json({ error: 'signalk-wiring is not enabled' })
      return
    }
    req.wiringStore = store
    next()
  }
  const access = (level) => (typeof router.access === 'function' ? router.access(level) : router)
  const readOnly = access('readonly')
  const readWrite = access('readwrite')
  const switcher = createSwitcher({ app: services.app, timeoutMs: services.putTimeoutMs })

  // Switchability and meters for every consumer, for the live views and the
  // calibration dialog.
  readOnly.get('/live', requireStore, (req, res) => {
    res.json(req.wiringStore.deriveSwitching())
  })

  // Switch a consumer (through the switch that feeds it) or a switch device
  // itself. Body: { consumerId | deviceId, state: boolean, confirmed?: boolean }.
  readWrite.post('/switch', requireStore, async (req, res) => {
    let body
    try { body = await jsonBody(req) } catch (err) { res.status(400).json({ error: err.message }); return }
    try {
      const result = await switcher.switchTo(req.wiringStore, {
        consumerId: body.consumerId,
        deviceId: body.deviceId,
        state: body.state,
        confirmed: body.confirmed === true
      }, userOf(req))
      res.status(result.status).json(result.body)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ---- Calibration. The runner belongs to one store; if the plugin is
  // stopped and started again a new one is made for the new store.
  let runner = null
  let runnerStore = null
  function runnerFor (store) {
    if (runner && runnerStore === store) return runner
    runnerStore = store
    runner = createRunner({
      store,
      read: (path) => {
        if (!services.app || typeof services.app.getSelfPath !== 'function') return null
        const leaf = services.app.getSelfPath(selfPath(path))
        const value = unwrap(leaf)
        if (typeof value !== 'number') return null
        const at = leaf && typeof leaf === 'object' && leaf.timestamp ? Date.parse(leaf.timestamp) : undefined
        return { value, at: Number.isFinite(at) ? at : undefined }
      },
      readSwitch: (deviceId) => {
        const device = store.get('device', deviceId)
        return device && device.switch_path ? switcher.readState(device.switch_path) : null
      },
      switchTo: async (deviceId, on) => {
        const result = await switcher.switchTo(store, { deviceId, state: on, confirmed: true }, 'calibration')
        if (result.status !== 200) throw new Error(result.body.error || `status ${result.status}`)
      },
      ...(services.clock ? { clock: services.clock } : {})
    })
    return runner
  }
  const currentRunner = () => runner

  // Start a run. Body: { deviceId, method: 'delta'|'watch', hand?: boolean,
  // meter?: { path, unit }, voltage?, timings?, autoContinue?, thresholdFraction?,
  // confirmed? }. A delta run switches by itself when the device is switchable
  // and hand is not set; a switch shared with other consumers gives a group
  // result recorded on the switch.
  readWrite.post('/calibration/runs', requireStore, async (req, res) => {
    let body
    try { body = await jsonBody(req) } catch (err) { res.status(400).json({ error: err.message }); return }
    const store = req.wiringStore
    const live = store.deriveSwitching()
    const consumer = live.consumers[body.deviceId]
    const device = store.get('device', body.deviceId)
    if (!device) { res.status(404).json({ error: `device not found: ${body.deviceId}` }); return }
    if (!consumer) { res.status(400).json({ error: 'only a consumer can be calibrated' }); return }
    if (!['delta', 'watch'].includes(body.method)) { res.status(400).json({ error: 'method must be delta or watch' }); return }
    const meter = body.meter && body.meter.path ? body.meter : consumer.meters[0]
    if (!meter) { res.status(400).json({ error: 'no meter is set on or upstream of this device: add a meter path first' }); return }
    const auto = body.method === 'delta' && !body.hand && consumer.switchable
    if (auto) {
      const planned = switcher.plan(store, { consumerId: body.deviceId, confirmed: body.confirmed === true })
      if (planned.status !== 200) { res.status(planned.status).json(planned.body); return }
    }
    const group = auto && consumer.sharedWith.length > 0
    const groupIds = group ? [body.deviceId, ...consumer.sharedWith] : null
    const names = (groupIds || [body.deviceId]).map((id) => (store.get('device', id) || {}).name || id)
    try {
      const record = runnerFor(store).start({
        deviceId: group ? consumer.switchDeviceId : body.deviceId,
        deviceName: names.join(' and '),
        method: body.method,
        meter: { path: meter.path, unit: meter.unit, source: meter.source || null },
        voltage: body.voltage != null ? Number(body.voltage) : consumer.voltage,
        switchDeviceId: auto ? consumer.switchDeviceId : null,
        consumerIds: groupIds,
        timings: body.timings,
        autoContinue: body.autoContinue,
        thresholdFraction: body.thresholdFraction
      })
      res.status(201).json({ run: runToResource(record), group })
    } catch (err) {
      res.status(/already in progress/.test(err.message) ? 409 : 400).json({ error: err.message })
    }
  })

  // Where the current (or latest) run stands, for polling.
  readOnly.get('/calibration/status', requireStore, (req, res) => {
    res.json(runnerFor(req.wiringStore).status())
  })

  readOnly.get('/calibration/runs', requireStore, (req, res) => {
    res.json(req.wiringStore.listRuns({ deviceId: req.query.deviceId }).map(runToResource))
  })

  readWrite.post('/calibration/continue', requireStore, (req, res) => {
    res.json({ ok: runnerFor(req.wiringStore).continueRun() })
  })

  readWrite.post('/calibration/finish', requireStore, (req, res) => {
    res.json({ ok: runnerFor(req.wiringStore).finish() })
  })

  readWrite.post('/calibration/cancel', requireStore, async (req, res) => {
    res.json({ ok: await runnerFor(req.wiringStore).cancel() })
  })

  // Recomputes a finished watch run with another "on" threshold (in the
  // meter's unit), before it is accepted.
  readWrite.post('/calibration/runs/:id/recompute', requireStore, async (req, res) => {
    let body
    try { body = await jsonBody(req) } catch (err) { res.status(400).json({ error: err.message }); return }
    const store = req.wiringStore
    const run = store.getRun(req.params.id)
    if (!run) { res.status(404).json({ error: `run not found: ${req.params.id}` }); return }
    if (run.method !== 'watch' || run.status !== 'done') { res.status(400).json({ error: 'only a finished watch run has a threshold' }); return }
    const threshold = Number(body.threshold)
    if (!Number.isFinite(threshold) || threshold < 0) { res.status(400).json({ error: 'threshold must be a number of at least 0' }); return }
    const patch = watchPatch({
      samples: run.samples || [], baseline: (run.details && run.details.baseline) || [], unit: run.meter_unit, voltage: run.voltage, threshold
    })
    const updated = store.updateRun(run.id, { ...patch, details: { ...run.details, ...patch.details } })
    res.json(runToResource(updated))
  })

  for (const verdict of ['accept', 'reject']) {
    readWrite.post(`/calibration/runs/:id/${verdict}`, requireStore, (req, res) => {
      try {
        const run = req.wiringStore.reviewRun(req.params.id, verdict === 'accept' ? 'accepted' : 'rejected')
        res.json(runToResource(run))
      } catch (err) {
        res.status(/not found/.test(err.message) ? 404 : 400).json({ error: err.message })
      }
    })
  }

  // Called when the plugin stops: a run in progress is cancelled.
  async function stopRuns () {
    const r = currentRunner()
    if (r && r.isRunning()) await r.cancel()
    runner = null
    runnerStore = null
  }

  return { switcher, stopRuns }
}

module.exports = { registerLiveRoutes, jsonBody, userOf }
