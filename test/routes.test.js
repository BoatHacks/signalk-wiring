'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Writable } = require('node:stream')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Store } = require('../src/store')
const { registerLiveRoutes } = require('../src/liveRoutes')
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

test('GET /circuits/:id/diagram returns the devices and cables of the derived circuit', () => {
  const { store, router, cleanup } = setup()
  const battery = store.create('device', { name: 'Battery', role: 'storage' })
  const fuse = store.create('device', { name: 'Fuse', role: 'distribution', trip_rating_a: 10 })
  const light = store.create('device', { name: 'Port light' })
  store.create('wireRun', { from_device_id: battery.id, to_device_id: fuse.id, conductors: [{ conductor: 'positive', color: 'red' }] })
  store.create('wireRun', { from_device_id: fuse.id, to_device_id: light.id, conductors: [{ conductor: 'positive', color: 'green' }] })
  const [circuit] = store.list('circuit')

  const req = new FakeRequest({ params: { id: circuit.id } })
  const res = new FakeResponse()
  router.invoke('get', '/circuits/:id/diagram', req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.nodes.length, 3)
  assert.equal(res.body.nodes.find((n) => n.id === light.id).label, 'Port light')
  assert.equal(res.body.edges.length, 2)
  assert.ok(res.body.edges.some((e) => e.color === 'green' && e.kind === 'feed'))
  cleanup()
})

test('GET /derived returns the banks and warnings of the whole boat', () => {
  const { store, router, cleanup } = setup()
  const a = store.create('device', { name: 'A', role: 'storage' })
  const b = store.create('device', { name: 'B', role: 'storage' })
  store.create('wireRun', { from_device_id: a.id, to_device_id: b.id })
  store.create('wireRun', { from_device_id: a.id })
  const res = new FakeResponse()
  router.invoke('get', '/derived', new FakeRequest({}), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.banks.length, 1)
  assert.equal(res.body.warnings[0].code, 'missing-device')
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

test('GET /changelog returns groups across kinds with parsed entries, filters and a cursor', () => {
  const { store, router, cleanup } = setup()
  const pump = store.create('device', { name: 'Bilge pump' })
  const hose = store.create('conduit', { name: 'Main hose' })
  store.update('device', pump.id, { name: 'Bilge pump 2' })
  const call = (query) => {
    const res = new FakeResponse()
    router.invoke('get', '/changelog', new FakeRequest({ query }), res)
    return res
  }
  let res = call({})
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.groups.length, 2)
  const group = res.body.groups.find((g) => g.id === pump.id)
  assert.equal(group.kind, 'device')
  assert.equal(group.entries[0].summary, 'updated')
  assert.deepEqual(group.entries[0].diff.name, { before: 'Bilge pump', after: 'Bilge pump 2' })
  assert.equal(group.entries[0].diffJson, undefined)
  assert.deepEqual(call({ kind: 'conduit' }).body.groups.map((g) => g.id), [hose.id])
  assert.deepEqual(call({ kind: 'conduit,device' }).body.groups.length, 2)
  assert.equal(call({ limit: '1' }).body.groups.length, 1)
  assert.ok(call({ limit: '1' }).body.nextCursor)
  assert.equal(call({ id: pump.id, entries: '1' }).body.groups[0].more, 1)
  assert.equal(call({ kind: 'nonsense' }).statusCode, 400)
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

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>')

async function uploadPlanImage (router, planId, body, contentType = 'image/svg+xml') {
  const req = new FakeRequest({ params: { id: planId }, headers: { 'content-type': contentType } })
  const res = new FakeResponse()
  const done = new Promise((resolve) => res.on('finish', resolve))
  router.invoke('post', '/plans/:id/image', req, res)
  if (!res.writableEnded) {
    req.emit('data', body)
    req.emit('end')
    await done
  }
  return res
}

test('POST /plans/:id/image stores the file under the plan id and records the filename', async () => {
  const { store, dataDir, router, cleanup } = setup()
  const plan = store.create('plan', { name: 'Main deck', view: 'top' })

  const res = await uploadPlanImage(router, plan.id, SVG_BYTES)

  assert.equal(res.statusCode, 201)
  assert.equal(store.get('plan', plan.id).filename, `${plan.id}.svg`)
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'plans', `${plan.id}.svg`)), SVG_BYTES)

  cleanup()
})

