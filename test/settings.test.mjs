import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, wireRunInitialValues, colorPlaceholder } from '../public/settings.js'

test('new wire runs pre-select the configured units', () => {
  const initial = wireRunInitialValues({
    ...DEFAULT_SETTINGS,
    defaultGaugeUnit: 'mm2',
    defaultLengthUnit: 'ft'
  })
  assert.deepEqual(initial, { gaugeUnit: 'mm2', lengthUnit: 'ft' })
})

test('defaults apply before settings have loaded', () => {
  assert.deepEqual(wireRunInitialValues(DEFAULT_SETTINGS), { gaugeUnit: 'AWG', lengthUnit: 'm' })
})

test('colour placeholder follows the convention, freestyle has none', () => {
  assert.match(colorPlaceholder('abyc-e11'), /yellow/)
  assert.match(colorPlaceholder('din-en-iso-13297'), /brown/)
  assert.equal(colorPlaceholder('freestyle'), '')
  assert.equal(colorPlaceholder('unknown'), '')
})
