'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Store } = require('../src/store')
const { MARKER_FILE } = require('../src/demoMode')
const createPlugin = require('../index')

// No test here may reach the real GitHub: demo mode always gets a fake fetch.

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-demostart-'))
}

function makeApp (dir) {
  const app = { statuses: [], errors: [], providers: [], getDataDirPath: () => dir }
  app.setPluginStatus = (m) => app.statuses.push(m)
  app.setPluginError = (m) => app.errors.push(m)
  app.registerResourceProvider = (p) => app.providers.push(p)
  return app
}

async function until (cond) {
  for (let i = 0; i < 400; i++) {
    if (cond()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('condition not reached')
}

const offline = async () => { throw new TypeError('fetch failed') }

// A demo/ folder with a real database holding one circuit.
function seedDemo (dir, circuitName = 'Demo circuit') {
  fs.mkdirSync(path.join(dir, 'demo/plans'), { recursive: true })
  const s = new Store(path.join(dir, 'demo/wiring.db'))
  s.create('circuit', { name: circuitName })
  s.close()
  fs.writeFileSync(path.join(dir, 'demo/plans/p.svg'), '<svg/>')
  fs.writeFileSync(path.join(dir, 'demo/version.json'), JSON.stringify({ manifest: 'f'.repeat(64) }))
}

function circuitNames (dir) {
  const s = new Store(path.join(dir, 'wiring.db'))
  const names = s.list('circuit').map((c) => c.name)
  s.close()
  return names
}

test('outside demo mode nothing is awaited and the fetch is never used', () => {
  const dir = tmp()
  const app = makeApp(dir)
  let called = 0
  const plugin = createPlugin(app, { fetch: async () => { called++ } })
  plugin.start({})
  assert.equal(app.providers.length, 9, 'providers registered synchronously')
  plugin.stop()
  assert.equal(called, 0)
  assert.deepEqual(app.statuses, [])
})

test('demo mode prepares before the store opens, then restores the data and starts', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  seedDemo(dir)
  const real = new Store(path.join(dir, 'wiring.db'))
  real.create('circuit', { name: 'Real circuit' })
  real.close()
  const app = makeApp(dir)
  const plugin = createPlugin(app, { fetch: offline })
  plugin.start({})
  assert.equal(app.providers.length, 0, 'not started yet')
  assert.deepEqual(app.statuses, ['Preparing the demo'])
  await until(() => app.providers.length === 9)
  const served = await app.providers.find((p) => p.type === 'wiringSettings').methods.getResource('config')
  assert.equal(served.demoMode, true)
  assert.equal(served.showFloorplan, false)
  plugin.stop()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(circuitNames(dir), ['Demo circuit'])
  assert.equal(fs.existsSync(path.join(dir, 'wiring.db.before-demo')), true)
  assert.equal(fs.readFileSync(path.join(dir, 'plans/p.svg'), 'utf8'), '<svg/>')
  const last = app.statuses[app.statuses.length - 1]
  assert.match(last, /^Demo mode on, demo files kept at version fffffff \(could not reach GitHub/)
  assert.match(last, /data restored from the demo, previous database kept as wiring\.db\.before-demo/)
  assert.deepEqual(app.errors, [])
})

test('every start restores again, so edits made during the demo are gone', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  seedDemo(dir)
  const app = makeApp(dir)
  const plugin = createPlugin(app, { fetch: offline })
  plugin.start({})
  await until(() => app.providers.length === 9)
  plugin.stop()
  await new Promise((resolve) => setTimeout(resolve, 20))
  const s = new Store(path.join(dir, 'wiring.db'))
  s.create('circuit', { name: 'Edited during the demo' })
  s.close()
  plugin.start({})
  await until(() => app.providers.length === 18)
  plugin.stop()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(circuitNames(dir), ['Demo circuit'])
})

test('without demo files it starts with the current data and says so', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  const real = new Store(path.join(dir, 'wiring.db'))
  real.create('circuit', { name: 'Real circuit' })
  real.close()
  const app = makeApp(dir)
  const plugin = createPlugin(app, { fetch: offline })
  plugin.start({})
  await until(() => app.providers.length === 9)
  plugin.stop()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(circuitNames(dir), ['Real circuit'])
  assert.match(app.statuses[app.statuses.length - 1], /no demo files \(could not reach GitHub.*no demo database, started with the current data/)
  assert.equal(fs.existsSync(path.join(dir, 'wiring.db.before-demo')), false)
})

test('a stop during the preparation cancels the start and touches nothing', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  seedDemo(dir)
  const real = new Store(path.join(dir, 'wiring.db'))
  real.create('circuit', { name: 'Real circuit' })
  real.close()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const app = makeApp(dir)
  const plugin = createPlugin(app, { fetch: async () => { await gate; throw new TypeError('fetch failed') } })
  plugin.start({})
  plugin.stop()
  release()
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(app.providers.length, 0)
  assert.deepEqual(circuitNames(dir), ['Real circuit'])
  assert.equal(fs.existsSync(path.join(dir, 'wiring.db.before-demo')), false)
})

test('a stop and restart during the preparation starts once', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  seedDemo(dir)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const app = makeApp(dir)
  const plugin = createPlugin(app, { fetch: async () => { await gate; throw new TypeError('fetch failed') } })
  plugin.start({})
  plugin.stop()
  plugin.start({})
  release()
  await until(() => app.providers.length === 9)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(app.providers.length, 9)
  plugin.stop()
})

test('a failure in the preparation is reported, never thrown', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  // A folder where the database copy has to go makes the restore fail.
  seedDemo(dir)
  fs.mkdirSync(path.join(dir, 'wiring.db.demo-new'))
  fs.writeFileSync(path.join(dir, 'wiring.db.demo-new', 'x'), 'blocks')
  const app = makeApp(dir)
  const rejections = []
  const onRejection = (e) => rejections.push(e)
  process.on('unhandledRejection', onRejection)
  const plugin = createPlugin(app, { fetch: offline })
  plugin.start({})
  await until(() => app.providers.length === 9)
  plugin.stop()
  await new Promise((resolve) => setTimeout(resolve, 50))
  process.off('unhandledRejection', onRejection)
  assert.deepEqual(rejections, [])
  assert.match(app.statuses[app.statuses.length - 1], /data could not be restored .*started with the current data/)
})

test('a failure that is not caught in the start body is reported as a plugin error', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  // wiring.db is a directory, so the store cannot open it.
  fs.mkdirSync(path.join(dir, 'wiring.db'))
  const app = makeApp(dir)
  const plugin = createPlugin(app, { fetch: offline })
  plugin.start({})
  await until(() => app.errors.length === 1)
  assert.match(app.errors[0], /^Demo mode could not start/)
})