test('POST /plans/:id/image rejects unsupported content types and bodies that do not match their type', async () => {
  const { store, router, cleanup } = setup()
  const plan = store.create('plan', { name: 'Main deck', view: 'top' })

  const wrongType = await uploadPlanImage(router, plan.id, SVG_BYTES, 'application/pdf')
  assert.equal(wrongType.statusCode, 415)

  const notSvg = await uploadPlanImage(router, plan.id, Buffer.from('just some text'))
  assert.equal(notSvg.statusCode, 400)

  // Declared as PNG or JPEG but the bytes are something else.
  assert.equal((await uploadPlanImage(router, plan.id, SVG_BYTES, 'image/png')).statusCode, 400)
  assert.equal((await uploadPlanImage(router, plan.id, PNG_BYTES, 'image/jpeg')).statusCode, 400)

  assert.equal(store.get('plan', plan.id).filename, null)

  cleanup()
})

test('POST /plans/:id/image rejects an oversized upload mid-stream', async () => {
  const { store, router, cleanup } = setup()
  const plan = store.create('plan', { name: 'Main deck', view: 'top' })

  const req = new FakeRequest({ params: { id: plan.id }, headers: { 'content-type': 'image/svg+xml' } })
  const res = new FakeResponse()
  router.invoke('post', '/plans/:id/image', req, res)
  req.emit('data', Buffer.alloc(16 * 1024 * 1024))

  assert.equal(res.statusCode, 413)
  assert.equal(req.destroyed, true)
  assert.equal(store.get('plan', plan.id).filename, null)

  cleanup()
})

for (const [label, mime, ext, bytes] of [
  ['PNG', 'image/png', 'png', PNG_BYTES],
  ['JPEG', 'image/jpeg', 'jpg', JPEG_BYTES],
  ['WebP', 'image/webp', 'webp', WEBP_BYTES]
]) {
  test(`plans accept ${label} drawings and serve them back with the right type`, async () => {
    const { store, dataDir, router, cleanup } = setup()
    const plan = store.create('plan', { name: 'Side view', view: 'side' })

    const up = await uploadPlanImage(router, plan.id, bytes, mime)
    assert.equal(up.statusCode, 201)
    assert.equal(store.get('plan', plan.id).filename, `${plan.id}.${ext}`)
    assert.ok(fs.existsSync(path.join(dataDir, 'plans', `${plan.id}.${ext}`)))

    const res = new FakeResponse()
    const done = new Promise((resolve) => res.on('finish', resolve))
    router.invoke('get', '/plans/:id/image', new FakeRequest({ params: { id: plan.id } }), res)
    await done
    assert.equal(res.headers['Content-Type'], mime)
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
    assert.deepEqual(res.body, bytes)

    cleanup()
  })
}

test('replacing a drawing with another format removes the old file', async () => {
  const { store, dataDir, router, cleanup } = setup()
  const plan = store.create('plan', { name: 'Deck', view: 'top' })

  await uploadPlanImage(router, plan.id, SVG_BYTES)
  await uploadPlanImage(router, plan.id, PNG_BYTES, 'image/png')

  assert.equal(store.get('plan', plan.id).filename, `${plan.id}.png`)
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'plans')), [`${plan.id}.png`])

  cleanup()
})

test('POST /plans/:id/image returns 404 for an unknown plan', async () => {
  const { router, cleanup } = setup()
  const res = await uploadPlanImage(router, 'nope', SVG_BYTES)
  assert.equal(res.statusCode, 404)
  cleanup()
})

test('GET /plans/:id/image serves the file with the safe headers', async () => {
  const { store, router, cleanup } = setup()
  const plan = store.create('plan', { name: 'Main deck', view: 'top' })
  await uploadPlanImage(router, plan.id, SVG_BYTES)

  const res = new FakeResponse()
  const done = new Promise((resolve) => res.on('finish', resolve))
  router.invoke('get', '/plans/:id/image', new FakeRequest({ params: { id: plan.id } }), res)
  await done

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'image/svg+xml')
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'/)
  assert.match(res.headers['Content-Security-Policy'], /sandbox/)
  assert.deepEqual(res.body, SVG_BYTES)

  cleanup()
})

