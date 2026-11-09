'use strict'

// Plan 0022: the saved position of an off-page "to" tab on a schematic page.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')

function setup () {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'A' })
  const b = store.create('device', { name: 'B' })
  const run = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, conductors: [{ conductor: 'positive' }] })
  return { store, a, b, run }
}

test('stub positions are stored with the page and read back', () => {
  const { store, a, run } = setup()
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: a.id, x: 0, y: 0 }], stubs: [{ wireRunId: run.id, x: 120.5, y: -40 }] })
  assert.deepEqual(page.stubs, [{ wireRunId: run.id, x: 120.5, y: -40 }])
  const moved = store.update('schematic', page.id, { stubs: [{ wireRunId: run.id, x: 5, y: 6 }] })
  assert.deepEqual(moved.stubs, [{ wireRunId: run.id, x: 5, y: 6 }])
  // a page written without the list keeps its stubs; an empty list clears them
  assert.equal(store.update('schematic', page.id, { name: 'Q' }).stubs.length, 1)
  assert.deepEqual(store.update('schematic', page.id, { stubs: [] }).stubs, [])
})

test('moving a tab is layout, not a logged change', () => {
  const { store, a, run } = setup()
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: a.id, x: 0, y: 0 }] })
  const before = store.changeLog('schematic', page.id).length
  store.update('schematic', page.id, { stubs: [{ wireRunId: run.id, x: 1, y: 2 }] })
  assert.equal(store.changeLog('schematic', page.id).length, before)
})

test('stub positions are validated', () => {
  const { store, a, run } = setup()
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: a.id, x: 0, y: 0 }] })
  assert.throws(() => store.update('schematic', page.id, { stubs: 'x' }), /stubs must be a list/)
  assert.throws(() => store.update('schematic', page.id, { stubs: [{ wireRunId: 'nope', x: 1, y: 2 }] }), /wire run not found/)
  assert.throws(() => store.update('schematic', page.id, { stubs: [{ wireRunId: run.id, x: 'a', y: 2 }] }), /x must be a number/)
  assert.throws(() => store.update('schematic', page.id, { stubs: [{ wireRunId: run.id, x: 1, y: 2 }, { wireRunId: run.id, x: 3, y: 4 }] }), /listed twice/)
})

test('purging a cable or a page erases its stub positions', () => {
  const { store, a, run } = setup()
  const page = store.create('schematic', { name: 'P', devices: [{ deviceId: a.id, x: 0, y: 0 }], stubs: [{ wireRunId: run.id, x: 1, y: 2 }] })
  const n = () => store.db.prepare('SELECT COUNT(*) n FROM schematic_stubs').get().n
  store.remove('wireRun', run.id)
  store.purgeCable(run.id)
  assert.equal(n(), 0)
  const again = setup()
  again.store.create('schematic', { name: 'P', devices: [], stubs: [{ wireRunId: again.run.id, x: 1, y: 2 }] })
  const p = again.store.list('schematic')[0]
  again.store.remove('schematic', p.id)
  again.store.purgeSchematic(p.id)
  assert.equal(again.store.db.prepare('SELECT COUNT(*) n FROM schematic_stubs').get().n, 0)
  assert.ok(page.id)
})

test('an older database gets the stub table by migration', () => {
  const store = new Store(':memory:')
  store.db.exec('DROP TABLE schematic_stubs')
  store.db.pragma('user_version = 12')
  store._migrate()
  assert.equal(store.db.pragma('user_version', { simple: true }), 15)
  assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'schematic_stubs'").get())
})
