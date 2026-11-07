'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { Store } = require('../src/store')

function freshStore () {
  return new Store(':memory:')
}

test('create + get a circuit', () => {
  const store = freshStore()
  const circuit = store.create('circuit', { name: 'Bilge pump circuit', notes: 'Breaker 4, 15A' })

  assert.equal(circuit.name, 'Bilge pump circuit')
  assert.equal(circuit.status, 'active')
  assert.ok(circuit.id)
  assert.deepEqual(store.get('circuit', circuit.id), circuit)

  store.close()
})

test('list returns all rows for a kind', () => {
  const store = freshStore()
  store.create('device', { name: 'Bilge pump', type: 'pump', zone: 'bilge' })
  store.create('device', { name: 'Nav lights', type: 'lighting' })

  const devices = store.list('device')
  assert.equal(devices.length, 2)

  store.close()
})

test('update appends a change_log entry with a before/after diff', () => {
  const store = freshStore()
  const wireRun = store.create('wireRun', {
    gauge: 14,
    gauge_unit: 'AWG',
    cable_label: 'red'
  })

  const updated = store.update('wireRun', wireRun.id, { cable_label: 'yellow' })
  assert.equal(updated.cable_label, 'yellow')

  const log = store.changeLog('wireRun', wireRun.id)
  // one entry for creation, one for this update
  assert.equal(log.length, 2)
  const updateEntry = log[1]
  assert.equal(updateEntry.summary, 'updated')
  const diff = JSON.parse(updateEntry.diff_json)
  assert.deepEqual(diff.cable_label, { before: 'red', after: 'yellow' })

  store.close()
})

test('update with no changed fields does not add a log entry', () => {
  const store = freshStore()
  const device = store.create('device', { name: 'Nav lights' })
  const logBefore = store.changeLog('device', device.id).length

  store.update('device', device.id, { name: 'Nav lights' })

  assert.equal(store.changeLog('device', device.id).length, logBefore)
  store.close()
})

test('remove marks status removed instead of deleting the row', () => {
  const store = freshStore()
  const device = store.create('device', { name: 'Old autopilot' })

  const removed = store.remove('device', device.id)
  assert.equal(removed.status, 'removed')
  assert.deepEqual(store.get('device', device.id), removed)

  const log = store.changeLog('device', device.id)
  assert.equal(log[log.length - 1].summary, 'removed')

  store.close()
})

test('update on an unknown id returns null', () => {
  const store = freshStore()
  assert.equal(store.update('device', 'does-not-exist', { name: 'x' }), null)
  store.close()
})

test('createAttachment + getAttachment round-trip', () => {
  const store = freshStore()
  const device = store.create('device', { name: 'Bilge pump' })
  const attachment = store.createAttachment({
    owner_type: 'device',
    owner_id: device.id,
    filename: 'connector.jpg',
    mime_type: 'image/jpeg',
    uploaded_at: new Date().toISOString()
  })

  assert.ok(attachment.id)
  assert.deepEqual(store.getAttachment(attachment.id), attachment)

  store.close()
})

test('listAttachmentsByOwner returns only that owner\'s attachments', () => {
  const store = freshStore()
  const deviceA = store.create('device', { name: 'A' })
  const deviceB = store.create('device', { name: 'B' })
  const makeAttachment = (ownerId) =>
    store.createAttachment({
      owner_type: 'device',
      owner_id: ownerId,
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      uploaded_at: new Date().toISOString()
    })
  makeAttachment(deviceA.id)
  makeAttachment(deviceA.id)
  makeAttachment(deviceB.id)

  assert.equal(store.listAttachmentsByOwner('device', deviceA.id).length, 2)
  assert.equal(store.listAttachmentsByOwner('device', deviceB.id).length, 1)

  store.close()
})

test('deleteAttachment removes the row', () => {
  const store = freshStore()
  const device = store.create('device', { name: 'A' })
  const attachment = store.createAttachment({
    owner_type: 'device',
    owner_id: device.id,
    filename: 'photo.jpg',
    mime_type: 'image/jpeg',
    uploaded_at: new Date().toISOString()
  })

  store.deleteAttachment(attachment.id)
  assert.equal(store.getAttachment(attachment.id), null)

  store.close()
})

