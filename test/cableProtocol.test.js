'use strict'

// Plan 0037: the optional protocol label on cables (migration 20).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')

function setup () {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'A', role: 'consumer' })
  const b = store.create('device', { name: 'B', role: 'consumer' })
  return { store, a, b }
}

test('a cable has no protocol by default, and one can be set, changed and cleared', () => {
  const { store, a, b } = setup()
  const run = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id })
  assert.equal(run.protocol, null)
  assert.equal(store.update('wireRun', run.id, { protocol: 'nmea2000' }).protocol, 'nmea2000')
  assert.equal(store.update('wireRun', run.id, { notes: 'x' }).protocol, 'nmea2000')
  assert.equal(store.update('wireRun', run.id, { protocol: '' }).protocol, null)
  const made = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, protocol: 'seatalk1' })
  assert.equal(made.protocol, 'seatalk1')
})

test('an unknown protocol is refused, on create and update', () => {
  const { store, a, b } = setup()
  assert.throws(() => store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, protocol: 'canbus' }), /protocol must be one of/)
  const run = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id })
  assert.throws(() => store.update('wireRun', run.id, { protocol: 'x' }), /protocol must be one of/)
})

test('the schema is at version 20', () => {
  const { store } = setup()
  assert.equal(store.db.pragma('user_version', { simple: true }), 20)
})
