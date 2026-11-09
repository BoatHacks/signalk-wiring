'use strict'

// Plan 0024: enclosures, migration 15, parent validation, boundary cables.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')
const { contentsOf, pathOf, wouldCycle, boundaryCables, childrenOf } = require('../src/enclosures')

const dev = (id, extra = {}) => ({ id, name: id, role: 'consumer', status: 'active', parentId: null, ...extra })
const cab = (id, from, to, extra = {}) => ({ id, fromDeviceId: from, toDeviceId: to, status: 'active', conductors: [], ...extra })

// cabinet > box > breaker; cabinet > lamp; outside: battery
const nested = [
  dev('cabinet', { role: 'enclosure' }),
  dev('box', { role: 'enclosure', parentId: 'cabinet' }),
  dev('breaker', { role: 'distribution', parentId: 'box' }),
  dev('lamp', { parentId: 'cabinet' }),
  dev('gone', { parentId: 'box', status: 'removed' }),
  dev('battery', { role: 'storage' })
]

test('contents are direct and nested, removed devices are left out', () => {
  assert.deepEqual(childrenOf(nested, 'cabinet'), ['box', 'lamp'])
  assert.deepEqual(contentsOf(nested, 'cabinet'), ['box', 'lamp', 'breaker'])
  assert.deepEqual(contentsOf(nested, 'box'), ['breaker'])
  assert.deepEqual(contentsOf(nested, 'battery'), [])
})

test('the path is the chain of enclosures, outermost first', () => {
  assert.deepEqual(pathOf(nested, 'breaker'), ['cabinet', 'box'])
  assert.deepEqual(pathOf(nested, 'cabinet'), [])
})

test('a cycle is detected', () => {
  assert.equal(wouldCycle(nested, 'cabinet', 'box'), true)
  assert.equal(wouldCycle(nested, 'box', 'box'), true)
  assert.equal(wouldCycle(nested, 'box', 'cabinet'), false)
  // a loop already in the data does not hang the walk
  const loop = [dev('a', { parentId: 'b' }), dev('b', { parentId: 'a' })]
  assert.deepEqual(contentsOf(loop, 'a').sort(), ['b'])
  assert.equal(pathOf(loop, 'a').length <= 1, true)
})

test('boundary cables have exactly one end inside, at any depth', () => {
  const cables = [
    cab('feed', 'battery', 'breaker', { conductors: [{ conductor: 'positive', color: 'red', fromTerminal: 'B+', toTerminal: 'IN' }] }),
    cab('inner', 'breaker', 'lamp'),
    cab('mid', 'lamp', 'box'),
    cab('removed', 'battery', 'lamp', { status: 'removed' }),
    cab('outside', 'battery', 'battery')
  ]
  const cabinet = boundaryCables(nested, cables, 'cabinet')
  assert.deepEqual(cabinet.map((p) => p.cableId), ['feed'])
  assert.equal(cabinet[0].innerDeviceId, 'breaker')
  assert.equal(cabinet[0].outerDeviceId, 'battery')
  assert.equal(cabinet[0].innerEnd, 'to')
  assert.deepEqual(cabinet[0].terminals, ['IN'])
  assert.equal(cabinet[0].name, 'breaker IN')
  assert.deepEqual(cabinet[0].conductors, [{ conductor: 'positive', color: 'red', terminal: 'IN' }])
  // the box sees the feed and the cable to the lamp (inside the cabinet, outside the box)
  assert.deepEqual(boundaryCables(nested, cables, 'box').map((p) => p.cableId).sort(), ['feed', 'inner'])
})

test('migration 15: a version 14 database gains the columns, twice over', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-m15-')), 'wiring.db')
  new Store(file).close()
  const raw = new Database(file)
  raw.exec('DROP INDEX idx_devices_parent; DROP INDEX idx_schematics_enclosure; ALTER TABLE devices DROP COLUMN parent_id; ALTER TABLE schematics DROP COLUMN enclosure_id')
  raw.pragma('user_version = 14')
  raw.close()
  for (let i = 0; i < 2; i++) {
    const store = new Store(file)
    assert.equal(store.db.pragma('user_version', { simple: true }), 15)
    const box = store.create('device', { name: 'Box', role: 'enclosure' })
    const lamp = store.create('device', { name: 'Lamp', parent_id: box.id })
    assert.equal(store.get('device', lamp.id).parent_id, box.id)
    store.close()
    if (i === 0) { const r = new Database(file); r.pragma('user_version = 14'); r.close() }
  }
})

function setup () {
  const store = new Store(':memory:')
  const box = store.create('device', { name: 'Box', role: 'enclosure' })
  const inner = store.create('device', { name: 'Inner box', role: 'enclosure', parent_id: box.id })
  const breaker = store.create('device', { name: 'Breaker', role: 'distribution', parent_id: inner.id })
  const lamp = store.create('device', { name: 'Lamp' })
  return { store, box, inner, breaker, lamp }
}