test('GET /plans/:id/image returns 404 when no file has been uploaded', () => {
  const { store, router, cleanup } = setup()
  const plan = store.create('plan', { name: 'Main deck', view: 'top' })

  const res = new FakeResponse()
  router.invoke('get', '/plans/:id/image', new FakeRequest({ params: { id: plan.id } }), res)

  assert.equal(res.statusCode, 404)
  cleanup()
})

test('the plan routes return 503 while the plugin is disabled', () => {
  const { router, disable, cleanup } = setup()
  disable()

  const get = new FakeResponse()
  router.invoke('get', '/plans/:id/image', new FakeRequest({ params: { id: 'x' } }), get)
  assert.equal(get.statusCode, 503)

  const post = new FakeResponse()
  router.invoke('post', '/plans/:id/image', new FakeRequest({ params: { id: 'x' } }), post)
  assert.equal(post.statusCode, 503)

  cleanup()
})

// A router that records the access level of every route. Routes registered
// straight on the router (not through access) count as the admin default.
function recordingRouter (withAccess) {
  const registered = []
  const router = {}
  const registrar = (level) => {
    const r = {}
    for (const method of ['get', 'put', 'post', 'delete']) {
      r[method] = (routePath) => { registered.push({ level, method, routePath }); return r }
    }
    return r
  }
  Object.assign(router, registrar('admin'))
  if (withAccess) router.access = (level) => registrar(level)
  return { router, registered }
}

test('every GET route is registered readonly when the server supports router.access, every write stays admin-only', () => {
  const store = new Store(':memory:')
  const { router, registered } = recordingRouter(true)
  registerRoutes(router, () => store, os.tmpdir())

  const gets = registered.filter((r) => r.method === 'get')
  const writes = registered.filter((r) => r.method !== 'get')
  assert.ok(gets.length >= 9)
  assert.ok(writes.length >= 6)
  assert.deepEqual(gets.filter((r) => r.level !== 'readonly'), [])
  assert.deepEqual(writes.filter((r) => r.level !== 'admin'), [])
  assert.deepEqual(gets.map((r) => r.routePath).sort(), [
    '/attachments', '/attachments/:id', '/changelog', '/changelog/:kind/:id',
    '/circuits/:id/diagram', '/derived', '/devices/:id/icon', '/plans/:id/image', '/version'
  ])
  store.close()
})

test('the live routes read as readonly and write as readwrite', () => {
  const store = new Store(':memory:')
  const { router, registered } = recordingRouter(true)
  registerLiveRoutes(router, () => store, { app: {} })
  for (const r of registered) {
    assert.equal(r.level, r.method === 'get' ? 'readonly' : 'readwrite', `${r.method} ${r.routePath}`)
  }
  store.close()
})

test('a server without router.access still registers every route', () => {
  const store = new Store(':memory:')
  const withAccess = recordingRouter(true)
  const without = recordingRouter(false)
  registerRoutes(withAccess.router, () => store, os.tmpdir())
  registerRoutes(without.router, () => store, os.tmpdir())
  const key = (r) => `${r.method} ${r.routePath}`
  assert.deepEqual(without.registered.map(key).sort(), withAccess.registered.map(key).sort())
  assert.ok(without.registered.every((r) => r.level === 'admin'))
  store.close()
})

test('POST /zones/:id/merge repoints items and returns the target zone', () => {
  const { store, router, cleanup } = setup()
  const from = store.create('zone', { name: 'Lazarette' })
  const into = store.create('zone', { name: 'Aft locker' })
  const device = store.create('device', { name: 'Pump', zone_id: from.id })

  const req = new FakeRequest({ params: { id: from.id }, query: { into: into.id } })
  const res = new FakeResponse()
  router.invoke('post', '/zones/:id/merge', req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.name, 'Aft locker')
  assert.equal(store.get('device', device.id).zone_id, into.id)
  assert.equal(store.get('zone', from.id), null)
  cleanup()
})

