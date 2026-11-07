'use strict'

// Routes of plan 0017: what can be switched and metered, the switch command,
// and (further down) calibration runs. Switching and calibrating need a
// read-write login; reading what is switchable needs a logged-in user.
// Where the server has no router.access (before signalk-server 2.36), the
// default admin-only rule applies, which is stricter and so safe.

const { createSwitcher } = require('./switching')

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

  return { switcher }
}

module.exports = { registerLiveRoutes, jsonBody, userOf }
