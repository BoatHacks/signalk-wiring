'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolveSettings, createSettingsProvider } = require('../src/settings')

test('resolveSettings fills defaults when options are missing', () => {
  assert.deepEqual(resolveSettings(undefined), {
    convention: 'freestyle',
    defaultGaugeUnit: 'AWG',
    defaultLengthUnit: 'm',
    autoTheme: false,
    voltageDropLimitCritical: 3,
    voltageDropLimitNormal: 10
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