test('migration: opening a pre-0008 database renames circuits.source to source_label and adds the new columns', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')

  // Build a fixture matching the schema as it existed before plan 0008 —
  // no source_label/breaker_rating/voltage/cable_label/switch_ref/
  // length_unit/rated_power_w/signalk_path — then close it so Store can
  // open the same file fresh, the same way a real upgrade would.
  const oldDb = new Database(dbPath)
  oldDb.exec(`
    CREATE TABLE circuits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT,
      panel_ref TEXT,
      convention TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT
    );
    CREATE TABLE wire_runs (
      id TEXT PRIMARY KEY,
      circuit_id TEXT NOT NULL REFERENCES circuits(id),
      from_endpoint TEXT,
      to_endpoint TEXT,
      gauge REAL,
      gauge_unit TEXT,
      color TEXT,
      length REAL,
      zone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT
    );
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      zone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT
    );
  `)
  oldDb.prepare(
    "INSERT INTO circuits (id, name, source, status) VALUES ('c1', 'Old circuit', 'Breaker 4, 15A', 'active')"
  ).run()
  oldDb.close()

  const store = new Store(dbPath)

  const circuit = store.get('circuit', 'c1')
  assert.equal(circuit.name, 'Old circuit')
  assert.equal(circuit.source, undefined)
  assert.equal(circuit.source_label, undefined) // retired by plan 0014
  assert.equal(circuit.voltage, null)

  const updatedCircuit = store.update('circuit', 'c1', { voltage: 12 })
  assert.equal(updatedCircuit.voltage, 12)

  const wireRun = store.create('wireRun', {
    cable_label: '19',
    switch_ref: '1',
    length_unit: 'm'
  })
  assert.equal(wireRun.cable_label, '19')
  assert.equal(wireRun.switch_ref, '1')
  assert.equal(wireRun.length_unit, 'm')

  const device = store.create('device', {
    name: 'Test device',
    rated_power_w: 40,
    signalk_path: 'electrical.switches.test'
  })
  assert.equal(device.rated_power_w, 40)
  assert.equal(device.signalk_path, 'electrical.switches.test')

  store.close()
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

test('migration is a no-op (safe to run twice) on an already-migrated database', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')

  const store1 = new Store(dbPath)
  store1.create('circuit', { id: 'c1', name: 'Circuit', notes: 'Breaker 1' })
  store1.close()

  // Re-opening (as a server restart would) runs _migrate() again; every
  // step is guarded by a column-existence check, so this must not throw
  // (e.g. "duplicate column name") or lose data.
  const store2 = new Store(dbPath)
  const circuit = store2.get('circuit', 'c1')
  assert.equal(circuit.notes, 'Breaker 1')
  store2.close()

  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

test('migration: a 0.2.0 database gains position, route, panel link and the plans table', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')

  // Shape of the schema as shipped in 0.2.0, before the floorplan columns.
  const oldDb = new Database(dbPath)
  oldDb.exec(`
    CREATE TABLE circuits (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, source_label TEXT,
      breaker_rating REAL, voltage REAL, panel_ref TEXT, convention TEXT,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT
    );
    CREATE TABLE wire_runs (
      id TEXT PRIMARY KEY, circuit_id TEXT NOT NULL REFERENCES circuits(id),
      from_endpoint TEXT, to_endpoint TEXT, gauge REAL, gauge_unit TEXT,
      color TEXT, length REAL, length_unit TEXT, zone TEXT, cable_label TEXT,
      switch_ref TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT
    );
    CREATE TABLE devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, zone TEXT,
      rated_power_w REAL, signalk_path TEXT,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT
    );
    INSERT INTO devices (id, name) VALUES ('d1', 'Bilge pump');
  `)
  oldDb.pragma('user_version = 1')
  oldDb.close()

  const store = new Store(dbPath)
  const device = store.get('device', 'd1')
  assert.equal(device.name, 'Bilge pump')
  assert.equal(device.pos_x, null)
  assert.equal(device.pos_y, null)
  assert.equal(device.pos_z, null)

  const run = store.create('wireRun', { route: '[]' })
  assert.equal(run.route, '[]')
  assert.equal(store.list('plan').length, 0)

  store.close()
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

test('migration to the floorplan columns is a no-op when run twice', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')

  const store1 = new Store(dbPath)
  store1.create('device', { id: 'd1', name: 'Pump', pos_x: 1.5, pos_y: -0.4, pos_z: 0.2 })
  store1.close()

  const store2 = new Store(dbPath)
  const device = store2.get('device', 'd1')
  assert.equal(device.pos_x, 1.5)
  assert.equal(device.pos_z, 0.2)
  store2.close()

  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

test('a position change writes one change-log entry and a half-placed device is allowed', () => {
  const store = freshStore()
  const device = store.create('device', { name: 'Pump', pos_x: 2 })
  assert.equal(device.pos_y, null)

  store.update('device', device.id, { pos_x: 3, pos_y: 0.5 })

  const log = store.changeLog('device', device.id)
  assert.equal(log.length, 2) // created + one update
  const diff = JSON.parse(log[1].diff_json)
  assert.deepEqual(diff, {
    pos_x: { before: 2, after: 3 },
    pos_y: { before: null, after: 0.5 }
  })

  store.close()
})

test('a route edit writes a single route diff, not one entry per point', () => {
  const store = freshStore()
  const run = store.create('wireRun', {})

  const route = JSON.stringify([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }])
  store.update('wireRun', run.id, { route })

  const log = store.changeLog('wireRun', run.id)
  assert.equal(log.length, 2)
  assert.deepEqual(Object.keys(JSON.parse(log[1].diff_json)), ['route'])

  store.close()
})

test('plans: create, update and remove keep history like other records', () => {
  const store = freshStore()
  const plan = store.create('plan', {
    name: 'Main deck',
    view: 'top',
    z_min: 0.5,
    z_max: 2.5,
    calibration: JSON.stringify({ originPx: [10, 20], pxPerMeter: 42 })
  })
  assert.equal(plan.status, 'active')
  assert.equal(plan.filename, null)

  store.update('plan', plan.id, { filename: `${plan.id}.svg` })
  store.remove('plan', plan.id)

  assert.equal(store.get('plan', plan.id).status, 'removed')
  assert.equal(store.changeLog('plan', plan.id).length, 3)

  store.close()
})

test('plans: view must be top or side', () => {
  const store = freshStore()
  assert.throws(() => store.create('plan', { name: 'Bad', view: 'diagonal' }))
  store.create('plan', { name: 'Profile', view: 'side' })
  store.close()
})

// Zones (plan 0010)

test('zones: create, case-insensitive uniqueness, and name resolution on write', () => {
  const store = freshStore()
  const salon = store.create('zone', { name: 'Salon' })
  assert.ok(salon.id)
  assert.throws(() => store.create('zone', { name: 'salon' }), /already exists/)

  // A zone name on a device finds the existing zone, whatever the case or padding.
  const a = store.create('device', { name: 'Light', zone: '  SALON ' })
  assert.equal(a.zone_id, salon.id)
  assert.equal(a.zone, 'Salon')

  // An unknown name creates the zone.
  const b = store.create('device', { name: 'Pump', zone: 'Engine room' })
  assert.equal(store.list('zone').length, 2)
  assert.equal(store.get('zone', b.zone_id).name, 'Engine room')

  store.close()
})

test('zones: zone_id wins over a stale zone name, and null clears both', () => {
  const store = freshStore()
  const salon = store.create('zone', { name: 'Salon' })
  const cabin = store.create('zone', { name: 'Aft cabin' })
  const device = store.create('device', { name: 'Light', zone_id: salon.id })

  const moved = store.update('device', device.id, { zone: 'Salon', zone_id: cabin.id })
  assert.equal(moved.zone_id, cabin.id)
  assert.equal(moved.zone, 'Aft cabin')

  const cleared = store.update('device', device.id, { zone_id: null })
  assert.equal(cleared.zone_id, null)
  assert.equal(cleared.zone, null)

  store.close()
})

test('zones: rename updates every item and is logged', () => {
  const store = freshStore()
  const zone = store.create('zone', { name: 'Salon' })
  const device = store.create('device', { name: 'Light', zone_id: zone.id })
  const run = store.create('wireRun', { zone_id: zone.id })

  store.update('zone', zone.id, { name: 'Main salon' })

  assert.equal(store.get('device', device.id).zone, 'Main salon')
  assert.equal(store.get('wireRun', run.id).zone, 'Main salon')
  assert.equal(store.changeLog('zone', zone.id).length, 2)

  const other = store.create('zone', { name: 'Galley' })
  assert.throws(() => store.update('zone', other.id, { name: 'main SALON' }), /already exists/)

  store.close()
})

test('zones: merge repoints items, logs them and removes the source zone', () => {
  const store = freshStore()
  const from = store.create('zone', { name: 'Lazarette' })
  const into = store.create('zone', { name: 'Aft locker' })
  const device = store.create('device', { name: 'Pump', zone_id: from.id })
  const run = store.create('wireRun', { zone_id: from.id })

  store.mergeZones(from.id, into.id)

  assert.equal(store.get('device', device.id).zone_id, into.id)
  assert.equal(store.get('wireRun', run.id).zone, 'Aft locker')
  assert.equal(store.get('zone', from.id), null)
  assert.equal(store.changeLog('device', device.id).length, 2)
  assert.throws(() => store.mergeZones(into.id, into.id))
  assert.throws(() => store.mergeZones('nope', into.id), /not found/)

  store.close()
})

test('zones: delete is refused while in use and allowed once empty', () => {
  const store = freshStore()
  const zone = store.create('zone', { name: 'Salon' })
  const device = store.create('device', { name: 'Light', zone_id: zone.id })

  assert.throws(() => store.deleteZone(zone.id), /in use/)
  assert.deepEqual(store.zoneUsage(zone.id), { devices: 1, wireRuns: 0, conduits: 0 })

  store.update('device', device.id, { zone_id: null })
  store.deleteZone(zone.id)
  assert.equal(store.get('zone', zone.id), null)

  store.close()
})

test('zones: migration turns padded, mixed-case zone strings into merged zones', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')
  const oldDb = new Database(dbPath)
  oldDb.exec(`
    CREATE TABLE circuits (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_label TEXT,
      breaker_rating REAL, voltage REAL, panel_ref TEXT, panel_device_id TEXT, convention TEXT,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    CREATE TABLE wire_runs (id TEXT PRIMARY KEY, circuit_id TEXT NOT NULL, from_endpoint TEXT,
      to_endpoint TEXT, gauge REAL, gauge_unit TEXT, color TEXT, length REAL, length_unit TEXT,
      zone TEXT, cable_label TEXT, switch_ref TEXT, route TEXT,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, zone TEXT,
      rated_power_w REAL, signalk_path TEXT, pos_x REAL, pos_y REAL, pos_z REAL,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    INSERT INTO circuits (id, name) VALUES ('c1', 'C');
    INSERT INTO devices (id, name, zone) VALUES ('d1', 'A', 'Engine room'), ('d2', 'B', ' engine ROOM '),
      ('d3', 'C', ''), ('d4', 'D', NULL), ('d5', 'E', 'Salon');
    INSERT INTO wire_runs (id, circuit_id, zone) VALUES ('w1', 'c1', 'ENGINE ROOM'), ('w2', 'c1', 'Salon');
  `)
  oldDb.pragma('user_version = 2')
  oldDb.close()

  const store = new Store(dbPath)
  const names = store.list('zone').map((z) => z.name).sort()
  assert.deepEqual(names, ['Engine room', 'Salon'])

  const d1 = store.get('device', 'd1')
  const d2 = store.get('device', 'd2')
  assert.equal(d1.zone_id, d2.zone_id)
  assert.equal(store.get('wireRun', 'w1').zone_id, d1.zone_id)
  assert.equal(d2.zone, 'Engine room')
  assert.equal(store.get('device', 'd3').zone_id, null)
  assert.equal(store.get('device', 'd4').zone_id, null)
  assert.equal(store.get('device', 'd1').tags, null)
  store.close()

  // Opening it again (a restart) changes nothing.
  const again = new Store(dbPath)
  assert.equal(again.list('zone').length, 2)
  again.close()

  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

// Device roles (plan 0011)

test('roles: a device is a consumer unless told otherwise, and only known roles are accepted', () => {
  const store = freshStore()
  const light = store.create('device', { name: 'Anchor light' })
  assert.equal(light.role, 'consumer')

  for (const role of ['source', 'storage', 'distribution', 'converter']) {
    assert.equal(store.create('device', { name: role, role }).role, role)
  }
  assert.throws(() => store.create('device', { name: 'X', role: 'battery' }), /role must be one of/)
  assert.throws(() => store.update('device', light.id, { role: 'nonsense' }), /role must be one of/)

  // Clearing the role puts it back to the default instead of failing.
  const solar = store.create('device', { name: 'Solar', role: 'source' })
  assert.equal(store.update('device', solar.id, { role: null }).role, 'consumer')
  assert.equal(store.update('device', solar.id, { role: '' }).role, 'consumer')

  store.close()
})

test('roles: a role change is one change-log entry', () => {
  const store = freshStore()
  const device = store.create('device', { name: 'Victron', role: 'consumer' })
  store.update('device', device.id, { role: 'converter' })
  const log = store.changeLog('device', device.id)
  assert.equal(log.length, 2)
  assert.deepEqual(JSON.parse(log[1].diff_json), { role: { before: 'consumer', after: 'converter' } })
  store.close()
})

test('roles: migration gives every existing device the consumer role', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')
  const oldDb = new Database(dbPath)
  oldDb.exec(`
    CREATE TABLE circuits (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE wire_runs (id TEXT PRIMARY KEY, circuit_id TEXT NOT NULL, zone TEXT, zone_id TEXT, tags TEXT,
      status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, zone TEXT, zone_id TEXT, tags TEXT,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    INSERT INTO devices (id, name) VALUES ('d1', 'Old pump');
  `)
  oldDb.pragma('user_version = 3')
  oldDb.close()

  const store = new Store(dbPath)
  assert.equal(store.get('device', 'd1').role, 'consumer')
  store.close()
  const again = new Store(dbPath)
  assert.equal(again.get('device', 'd1').role, 'consumer')
  again.close()
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

// Device icons (plan 0013)

function deviceWithImage (store, mimeType = 'image/png') {
  const device = store.create('device', { name: 'Chartplotter' })
  const attachment = store.createAttachment({
    owner_type: 'device', owner_id: device.id, filename: 'front.png',
    mime_type: mimeType, uploaded_at: new Date().toISOString()
  })
  return { device, attachment }
}

test('icons: a device can use one of its own images as its icon, and clear it again', () => {
  const store = freshStore()
  const { device, attachment } = deviceWithImage(store)

  const withIcon = store.update('device', device.id, { icon_attachment_id: attachment.id })
  assert.equal(withIcon.icon_attachment_id, attachment.id)
  assert.equal(store.update('device', device.id, { icon_attachment_id: null }).icon_attachment_id, null)
  assert.equal(store.changeLog('device', device.id).length, 3)

  store.close()
})

test('icons: only a JPEG, PNG or WebP image attached to the same device is accepted', () => {
  const store = freshStore()
  const { device } = deviceWithImage(store)
  const pdf = store.createAttachment({
    owner_type: 'device', owner_id: device.id, filename: 'schematic.pdf',
    mime_type: 'application/pdf', uploaded_at: 't'
  })
  const other = store.create('device', { name: 'Other' })
  const foreign = store.createAttachment({
    owner_type: 'device', owner_id: other.id, filename: 'x.png', mime_type: 'image/png', uploaded_at: 't'
  })

  assert.throws(() => store.update('device', device.id, { icon_attachment_id: pdf.id }), /icon must be/)
  assert.throws(() => store.update('device', device.id, { icon_attachment_id: foreign.id }), /icon must be/)
  assert.throws(() => store.update('device', device.id, { icon_attachment_id: 'missing' }), /icon must be/)

  const heic = deviceWithImage(store, 'image/heic')
  assert.throws(() => store.update('device', heic.device.id, { icon_attachment_id: heic.attachment.id }), /icon must be/)

  store.close()
})

test('icons: deleting the icon image clears the icon and logs it', () => {
  const store = freshStore()
  const { device, attachment } = deviceWithImage(store)
  store.update('device', device.id, { icon_attachment_id: attachment.id })

  store.deleteAttachment(attachment.id)

  assert.equal(store.get('device', device.id).icon_attachment_id, null)
  assert.equal(store.getAttachment(attachment.id), null)
  store.close()
})

test('icons: deleting some other image leaves the icon alone', () => {
  const store = freshStore()
  const { device, attachment } = deviceWithImage(store)
  const spare = store.createAttachment({
    owner_type: 'device', owner_id: device.id, filename: 'back.png', mime_type: 'image/png', uploaded_at: 't'
  })
  store.update('device', device.id, { icon_attachment_id: attachment.id })

  store.deleteAttachment(spare.id)

  assert.equal(store.get('device', device.id).icon_attachment_id, attachment.id)
  store.close()
})

test('icons: migration adds the icon column to an existing database', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')
  const oldDb = new Database(dbPath)
  oldDb.exec(`
    CREATE TABLE circuits (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE wire_runs (id TEXT PRIMARY KEY, circuit_id TEXT NOT NULL, zone TEXT, zone_id TEXT, tags TEXT,
      status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, role TEXT NOT NULL DEFAULT 'consumer',
      zone TEXT, zone_id TEXT, tags TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    INSERT INTO devices (id, name) VALUES ('d1', 'Pump');
  `)
  oldDb.pragma('user_version = 4')
  oldDb.close()

  const store = new Store(dbPath)
  assert.equal(store.get('device', 'd1').icon_attachment_id, null)
  store.close()
  new Store(dbPath).close() // a restart is harmless
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

// Conduits (plan 0015)

function tableNames (db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
}

test('migration: a 0.4.1 database gains the conduit tables and keeps its data', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')

  const first = new Store(dbPath)
  first.create('device', { id: 'd1', name: 'Pump' })
  first.close()

  // Put the database back into its pre-conduit shape.
  const oldDb = new Database(dbPath)
  oldDb.exec('DROP TABLE wire_run_conduits; DROP TABLE conduits;')
  oldDb.pragma('user_version = 5')
  oldDb.close()

  const store = new Store(dbPath)
  assert.equal(store.get('device', 'd1').name, 'Pump')
  const names = tableNames(store.db)
  assert.ok(names.includes('conduits'))
  assert.ok(names.includes('wire_run_conduits'))
  const columns = store.db.prepare('PRAGMA table_info(conduits)').all().map((c) => c.name)
  for (const c of ['id', 'name', 'kind', 'inner_diameter', 'diameter_unit', 'zone', 'zone_id', 'route', 'notes', 'status']) {
    assert.ok(columns.includes(c), `conduits.${c}`)
  }
  const joinColumns = store.db.prepare('PRAGMA table_info(wire_run_conduits)').all().map((c) => c.name)
  assert.deepEqual(joinColumns.sort(), ['conduit_id', 'position', 'wire_run_id'])
  assert.equal(store.db.pragma('user_version', { simple: true }) >= 6, true)
  store.close()

  // Opening again changes nothing.
  const again = new Store(dbPath)
  assert.equal(again.get('device', 'd1').name, 'Pump')
  again.close()

  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

test('a fresh database already has the conduit tables', () => {
  const store = freshStore()
  const names = tableNames(store.db)
  assert.ok(names.includes('conduits'))
  assert.ok(names.includes('wire_run_conduits'))
  store.close()
})

function conduitFixture () {
  const store = freshStore()
  const circuit = store.create('circuit', { name: 'C' })
  const cable = (label) => store.create('wireRun', { cable_label: label })
  return { store, circuit, cable }
}

test('conduits: create, update and remove keep one change-log entry per change', () => {
  const store = freshStore()
  const conduit = store.create('conduit', { name: '  Galley conduit ', kind: 'conduit', inner_diameter: 25, diameter_unit: 'mm' })
  assert.equal(conduit.name, 'Galley conduit')
  assert.equal(conduit.status, 'active')
  assert.equal(conduit.route, null)

  store.update('conduit', conduit.id, { route: JSON.stringify([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]) })
  store.update('conduit', conduit.id, { name: 'Galley conduit' }) // no change
  store.remove('conduit', conduit.id)

  assert.equal(store.get('conduit', conduit.id).status, 'removed')
  const log = store.changeLog('conduit', conduit.id)
  assert.deepEqual(log.map((e) => e.summary), ['created', 'updated', 'removed'])
  assert.deepEqual(Object.keys(JSON.parse(log[1].diff_json)), ['route'])
  store.close()
})

test('conduits: a name is required and the kind is trimmed free text', () => {
  const store = freshStore()
  assert.throws(() => store.create('conduit', { name: '  ' }), /needs a name/)
  const conduit = store.create('conduit', { name: 'Loom', kind: ' wiring loom ' })
  assert.equal(conduit.kind, 'wiring loom')
  assert.throws(() => store.update('conduit', conduit.id, { name: '' }), /needs a name/)
  store.close()
})

test('conduits: zones resolve by name or id, follow renames and count as usage', () => {
  const store = freshStore()
  const conduit = store.create('conduit', { name: 'Run', zone: ' Galley ' })
  assert.equal(conduit.zone, 'Galley')
  assert.ok(conduit.zone_id)
  store.update('zone', conduit.zone_id, { name: 'Kitchen' })
  assert.equal(store.get('conduit', conduit.id).zone, 'Kitchen')
  assert.equal(store.zoneUsage(conduit.zone_id).conduits, 1)
  assert.throws(() => store.deleteZone(conduit.zone_id), /in use/)

  const other = store.create('zone', { name: 'Salon' })
  store.mergeZones(conduit.zone_id, other.id)
  assert.equal(store.get('conduit', conduit.id).zone_id, other.id)
  store.close()
})

test('conduit assignments: a cable lists its conduits in order and each change is logged', () => {
  const { store, cable } = conduitFixture()
  const a = store.create('conduit', { name: 'A' })
  const b = store.create('conduit', { name: 'B' })
  const c1 = cable('one')
  const c2 = cable('two')

  store.assignCable(a.id, c1.id)
  store.assignCable(b.id, c1.id)
  store.assignCable(b.id, c2.id)
  store.assignCable(b.id, c2.id) // repeat is a no-op

  assert.deepEqual(store.conduitsOfCable(c1.id), [a.id, b.id])
  assert.deepEqual(store.cablesOfConduit(b.id), [c1.id, c2.id])
  assert.deepEqual(store.changeLog('conduit', b.id).map((e) => e.summary), ['created', 'cable assigned', 'cable assigned'])
  assert.deepEqual(JSON.parse(store.changeLog('conduit', b.id)[1].diff_json), { wireRunId: c1.id })

  store.setCableConduits(c1.id, [b.id, a.id])
  assert.deepEqual(store.conduitsOfCable(c1.id), [b.id, a.id])
  const log = store.changeLog('wireRun', c1.id)
  assert.equal(log[log.length - 1].summary, 'conduits changed')
  assert.deepEqual(JSON.parse(log[log.length - 1].diff_json).conduits, { before: [a.id, b.id], after: [b.id, a.id] })

  // Same list again writes nothing.
  const count = store.changeLog('wireRun', c1.id).length
  store.setCableConduits(c1.id, [b.id, a.id])
  assert.equal(store.changeLog('wireRun', c1.id).length, count)

  store.unassignCable(b.id, c1.id)
  assert.deepEqual(store.conduitsOfCable(c1.id), [a.id])
  assert.equal(store.changeLog('conduit', b.id).slice(-1)[0].summary, 'cable unassigned')
  store.assignCable(b.id, c1.id)
  assert.deepEqual(store.conduitsOfCable(c1.id), [a.id, b.id])
  store.close()
})

test('conduit assignments: unknown ids are refused and removal keeps the assignments', () => {
  const { store, cable } = conduitFixture()
  const a = store.create('conduit', { name: 'A' })
  const c1 = cable('one')
  assert.throws(() => store.assignCable('nope', c1.id), /conduit not found/)
  assert.throws(() => store.assignCable(a.id, 'nope'), /wire run not found/)
  assert.throws(() => store.setCableConduits(c1.id, ['nope']), /conduit not found/)

  store.assignCable(a.id, c1.id)
  store.remove('conduit', a.id)
  store.remove('wireRun', c1.id)
  assert.deepEqual(store.conduitsOfCable(c1.id), [a.id])
  store.close()
})

test('conduit assignment maps list both directions in order', () => {
  const { store, cable } = conduitFixture()
  const a = store.create('conduit', { name: 'A' })
  const b = store.create('conduit', { name: 'B' })
  const c1 = cable('one')
  store.assignCable(b.id, c1.id)
  store.assignCable(a.id, c1.id)
  const maps = store.conduitAssignmentMaps()
  assert.deepEqual(maps.byCable[c1.id], [b.id, a.id])
  assert.deepEqual(maps.byConduit[a.id], [c1.id])
  store.close()
})

// ---- Plan 0014: cables between devices, conductors, terminals ----

test('a cable joins two devices and lists its conductors, logged as one change', () => {
  const store = freshStore()
  const fuse = store.create('device', { name: 'Fuse', role: 'distribution', trip_rating_a: 10 })
  const lamp = store.create('device', { name: 'Lamp' })
  const cable = store.create('wireRun', {
    from_device_id: fuse.id,
    to_device_id: lamp.id,
    gauge: 2.5,
    conductors: [
      { conductor: 'positive', color: 'red' },
      { conductor: 'negative', color: 'black' }
    ]
  })
  assert.equal(cable.from_device_id, fuse.id)
  assert.deepEqual(cable.conductors.map((c) => c.conductor), ['positive', 'negative'])
  assert.equal(cable.conductors[0].color, 'red')
  assert.equal(store.get('device', fuse.id).trip_rating_a, 10)

  store.update('wireRun', cable.id, { conductors: [{ conductor: 'positive', color: 'brown' }] })
  const log = store.changeLog('wireRun', cable.id)
  assert.equal(log.length, 2)
  const diff = JSON.parse(log[1].diff_json)
  assert.deepEqual(Object.keys(diff), ['conductors'])
  assert.equal(diff.conductors.after[0].color, 'brown')

  // The same list again is not a change.
  store.update('wireRun', cable.id, { conductors: [{ conductor: 'positive', color: 'brown' }] })
  assert.equal(store.changeLog('wireRun', cable.id).length, 2)
  // Leaving conductors out leaves them alone.
  store.update('wireRun', cable.id, { gauge: 4 })
  assert.equal(store.get('wireRun', cable.id).conductors.length, 1)
  store.close()
})

test('a cable needs real devices and known conductor types', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'A' })
  assert.throws(() => store.create('wireRun', { from_device_id: 'nope' }), /device not found/)
  assert.throws(() => store.create('wireRun', { from_device_id: a.id, conductors: [{ conductor: 'blue' }] }), /conductor must be one of/)
  assert.throws(() => store.create('wireRun', { conductors: [{ conductor: 'negative', toDeviceId: 'nope' }] }), /device not found/)
  assert.equal(store.list('wireRun').length, 0)
  store.close()
})

test('device terminals are written with the device and validated', () => {
  const store = freshStore()
  const inverter = store.create('device', {
    name: 'Inverter',
    role: 'converter',
    terminals: [
      { name: 'DC +', conductor: 'positive', voltage: 12, port: 'DC in' },
      { name: 'AC L', conductor: 'line', voltage: 230, port: 'AC out' }
    ]
  })
  assert.equal(inverter.terminals.length, 2)
  assert.equal(inverter.terminals[1].port, 'AC out')
  assert.throws(() => store.update('device', inverter.id, { terminals: [{ conductor: 'positive' }] }), /needs a name/)
  assert.throws(() => store.update('device', inverter.id, { terminals: [{ name: 'x', conductor: 'red' }] }), /must be one of/)

  store.update('device', inverter.id, { terminals: [{ name: 'DC +', conductor: 'positive' }] })
  assert.equal(store.get('device', inverter.id).terminals.length, 1)
  const diff = JSON.parse(store.changeLog('device', inverter.id)[1].diff_json)
  assert.deepEqual(Object.keys(diff), ['terminals'])
  store.close()
})

function legacyV6Db (dbPath) {
  const oldDb = new Database(dbPath)
  oldDb.exec(`
    CREATE TABLE zones (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE circuits (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, source_label TEXT, breaker_rating REAL, voltage REAL,
      panel_ref TEXT, panel_device_id TEXT, convention TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    CREATE TABLE wire_runs (
      id TEXT PRIMARY KEY, circuit_id TEXT NOT NULL REFERENCES circuits(id), from_endpoint TEXT, to_endpoint TEXT,
      gauge REAL, gauge_unit TEXT, color TEXT, length REAL, length_unit TEXT, zone TEXT, cable_label TEXT,
      switch_ref TEXT, route TEXT, zone_id TEXT REFERENCES zones(id), tags TEXT,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    CREATE INDEX idx_wire_runs_circuit_id ON wire_runs (circuit_id);
    CREATE TABLE devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, role TEXT NOT NULL DEFAULT 'consumer',
      icon_attachment_id TEXT, zone TEXT, rated_power_w REAL, signalk_path TEXT, pos_x REAL, pos_y REAL, pos_z REAL,
      zone_id TEXT REFERENCES zones(id), tags TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    CREATE TABLE conduits (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT, inner_diameter REAL,
      diameter_unit TEXT, zone TEXT, zone_id TEXT REFERENCES zones(id), route TEXT,
      status TEXT NOT NULL DEFAULT 'active', notes TEXT);
    CREATE TABLE wire_run_conduits (wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
      conduit_id TEXT NOT NULL REFERENCES conduits(id), position INTEGER NOT NULL, PRIMARY KEY (wire_run_id, conduit_id));
    INSERT INTO devices (id, name) VALUES ('d1', 'Bilge pump'), ('d2', 'Fuse 4');
    INSERT INTO circuits (id, name, source_label, breaker_rating, notes) VALUES ('c1', 'Bilge', 'Breaker 4', 15, 'old note');
    INSERT INTO wire_runs (id, circuit_id, from_endpoint, to_endpoint, gauge, gauge_unit, color, route, notes)
      VALUES ('w1', 'c1', ' fuse 4 ', 'd1', 2.5, 'mm2', 'red', '[]', 'keep me'),
             ('w2', 'c1', 'Mystery box', 'Bilge Pump', 1, 'mm2', NULL, NULL, NULL);
    INSERT INTO conduits (id, name) VALUES ('k1', 'Loom');
    INSERT INTO wire_run_conduits VALUES ('w1', 'k1', 0);
  `)
  oldDb.pragma('user_version = 6')
  oldDb.close()
}

test('migration 7: a 0.4.x database gets device ends, conductors and keeps its data, twice over', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')
  legacyV6Db(dbPath)

  for (let pass = 0; pass < 2; pass++) {
    const store = new Store(dbPath)
    assert.ok(store.db.pragma('user_version', { simple: true }) >= 7)
    const w1 = store.get('wireRun', 'w1')
    assert.equal(w1.from_device_id, 'd2') // matched by name, ignoring case and padding
    assert.equal(w1.to_device_id, 'd1') // matched by id
    assert.equal(w1.gauge, 2.5)
    assert.equal(w1.route, '[]')
    assert.deepEqual(w1.conductors, [{ conductor: 'positive', color: 'red', fromDeviceId: null, toDeviceId: null, fromTerminal: null, toTerminal: null }])
    assert.equal(w1.circuit_id, undefined)
    assert.equal(w1.from_endpoint, undefined)

    const w2 = store.get('wireRun', 'w2')
    assert.equal(w2.from_device_id, null)
    assert.equal(w2.to_device_id, 'd1')
    assert.match(w2.notes, /From: Mystery box/)

    const circuit = store.get('circuit', 'c1')
    assert.equal(circuit.notes, 'old note')
    assert.equal(circuit.source_label, undefined)
    assert.equal(circuit.breaker_rating, undefined)
    assert.equal(store.get('device', 'd1').trip_rating_a, null)
    assert.deepEqual(store.db.prepare('SELECT * FROM wire_run_conduits').all(), [{ wire_run_id: 'w1', conduit_id: 'k1', position: 0 }])
    assert.deepEqual(store.db.pragma('foreign_key_check'), [])
    store.close()
  }
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

test('a fresh database has the new shape', () => {
  const store = freshStore()
  const cols = (t) => store.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  assert.ok(cols('wire_runs').includes('from_device_id'))
  assert.ok(!cols('wire_runs').includes('circuit_id'))
  assert.ok(cols('devices').includes('trip_rating_a'))
  assert.ok(cols('circuits').includes('key'))
  assert.ok(!cols('circuits').includes('source_label'))
  assert.ok(store.db.pragma('user_version', { simple: true }) >= 9)
  store.close()
})

// ---- Plan 0014: circuit records follow the cables ----

function boat (store) {
  const battery = store.create('device', { name: 'House battery', role: 'storage', nominal_voltage: 12 })
  const fuse = store.create('device', { name: 'Lamp fuse', role: 'distribution', trip_rating_a: 10 })
  const lamp = store.create('device', { name: 'Cabin lamp' })
  const cable = (from, to) => store.create('wireRun', { from_device_id: from.id, to_device_id: to.id })
  return { battery, fuse, lamp, cable }
}

test('circuits: a circuit record appears when cables connect, keyed to the fuse, and is logged', () => {
  const store = freshStore()
  const { battery, fuse, lamp, cable } = boat(store)
  assert.equal(store.list('circuit').length, 0)
  cable(battery, fuse)
  cable(fuse, lamp)

  const circuits = store.list('circuit')
  assert.equal(circuits.length, 1)
  assert.equal(circuits[0].key, `protector:${fuse.id}`)
  assert.equal(circuits[0].name, 'Lamp fuse')
  assert.equal(circuits[0].status, 'active')
  assert.equal(JSON.parse(circuits[0].cable_ids).length, 2)
  const log = store.changeLog('circuit', circuits[0].id)
  assert.equal(log[0].summary, 'created')
  store.close()
})

test('circuits: name and notes survive cable edits, and a lone battery-to-lamp cable is unprotected', () => {
  const store = freshStore()
  const { battery, lamp, cable } = boat(store)
  const run = cable(battery, lamp)
  const [circuit] = store.list('circuit')
  assert.equal(circuit.key, `cable:${run.id}`)
  assert.match(circuit.name, /^Unprotected: Cabin lamp/)

  store.update('circuit', circuit.id, { name: 'Reading light', notes: 'port side' })
  store.update('wireRun', run.id, { gauge: 2.5 })
  const after = store.get('circuit', circuit.id)
  assert.equal(after.name, 'Reading light')
  assert.equal(after.notes, 'port side')
  assert.equal(store.list('circuit').length, 1)
  store.close()
})

test('circuits: adding a fuse later moves the record onto it and keeps name and notes', () => {
  const store = freshStore()
  const { battery, fuse, lamp, cable } = boat(store)
  const direct = cable(battery, lamp)
  const [circuit] = store.list('circuit')
  store.update('circuit', circuit.id, { name: 'Reading light', notes: 'keep' })

  store.update('wireRun', direct.id, { to_device_id: fuse.id })
  cable(fuse, lamp)

  const circuits = store.list('circuit')
  assert.equal(circuits.length, 1)
  assert.equal(circuits[0].id, circuit.id)
  assert.equal(circuits[0].key, `protector:${fuse.id}`)
  assert.equal(circuits[0].name, 'Reading light')
  assert.equal(circuits[0].notes, 'keep')
  store.close()
})

test('circuits: a circuit that disappears is kept as removed, and comes back with its notes', () => {
  const store = freshStore()
  const { battery, fuse, lamp, cable } = boat(store)
  const a = cable(battery, fuse)
  const b = cable(fuse, lamp)
  const [circuit] = store.list('circuit')
  store.update('circuit', circuit.id, { notes: 'hello' })

  store.remove('wireRun', a.id)
  assert.equal(store.get('circuit', circuit.id).status, 'active') // the fuse still feeds the lamp
  store.remove('wireRun', b.id)
  assert.equal(store.get('circuit', circuit.id).status, 'removed')
  assert.equal(store.list('circuit').length, 1)

  store.update('wireRun', b.id, { status: 'active' })
  const back = store.get('circuit', circuit.id)
  assert.equal(back.status, 'active')
  assert.equal(back.notes, 'hello')
  const summaries = store.changeLog('circuit', circuit.id).map((l) => l.summary)
  assert.ok(summaries.includes('removed'))
  store.close()
})

test('circuits: unrelated writes add no change-log entries and no duplicate records', () => {
  const store = freshStore()
  const { battery, fuse, lamp, cable } = boat(store)
  cable(battery, fuse)
  cable(fuse, lamp)
  const [circuit] = store.list('circuit')
  const before = store.changeLog('circuit', circuit.id).length
  store.update('device', lamp.id, { notes: 'x' })
  store.create('device', { name: 'Other' })
  assert.equal(store.changeLog('circuit', circuit.id).length, before)
  assert.equal(store.list('circuit').length, 1)
  store.close()
})

test('circuits: records left by hand (no key) are kept as removed at the next sync', () => {
  const store = freshStore()
  const old = store.create('circuit', { name: 'Old bilge', notes: 'from 0.4' })
  store.create('device', { name: 'Anything' })
  const kept = store.get('circuit', old.id)
  assert.equal(kept.status, 'removed')
  assert.equal(kept.notes, 'from 0.4')
  store.close()
})

// Schematics (plan 0016)

test('migration: a 0.4.2 database gains the schematic tables and keeps its data', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-migration-')), 'wiring.db')
  const first = new Store(dbPath)
  first.create('device', { id: 'd1', name: 'Pump' })
  first.close()

  const oldDb = new Database(dbPath)
  oldDb.exec('DROP TABLE schematic_wires; DROP TABLE schematic_devices; DROP TABLE schematics;')
  oldDb.pragma('user_version = 7')
  oldDb.close()

  const store = new Store(dbPath)
  assert.equal(store.get('device', 'd1').name, 'Pump')
  const names = tableNames(store.db)
  for (const t of ['schematics', 'schematic_devices', 'schematic_wires']) assert.ok(names.includes(t), t)
  assert.ok(store.db.pragma('user_version', { simple: true }) >= 8)
  store.create('schematic', { id: 's1', name: 'Page', devices: [{ deviceId: 'd1', x: 1, y: 2 }] })
  store.close()

  const again = new Store(dbPath)
  assert.equal(again.get('schematic', 's1').devices.length, 1)
  assert.ok(again.db.pragma('user_version', { simple: true }) >= 8)
  again.close()
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

test('schematics: create with devices and bent wires, read back', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'A' })
  const b = store.create('device', { name: 'B' })
  const cable = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, conductors: [{ conductor: 'positive' }] })
  const s = store.create('schematic', {
    name: '  12 V system ',
    devices: [{ deviceId: a.id, x: 10, y: 20 }, { deviceId: b.id, x: 300, y: 40 }],
    wires: [{ wireRunId: cable.id, points: [{ x: 100, y: 50 }] }]
  })
  assert.equal(s.name, '12 V system')
  assert.equal(s.status, 'active')
  assert.deepEqual(s.devices, [{ deviceId: a.id, x: 10, y: 20 }, { deviceId: b.id, x: 300, y: 40 }])
  assert.deepEqual(s.wires, [{ wireRunId: cable.id, points: [{ x: 100, y: 50 }] }])
  assert.deepEqual(store.list('schematic')[0], s)
  store.close()
})

test('schematics: a device can be on several pages with its own position', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'A' })
  const s1 = store.create('schematic', { name: 'One', devices: [{ deviceId: a.id, x: 1, y: 1 }] })
  const s2 = store.create('schematic', { name: 'Two', devices: [{ deviceId: a.id, x: 9, y: 9 }] })
  assert.equal(store.get('schematic', s1.id).devices[0].x, 1)
  assert.equal(store.get('schematic', s2.id).devices[0].x, 9)
  assert.equal(store.list('schematic').length, 2)
  store.close()
})

