'use strict'

// Plan 0033: the change log across records, grouped by record.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')

function stamp (store, id, iso) {
  store.db.prepare('UPDATE change_log SET timestamp = ? WHERE record_id = ?').run(iso, id)
}

function fixture () {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'Bilge pump' })
  const b = store.create('device', { name: 'Anchor light' })
  const hose = store.create('conduit', { name: 'Main hose' })
  stamp(store, a.id, '2026-11-01T10:00:00.000Z')
  stamp(store, b.id, '2026-11-03T10:00:00.000Z')
  stamp(store, hose.id, '2026-11-02T10:00:00.000Z')
  return { store, a, b, hose }
}

test('groups are one per record, newest activity first, entries newest first', () => {
  const { store, a, b, hose } = fixture()
  store.update('device', a.id, { name: 'Bilge pump 2' })
  store.db.prepare("UPDATE change_log SET timestamp = '2026-11-04T10:00:00.000Z' WHERE record_id = ? AND summary = 'updated'").run(a.id)
  const { groups, nextCursor } = store.changeGroups()
  assert.deepEqual(groups.map((g) => g.id), [a.id, b.id, hose.id])
  assert.equal(nextCursor, null)
  assert.equal(groups[0].name, 'Bilge pump 2')
  assert.equal(groups[0].status, 'active')
  assert.equal(groups[0].latest, '2026-11-04T10:00:00.000Z')
  assert.deepEqual(groups[0].entries.map((e) => e.summary), ['updated', 'created'])
  assert.equal(groups[0].more, 0)
  store.close()
})

test('kind filter, date range and id narrow the result', () => {
  const { store, a, b, hose } = fixture()
  assert.deepEqual(store.changeGroups({ kinds: ['conduit'] }).groups.map((g) => g.id), [hose.id])
  assert.deepEqual(
    store.changeGroups({ since: '2026-11-02T00:00:00Z', until: '2026-11-02T23:59:59Z' }).groups.map((g) => g.id),
    [hose.id]
  )
  assert.deepEqual(store.changeGroups({ id: a.id }).groups.map((g) => g.id), [a.id])
  assert.equal(store.changeGroups({ since: '2027-01-01T00:00:00Z' }).groups.length, 0)
  assert.ok(b)
  store.close()
})

test('text matches the record name or an entry summary', () => {
  const { store, a, b } = fixture()
  store.remove('device', b.id)
  assert.deepEqual(store.changeGroups({ q: 'bilge' }).groups.map((g) => g.id), [a.id])
  const removed = store.changeGroups({ q: 'removed' }).groups
  assert.deepEqual(removed.map((g) => g.id), [b.id])
  assert.deepEqual(removed[0].entries.map((e) => e.summary), ['removed'])
  assert.equal(removed[0].status, 'removed')
  store.close()
})

test('entries are capped per group with a count of the rest', () => {
  const { store, a } = fixture()
  for (let i = 0; i < 6; i++) store.update('device', a.id, { name: `Pump ${i}` })
  const group = store.changeGroups({ id: a.id, entries: 3 }).groups[0]
  assert.equal(group.entries.length, 3)
  assert.equal(group.more, 4)
  assert.equal(group.entries[0].summary, 'updated')
  assert.equal(store.changeGroups({ id: a.id, entries: 50 }).groups[0].more, 0)
  store.close()
})

test('groups page by cursor without gaps or repeats', () => {
  const { store, a, b, hose } = fixture()
  const first = store.changeGroups({ limit: 2 })
  assert.deepEqual(first.groups.map((g) => g.id), [b.id, hose.id])
  assert.ok(first.nextCursor)
  const second = store.changeGroups({ limit: 2, cursor: first.nextCursor })
  assert.deepEqual(second.groups.map((g) => g.id), [a.id])
  assert.equal(second.nextCursor, null)
  store.close()
})

test('groups with the same latest time keep a stable order across pages', () => {
  const store = new Store(':memory:')
  const ids = ['One', 'Two', 'Three'].map((n) => store.create('device', { name: n }).id)
  store.db.prepare("UPDATE change_log SET timestamp = '2026-11-01T10:00:00.000Z'").run()
  const seen = []
  let cursor
  do {
    const page = store.changeGroups({ limit: 1, cursor })
    seen.push(...page.groups.map((g) => g.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(seen, [...ids].reverse())
  store.close()
})

test('circuit entries are left out unless the circuit kind is asked for', () => {
  const { store } = fixture()
  const circuit = store.create('circuit', { name: 'Lights', key: 'k1' })
  assert.equal(store.changeGroups().groups.some((g) => g.kind === 'circuit'), false)
  assert.deepEqual(store.changeGroups({ kinds: ['circuit'] }).groups.map((g) => g.id), [circuit.id])
  store.close()
})

test('a purged record shows as purged with the name from its tombstone, a cable by label or ends', () => {
  const store = new Store(':memory:')
  const a = store.create('device', { name: 'Battery' })
  const b = store.create('device', { name: 'Lamp' })
  const c = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, conductors: [{ conductor: 'positive' }] })
  store.remove('wireRun', c.id)
  store.purgeCable(c.id)
  const gone = store.changeGroups({ kinds: ['wireRun'] }).groups[0]
  assert.equal(gone.status, 'purged')
  assert.equal(gone.name, 'Battery to Lamp')
  assert.deepEqual(gone.entries.map((e) => e.summary), ['permanently deleted'])
  const live = store.changeGroups({ kinds: ['device'] }).groups
  assert.equal(live.every((g) => g.status === 'active'), true)
  store.close()
})

test('a deleted zone is named from its logged entry', () => {
  const store = new Store(':memory:')
  const z = store.create('zone', { name: 'Engine room' })
  store.deleteZone(z.id)
  const group = store.changeGroups({ kinds: ['zone'] }).groups[0]
  assert.equal(group.status, 'purged')
  assert.equal(group.name, 'Engine room')
  store.close()
})
