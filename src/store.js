'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')

const TABLES = {
  circuit: {
    table: 'circuits',
    columns: [
      'id', 'name', 'source_label', 'breaker_rating', 'voltage', 'panel_ref',
      'panel_device_id', 'convention', 'status', 'notes'
    ]
  },
  wireRun: {
    table: 'wire_runs',
    columns: [
      'id', 'circuit_id', 'from_endpoint', 'to_endpoint', 'gauge', 'gauge_unit',
      'color', 'length', 'length_unit', 'zone', 'cable_label', 'switch_ref',
      'route', 'zone_id', 'tags', 'status', 'notes'
    ]
  },
  device: {
    table: 'devices',
    columns: [
      'id', 'name', 'type', 'role', 'zone', 'rated_power_w', 'signalk_path',
      'pos_x', 'pos_y', 'pos_z', 'zone_id', 'tags', 'status', 'notes'
    ]
  },
  zone: {
    table: 'zones',
    columns: ['id', 'name']
  },
  plan: {
    table: 'plans',
    columns: ['id', 'name', 'view', 'filename', 'z_min', 'z_max', 'calibration', 'status', 'notes']
  }
}

// What a device does with power. Consumers are the default, so devices
// recorded before roles existed stay valid. Distribution covers switches,
// breakers, fuses, bus bars, panels, isolators and relays; converters are
// inverters, chargers and DC-DC units.
const DEVICE_ROLES = ['consumer', 'source', 'storage', 'distribution', 'converter']

// Each migration is applied at most once per database, tracked via
// SQLite's own `PRAGMA user_version` (an integer SQLite reserves
// exactly for this). Every step guards itself with a PRAGMA
// table_info() check rather than assuming it's needed, so the same
// list is safe to run against both a fresh database (schema.sql
// already has the new shape — every guard is a no-op) and an existing
// one from before this migration existed.
const MIGRATIONS = [
  {
    version: 1,
    description: 'circuits: source -> source_label, + breaker_rating, voltage; ' +
      'wire_runs: + cable_label, switch_ref, length_unit; ' +
      'devices: + rated_power_w, signalk_path',
    apply (db) {
      const hasColumn = (table, column) =>
        db.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === column)

      if (hasColumn('circuits', 'source') && !hasColumn('circuits', 'source_label')) {
        db.exec('ALTER TABLE circuits RENAME COLUMN source TO source_label')
      }
      if (!hasColumn('circuits', 'breaker_rating')) {
        db.exec('ALTER TABLE circuits ADD COLUMN breaker_rating REAL')
      }
      if (!hasColumn('circuits', 'voltage')) {
        db.exec('ALTER TABLE circuits ADD COLUMN voltage REAL')
      }

      if (!hasColumn('wire_runs', 'cable_label')) {
        db.exec('ALTER TABLE wire_runs ADD COLUMN cable_label TEXT')
      }
      if (!hasColumn('wire_runs', 'switch_ref')) {
        db.exec('ALTER TABLE wire_runs ADD COLUMN switch_ref TEXT')
      }
      if (!hasColumn('wire_runs', 'length_unit')) {
        db.exec('ALTER TABLE wire_runs ADD COLUMN length_unit TEXT')
      }

      if (!hasColumn('devices', 'rated_power_w')) {
        db.exec('ALTER TABLE devices ADD COLUMN rated_power_w REAL')
      }
      if (!hasColumn('devices', 'signalk_path')) {
        db.exec('ALTER TABLE devices ADD COLUMN signalk_path TEXT')
      }
    }
  },
  {
    version: 2,
    description: 'circuits: + panel_device_id; wire_runs: + route; devices: + pos_x, pos_y, pos_z ' +
      '(the plans table comes from schema.sql)',
    apply (db) {
      const hasColumn = (table, column) =>
        db.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === column)
      const addColumn = (table, column, type) => {
        if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      }
      addColumn('circuits', 'panel_device_id', 'TEXT')
      addColumn('wire_runs', 'route', 'TEXT')
      addColumn('devices', 'pos_x', 'REAL')
      addColumn('devices', 'pos_y', 'REAL')
      addColumn('devices', 'pos_z', 'REAL')
    }
  },
  {
    version: 3,
    description: 'wire_runs and devices: + zone_id, tags; every distinct zone string becomes a zone',
    apply (db) {
      const hasColumn = (table, column) =>
        db.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === column)
      for (const table of ['wire_runs', 'devices']) {
        if (!hasColumn(table, 'zone_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN zone_id TEXT REFERENCES zones(id)`)
        if (!hasColumn(table, 'tags')) db.exec(`ALTER TABLE ${table} ADD COLUMN tags TEXT`)
      }

      // Zone strings differing only in case or padding are one zone; the
      // first spelling met becomes its name. The old `zone` text column
      // stays, holding the zone's name, as a rollback aid and so responses
      // keep a readable zone.
      const zoneIdByKey = new Map()
      for (const row of db.prepare('SELECT id, name FROM zones').all()) {
        zoneIdByKey.set(row.name.toLowerCase(), row.id)
      }
      for (const table of ['devices', 'wire_runs']) {
        const rows = db.prepare(
          `SELECT id, zone FROM ${table} WHERE zone_id IS NULL AND zone IS NOT NULL AND TRIM(zone) != '' ORDER BY rowid`
        ).all()
        for (const row of rows) {
          const name = row.zone.trim()
          const key = name.toLowerCase()
          if (!zoneIdByKey.has(key)) {
            const id = crypto.randomUUID()
            db.prepare('INSERT INTO zones (id, name) VALUES (?, ?)').run(id, name)
            zoneIdByKey.set(key, id)
          }
          const zoneId = zoneIdByKey.get(key)
          const canonical = db.prepare('SELECT name FROM zones WHERE id = ?').get(zoneId).name
          db.prepare(`UPDATE ${table} SET zone_id = ?, zone = ? WHERE id = ?`).run(zoneId, canonical, row.id)
        }
      }
    }
  },
  {
    version: 4,
    description: "devices: + role (default 'consumer')",
    apply (db) {
      const hasRole = db.prepare('PRAGMA table_info(devices)').all().some((c) => c.name === 'role')
      if (!hasRole) db.exec("ALTER TABLE devices ADD COLUMN role TEXT NOT NULL DEFAULT 'consumer'")
    }
  }
]

