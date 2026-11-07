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
  const circuit = store.create('circuit', { name: 'Bilge pump circuit', source_label: 'Breaker 4, 15A' })

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
  const circuit = store.create('circuit', { name: 'Bilge pump circuit' })
  const wireRun = store.create('wireRun', {
    circuit_id: circuit.id,
    from_endpoint: 'breaker-4',
    to_endpoint: 'bilge-pump',
    gauge: 14,
    gauge_unit: 'AWG',
    color: 'red'
  })

  const updated = store.update('wireRun', wireRun.id, { color: 'yellow' })
  assert.equal(updated.color, 'yellow')

  const log = store.changeLog('wireRun', wireRun.id)
  // one entry for creation, one for this update
  assert.equal(log.length, 2)
  const updateEntry = log[1]
  assert.equal(updateEntry.summary, 'updated')
  const diff = JSON.parse(updateEntry.diff_json)
  assert.deepEqual(diff.color, { before: 'red', after: 'yellow' })

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
  assert.equal(circuit.source_label, 'Breaker 4, 15A')
  assert.equal(circuit.source, undefined)
  assert.equal(circuit.breaker_rating, null)
  assert.equal(circuit.voltage, null)

  const updatedCircuit = store.update('circuit', 'c1', { breaker_rating: 15, voltage: 12 })
  assert.equal(updatedCircuit.breaker_rating, 15)
  assert.equal(updatedCircuit.voltage, 12)

  const wireRun = store.create('wireRun', {
    circuit_id: 'c1',
    from_endpoint: 'a',
    to_endpoint: 'b',
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
  store1.create('circuit', { id: 'c1', name: 'Circuit', source_label: 'Breaker 1' })
  store1.close()

  // Re-opening (as a server restart would) runs _migrate() again; every
  // step is guarded by a column-existence check, so this must not throw
  // (e.g. "duplicate column name") or lose data.
  const store2 = new Store(dbPath)
  const circuit = store2.get('circuit', 'c1')
  assert.equal(circuit.source_label, 'Breaker 1')
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

  const circuit = store.create('circuit', { name: 'C', panel_device_id: 'd1' })
  assert.equal(circuit.panel_device_id, 'd1')
  const run = store.create('wireRun', { circuit_id: circuit.id, route: '[]' })
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
  const circuit = store.create('circuit', { name: 'C' })
  const run = store.create('wireRun', { circuit_id: circuit.id })

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
  const circuit = store.create('circuit', { name: 'C' })
  const run = store.create('wireRun', { circuit_id: circuit.id, zone_id: zone.id })

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
  const circuit = store.create('circuit', { name: 'C' })
  const run = store.create('wireRun', { circuit_id: circuit.id, zone_id: from.id })

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
  assert.deepEqual(store.zoneUsage(zone.id), { devices: 1, wireRuns: 0 })

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