test('schematics: validation', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'A' })
  assert.throws(() => store.create('schematic', { name: '  ' }), /needs a name/)
  assert.throws(() => store.create('schematic', { name: 'x', devices: [{ deviceId: 'nope', x: 0, y: 0 }] }), /device not found/)
  assert.throws(() => store.create('schematic', { name: 'x', devices: [{ deviceId: a.id, x: 'a', y: 0 }] }), /number/)
  assert.throws(() => store.create('schematic', {
    name: 'x', devices: [{ deviceId: a.id, x: 0, y: 0 }, { deviceId: a.id, x: 1, y: 1 }]
  }), /twice/)
  assert.throws(() => store.create('schematic', { name: 'x', wires: [{ wireRunId: 'nope', points: [{ x: 0, y: 0 }] }] }), /wire run not found/)
  assert.equal(store.list('schematic').length, 0)
  store.close()
})

test('schematics: a wire without bend points is not kept', () => {
  const store = freshStore()
  const cable = store.create('wireRun', {})
  const s = store.create('schematic', { name: 'x', wires: [{ wireRunId: cable.id, points: [] }] })
  assert.deepEqual(s.wires, [])
  const bent = store.update('schematic', s.id, { wires: [{ wireRunId: cable.id, points: [{ x: 1, y: 2 }] }] })
  assert.equal(bent.wires.length, 1)
  const straight = store.update('schematic', s.id, { wires: [{ wireRunId: cable.id, points: [] }] })
  assert.equal(straight.wires.length, 0)
  store.close()
})