// Records are never hard-deleted (SPEC.md §3.1): "removing" a wire run or
// device means setting status to 'removed' so the history stays queryable.
const REMOVED_STATUS = 'removed'

class Store {
  constructor (dbPath) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA_SQL)
    this._migrate()
  }

  close () {
    this.db.close()
  }

  _migrate () {
    const currentVersion = this.db.pragma('user_version', { simple: true })
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        migration.apply(this.db)
        this.db.pragma(`user_version = ${migration.version}`)
      }
    }
  }

  create (kind, fields) {
    const { table, columns } = TABLES[kind]
    const id = fields.id || crypto.randomUUID()
    let row = { ...fields, id, status: fields.status || 'active' }
    if (kind === 'zone') row.name = this._checkZoneName(row.name, id)
    else if (kind === 'device' || kind === 'wireRun') row = this._resolveZone(row)
    if (kind === 'device') row = this._checkRole(row)
    const cols = columns.filter((c) => c in row)
    const placeholders = cols.map((c) => `@${c}`).join(', ')
    this.db
      .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(row)
    this._logChange(kind, id, 'created', { after: this.get(kind, id) })
    return this.get(kind, id)
  }

  get (kind, id) {
    const { table } = TABLES[kind]
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null
  }

  list (kind) {
    const { table } = TABLES[kind]
    const order = kind === 'zone' ? ' ORDER BY name COLLATE NOCASE' : ''
    return this.db.prepare(`SELECT * FROM ${table}${order}`).all()
  }

  update (kind, id, patch) {
    const existing = this.get(kind, id)
    if (!existing) return null

    if (kind === 'zone' && 'name' in patch) patch = { ...patch, name: this._checkZoneName(patch.name, id) }
    else if (kind === 'device' || kind === 'wireRun') patch = this._resolveZone(patch)
    if (kind === 'device') patch = this._checkRole(patch)

    const { table, columns } = TABLES[kind]
    const cols = columns.filter((c) => c !== 'id' && c in patch)
    if (cols.length === 0) return existing

    const assignments = cols.map((c) => `${c} = @${c}`).join(', ')
    this.db
      .prepare(`UPDATE ${table} SET ${assignments} WHERE id = @id`)
      .run({ ...patch, id })

    const updated = this.get(kind, id)
    if (kind === 'zone' && existing.name !== updated.name) this._syncZoneName(id, updated.name)
    const diff = {}
    for (const c of cols) {
      if (existing[c] !== updated[c]) diff[c] = { before: existing[c], after: updated[c] }
    }
    if (Object.keys(diff).length > 0) {
      const summary = existing.status !== 'removed' && updated.status === REMOVED_STATUS
        ? 'removed'
        : 'updated'
      this._logChange(kind, id, summary, diff)
    }
    return updated
  }

  // An absent role stays absent (the column default applies); a cleared one
  // goes back to the default; anything else must be a known role.
  _checkRole (fields) {
    if (!('role' in fields)) return fields
    if (fields.role === null || fields.role === '' || fields.role === undefined) {
      return { ...fields, role: 'consumer' }
    }
    if (!DEVICE_ROLES.includes(fields.role)) {
      throw new Error(`role must be one of: ${DEVICE_ROLES.join(', ')}`)
    }
    return fields
  }

  // A zone name is trimmed, required, and unique ignoring case.
  _checkZoneName (name, ownId) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('a zone needs a name')
    const clash = this.db
      .prepare('SELECT id FROM zones WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(trimmed, ownId || '')
    if (clash) throw new Error(`zone already exists: ${trimmed}`)
    return trimmed
  }

  // The zone a device or wire run belongs to is set by zone_id, or by a zone
  // name (which finds the zone ignoring case and padding, or creates it).
  // zone_id wins when both are given. The `zone` text column always holds the
  // zone's name, so responses keep a readable zone.
  _resolveZone (fields) {
    if ('zone_id' in fields) {
      if (fields.zone_id === null || fields.zone_id === '' || fields.zone_id === undefined) {
        return { ...fields, zone_id: null, zone: null }
      }
      const zone = this.get('zone', fields.zone_id)
      if (!zone) throw new Error(`zone not found: ${fields.zone_id}`)
      return { ...fields, zone: zone.name }
    }
    if ('zone' in fields) {
      const name = typeof fields.zone === 'string' ? fields.zone.trim() : ''
      if (!name) return { ...fields, zone: null, zone_id: null }
      const zone = this.ensureZone(name)
      return { ...fields, zone: zone.name, zone_id: zone.id }
    }
    return fields
  }

  ensureZone (name) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('a zone needs a name')
    const found = this.db.prepare('SELECT * FROM zones WHERE name = ? COLLATE NOCASE').get(trimmed)
    return found || this.create('zone', { name: trimmed })
  }

  _syncZoneName (zoneId, name) {
    for (const table of ['devices', 'wire_runs']) {
      this.db.prepare(`UPDATE ${table} SET zone = ? WHERE zone_id = ?`).run(name, zoneId)
    }
  }

  zoneUsage (zoneId) {
    const count = (table) => this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE zone_id = ? AND status != 'removed'`)
      .get(zoneId).n
    return { devices: count('devices'), wireRuns: count('wire_runs') }
  }

  // Zones are a plain list, not part of the removed-but-kept lifecycle, so
  // an unused zone is really deleted (and the deletion logged). Removed
  // devices and wire runs that still point at it are detached.
  deleteZone (zoneId) {
    const zone = this.get('zone', zoneId)
    if (!zone) throw new Error(`zone not found: ${zoneId}`)
    const usage = this.zoneUsage(zoneId)
    if (usage.devices + usage.wireRuns > 0) {
      throw new Error(`zone in use by ${usage.devices} devices and ${usage.wireRuns} wire runs: ${zone.name}`)
    }
    for (const table of ['devices', 'wire_runs']) {
      this.db.prepare(`UPDATE ${table} SET zone_id = NULL, zone = NULL WHERE zone_id = ?`).run(zoneId)
    }
    this.db.prepare('DELETE FROM zones WHERE id = ?').run(zoneId)
    this._logChange('zone', zoneId, 'deleted', { before: zone })
  }

  // Moves every device and wire run of one zone to another, logging each
  // move, then removes the emptied zone.
  mergeZones (fromId, intoId) {
    const from = this.get('zone', fromId)
    const into = this.get('zone', intoId)
    if (!from) throw new Error(`zone not found: ${fromId}`)
    if (!into) throw new Error(`zone not found: ${intoId}`)
    if (fromId === intoId) throw new Error('cannot merge a zone into itself')

    const merge = this.db.transaction(() => {
      for (const kind of ['device', 'wireRun']) {
        for (const item of this.list(kind).filter((i) => i.zone_id === fromId)) {
          this.update(kind, item.id, { zone_id: intoId })
        }
      }
      this.db.prepare('DELETE FROM zones WHERE id = ?').run(fromId)
      this._logChange('zone', fromId, 'merged', { before: from, mergedInto: into.id })
    })
    merge()
    return into
  }

  // Marks a record removed rather than deleting the row (SPEC.md §3.1/§3.2).
  remove (kind, id) {
    return this.update(kind, id, { status: REMOVED_STATUS })
  }

  changeLog (kind, id) {
    return this.db
      .prepare('SELECT * FROM change_log WHERE record_type = ? AND record_id = ? ORDER BY timestamp ASC')
      .all(kind, id)
  }

  // Attachments aren't part of the removed-but-kept lifecycle (SPEC.md
  // §3.1 is about wiring records, not their photos) and have no `status`
  // column, so they get their own methods instead of the TABLES-driven
  // CRUD above.
  createAttachment (fields) {
    const id = fields.id || crypto.randomUUID()
    this.db
      .prepare(
        'INSERT INTO attachments (id, owner_type, owner_id, filename, mime_type, uploaded_at) VALUES (@id, @owner_type, @owner_id, @filename, @mime_type, @uploaded_at)'
      )
      .run({ ...fields, id })
    return this.getAttachment(id)
  }

  getAttachment (id) {
    return this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) || null
  }

  listAttachmentsByOwner (ownerType, ownerId) {
    return this.db
      .prepare('SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ?')
      .all(ownerType, ownerId)
  }

  // Hard delete: the file on disk is the only thing worth keeping a
  // record of, and that's the caller's job (routes.js removes it too).
  deleteAttachment (id) {
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
  }

  _logChange (kind, id, summary, diff) {
    this.db
      .prepare(
        'INSERT INTO change_log (id, record_type, record_id, timestamp, summary, diff_json) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(crypto.randomUUID(), kind, id, new Date().toISOString(), summary, JSON.stringify(diff))
  }
}

module.exports = { Store, REMOVED_STATUS, DEVICE_ROLES }
