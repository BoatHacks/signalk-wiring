'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { isDemoMode, MARKER_FILE } = require('../src/demoMode')
const { createSettingsProvider, resolveSettings } = require('../src/settings')

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-demomode-'))
}

test('isDemoMode is true only for a file named demo-mode-active', () => {
  const dir = tmp()
  assert.equal(isDemoMode(dir), false)
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  assert.equal(isDemoMode(dir), true)
  fs.writeFileSync(path.join(dir, MARKER_FILE), 'anything, never read')
  assert.equal(isDemoMode(dir), true)
})

test('a directory named demo-mode-active does not count', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, MARKER_FILE))
  assert.equal(isDemoMode(dir), false)
})

test('a missing data directory is not demo mode', () => {
  assert.equal(isDemoMode(path.join(tmp(), 'nope')), false)
})

test('plugin.schema has no showFloorplan option', () => {
  const plugin = require('../index.js')({ getDataDirPath: () => tmp(), registerResourceProvider () {} })
  assert.equal('showFloorplan' in plugin.schema.properties, false)
})

test('the plugin serves demoMode and showFloorplan false when the marker file exists', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, MARKER_FILE), '')
  const providers = []
  const plugin = require('../index.js')({ getDataDirPath: () => dir, registerResourceProvider: (p) => providers.push(p) })
  plugin.start({ showFloorplan: true })
  const served = await providers.find((p) => p.type === 'wiringSettings').methods.getResource('config')
  plugin.stop()
  assert.equal(served.demoMode, true)
  assert.equal(served.showFloorplan, false)
})

test('without the marker file the plugin serves demoMode false and showFloorplan true, whatever a stale option says', async () => {
  const dir = tmp()
  const providers = []
  const plugin = require('../index.js')({ getDataDirPath: () => dir, registerResourceProvider: (p) => providers.push(p) })
  plugin.start({ showFloorplan: false })
  const served = await providers.find((p) => p.type === 'wiringSettings').methods.getResource('config')
  plugin.stop()
  assert.equal(served.demoMode, false)
  assert.equal(served.showFloorplan, true)
  assert.deepEqual(createSettingsProvider(resolveSettings({}, true)).type, 'wiringSettings')
})
