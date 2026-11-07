import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newId } from '../public/ids.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('newId uses crypto.randomUUID when the browser offers it', () => {
  const fake = { randomUUID: () => 'from-randomUUID' }
  assert.equal(newId(fake), 'from-randomUUID')
})

test('newId still works in an insecure context, where randomUUID is missing', () => {
  // Pages served over plain http (a boat LAN) have getRandomValues but no randomUUID.
  const insecure = { getRandomValues: (a) => globalThis.crypto.getRandomValues(a) }
  const id = newId(insecure)
  assert.match(id, UUID_V4)
  assert.notEqual(newId(insecure), id)
})

test('newId falls back to Math.random when there is no crypto at all', () => {
  assert.match(newId(undefined), UUID_V4)
})
