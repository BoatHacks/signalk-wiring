'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Writable } = require('node:stream')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Store } = require('../src/store')
const { registerRoutes } = require('../src/routes')

function createFakeRouter () {
  const handlersByMethodAndPath = { get: {}, post: {}, delete: {} }
  const router = {}
  for (const method of Object.keys(handlersByMethodAndPath)) {
    router[method] = (routePath, ...handlers) => {
      handlersByMethodAndPath[method][routePath] = handlers
    }
  }
  router.invoke = (method, routePath, req, res) => {
    const handlers = handlersByMethodAndPath[method][routePath]
    assert.ok(handlers, `no handler registered for ${method} ${routePath}`)
    let i = 0
    const next = () => {
      const handler = handlers[i++]
      if (handler) handler(req, res, next)
    }
    next()
  }
  return router
}

class FakeRequest extends EventEmitter {
  constructor ({ params = {}, query = {}, headers = {} } = {}) {
    super()
    this.params = params
    this.query = query
    this.headers = headers
  }

  destroy () {
    this.destroyed = true
  }
}

class FakeResponse extends Writable {
  constructor () {
    super()
    this.statusCode = 200
    this.headers = {}
    this.body = undefined
  }

  status (code) {
    this.statusCode = code
    return this
  }

  json (payload) {
    this.body = payload
    this.end()
    return this
  }

  setHeader (key, value) {
    this.headers[key] = value
  }

  _write (chunk, _encoding, callback) {
    this.body = Buffer.concat([this.body instanceof Buffer ? this.body : Buffer.alloc(0), chunk])
    callback()
  }
}

function setup () {
  const store = new Store(':memory:')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-test-'))
  const router = createFakeRouter()
  let enabled = true
  registerRoutes(router, () => (enabled ? store : null), dataDir)
  return {
    store,
    dataDir,
    router,
    disable: () => { enabled = false },
    cleanup: () => {
      store.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }
}

test('POST /attachments stores the file and creates a record', async () => {
  const { store, router, cleanup } = setup()
  const device = store.create('device', { name: 'Bilge pump' })

  const req = new FakeRequest({
    query: { ownerType: 'device', ownerId: device.id, filename: 'pump.jpg' },
    headers: { 'content-type': 'image/jpeg' }
  })
  const res = new FakeResponse()

  const done = new Promise((resolve) => res.on('finish', resolve))
  router.invoke('post', '/attachments', req, res)
  req.emit('data', Buffer.from('fake-jpeg-bytes'))
  req.emit('end')
  await done

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.filename, 'pump.jpg')
  assert.equal(store.listAttachmentsByOwner('device', device.id).length, 1)

  cleanup()
})

test('POST /attachments rejects a disallowed content type', async () => {
  const { store, router, cleanup } = setup()
  const device = store.create('device', { name: 'Bilge pump' })

  const req = new FakeRequest({
    query: { ownerType: 'device', ownerId: device.id, filename: 'evil.exe' },
    headers: { 'content-type': 'application/x-msdownload' }
  })
  const res = new FakeResponse()
  router.invoke('post', '/attachments', req, res)

  assert.equal(res.statusCode, 415)
  assert.equal(store.listAttachmentsByOwner('device', device.id).length, 0)

  cleanup()
})

test('POST /attachments rejects an oversized upload mid-stream', async () => {
  const { store, router, cleanup } = setup()
  const device = store.create('device', { name: 'Bilge pump' })

  const req = new FakeRequest({
    query: { ownerType: 'device', ownerId: device.id, filename: 'huge.jpg' },
    headers: { 'content-type': 'image/jpeg' }
  })
  const res = new FakeResponse()
  router.invoke('post', '/attachments', req, res)
  req.emit('data', Buffer.alloc(16 * 1024 * 1024))

  assert.equal(res.statusCode, 413)
  assert.equal(req.destroyed, true)
  assert.equal(store.listAttachmentsByOwner('device', device.id).length, 0)

  cleanup()
})

