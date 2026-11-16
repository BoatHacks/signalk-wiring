import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plural } from '../public/wording.js'

test('plural uses the singular for exactly one and adds an s otherwise', () => {
  assert.equal(plural(1, 'device'), '1 device')
  assert.equal(plural(0, 'device'), '0 devices')
  assert.equal(plural(2, 'cable'), '2 cables')
  assert.equal(plural('1', 'conduit'), '1 conduit')
})

test('plural takes an explicit plural form', () => {
  assert.equal(plural(3, 'battery', 'batteries'), '3 batteries')
  assert.equal(plural(1, 'battery', 'batteries'), '1 battery')
})

import { loadErrorSentence } from '../public/wording.js'

test('loadErrorSentence says the server answered when there is an error status', () => {
  assert.equal(loadErrorSentence('devices', 'failed to load wiringDevices: 500'),
    'Could not load the devices. The server answered with an error.')
})

test('loadErrorSentence says the server could not be reached for anything else', () => {
  assert.equal(loadErrorSentence('cables', 'Failed to fetch'), 'Could not load the cables. The server could not be reached.')
  assert.equal(loadErrorSentence('cables', ''), 'Could not load the cables. The server could not be reached.')
})
