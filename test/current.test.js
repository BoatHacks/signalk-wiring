'use strict'

// Plan 0019: the current field, type presets, migration fill, mixed cables.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')
const { typeCurrent, mixesAcAndDc, terminalsCurrent, AC_TYPES, DC_TYPES } = require('../src/current')

const freshStore = () => new Store(':memory:')

test('the type table: AC, DC and unset, ignoring case and spacing', () => {
  for (const t of AC_TYPES) assert.equal(typeCurrent(t), 'ac', t)
  for (const t of DC_TYPES) assert.equal(typeCurrent(t), 'dc', t)
  assert.equal(typeCurrent('  shore POWER inlet '), 'ac')
  for (const t of ['Inverter', 'MPPT charger', 'Breaker', 'Cabin light', '', null, undefined]) {
    assert.equal(typeCurrent(t), null, String(t))
  }
})

test('terminalsCurrent agrees only when every terminal does', () => {
  assert.equal(terminalsCurrent([{ conductor: 'positive' }, { conductor: 'negative' }]), 'dc')
  assert.equal(terminalsCurrent([{ conductor: 'line' }, { conductor: 'neutral' }, { conductor: 'earth' }]), 'ac')
  assert.equal(terminalsCurrent([{ conductor: 'line' }, { conductor: 'positive' }]), null)
  assert.equal(terminalsCurrent([{ conductor: 'signal' }]), null)
  assert.equal(terminalsCurrent([]), null)
})

test('mixesAcAndDc: line or neutral with positive or negative; earth and signal never count', () => {
  const m = (...types) => mixesAcAndDc(types.map((conductor) => ({ conductor })))
  assert.equal(m('line', 'positive'), true)
  assert.equal(m('neutral', 'negative'), true)
  assert.equal(m('line', 'neutral', 'earth'), false)
  assert.equal(m('positive', 'negative', 'earth'), false)
  assert.equal(m('earth', 'positive'), false)
  assert.equal(m('signal', 'line'), false)
  assert.equal(m('earth', 'signal'), false)
  assert.equal(m(), false)
})

test('current is validated, optional and logged like any field', () => {
  const store = freshStore()
  const d = store.create('device', { name: 'Thing', current: 'ac' })
  assert.equal(d.current, 'ac')
  assert.throws(() => store.create('device', { name: 'Bad', current: 'both' }), /current must be one of/)
  assert.throws(() => store.update('device', d.id, { current: 'AC' }), /current must be one of/)
  assert.equal(store.update('device', d.id, { current: 'dc' }).current, 'dc')
  const entry = store.changeLog('device', d.id).pop()
  assert.deepEqual(JSON.parse(entry.diff_json).current, { before: 'ac', after: 'dc' })
  assert.equal(store.update('device', d.id, { current: '' }).current, null)
  store.close()
})

test('a new device gets its current from the type, an explicit value wins, updates never change it', () => {
  const store = freshStore()
  assert.equal(store.create('device', { name: 'Shore', type: 'Shore power inlet' }).current, 'ac')
  assert.equal(store.create('device', { name: 'Bank', type: 'lifepo4 battery' }).current, 'dc')
  assert.equal(store.create('device', { name: 'Charger', type: 'MPPT charger' }).current, null)
  assert.equal(store.create('device', { name: 'No type' }).current, null)
  const odd = store.create('device', { name: 'AC battery', type: 'Battery', current: 'ac' })
  assert.equal(odd.current, 'ac')
  const explicitNone = store.create('device', { name: 'Either', type: 'Battery', current: null })
  assert.equal(explicitNone.current, null)
  const g = store.create('device', { name: 'Gen', type: 'Generator' })
  assert.equal(store.update('device', g.id, { type: 'Battery' }).current, 'ac')
  store.close()
})

test('the resource serves current as ac, dc or absent', async () => {
  const store = freshStore()
  const provider = createResourceProvider(store, 'device', 'wiringDevices')
  await provider.methods.setResource('a', { name: 'Gen', type: 'Generator' })
  await provider.methods.setResource('b', { name: 'Lamp' })
  assert.equal((await provider.methods.getResource('a')).current, 'ac')
  assert.equal('current' in (await provider.methods.getResource('b')), false)
  await assert.rejects(provider.methods.setResource('b', { name: 'Lamp', current: 'x' }), /current must be one of/)
  store.close()
})

function oldDatabase (store) {
  return store.db
}

