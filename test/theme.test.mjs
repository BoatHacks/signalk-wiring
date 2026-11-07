import { test } from 'node:test'
import assert from 'node:assert/strict'
import { themeFromEnvironment } from '../public/theme.js'

test('daytime sun is light, every dusk-to-dawn phase is dark', () => {
  assert.equal(themeFromEnvironment('day', undefined), 'light')
  for (const phase of ['dawn', 'sunrise', 'sunset', 'dusk', 'night']) {
    assert.equal(themeFromEnvironment(phase, undefined), 'dark')
  }
})

test('values wrapped as { value } are unwrapped', () => {
  assert.equal(themeFromEnvironment({ value: 'night', timestamp: 't' }, null), 'dark')
  assert.equal(themeFromEnvironment(null, { value: 'day' }), 'light')
})

test('environment.mode is the fallback, case-insensitively', () => {
  assert.equal(themeFromEnvironment(null, 'Night'), 'dark')
  assert.equal(themeFromEnvironment(undefined, 'DAY'), 'light')
  assert.equal(themeFromEnvironment('unknown phase', 'night'), 'dark')
})

test('no usable environment gives no recommendation', () => {
  assert.equal(themeFromEnvironment(null, null), null)
  assert.equal(themeFromEnvironment('twilight', 'dusk'), null)
  assert.equal(themeFromEnvironment(undefined, 42), null)
})
