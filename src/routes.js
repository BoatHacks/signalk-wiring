'use strict'

const fs = require('fs')
const path = require('path')
const { rowToResource } = require('./resources')

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf'
])

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15MB

const MAX_PLAN_IMAGE_BYTES = 15 * 1024 * 1024 // 15MB, same cap as attachments

const CHANGE_LOG_KINDS = new Set(['circuit', 'wireRun', 'device', 'plan'])

// Locked down in case someone opens the download URL directly: no scripts,
// no network, no framing. In the webapp the file only ever loads through an
// <image> element, where scripts do not run at all (ARCHITECTURE.md §6).
const PLAN_IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"

function plansDir (dataDir) {
  return path.join(dataDir, 'plans')
}

// Drawings may be SVG or a raster image. Each type is checked against the
// file's own bytes, not just the declared content type.
const PLAN_IMAGE_TYPES = {
  'image/svg+xml': { ext: 'svg', matches: (b) => /<svg[\s>]/i.test(b.toString('utf8')) },
  'image/png': { ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', matches: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' }
}
const PLAN_MIME_BY_EXT = Object.fromEntries(Object.entries(PLAN_IMAGE_TYPES).map(([mime, t]) => [t.ext, mime]))

// Named by the plan's id and a fixed extension per type, never by anything
// the client sent.
function planImagePath (dataDir, plan) {
  return path.join(plansDir(dataDir), plan.filename)
}

// Reads a request body up to `maxBytes`. Answers 413 and destroys the
// request itself when the limit is exceeded; otherwise calls `onBody`.
function readBody (req, res, maxBytes, onBody) {
  const chunks = []
  let totalBytes = 0
  let rejected = false

  req.on('data', (chunk) => {
    if (rejected) return
    totalBytes += chunk.length
    if (totalBytes > maxBytes) {
      rejected = true
      res.status(413).json({ error: `file exceeds ${maxBytes} byte limit` })
      req.destroy()
      return
    }
    chunks.push(chunk)
  })

  req.on('end', () => {
    if (rejected) return
    onBody(Buffer.concat(chunks))
  })
}

function attachmentsDir (dataDir) {
  return path.join(dataDir, 'attachments')
}

// Filename on disk is derived from the attachment's own id, never the
// client-supplied name, to avoid path traversal (ARCHITECTURE.md §6).
function storedFilePath (dataDir, attachment) {
  const ext = path.extname(attachment.filename).slice(0, 10)
  return path.join(attachmentsDir(dataDir), `${attachment.id}${ext}`)
}

function changeLogEntryToResource (row) {
  const resource = rowToResource(row)
  resource.diff = JSON.parse(resource.diffJson)
  delete resource.diffJson
  return resource
}

function buildCircuitDiagram (store, circuitId) {
  const circuit = store.get('circuit', circuitId)
  if (!circuit) return null

  const wireRuns = store.list('wireRun').filter((wr) => wr.circuit_id === circuitId)
  const deviceById = new Map(store.list('device').map((d) => [d.id, d]))

  const nodes = []
  const seenNodeIds = new Set()
  const addNode = (endpointId) => {
    if (!endpointId || seenNodeIds.has(endpointId)) return
    seenNodeIds.add(endpointId)
    const device = deviceById.get(endpointId)
    nodes.push(
      device
        ? { id: endpointId, label: device.name, kind: 'device', status: device.status }
        : { id: endpointId, label: endpointId, kind: 'label', status: 'active' }
    )
  }

  for (const wireRun of wireRuns) {
    addNode(wireRun.from_endpoint)
    addNode(wireRun.to_endpoint)
  }

  const edges = wireRuns.map((wr) => ({
    id: wr.id,
    from: wr.from_endpoint,
    to: wr.to_endpoint,
    color: wr.color,
    gauge: wr.gauge,
    gaugeUnit: wr.gauge_unit,
    status: wr.status
  }))

  return { circuit: rowToResource(circuit), nodes, edges }
}