test('migration 10 fills by type and terminals, never overrides a mark, and is safe twice', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'wiring-'))
  const file = require('node:path').join(dir, 'w.db')
  const store = new Store(file)
  const mk = (fields, terminals) => store.create('device', { ...fields, ...(terminals ? { terminals } : {}) }).id
  const t = (conductor) => ({ name: conductor, conductor })
  const ids = {
    gen: mk({ name: 'Gen', type: 'Generator' }),
    batt: mk({ name: 'Batt', type: 'Battery' }),
    marked: mk({ name: 'Marked', type: 'Battery', current: 'ac' }),
    dcBox: mk({ name: 'DC box' }, [t('positive'), t('negative')]),
    acBox: mk({ name: 'AC box' }, [t('line'), t('neutral'), t('earth')]),
    mixed: mk({ name: 'Mixed' }, [t('line'), t('positive')]),
    plain: mk({ name: 'Plain', type: 'Inverter' })
  }
  // Simulate the database as it was before migration 10: no mark anywhere
  // except the hand-set one.
  store.db.exec("UPDATE devices SET current = NULL WHERE id != '" + ids.marked + "'")
  store.db.pragma('user_version = 9')
  store.close()
  for (let i = 0; i < 2; i++) {
    const again = new Store(file)
    assert.equal(again.db.pragma('user_version', { simple: true }), 10)
    const cur = (k) => again.get('device', ids[k]).current
    assert.equal(cur('gen'), 'ac')
    assert.equal(cur('batt'), 'dc')
    assert.equal(cur('marked'), 'ac')
    assert.equal(cur('dcBox'), 'dc')
    assert.equal(cur('acBox'), 'ac')
    assert.equal(cur('mixed'), null)
    assert.equal(cur('plain'), null)
    // run the migration body again directly: still fine, still no override
    again.db.pragma('user_version = 9')
    again.close()
  }
  require('node:fs').rmSync(dir, { recursive: true, force: true })
})

test('migration 10 adds the column to a database that predates it', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'wiring-'))
  const file = require('node:path').join(dir, 'w.db')
  const s = new Store(file)
  s.create('device', { name: 'Old gen', type: 'Generator' })
  s.close()
  const raw = new Database(file)
  raw.exec('ALTER TABLE devices DROP COLUMN current')
  raw.pragma('user_version = 9')
  raw.close()
  const store = new Store(file)
  assert.equal(store.list('device')[0].current, 'ac')
  store.close()
  require('node:fs').rmSync(dir, { recursive: true, force: true })
})

function twoDevices (store) {
  return [store.create('device', { name: 'A' }).id, store.create('device', { name: 'B' }).id]
}

test('a cable cannot carry both AC and DC: create and update through the store', () => {
  const store = freshStore()
  const [a, b] = twoDevices(store)
  const c = (...types) => types.map((conductor) => ({ conductor }))
  const base = { from_device_id: a, to_device_id: b }
  assert.throws(() => store.create('wireRun', { ...base, conductors: c('line', 'positive') }), /A cable cannot carry both AC and DC/)
  assert.throws(() => store.create('wireRun', { ...base, conductors: c('neutral', 'negative') }), /A cable cannot carry both AC and DC/)
  const ac = store.create('wireRun', { ...base, conductors: c('line', 'neutral', 'earth') })
  const dc = store.create('wireRun', { ...base, conductors: c('positive', 'negative', 'earth') })
  store.create('wireRun', { ...base, conductors: c('positive', 'signal') })
  assert.throws(() => store.update('wireRun', ac.id, { conductors: c('line', 'positive') }), /A cable cannot carry both AC and DC/)
  assert.deepEqual(store.get('wireRun', ac.id).conductors.map((x) => x.conductor), ['line', 'neutral', 'earth'])
  assert.ok(store.update('wireRun', dc.id, { conductors: c('positive', 'negative') }))
  assert.equal(store.list('wireRun').length, 3)
  store.close()
})

test('a mixed cable is rejected through the resource provider too', async () => {
  const store = freshStore()
  const [a, b] = twoDevices(store)
  const provider = createResourceProvider(store, 'wireRun', 'wiringCables')
  const mixed = { fromDeviceId: a, toDeviceId: b, conductors: [{ conductor: 'line' }, { conductor: 'negative' }] }
  await assert.rejects(provider.methods.setResource('w1', mixed), /A cable cannot carry both AC and DC/)
  await provider.methods.setResource('w2', { ...mixed, conductors: [{ conductor: 'line' }, { conductor: 'earth' }] })
  await assert.rejects(provider.methods.setResource('w2', mixed), /A cable cannot carry both AC and DC/)
  store.close()
})
