'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolveSettings, settingsWarnings, createSettingsProvider } = require('../src/settings')

test('resolveSettings fills defaults when options are missing', () => {
  assert.deepEqual(resolveSettings(undefined), {
    convention: 'freestyle',
    defaultGaugeUnit: 'AWG',
    defaultLengthUnit: 'm',
    autoTheme: false,
    voltageDropLimitCritical: 3,
    voltageDropLimitNormal: 10,
    dashboardInputs: [],
    dashboardOutputs: []
  })
  assert.deepEqual(resolveSettings({}), resolveSettings(undefined))
})

test('resolveSettings keeps valid values', () => {
  const settings = resolveSettings({
    convention: 'abyc-e11',
    defaultGaugeUnit: 'mm2',
    defaultLengthUnit: 'ft'
  })
  assert.equal(settings.convention, 'abyc-e11')
  assert.equal(settings.defaultGaugeUnit, 'mm2')
  assert.equal(settings.defaultLengthUnit, 'ft')
  assert.equal(settings.autoTheme, false)
  assert.equal(resolveSettings({ autoTheme: true }).autoTheme, true)
  assert.equal(resolveSettings({ autoTheme: 'yes' }).autoTheme, false)
})

test('resolveSettings falls back to the default for unknown values', () => {
  const settings = resolveSettings({
    convention: 'nonsense',
    defaultGaugeUnit: 'cubits',
    defaultLengthUnit: 42
  })
  assert.deepEqual(settings, resolveSettings(undefined))
})

test('settings provider serves one read-only "config" resource', async () => {
  const settings = resolveSettings({ convention: 'din-en-iso-13297' })
  const provider = createSettingsProvider(settings)

  assert.equal(provider.type, 'wiringSettings')
  assert.deepEqual(await provider.methods.listResources(), { config: settings })
  assert.deepEqual(await provider.methods.getResource('config'), settings)
  await assert.rejects(provider.methods.getResource('other'), /not found/)
  await assert.rejects(provider.methods.setResource('config', {}), /read-only/)
  await assert.rejects(provider.methods.deleteResource('config'), /read-only/)
})

test('the voltage drop limits default to 3 and 10 and keep valid numbers', () => {
  const d = resolveSettings({})
  assert.equal(d.voltageDropLimitCritical, 3)
  assert.equal(d.voltageDropLimitNormal, 10)
  const s = resolveSettings({ voltageDropLimitCritical: 2.5, voltageDropLimitNormal: 12 })
  assert.equal(s.voltageDropLimitCritical, 2.5)
  assert.equal(s.voltageDropLimitNormal, 12)
  // the ends of the range are valid
  assert.equal(resolveSettings({ voltageDropLimitCritical: 0.5 }).voltageDropLimitCritical, 0.5)
  assert.equal(resolveSettings({ voltageDropLimitNormal: 20 }).voltageDropLimitNormal, 20)
})

test('bad voltage drop limits fall back to their default', () => {
  for (const bad of [0.4, 0, -3, 20.1, 100, NaN, Infinity, '5', null, true, {}, []]) {
    const s = resolveSettings({ voltageDropLimitCritical: bad, voltageDropLimitNormal: bad })
    assert.equal(s.voltageDropLimitCritical, 3, `critical ${String(bad)}`)
    assert.equal(s.voltageDropLimitNormal, 10, `normal ${String(bad)}`)
  }
  // one bad value does not disturb the other
  const mixed = resolveSettings({ voltageDropLimitCritical: 99, voltageDropLimitNormal: 8 })
  assert.equal(mixed.voltageDropLimitCritical, 3)
  assert.equal(mixed.voltageDropLimitNormal, 8)
})

test('the settings resource carries the voltage drop limits', async () => {
  const provider = createSettingsProvider(resolveSettings({ voltageDropLimitNormal: 7 }))
  const config = await provider.methods.getResource('config')
  assert.equal(config.voltageDropLimitCritical, 3)
  assert.equal(config.voltageDropLimitNormal, 7)
})

test('the plugin schema declares both limits as numbers from 0.5 to 20 with the defaults', () => {
  const plugin = require('../index.js')({ getDataDirPath: () => '/tmp', registerResourceProvider () {} })
  for (const [key, def] of [['voltageDropLimitCritical', 3], ['voltageDropLimitNormal', 10]]) {
    const p = plugin.schema.properties[key]
    assert.equal(p.type, 'number')
    assert.equal(p.minimum, 0.5)
    assert.equal(p.maximum, 20)
    assert.equal(p.default, def)
  }
})

const entry = (extra = {}) => ({ label: 'Shore', path: 'electrical.shore.power', unit: 'W', ...extra })

