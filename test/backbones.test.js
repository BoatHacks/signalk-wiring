'use strict'

// Plan 0037 step 1: backbones with taps, devices.len, removal, purge, resources.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

const dev = (store, name, extra = {}) => store.create('device', { name, ...extra })

test('migration 18 creates the tables, adds len, and is safe twice', () => {
  const store = new Store(':memory:')
  assert.ok(store.db.pragma('user_version', { simple: true }) >= 20)
  const cols = (t) => store.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  assert.ok(cols('devices').includes('len'))
  assert.deepEqual(cols('backbone_taps').filter((c) => ['along', 'drop_length', 'power_feed', 'fed_from_device_id'].includes(c)).sort(),
    ['along', 'drop_length', 'fed_from_device_id', 'power_feed'])
  // An old database: drop the new tables and column, set the version back, reopen the steps.
  store.db.exec('DROP TABLE backbone_taps; DROP TABLE backbones; ALTER TABLE devices DROP COLUMN len')
  store.db.pragma('user_version = 17')
  store._migrate()
  assert.ok(cols('devices').includes('len'))
  assert.ok(cols('backbones').includes('supply_rating_a'))
  // Run it again with everything in place.
  store.db.pragma('user_version = 17')
  store._migrate()
  assert.equal(store.db.pragma('user_version', { simple: true }), 20)
  store.close()
})

test('a backbone round trips with its taps and flags', () => {
  const store = new Store(':memory:')
  const gps = dev(store, 'GPS', { len: 1 })
  const bb = store.create('backbone', {
    name: 'Main', cable_class: 'mini', length: 12, length_unit: 'm', terminator_a: true, terminator_b: 1,
    supply_rating_a: 4, route: JSON.stringify([{ x: 1, y: 2 }]),
    taps: [{ deviceId: gps.id, port: 'NMEA 2000', dropLength: 0.5, along: 2 }]
  })
  assert.equal(bb.terminator_a, 1)
  assert.equal(bb.taps.length, 1)
  assert.equal(bb.taps[0].dropLength, 0.5)
  assert.equal(bb.taps[0].powerFeed, false)
  assert.equal(store.get('device', gps.id).len, 1)
  const log = store.changeLog('backbone', bb.id)
  assert.equal(log[0].summary, 'created')
  const up = store.update('backbone', bb.id, { taps: [] })
  assert.equal(up.taps.length, 0)
  assert.equal(store.changeLog('backbone', bb.id).length, 2)
  store.close()
})

test('validation: name, class, numbers, device, power feed source, len', () => {
  const store = new Store(':memory:')
  const a = dev(store, 'A')
  const fuse = dev(store, 'Fuse', { role: 'distribution' })
  assert.throws(() => store.create('backbone', { name: ' ' }), /needs a name/)
  assert.throws(() => store.create('backbone', { name: 'x', cable_class: 'huge' }), /cable class/)
  assert.throws(() => store.create('backbone', { name: 'x', length: -1 }), /length/)
  assert.throws(() => store.create('backbone', { name: 'x', supply_rating_a: 'abc' }), /supply_rating_a/)
  assert.throws(() => store.create('backbone', { name: 'x', taps: [{ deviceId: 'nope' }] }), /device not found/)
  assert.throws(() => store.create('backbone', { name: 'x', taps: [{ deviceId: a.id, dropLength: -2 }] }), /drop length/)
  assert.throws(() => store.create('backbone', { name: 'x', taps: [{ deviceId: a.id, along: 'q' }] }), /position/)
  assert.throws(() => store.create('backbone', { name: 'x', taps: [{ deviceId: a.id, powerFeed: true }] }), /fed from/)
  assert.throws(() => store.create('backbone', { name: 'x', taps: [{ deviceId: a.id, powerFeed: true, fedFromDeviceId: 'nope' }] }), /device not found/)
  assert.throws(() => store.create('backbone', { name: 'x', taps: [{ deviceId: a.id, fedFromDeviceId: fuse.id }] }), /only a power feed/)
  const ok = store.create('backbone', { name: 'x', taps: [{ deviceId: a.id, powerFeed: true, fedFromDeviceId: fuse.id }] })
  assert.equal(ok.taps[0].powerFeed, true)
  assert.throws(() => store.create('device', { name: 'B', len: -1 }), /len/)
  assert.throws(() => store.update('device', a.id, { len: 'x' }), /len/)
  assert.equal(store.update('device', a.id, { len: '2' }).len, 2)
  assert.equal(store.update('device', a.id, { len: '' }).len, null)
  store.close()
})