test('GET /attachments/:id downloads the stored file', async () => {
  const { store, router, cleanup } = setup()
  const device = store.create('device', { name: 'Bilge pump' })

  const uploadReq = new FakeRequest({
    query: { ownerType: 'device', ownerId: device.id, filename: 'pump.jpg' },
    headers: { 'content-type': 'image/jpeg' }
  })
  const uploadRes = new FakeResponse()
  const uploaded = new Promise((resolve) => uploadRes.on('finish', resolve))
  router.invoke('post', '/attachments', uploadReq, uploadRes)
  uploadReq.emit('data', Buffer.from('fake-jpeg-bytes'))
  uploadReq.emit('end')
  await uploaded

  const downloadReq = new FakeRequest({ params: { id: uploadRes.body.id } })
  const downloadRes = new FakeResponse()
  const downloaded = new Promise((resolve) => downloadRes.on('finish', resolve))
  router.invoke('get', '/attachments/:id', downloadReq, downloadRes)
  await downloaded

  assert.equal(downloadRes.headers['Content-Type'], 'image/jpeg')
  assert.equal(downloadRes.body.toString(), 'fake-jpeg-bytes')

  cleanup()
})

test('DELETE /attachments/:id removes the row and the file', async () => {
  const { store, router, dataDir, cleanup } = setup()
  const device = store.create('device', { name: 'Bilge pump' })
  const attachment = store.createAttachment({
    owner_type: 'device',
    owner_id: device.id,
    filename: 'pump.jpg',
    mime_type: 'image/jpeg',
    uploaded_at: new Date().toISOString()
  })
  fs.mkdirSync(path.join(dataDir, 'attachments'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'attachments', `${attachment.id}.jpg`), 'x')

  const req = new FakeRequest({ params: { id: attachment.id } })
  const res = new FakeResponse()
  router.invoke('delete', '/attachments/:id', req, res)

  assert.equal(res.statusCode, 204)
  assert.equal(store.getAttachment(attachment.id), null)
  assert.equal(fs.existsSync(path.join(dataDir, 'attachments', `${attachment.id}.jpg`)), false)

  cleanup()
})

test('GET /circuits/:id/diagram returns nodes and edges', () => {
  const { store, router, cleanup } = setup()
  const circuit = store.create('circuit', { name: 'Nav lights' })
  const device = store.create('device', { name: 'Port light' })
  store.create('wireRun', {
    circuit_id: circuit.id,
    from_endpoint: 'breaker-2',
    to_endpoint: device.id,
    color: 'green'
  })

  const req = new FakeRequest({ params: { id: circuit.id } })
  const res = new FakeResponse()
  router.invoke('get', '/circuits/:id/diagram', req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.nodes.length, 2)
  const deviceNode = res.body.nodes.find((n) => n.id === device.id)
  assert.equal(deviceNode.kind, 'device')
  assert.equal(deviceNode.label, 'Port light')
  const labelNode = res.body.nodes.find((n) => n.id === 'breaker-2')
  assert.equal(labelNode.kind, 'label')
  assert.equal(res.body.edges.length, 1)

  cleanup()
})

test('GET /circuits/:id/diagram 404s for an unknown circuit', () => {
  const { router, cleanup } = setup()
  const req = new FakeRequest({ params: { id: 'nope' } })
  const res = new FakeResponse()
  router.invoke('get', '/circuits/:id/diagram', req, res)
  assert.equal(res.statusCode, 404)
  cleanup()
})

test('GET /changelog/:kind/:id returns parsed diff entries', () => {
  const { store, router, cleanup } = setup()
  const device = store.create('device', { name: 'Bilge pump' })
  store.update('device', device.id, { name: 'Bilge pump (renamed)' })

  const req = new FakeRequest({ params: { kind: 'device', id: device.id } })
  const res = new FakeResponse()
  router.invoke('get', '/changelog/:kind/:id', req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.length, 2)
  assert.equal(res.body[1].summary, 'updated')
  assert.deepEqual(res.body[1].diff.name, { before: 'Bilge pump', after: 'Bilge pump (renamed)' })

  cleanup()
})

test('GET /changelog/:kind/:id rejects an unknown kind', () => {
  const { router, cleanup } = setup()
  const req = new FakeRequest({ params: { kind: 'nonsense', id: 'x' } })
  const res = new FakeResponse()
  router.invoke('get', '/changelog/:kind/:id', req, res)
  assert.equal(res.statusCode, 400)
  cleanup()
})

test('routes 503 instead of crashing when the plugin is disabled', () => {
  const { router, disable, cleanup } = setup()
  disable()

  const req = new FakeRequest({ query: { ownerType: 'device', ownerId: 'x' } })
  const res = new FakeResponse()
  router.invoke('get', '/attachments', req, res)

  assert.equal(res.statusCode, 503)
  cleanup()
})