test('POST /zones/:id/merge answers 400 without a target and 404 for an unknown zone', () => {
  const { store, router, cleanup } = setup()
  const zone = store.create('zone', { name: 'Salon' })

  const noTarget = new FakeResponse()
  router.invoke('post', '/zones/:id/merge', new FakeRequest({ params: { id: zone.id } }), noTarget)
  assert.equal(noTarget.statusCode, 400)

  const unknown = new FakeResponse()
  router.invoke('post', '/zones/:id/merge', new FakeRequest({ params: { id: 'nope' }, query: { into: zone.id } }), unknown)
  assert.equal(unknown.statusCode, 404)
  cleanup()
})

async function deviceWithIcon (store, router, bytes = PNG_BYTES, dataDir) {
  const device = store.create('device', { name: 'Chartplotter' })
  const req = new FakeRequest({
    query: { ownerType: 'device', ownerId: device.id, filename: 'front.png' },
    headers: { 'content-type': 'image/png' }
  })
  const res = new FakeResponse()
  const done = new Promise((resolve) => res.on('finish', resolve))
  router.invoke('post', '/attachments', req, res)
  req.emit('data', bytes)
  req.emit('end')
  await done
  store.update('device', device.id, { icon_attachment_id: res.body.id })
  return { device, attachmentId: res.body.id }
}

test('GET /devices/:id/icon serves the icon image with the safe headers', async () => {
  const { store, router, cleanup } = setup()
  const { device } = await deviceWithIcon(store, router)

  const res = new FakeResponse()
  const done = new Promise((resolve) => res.on('finish', resolve))
  router.invoke('get', '/devices/:id/icon', new FakeRequest({ params: { id: device.id } }), res)
  await done

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'image/png')
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'/)
  assert.deepEqual(res.body, PNG_BYTES)
  cleanup()
})

test('GET /devices/:id/icon is 404 without an icon or for an unknown device, and 503 when disabled', async () => {
  const { store, router, disable, cleanup } = setup()
  const plain = store.create('device', { name: 'Pump' })

  const noIcon = new FakeResponse()
  router.invoke('get', '/devices/:id/icon', new FakeRequest({ params: { id: plain.id } }), noIcon)
  assert.equal(noIcon.statusCode, 404)

  const unknown = new FakeResponse()
  router.invoke('get', '/devices/:id/icon', new FakeRequest({ params: { id: 'nope' } }), unknown)
  assert.equal(unknown.statusCode, 404)

  disable()
  const off = new FakeResponse()
  router.invoke('get', '/devices/:id/icon', new FakeRequest({ params: { id: plain.id } }), off)
  assert.equal(off.statusCode, 503)
  cleanup()
})

test('DELETE /attachments/:id clears the device icon when it was the icon', async () => {
  const { store, router, cleanup } = setup()
  const { device, attachmentId } = await deviceWithIcon(store, router)

  const res = new FakeResponse()
  const done = new Promise((resolve) => res.on('finish', resolve))
  router.invoke('delete', '/attachments/:id', new FakeRequest({ params: { id: attachmentId } }), res)
  await done

  assert.equal(res.statusCode, 204)
  assert.equal(store.get('device', device.id).icon_attachment_id, null)
  cleanup()
})