test('a tap is unique per device and port, also across live backbones', () => {
  const store = new Store(':memory:')
  const a = dev(store, 'A')
  assert.throws(() => store.create('backbone', { name: 'x', taps: [{ deviceId: a.id, port: 'N' }, { deviceId: a.id, port: 'N' }] }), /already a tap/)
  const one = store.create('backbone', { name: 'one', taps: [{ deviceId: a.id, port: 'N' }] })
  // Another port of the same device is a different tap.
  store.create('backbone', { name: 'two', taps: [{ deviceId: a.id, port: 'M' }] })
  assert.throws(() => store.create('backbone', { name: 'three', taps: [{ deviceId: a.id, port: 'N' }] }), /already a tap on the backbone one/)
  // Once the first is removed, the port is free; undo is then refused.
  store.remove('backbone', one.id)
  const three = store.create('backbone', { name: 'three', taps: [{ deviceId: a.id, port: 'N' }] })
  assert.throws(() => store.restore('backbone', one.id), /already a tap/)
  store.remove('backbone', three.id)
  assert.equal(store.restore('backbone', one.id).status, 'active')
  store.close()
})

test('removal and undo are logged, purge needs removal and erases everything', () => {
  const store = new Store(':memory:')
  const a = dev(store, 'A')
  const bb = store.create('backbone', { name: 'Main', taps: [{ deviceId: a.id }] })
  const att = store.createAttachment({ owner_type: 'backbone', owner_id: bb.id, filename: 'a.jpg', mime_type: 'image/jpeg', uploaded_at: 'now' })
  assert.throws(() => store.purgeBackbone(bb.id), /only a removed backbone/)
  assert.throws(() => store.purgeBackbone('nope'), (e) => e.notFound === true)
  assert.equal(store.remove('backbone', bb.id).status, 'removed')
  assert.equal(store.restore('backbone', bb.id).status, 'active')
  assert.deepEqual(store.changeLog('backbone', bb.id).map((r) => r.summary), ['created', 'removed', 'restored (undo)'])
  // A device on a backbone cannot be erased until the backbone goes.
  store.remove('device', a.id)
  assert.throws(() => store.purgeDevice(a.id), /backbones first: Main/)
  store.remove('backbone', bb.id)
  const files = store.purgeBackbone(bb.id)
  assert.equal(files.length, 1)
  assert.equal(files[0].id, att.id)
  assert.equal(store.get('backbone', bb.id), null)
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM backbone_taps').get().n, 0)
  const log = store.changeLog('backbone', bb.id)
  assert.equal(log.length, 1)
  assert.equal(log[0].summary, 'permanently deleted')
  store.purgeDevice(a.id)
  store.close()
})

test('the wiringBackbones resource lists, reads, writes and deletes', async () => {
  const store = new Store(':memory:')
  const a = dev(store, 'A')
  const fuse = dev(store, 'Fuse', { role: 'distribution' })
  const p = createResourceProvider(store, 'backbone', 'wiringBackbones')
  await p.methods.setResource('bb1', {
    name: 'Main', cableClass: 'maxi', length: 20, lengthUnit: 'm', terminatorA: true, terminatorB: false, supplyRatingA: 5,
    route: [{ x: 1, y: 2 }],
    taps: [{ deviceId: a.id, port: 'NMEA 2000', dropLength: 1, along: 3, powerFeed: true, fedFromDeviceId: fuse.id }]
  })
  const got = await p.methods.getResource('bb1')
  assert.equal(got.cableClass, 'maxi')
  assert.equal(got.terminatorA, true)
  assert.equal(got.terminatorB, false)
  assert.deepEqual(got.route, [{ x: 1, y: 2 }])
  assert.equal(got.taps[0].powerFeed, true)
  assert.equal(got.taps[0].fedFromDeviceId, fuse.id)
  assert.deepEqual(Object.keys(await p.methods.listResources()), ['bb1'])
  await p.methods.setResource('bb1', { name: 'Renamed', terminatorB: true })
  assert.equal((await p.methods.getResource('bb1')).name, 'Renamed')
  assert.equal((await p.methods.getResource('bb1')).taps.length, 1)
  await p.methods.deleteResource('bb1')
  assert.equal((await p.methods.getResource('bb1')).status, 'removed')
  store.close()
})