// registerWithRouter runs once at server boot for every installed plugin
// regardless of its enabled state, while `getStore()` only returns a
// Store between plugin.start()/stop() — so every handler reads the store
// fresh and returns 503 rather than crashing on a null store if the
// plugin is currently disabled.
function registerRoutes (router, getStore, dataDir) {
  const requireStore = (req, res, next) => {
    const store = getStore()
    if (!store) {
      res.status(503).json({ error: 'signalk-wiring is not enabled' })
      return
    }
    req.wiringStore = store
    next()
  }

  router.post('/attachments', requireStore, (req, res) => {
    const { ownerType, ownerId, filename } = req.query
    if (!['wireRun', 'device'].includes(ownerType) || !ownerId || !filename) {
      res.status(400).json({ error: 'ownerType (wireRun|device), ownerId, and filename query params are required' })
      return
    }

    const mimeType = req.headers['content-type'] || ''
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
      res.status(415).json({ error: `unsupported content type: ${mimeType || '(none)'}` })
      return
    }

    readBody(req, res, MAX_ATTACHMENT_BYTES, (body) => {
      const attachment = req.wiringStore.createAttachment({
        owner_type: ownerType,
        owner_id: ownerId,
        filename: path.basename(String(filename)),
        mime_type: mimeType,
        uploaded_at: new Date().toISOString()
      })
      fs.mkdirSync(attachmentsDir(dataDir), { recursive: true })
      fs.writeFileSync(storedFilePath(dataDir, attachment), body)
      res.status(201).json(rowToResource(attachment))
    })
  })

  router.get('/attachments', requireStore, (req, res) => {
    const { ownerType, ownerId } = req.query
    if (!ownerType || !ownerId) {
      res.status(400).json({ error: 'ownerType and ownerId query params are required' })
      return
    }
    const attachments = req.wiringStore.listAttachmentsByOwner(ownerType, ownerId)
    res.json(attachments.map(rowToResource))
  })

  router.get('/attachments/:id', requireStore, (req, res) => {
    const attachment = req.wiringStore.getAttachment(req.params.id)
    if (!attachment) {
      res.status(404).json({ error: `attachment not found: ${req.params.id}` })
      return
    }
    const filePath = storedFilePath(dataDir, attachment)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `attachment file missing on disk: ${req.params.id}` })
      return
    }
    res.setHeader('Content-Type', attachment.mime_type)
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`)
    fs.createReadStream(filePath).pipe(res)
  })

  router.delete('/attachments/:id', requireStore, (req, res) => {
    const attachment = req.wiringStore.getAttachment(req.params.id)
    if (!attachment) {
      res.status(404).json({ error: `attachment not found: ${req.params.id}` })
      return
    }
    req.wiringStore.deleteAttachment(req.params.id)
    fs.rmSync(storedFilePath(dataDir, attachment), { force: true })
    res.status(204).end()
  })

  router.post('/plans/:id/image', requireStore, (req, res) => {
    const plan = req.wiringStore.get('plan', req.params.id)
    if (!plan) {
      res.status(404).json({ error: `plan not found: ${req.params.id}` })
      return
    }
    const mimeType = (req.headers['content-type'] || '').split(';')[0].trim()
    const type = PLAN_IMAGE_TYPES[mimeType]
    if (!type) {
      res.status(415).json({ error: `plans must be one of ${Object.keys(PLAN_IMAGE_TYPES).join(', ')}, got: ${mimeType || '(none)'}` })
      return
    }
    readBody(req, res, MAX_PLAN_IMAGE_BYTES, (body) => {
      if (!type.matches(body)) {
        res.status(400).json({ error: `the file is not a valid ${mimeType} image` })
        return
      }
      const filename = `${plan.id}.${type.ext}`
      fs.mkdirSync(plansDir(dataDir), { recursive: true })
      fs.writeFileSync(path.join(plansDir(dataDir), filename), body)
      // A new format replaces the old file rather than leaving it behind.
      if (plan.filename && plan.filename !== filename) {
        fs.rmSync(planImagePath(dataDir, plan), { force: true })
      }
      const updated = req.wiringStore.update('plan', plan.id, { filename })
      res.status(201).json(rowToResource(updated))
    })
  })

  // Reading a plan only needs a logged-in user, not an admin. Plugin routes
  // default to admin-only, so this one is registered through router.access
  // where the server offers it (signalk-server >= 2.36); older servers keep
  // the admin-only default, which is safe, just stricter.
  const readOnlyRoutes = typeof router.access === 'function' ? router.access('readonly') : router
  readOnlyRoutes.get('/plans/:id/image', requireStore, (req, res) => {
    const plan = req.wiringStore.get('plan', req.params.id)
    const filePath = plan && plan.filename ? planImagePath(dataDir, plan) : null
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: `no drawing uploaded for plan: ${req.params.id}` })
      return
    }
    res.setHeader('Content-Type', PLAN_MIME_BY_EXT[path.extname(plan.filename).slice(1)] || 'application/octet-stream')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', PLAN_IMAGE_CSP)
    fs.createReadStream(filePath).pipe(res)
  })

  router.get('/circuits/:id/diagram', requireStore, (req, res) => {
    const diagram = buildCircuitDiagram(req.wiringStore, req.params.id)
    if (!diagram) {
      res.status(404).json({ error: `circuit not found: ${req.params.id}` })
      return
    }
    res.json(diagram)
  })

  router.get('/changelog/:kind/:id', requireStore, (req, res) => {
    const { kind, id } = req.params
    if (!CHANGE_LOG_KINDS.has(kind)) {
      res.status(400).json({ error: `kind must be one of: ${[...CHANGE_LOG_KINDS].join(', ')}` })
      return
    }
    res.json(req.wiringStore.changeLog(kind, id).map(changeLogEntryToResource))
  })
}

module.exports = { registerRoutes, buildCircuitDiagram }