test('parent_id must be a live enclosure, not the device itself, with no cycle', () => {
  const { store, box, inner, breaker, lamp } = setup()
  assert.throws(() => store.update('device', lamp.id, { parent_id: breaker.id }), /only be put inside an enclosure/)
  assert.throws(() => store.update('device', box.id, { parent_id: box.id }), /inside itself/)
  assert.throws(() => store.update('device', box.id, { parent_id: inner.id }), /something it holds/)
  assert.throws(() => store.update('device', lamp.id, { parent_id: 'nope' }), /device not found/)
  assert.throws(() => store.create('device', { name: 'X', parent_id: lamp.id }), /only be put inside an enclosure/)
  const moved = store.update('device', lamp.id, { parent_id: inner.id })
  assert.equal(moved.parent_id, inner.id)
  // logged like any field
  const log = store.changeLog('device', lamp.id).at(-1)
  assert.deepEqual(JSON.parse(log.diff_json).parent_id, { before: null, after: inner.id })
  // taking it out
  assert.equal(store.update('device', lamp.id, { parent_id: '' }).parent_id, null)
  // a removed enclosure takes no new devices
  store.remove('device', inner.id)
  assert.throws(() => store.update('device', lamp.id, { parent_id: inner.id }), /removed enclosure/)
})

test('an enclosure that holds devices keeps its role', () => {
  const { store, box, inner } = setup()
  assert.throws(() => store.update('device', inner.id, { role: 'consumer' }), /still holds devices/)
  store.update('device', inner.id, { notes: 'fine' })
  store.update('device', store.list('device').find((d) => d.name === 'Breaker').id, { parent_id: null })
  assert.equal(store.update('device', inner.id, { role: 'consumer' }).role, 'consumer')
  assert.ok(box)
})

test('one inside page per enclosure, set only on creation', () => {
  const { store, box, inner, lamp } = setup()
  const page = store.create('schematic', { name: 'Box (inside)', enclosure_id: box.id })
  assert.equal(page.enclosure_id, box.id)
  assert.throws(() => store.create('schematic', { name: 'Again', enclosure_id: box.id }), /already has an inside page/)
  assert.throws(() => store.create('schematic', { name: 'X', enclosure_id: lamp.id }), /belongs to an enclosure/)
  assert.throws(() => store.update('schematic', page.id, { enclosure_id: inner.id }), /cannot be changed/)
  assert.throws(() => store.update('schematic', page.id, { enclosure_id: null }), /cannot be changed/)
  assert.equal(store.update('schematic', page.id, { enclosure_id: box.id, name: 'Renamed' }).name, 'Renamed')
  assert.equal(store.create('schematic', { name: 'Plain' }).enclosure_id, null)
})

test('resources serve parentId, enclosureId, contents and boundary cables', async () => {
  const { store, box, inner, breaker, lamp } = setup()
  const c = store.create('wireRun', {
    from_device_id: lamp.id, to_device_id: breaker.id,
    conductors: [{ conductor: 'positive', toTerminal: 'IN' }]
  })
  const devices = createResourceProvider(store, 'device', 'wiringDevices')
  const got = await devices.methods.getResource(box.id)
  assert.deepEqual(got.contents, [inner.id])
  assert.deepEqual(got.allContents, [inner.id, breaker.id])
  assert.equal(got.boundaryCables[0].cableId, c.id)
  assert.equal((await devices.methods.getResource(breaker.id)).parentId, inner.id)
  assert.equal((await devices.methods.getResource(lamp.id)).contents, undefined)
  const all = await devices.methods.listResources()
  assert.deepEqual(all[inner.id].contents, [breaker.id])
  const page = store.create('schematic', { name: 'In', enclosure_id: box.id })
  const schematics = createResourceProvider(store, 'schematic', 'wiringSchematics')
  assert.equal((await schematics.methods.getResource(page.id)).enclosureId, box.id)
  // a put with the derived fields echoed back is accepted
  await devices.methods.setResource(box.id, { ...got, notes: 'x' })
  assert.equal(store.get('device', box.id).notes, 'x')
})

test('purge: an enclosure with devices in it is refused, its inside page goes with it', () => {
  const { store, box, inner, breaker } = setup()
  const page = store.create('schematic', { name: 'Box (inside)', enclosure_id: box.id })
  store.remove('device', inner.id)
  store.remove('device', box.id)
  assert.throws(() => store.purgeDevice(box.id), /Take out or delete these devices first: Inner box/)
  store.update('device', inner.id, { parent_id: null })
  assert.throws(() => store.purgeDevice(inner.id), /Take out or delete these devices first: Breaker/)
  store.update('device', breaker.id, { parent_id: null })
  store.purgeDevice(inner.id)
  store.purgeDevice(box.id)
  assert.equal(store.get('device', box.id), null)
  assert.equal(store.get('schematic', page.id), null)
})