test('GET /changelog accepts the conduit kind and attachments can belong to a conduit', async () => {
  const { store, router, cleanup } = setup()
  const conduit = store.create('conduit', { name: 'Galley' })
  const res = new FakeResponse()
  router.invoke('get', '/changelog/:kind/:id', new FakeRequest({ params: { kind: 'conduit', id: conduit.id } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.length, 1)

  const req = new FakeRequest({
    query: { ownerType: 'conduit', ownerId: conduit.id, filename: 'conduit.jpg' },
    headers: { 'content-type': 'image/jpeg' }
  })
  const up = new FakeResponse()
  const done = new Promise((resolve) => up.on('finish', resolve))
  router.invoke('post', '/attachments', req, up)
  req.emit('data', Buffer.from('x'))
  req.emit('end')
  await done
  assert.equal(up.statusCode, 201)
  cleanup()
})

test('DELETE /cables/:id/purge refuses a live cable and erases a removed one with its files, history and links', () => {
  const { store, router, dataDir, cleanup } = setup()
  const a = store.create('device', { name: 'Battery', role: 'storage' })
  const b = store.create('device', { name: 'Lamp' })
  const cable = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id })
  const keep = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id })
  const attachment = store.createAttachment({
    owner_type: 'wireRun', owner_id: cable.id, filename: 'c.jpg', mime_type: 'image/jpeg', uploaded_at: new Date().toISOString()
  })
  fs.mkdirSync(path.join(dataDir, 'attachments'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'attachments', `${attachment.id}.jpg`), 'x')

  let res = new FakeResponse()
  router.invoke('delete', '/cables/:id/purge', new FakeRequest({ params: { id: cable.id } }), res)
  assert.equal(res.statusCode, 409)
  assert.ok(store.get('wireRun', cable.id))

  store.remove('wireRun', cable.id)
  res = new FakeResponse()
  router.invoke('delete', '/cables/:id/purge', new FakeRequest({ params: { id: cable.id } }), res)
  assert.equal(res.statusCode, 204)
  assert.equal(store.get('wireRun', cable.id), null)
  assert.equal(store.getAttachment(attachment.id), null)
  assert.equal(fs.existsSync(path.join(dataDir, 'attachments', `${attachment.id}.jpg`)), false)
  assert.deepEqual(store.changeLog('wireRun', cable.id).map((e) => e.summary), ['permanently deleted'])
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM wire_run_conductors WHERE wire_run_id = ?').get(cable.id).n, 0)
  assert.ok(store.get('wireRun', keep.id))

  res = new FakeResponse()
  router.invoke('delete', '/cables/:id/purge', new FakeRequest({ params: { id: cable.id } }), res)
  assert.equal(res.statusCode, 404)
  cleanup()
})

for (const [segment, kind, make] of [
  ['devices', 'device', (store) => store.create('device', { name: 'Lamp' })],
  ['conduits', 'conduit', (store) => store.create('conduit', { name: 'Hose' })],
  ['schematics', 'schematic', (store) => store.create('schematic', { name: 'Page' })]
]) {
  test(`DELETE /${segment}/:id/purge: 404 unknown, 409 not removed, 204 erased with its files`, () => {
    const { store, router, dataDir, cleanup } = setup()
    const record = make(store)
    const call = (id) => {
      const res = new FakeResponse()
      router.invoke('delete', `/${segment}/:id/purge`, new FakeRequest({ params: { id } }), res)
      return res
    }
    assert.equal(call('missing').statusCode, 404)
    assert.equal(call(record.id).statusCode, 409)
    assert.ok(store.get(kind, record.id))
    let file = null
    if (kind !== 'schematic') {
      const attachment = store.createAttachment({
        owner_type: kind, owner_id: record.id, filename: 'p.jpg', mime_type: 'image/jpeg', uploaded_at: new Date().toISOString()
      })
      fs.mkdirSync(path.join(dataDir, 'attachments'), { recursive: true })
      file = path.join(dataDir, 'attachments', `${attachment.id}.jpg`)
      fs.writeFileSync(file, 'x')
    }
    store.remove(kind, record.id)
    assert.equal(call(record.id).statusCode, 204)
    assert.equal(store.get(kind, record.id), null)
    if (file) assert.equal(fs.existsSync(file), false)
    assert.equal(call(record.id).statusCode, 404)
    cleanup()
  })
}

test('DELETE /devices/:id/purge is 409 with the cable names while a cable still ends on the device', () => {
  const { store, router, cleanup } = setup()
  const a = store.create('device', { name: 'Battery', role: 'storage' })
  const b = store.create('device', { name: 'Lamp' })
  store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, cable_label: 'lamp feed' })
  store.remove('device', b.id)
  const res = new FakeResponse()
  router.invoke('delete', '/devices/:id/purge', new FakeRequest({ params: { id: b.id } }), res)
  assert.equal(res.statusCode, 409)
  assert.match(res.body.error, /Delete these cables first: lamp feed/)
  cleanup()
})

test('GET /version returns the plugin version, even with the plugin stopped', () => {
  const { router, disable, cleanup } = setup()
  disable()
  const res = new FakeResponse()
  router.invoke('get', '/version', new FakeRequest(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { version: require('../package.json').version })
  cleanup()
})
