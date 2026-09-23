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

const CHANGE_LOG_KINDS = new Set(['circuit', 'wireRun', 'device'])

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

    const chunks = []
    let totalBytes = 0
    let rejected = false

    req.on('data', (chunk) => {
      if (rejected) return
      totalBytes += chunk.length
      if (totalBytes > MAX_ATTACHMENT_BYTES) {
        rejected = true
        res.status(413).json({ error: `file exceeds ${MAX_ATTACHMENT_BYTES} byte limit` })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (rejected) return
      const attachment = req.wiringStore.createAttachment({
        owner_type: ownerType,
        owner_id: ownerId,
        filename: path.basename(String(filename)),
        mime_type: mimeType,
        uploaded_at: new Date().toISOString()
      })
      fs.mkdirSync(attachmentsDir(dataDir), { recursive: true })
      fs.writeFileSync(storedFilePath(dataDir, attachment), Buffer.concat(chunks))
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