test('dashboard lists default to empty and keep valid entries in order', () => {
  assert.deepEqual(resolveSettings({}).dashboardInputs, [])
  const s = resolveSettings({
    dashboardInputs: [entry(), entry({ label: 'Solar', path: 'electrical.solar.0.current', unit: 'A', voltage: 13.5 })],
    dashboardOutputs: [entry({ label: 'Load', unit: 'A', voltagePath: 'electrical.batteries.0.voltage' })]
  })
  assert.deepEqual(s.dashboardInputs, [
    { label: 'Shore', path: 'electrical.shore.power', unit: 'W', voltage: null, voltagePath: null },
    { label: 'Solar', path: 'electrical.solar.0.current', unit: 'A', voltage: 13.5, voltagePath: null }
  ])
  assert.equal(s.dashboardOutputs[0].voltagePath, 'electrical.batteries.0.voltage')
  assert.equal(s.dashboardOutputs[0].voltage, null)
})

test('an amp entry with neither voltage nor voltage path is kept', () => {
  const s = resolveSettings({ dashboardInputs: [entry({ unit: 'A' })] })
  assert.equal(s.dashboardInputs.length, 1)
  assert.equal(s.dashboardInputs[0].voltage, null)
})

test('a watt entry carries no voltage', () => {
  const s = resolveSettings({ dashboardInputs: [entry({ voltage: 12, voltagePath: 'a.b' })] })
  assert.equal(s.dashboardInputs[0].voltage, null)
  assert.equal(s.dashboardInputs[0].voltagePath, null)
})

test('bad dashboard entries are dropped and reported', () => {
  const bad = [
    null, 'x', [], {},
    entry({ label: '' }), entry({ label: '   ' }), entry({ label: 'x'.repeat(41) }),
    entry({ path: 'has space' }), entry({ path: 'a..b' }), entry({ path: '.a' }), entry({ path: 'a.' }), entry({ path: '' }), entry({ path: 5 }),
    entry({ unit: 'kW' }), entry({ unit: undefined }),
    entry({ unit: 'A', voltage: 0.5 }), entry({ unit: 'A', voltage: 101 }), entry({ unit: 'A', voltage: '12' }), entry({ unit: 'A', voltage: NaN }),
    entry({ unit: 'A', voltagePath: 'bad path' })
  ]
  const options = { dashboardInputs: [...bad, entry({ label: 'Good' })] }
  const s = resolveSettings(options)
  assert.deepEqual(s.dashboardInputs.map((e) => e.label), ['Good'])
  const warnings = settingsWarnings(options)
  assert.equal(warnings.length, bad.length)
  assert.match(warnings[0], /^Dashboard input 1:/)
  assert.match(warnings[4], /^Dashboard input 5: label/)
})

test('a list that is not an array is ignored with a warning', () => {
  const o = { dashboardOutputs: 'nope' }
  assert.deepEqual(resolveSettings(o).dashboardOutputs, [])
  assert.deepEqual(settingsWarnings(o), ['Dashboard output: not a list'])
})

test('dashboard lists are capped at 12 entries', () => {
  const many = Array.from({ length: 15 }, (_, i) => entry({ label: 'E' + i }))
  const s = resolveSettings({ dashboardInputs: many })
  assert.equal(s.dashboardInputs.length, 12)
  assert.equal(s.dashboardInputs[11].label, 'E11')
  assert.equal(settingsWarnings({ dashboardInputs: many }).length, 3)
  assert.equal(settingsWarnings({}).length, 0)
})

test('the label is trimmed', () => {
  assert.equal(resolveSettings({ dashboardInputs: [entry({ label: '  Shore  ' })] }).dashboardInputs[0].label, 'Shore')
})

test('the settings resource serves the dashboard lists', async () => {
  const provider = createSettingsProvider(resolveSettings({ dashboardOutputs: [entry({ label: 'Load' })] }))
  const config = await provider.methods.getResource('config')
  assert.equal(config.dashboardOutputs[0].label, 'Load')
})

test('the plugin schema declares the dashboard lists as arrays of small forms, at most 12', () => {
  const plugin = require('../index.js')({ getDataDirPath: () => '/tmp', registerResourceProvider () {} })
  for (const key of ['dashboardInputs', 'dashboardOutputs']) {
    const p = plugin.schema.properties[key]
    assert.equal(p.type, 'array')
    assert.equal(p.maxItems, 12)
    assert.deepEqual(Object.keys(p.items.properties), ['label', 'path', 'unit', 'voltage', 'voltagePath'])
    assert.deepEqual(p.items.properties.unit.enum, ['W', 'A'])
    assert.deepEqual(p.items.required, ['label', 'path', 'unit'])
  }
})

test('starting the plugin reports dropped dashboard entries in the plugin status', () => {
  const os = require('os')
  const fs = require('fs')
  const path = require('path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-status-'))
  const statuses = []
  const plugin = require('../index.js')({
    getDataDirPath: () => dir,
    registerResourceProvider () {},
    setPluginStatus: (m) => statuses.push(m)
  })
  plugin.start({ dashboardInputs: [{ label: '', path: 'a.b', unit: 'W' }] })
  plugin.stop()
  assert.equal(statuses.length, 1)
  assert.match(statuses[0], /Dashboard input 1: label/)
})
