'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolveSettings, createSettingsProvider } = require('../src/settings')

test('resolveSettings fills defaults when options are missing', () => {
  assert.deepEqual(resolveSettings(undefined), {
    convention: 'freestyle',
    defaultGaugeUnit: 'AWG',
    defaultLengthUnit: 'm'
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