test('what an enclosure holds is placed on its inside page only; an enclosure not on its own', () => {
  const { store, box, inner, breaker, lamp } = setup()
  const outer = store.create('schematic', { name: 'Outer' })
  const insidePage = store.create('schematic', { name: 'Inside', enclosure_id: inner.id })
  // contents cannot be added to a page that is not their enclosure's inside page
  assert.throws(() => store.update('schematic', outer.id, { devices: [{ deviceId: breaker.id, x: 0, y: 0 }] }), /place it on that enclosure's inside page/)
  assert.throws(() => store.update('schematic', insidePage.id, { devices: [{ deviceId: inner.id, x: 0, y: 0 }] }), /not placed on its own inside page/)
  assert.throws(() => store.create('schematic', { name: 'X', devices: [{ deviceId: breaker.id, x: 0, y: 0 }] }), /inside page/)
  assert.equal(store.update('schematic', insidePage.id, { devices: [{ deviceId: breaker.id, x: 1, y: 2 }] }).devices.length, 1)
  // the enclosure itself and unrelated devices go on the outer page
  assert.equal(store.update('schematic', outer.id, { devices: [{ deviceId: box.id, x: 0, y: 0 }, { deviceId: lamp.id, x: 5, y: 5 }] }).devices.length, 2)
  // a placement made before the device was put inside stays, and can be rewritten
  store.update('device', lamp.id, { parent_id: box.id })
  const kept = store.update('schematic', outer.id, { devices: [{ deviceId: box.id, x: 3, y: 3 }, { deviceId: lamp.id, x: 9, y: 9 }] })
  assert.equal(kept.devices.length, 2)
  // a new inside page can be created with its contents in one write
  const page = store.create('schematic', { name: 'Box (inside)', enclosure_id: box.id, devices: [{ deviceId: lamp.id, x: 0, y: 0 }, { deviceId: inner.id, x: 100, y: 0 }] })
  assert.equal(page.devices.length, 2)
})

test('regression: putting devices inside an enclosure changes no circuit, warning or bank', () => {
  const store = new Store(':memory:')
  const t = (name, conductor) => ({ name, conductor })
  const battery = store.create('device', { name: 'Battery', role: 'storage', nominal_voltage: 12, terminals: [t('+', 'positive'), t('-', 'negative')] })
  const fuse = store.create('device', { name: 'Fuse', role: 'distribution', trip_rating_a: 10 })
  const bar = store.create('device', { name: 'Bar', role: 'distribution' })
  const lamp = store.create('device', { name: 'Lamp', rated_power_w: 20 })
  const feed = (from, to) => store.create('wireRun', { from_device_id: from.id, to_device_id: to.id, conductors: [{ conductor: 'positive' }] })
  feed(battery, fuse); feed(fuse, bar); feed(bar, lamp)
  const snapshot = () => JSON.stringify({
    derived: store.deriveAll(),
    circuits: store.list('circuit').map(({ id, key, name, status, cable_ids: cableIds }) => ({ id, key, name, status, cableIds })),
    switching: store.deriveSwitching()
  })
  const before = snapshot()
  const box = store.create('device', { name: 'Panel', role: 'enclosure' })
  assert.equal(snapshot(), before)
  for (const d of [fuse, bar, lamp]) store.update('device', d.id, { parent_id: box.id })
  assert.equal(snapshot(), before)
  store.update('device', fuse.id, { parent_id: null })
  assert.equal(snapshot(), before)
  store.close()
})

function withContents () {
  const store = new Store(':memory:')
  const panel = store.create('device', { name: 'Panel', role: 'enclosure' })
  const sub = store.create('device', { name: 'Sub box', role: 'enclosure', parent_id: panel.id })
  const fuse = store.create('device', { name: 'Fuse', role: 'distribution', trip_rating_a: 10, parent_id: sub.id })
  const lamp = store.create('device', { name: 'Lamp', parent_id: panel.id })
  const battery = store.create('device', { name: 'Battery', role: 'storage', nominal_voltage: 12 })
  const other = store.create('device', { name: 'Other lamp' })
  const run = (from, to) => store.create('wireRun', { from_device_id: from.id, to_device_id: to.id, conductors: [{ conductor: 'positive' }] })
  const feed = run(battery, fuse)
  const branch = run(fuse, lamp)
  const outside = run(battery, other)
  const old = run(battery, lamp)
  store.remove('wireRun', old.id)
  const page = store.create('schematic', { name: 'Panel (inside)', enclosure_id: panel.id })
  const subPage = store.create('schematic', { name: 'Sub (inside)', enclosure_id: sub.id })
  return { store, panel, sub, fuse, lamp, battery, other, feed, branch, outside, old, page, subPage }
}

test('removing an enclosure removes what it holds, their cables and the inside pages as one action', () => {
  const { store, panel, sub, fuse, lamp, battery, other, feed, branch, outside, old, page, subPage } = withContents()
  store.remove('device', panel.id)
  const status = (kind, r) => store.get(kind, r.id).status
  for (const d of [panel, sub, fuse, lamp]) assert.equal(status('device', d), 'removed', d.name)
  for (const c of [feed, branch, old]) assert.equal(status('wireRun', c), 'removed')
  assert.equal(status('wireRun', outside), 'active')
  assert.equal(status('device', battery), 'active')
  assert.equal(status('device', other), 'active')
  assert.equal(status('schematic', page), 'removed')
  assert.equal(status('schematic', subPage), 'removed')
  // the contents keep their place in the enclosure, so undo can put them back
  assert.equal(store.get('device', fuse.id).parent_id, sub.id)
  // the enclosure's history says what went with it
  const entry = store.changeLog('device', panel.id).find((e) => e.summary === 'removed with contents')
  assert.deepEqual(JSON.parse(entry.diff_json).devices.sort(), [sub.id, fuse.id, lamp.id].sort())
  assert.deepEqual(JSON.parse(entry.diff_json).cables.sort(), [feed.id, branch.id].sort())
  // the circuits no longer see them
  assert.equal(store.deriveAll().circuits.some((c) => c.cableIds.includes(feed.id)), false)
})

test('undo of an enclosure removal restores exactly what it took, not what was removed before', () => {
  const { store, panel, sub, fuse, lamp, feed, branch, outside, old, page, subPage } = withContents()
  store.remove('device', panel.id)
  const restored = store.update('device', panel.id, { status: 'active' })
  assert.equal(restored.status, 'active')
  for (const d of [sub, fuse, lamp]) assert.equal(store.get('device', d.id).status, 'active', d.name)
  for (const c of [feed, branch, outside]) assert.equal(store.get('wireRun', c.id).status, 'active')
  assert.equal(store.get('wireRun', old.id).status, 'removed') // removed by the user earlier: stays removed
  assert.equal(store.get('schematic', page.id).status, 'active')
  assert.equal(store.get('schematic', subPage.id).status, 'active')
  assert.equal(store.changeLog('device', panel.id).at(-1).summary, 'restored (undo)')
  assert.ok(store.changeLog('device', panel.id).some((e) => e.summary === 'removed with contents'))
  assert.ok(store.changeLog('device', fuse.id).some((e) => e.summary === 'restored (undo)'))
  assert.ok(store.deriveAll().circuits.some((c) => c.cableIds.includes(feed.id)))
  // removing again after the restore works the same
  store.remove('device', panel.id)
  assert.equal(store.get('device', fuse.id).status, 'removed')
})

test('removing a nested enclosure takes only its own contents; an empty enclosure is a plain removal', () => {
  const { store, panel, sub, fuse, lamp } = withContents()
  store.remove('device', sub.id)
  assert.equal(store.get('device', fuse.id).status, 'removed')
  assert.equal(store.get('device', lamp.id).status, 'active')
  assert.equal(store.get('device', panel.id).status, 'active')
  store.update('device', sub.id, { status: 'active' })
  assert.equal(store.get('device', fuse.id).status, 'active')
  const empty = store.create('device', { name: 'Empty', role: 'enclosure' })
  store.remove('device', empty.id)
  assert.equal(store.get('device', empty.id).status, 'removed')
  assert.equal(store.changeLog('device', empty.id).filter((e) => e.summary === 'removed with contents').length, 1)
})

test('purge stays strict: the contents of a removed enclosure must be purged first, their cables first of all', () => {
  const { store, panel, sub, fuse, lamp, feed, branch, old, page, subPage } = withContents()
  store.remove('device', panel.id)
  assert.throws(() => store.purgeDevice(panel.id), /Take out or delete these devices first/)
  assert.throws(() => store.purgeDevice(fuse.id), /Delete these cables first/)
  for (const c of [feed, branch, old]) store.purgeCable(c.id)
  store.purgeDevice(fuse.id)
  store.purgeDevice(lamp.id)
  store.purgeDevice(sub.id)
  store.purgeDevice(panel.id)
  assert.equal(store.get('device', panel.id), null)
  assert.equal(store.get('schematic', page.id), null)
  assert.equal(store.get('schematic', subPage.id), null)
})