test('schematics: adding or removing a device is logged, moving one is not', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'A' })
  const b = store.create('device', { name: 'B' })
  const s = store.create('schematic', { name: 'Page', devices: [{ deviceId: a.id, x: 0, y: 0 }] })
  const count = () => store.changeLog('schematic', s.id).length
  assert.equal(count(), 1)

  store.update('schematic', s.id, { devices: [{ deviceId: a.id, x: 50, y: 60 }] })
  assert.equal(count(), 1)
  assert.equal(store.get('schematic', s.id).devices[0].x, 50)

  store.update('schematic', s.id, { wires: [] })
  assert.equal(count(), 1)

  store.update('schematic', s.id, { devices: [{ deviceId: a.id, x: 50, y: 60 }, { deviceId: b.id, x: 1, y: 1 }] })
  assert.equal(count(), 2)
  store.update('schematic', s.id, { devices: [{ deviceId: b.id, x: 1, y: 1 }] })
  assert.equal(count(), 3)
  const last = store.changeLog('schematic', s.id)[2]
  assert.deepEqual(JSON.parse(last.diff_json).devices.after, [b.id])
  store.close()
})

test('schematics: rename, notes and soft delete keep the page and its history', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'A' })
  const s = store.create('schematic', { name: 'Page', devices: [{ deviceId: a.id, x: 0, y: 0 }] })
  assert.equal(store.update('schematic', s.id, { name: 'Renamed', notes: 'n' }).name, 'Renamed')
  assert.throws(() => store.update('schematic', s.id, { name: '' }), /needs a name/)
  const gone = store.remove('schematic', s.id)
  assert.equal(gone.status, 'removed')
  assert.equal(gone.devices.length, 1)
  assert.equal(store.list('schematic').length, 1)
  const summaries = store.changeLog('schematic', s.id).map((l) => l.summary)
  assert.deepEqual(summaries, ['created', 'updated', 'removed'])
  assert.equal(store.update('schematic', 'missing', { name: 'x' }), null)
  store.close()
})

test('schematics: removing a device from a page does not touch the device or its cables', () => {
  const store = freshStore()
  const a = store.create('device', { name: 'A' })
  const b = store.create('device', { name: 'B' })
  const cable = store.create('wireRun', { from_device_id: a.id, to_device_id: b.id, conductors: [{ conductor: 'positive' }] })
  const s = store.create('schematic', { name: 'P', devices: [{ deviceId: a.id, x: 0, y: 0 }, { deviceId: b.id, x: 1, y: 1 }] })
  store.update('schematic', s.id, { devices: [{ deviceId: a.id, x: 0, y: 0 }] })
  assert.equal(store.get('device', b.id).status, 'active')
  assert.equal(store.get('wireRun', cable.id).status, 'active')
  store.close()
})
