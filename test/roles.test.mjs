import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, roleLabel, isConsumer } from '../public/roles.js'

test('the five roles are consumer, source, storage, distribution and converter', () => {
  assert.deepEqual(ROLES.map((r) => r.value), ['consumer', 'source', 'storage', 'distribution', 'converter'])
  for (const r of ROLES) assert.ok(r.label && r.hint)
})

test('roleLabel falls back to Consumer for a missing or unknown role', () => {
  assert.equal(roleLabel('source'), 'Source')
  assert.equal(roleLabel(undefined), 'Consumer')
  assert.equal(roleLabel('weird'), 'Consumer')
})

test('isConsumer is true for a consumer and for no role', () => {
  assert.equal(isConsumer({ role: 'consumer' }), true)
  assert.equal(isConsumer({}), true)
  assert.equal(isConsumer({ role: 'storage' }), false)
})
