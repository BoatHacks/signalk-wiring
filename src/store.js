'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const { deriveCircuits } = require('./circuits')
const { isCriticalType } = require('./safety')
const { deriveSwitchability } = require('./switchability')

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')

const TABLES = {
  circuit: {
    table: 'circuits',
    columns: ['id', 'name', 'key', 'cable_ids', 'voltage', 'convention', 'meter_path', 'meter_unit', 'status', 'notes']
  },
  wireRun: {
    table: 'wire_runs',
    columns: [
      'id', 'from_device_id', 'to_device_id', 'gauge', 'gauge_unit',
      'length', 'length_unit', 'zone', 'cable_label', 'switch_ref',
      'route', 'zone_id', 'tags', 'status', 'notes'
    ]
  },
  device: {
    table: 'devices',
    columns: [
      'id', 'name', 'type', 'role', 'icon_attachment_id', 'zone', 'rated_power_w', 'signalk_path',
      'trip_rating_a', 'nominal_voltage', 'power_factor', 'switch_path', 'confirm_switching', 'never_remote',
      'meter_path', 'meter_unit', 'pos_x', 'pos_y', 'pos_z', 'zone_id', 'tags', 'status', 'notes'
    ]
  },
  conduit: {
    table: 'conduits',
    columns: [
      'id', 'name', 'kind', 'inner_diameter', 'diameter_unit', 'zone', 'zone_id', 'route',
      'status', 'notes'
    ]
  },
  zone: {
    table: 'zones',
    columns: ['id', 'name']
  },
  schematic: {
    table: 'schematics',
    columns: ['id', 'name', 'status', 'notes']
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

// Tables whose rows can belong to a zone.
const ZONED_TABLES = ['devices', 'wire_runs', 'conduits']
const ZONED_KINDS = ['device', 'wireRun', 'conduit']
// The conductor types of a cable and of a device terminal.
const CONDUCTOR_TYPES = ['positive', 'negative', 'line', 'neutral', 'earth']

// Image types a browser can draw in a small icon. HEIC is accepted as an
// attachment but not here, since most browsers cannot display it.
const ICON_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

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
  },
  {
    version: 5,
    description: 'devices: + icon_attachment_id',
    apply (db) {
      const has = db.prepare('PRAGMA table_info(devices)').all().some((c) => c.name === 'icon_attachment_id')
      if (!has) db.exec('ALTER TABLE devices ADD COLUMN icon_attachment_id TEXT')
    }
  },
  {
    version: 6,
    description: 'conduits and wire_run_conduits (the tables come from schema.sql; this guards the version)',
    apply (db) {
      // schema.sql runs on every open with IF NOT EXISTS, so by now the
      // tables exist for fresh and old databases alike. Create them here
      // too in case this step is ever run without that file.
      const exists = (name) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
      if (!exists('conduits')) {
        db.exec(`CREATE TABLE conduits (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT, inner_diameter REAL,
          diameter_unit TEXT, zone TEXT, zone_id TEXT REFERENCES zones(id), route TEXT,
          status TEXT NOT NULL DEFAULT 'active', notes TEXT)`)
      }
      if (!exists('wire_run_conduits')) {
        db.exec(`CREATE TABLE wire_run_conduits (
          wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
          conduit_id TEXT NOT NULL REFERENCES conduits(id),
          position INTEGER NOT NULL, PRIMARY KEY (wire_run_id, conduit_id))`)
      }
    }
  }
  ,
  {
    version: 7,
    description: 'plan 0014: cables between devices with conductors, device terminals, trip rating, ' +
      'nominal voltage and power factor; circuits keyed by what the cables imply',
    apply (db) {
      const hasColumn = (table, column) =>
        db.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === column)
      const addColumn = (table, column, type) => {
        if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      }

      addColumn('devices', 'trip_rating_a', 'REAL')
      addColumn('devices', 'nominal_voltage', 'REAL')
      addColumn('devices', 'power_factor', 'REAL')

      // schema.sql has created the two new tables by now (IF NOT EXISTS), for
      // fresh and old databases alike; this only matters if it was skipped.
      db.exec(`CREATE TABLE IF NOT EXISTS wire_run_conductors (
        id TEXT PRIMARY KEY, wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
        position INTEGER NOT NULL, conductor TEXT NOT NULL, color TEXT,
        from_device_id TEXT REFERENCES devices(id), to_device_id TEXT REFERENCES devices(id),
        from_terminal TEXT, to_terminal TEXT)`)
      db.exec(`CREATE TABLE IF NOT EXISTS device_terminals (
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
        position INTEGER NOT NULL, name TEXT NOT NULL, conductor TEXT NOT NULL,
        voltage REAL, port TEXT)`)

      // Circuits: records now follow the cables. The hand-entered source,
      // breaker, panel fields are retired; a circuit made by hand has no key
      // and is kept as removed at the next sync (name and notes survive).
      addColumn('circuits', 'key', 'TEXT')
      addColumn('circuits', 'cable_ids', 'TEXT')
      for (const column of ['source_label', 'breaker_rating', 'panel_ref', 'panel_device_id']) {
        if (hasColumn('circuits', column)) db.exec(`ALTER TABLE circuits DROP COLUMN ${column}`)
      }

      // Wire runs: free-text ends become devices.
      if (hasColumn('wire_runs', 'circuit_id')) {
        const devices = db.prepare('SELECT id, name FROM devices').all()
        const byId = new Set(devices.map((d) => d.id))
        const byName = new Map()
        for (const d of devices) {
          const key = String(d.name).trim().toLowerCase()
          if (!byName.has(key)) byName.set(key, d.id)
        }
        const resolve = (text) => {
          if (typeof text !== 'string' || !text.trim()) return null
          if (byId.has(text)) return text
          return byName.get(text.trim().toLowerCase()) || null
        }
        const old = db.prepare('SELECT * FROM wire_runs ORDER BY rowid').all()

        db.pragma('foreign_keys = OFF')
        try {
          db.transaction(() => {
            db.exec(`CREATE TABLE wire_runs_new (
              id TEXT PRIMARY KEY,
              from_device_id TEXT REFERENCES devices(id),
              to_device_id TEXT REFERENCES devices(id),
              gauge REAL, gauge_unit TEXT, length REAL, length_unit TEXT, zone TEXT,
              cable_label TEXT, switch_ref TEXT, route TEXT,
              zone_id TEXT REFERENCES zones(id), tags TEXT,
              status TEXT NOT NULL DEFAULT 'active', notes TEXT)`)
            const insert = db.prepare(`INSERT INTO wire_runs_new
              (id, from_device_id, to_device_id, gauge, gauge_unit, length, length_unit, zone,
               cable_label, switch_ref, route, zone_id, tags, status, notes)
              VALUES (@id, @from_device_id, @to_device_id, @gauge, @gauge_unit, @length, @length_unit, @zone,
               @cable_label, @switch_ref, @route, @zone_id, @tags, @status, @notes)`)
            const insertConductor = db.prepare(`INSERT INTO wire_run_conductors
              (id, wire_run_id, position, conductor, color) VALUES (?, ?, 0, 'positive', ?)`)
            for (const row of old) {
              const from = resolve(row.from_endpoint)
              const to = resolve(row.to_endpoint)
              // A free-text end that matches no device is kept in the notes
              // so nothing is lost; the cable then shows as unfinished.
              const lost = []
              if (!from && row.from_endpoint) lost.push(`From: ${row.from_endpoint}`)
              if (!to && row.to_endpoint) lost.push(`To: ${row.to_endpoint}`)
              const notes = lost.length
                ? [row.notes, `Before devices were linked: ${lost.join(', ')}`].filter(Boolean).join('\n')
                : row.notes
              insert.run({
                id: row.id,
                from_device_id: from,
                to_device_id: to,
                gauge: row.gauge,
                gauge_unit: row.gauge_unit,
                length: row.length,
                length_unit: row.length_unit,
                zone: row.zone,
                cable_label: row.cable_label,
                switch_ref: row.switch_ref,
                route: row.route,
                zone_id: row.zone_id,
                tags: row.tags,
                status: row.status,
                notes
              })
              insertConductor.run(crypto.randomUUID(), row.id, row.color || null)
            }
            db.exec('DROP TABLE wire_runs')
            db.exec('ALTER TABLE wire_runs_new RENAME TO wire_runs')
          })()
        } finally {
          db.pragma('foreign_keys = ON')
        }
      }

      db.exec('CREATE INDEX IF NOT EXISTS idx_wire_runs_from ON wire_runs (from_device_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_wire_runs_to ON wire_runs (to_device_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_conductors_wire_run ON wire_run_conductors (wire_run_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_terminals_device ON device_terminals (device_id)')
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_circuits_key ON circuits (key) WHERE key IS NOT NULL')
    }
  },
  {
    version: 8,
    description: 'plan 0016: schematics with their devices and bent wires (tables come from schema.sql; this guards the version)',
    apply (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS schematics (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', notes TEXT)`)
      db.exec(`CREATE TABLE IF NOT EXISTS schematic_devices (
        id TEXT PRIMARY KEY, schematic_id TEXT NOT NULL REFERENCES schematics(id),
        position INTEGER NOT NULL, device_id TEXT NOT NULL REFERENCES devices(id),
        x REAL NOT NULL, y REAL NOT NULL)`)
      db.exec(`CREATE TABLE IF NOT EXISTS schematic_wires (
        id TEXT PRIMARY KEY, schematic_id TEXT NOT NULL REFERENCES schematics(id),
        position INTEGER NOT NULL, wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
        points TEXT)`)
      db.exec('CREATE INDEX IF NOT EXISTS idx_schematic_devices_schematic ON schematic_devices (schematic_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_schematic_wires_schematic ON schematic_wires (schematic_id)')
    }
  },
  {
    version: 9,
    description: 'plan 0017: devices + switch_path, confirm_switching, never_remote, meter_path, meter_unit; ' +
      'circuits + meter_path, meter_unit; calibration_runs',
    apply (db) {
      const hasColumn = (table, column) =>
        db.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === column)
      const addColumn = (table, column, type) => {
        if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      }
      addColumn('devices', 'switch_path', 'TEXT')
      addColumn('devices', 'confirm_switching', 'INTEGER NOT NULL DEFAULT 0')
      addColumn('devices', 'never_remote', 'INTEGER NOT NULL DEFAULT 0')
      addColumn('devices', 'meter_path', 'TEXT')
      addColumn('devices', 'meter_unit', 'TEXT')
      addColumn('circuits', 'meter_path', 'TEXT')
      addColumn('circuits', 'meter_unit', 'TEXT')
      // schema.sql has created calibration_runs by now, for fresh and old
      // databases alike; this only matters if it was skipped.
      db.exec(`CREATE TABLE IF NOT EXISTS calibration_runs (
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
        switch_device_id TEXT REFERENCES devices(id), consumer_ids TEXT,
        method TEXT NOT NULL CHECK (method IN ('delta', 'watch')),
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
        review TEXT NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'accepted', 'rejected')),
        meter_path TEXT, meter_unit TEXT, voltage REAL, estimate INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL, ended_at TEXT, params TEXT, samples TEXT, details TEXT,
        avg_w REAL, peak_w REAL, duty_cycle REAL, confidence TEXT, error TEXT)`)
      db.exec('CREATE INDEX IF NOT EXISTS idx_calibration_runs_device ON calibration_runs (device_id)')
    }
  }
]

const METER_UNITS = ['A', 'W']
const RUN_METHODS = ['delta', 'watch']
const RUN_STATUSES = ['running', 'done', 'failed', 'cancelled']
const RUN_REVIEWS = ['pending', 'accepted', 'rejected']
const RUN_COLUMNS = [
  'device_id', 'switch_device_id', 'consumer_ids', 'method', 'status', 'review', 'meter_path', 'meter_unit',
  'voltage', 'estimate', 'started_at', 'ended_at', 'params', 'samples', 'details', 'avg_w', 'peak_w',
  'duty_cycle', 'confidence', 'error'
]
const RUN_JSON_COLUMNS = ['consumer_ids', 'params', 'samples', 'details']

// A run row as the rest of the code sees it: JSON columns parsed.
function runFromRow (row) {
  if (!row) return null
  const out = { ...row }
  for (const c of RUN_JSON_COLUMNS) out[c] = typeof row[c] === 'string' ? JSON.parse(row[c]) : null
  return out
}

const numberOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

const checkConductorType = (value, what) => {
  if (!CONDUCTOR_TYPES.includes(value)) {
    throw new Error(`${what} must be one of: ${CONDUCTOR_TYPES.join(', ')}`)
  }
  return value
}

// Child tables written as part of their parent record.
const CHILDREN = {
  wireRun: {
    field: 'conductors',
    table: 'wire_run_conductors',
    parent: 'wire_run_id',
    columns: ['conductor', 'color', 'from_device_id', 'to_device_id', 'from_terminal', 'to_terminal'],
    toKey: (column) => column.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
    fromRow: (r) => ({
      conductor: r.conductor,
      color: r.color,
      fromDeviceId: r.from_device_id,
      toDeviceId: r.to_device_id,
      fromTerminal: r.from_terminal,
      toTerminal: r.to_terminal
    }),
    normalize: (i) => ({
      conductor: i.conductor,
      color: textOrNull(i.color),
      fromDeviceId: textOrNull(i.fromDeviceId),
      toDeviceId: textOrNull(i.toDeviceId),
      fromTerminal: textOrNull(i.fromTerminal),
      toTerminal: textOrNull(i.toTerminal)
    }),
    check (item, store) {
      const out = CHILDREN.wireRun.normalize(item)
      checkConductorType(out.conductor, 'conductor')
      for (const key of ['fromDeviceId', 'toDeviceId']) {
        if (out[key] && !store.db.prepare('SELECT 1 FROM devices WHERE id = ?').get(out[key])) {
          throw new Error(`device not found: ${out[key]}`)
        }
      }
      return out
    }
  },
  device: {
    field: 'terminals',
    table: 'device_terminals',
    parent: 'device_id',
    columns: ['name', 'conductor', 'voltage', 'port'],
    toKey: (column) => column,
    fromRow: (r) => ({ name: r.name, conductor: r.conductor, voltage: r.voltage, port: r.port }),
    normalize: (i) => ({
      name: textOrNull(i.name),
      conductor: i.conductor,
      voltage: numberOrNull(i.voltage),
      port: textOrNull(i.port)
    }),
    check (item) {
      const out = CHILDREN.device.normalize(item)
      if (!out.name) throw new Error('a terminal needs a name')
      checkConductorType(out.conductor, 'terminal conductor')
      return out
    }
  }
}

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
    else if (ZONED_KINDS.includes(kind)) row = this._resolveZone(this._checkConduit(kind, row, true))
    if (kind === 'device') row = this._checkSwitching(this._checkIcon(id, this._checkRole(row)), true)
    else if (kind === 'circuit') row = this._checkSwitching(row, false)
    if (kind === 'wireRun') this._checkWireRunEnds(row)
    if (kind === 'schematic') row.name = this._checkSchematicName(row.name)
    const lists = kind === 'schematic' ? this._checkSchematicLists(row) : null
    const children = this._childrenOf(kind)
    const list = children ? this._checkChildren(kind, children, row[children.field], row) : null
    const cols = columns.filter((c) => c in row)
    const placeholders = cols.map((c) => `@${c}`).join(', ')
    this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
        .run(row)
      if (list) this._writeChildren(children, id, list)
      if (lists) this._writeSchematicLists(id, lists)
    })()
    this._logChange(kind, id, 'created', { after: this.get(kind, id) })
    this._afterWrite(kind)
    return this.get(kind, id)
  }

  get (kind, id) {
    const { table } = TABLES[kind]
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null
    return row ? this._withChildren(kind, [row])[0] : null
  }

  list (kind) {
    const { table } = TABLES[kind]
    const order = kind === 'zone' ? ' ORDER BY name COLLATE NOCASE' : ''
    return this._withChildren(kind, this.db.prepare(`SELECT * FROM ${table}${order}`).all())
  }

  // Schematics (plan 0016). A page lists its devices (with x and y) and the
  // cables the user bent (with their bend points). Both are written with the
  // page. Only adding or removing a device on a page is a logged change:
  // moving a device or a bend point is layout and is not, and a wire needs no
  // entry because the cable itself carries the wiring facts.
  _withSchematicLists (rows) {
    if (rows.length === 0) return rows
    const one = rows.length === 1
    const devices = one
      ? this.db.prepare('SELECT * FROM schematic_devices WHERE schematic_id = ? ORDER BY position').all(rows[0].id)
      : this.db.prepare('SELECT * FROM schematic_devices ORDER BY schematic_id, position').all()
    const wires = one
      ? this.db.prepare('SELECT * FROM schematic_wires WHERE schematic_id = ? ORDER BY position').all(rows[0].id)
      : this.db.prepare('SELECT * FROM schematic_wires ORDER BY schematic_id, position').all()
    const group = (list, map) => {
      const by = new Map()
      for (const r of list) {
        if (!by.has(r.schematic_id)) by.set(r.schematic_id, [])
        by.get(r.schematic_id).push(map(r))
      }
      return by
    }
    const dByS = group(devices, (r) => ({ deviceId: r.device_id, x: r.x, y: r.y }))
    const wByS = group(wires, (r) => ({ wireRunId: r.wire_run_id, points: r.points ? JSON.parse(r.points) : [] }))
    return rows.map((row) => ({ ...row, devices: dByS.get(row.id) || [], wires: wByS.get(row.id) || [] }))
  }

  _checkSchematicName (name) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('a schematic needs a name')
    return trimmed
  }

  // Validates and normalises the lists of a schematic write. A list that was
  // not given is null (left alone). A wire without bend points is dropped,
  // since an unbent wire needs no row.
  _checkSchematicLists (fields) {
    const out = { devices: null, wires: null }
    const finite = (v, what) => {
      const n = Number(v)
      if (v === null || v === '' || v === undefined || !Number.isFinite(n)) throw new Error(`${what} must be a number`)
      return n
    }
    if (fields.devices !== undefined) {
      if (!Array.isArray(fields.devices)) throw new Error('devices must be a list')
      const seen = new Set()
      out.devices = fields.devices.map((item) => {
        const deviceId = item && item.deviceId
        if (!deviceId || !this.db.prepare('SELECT 1 FROM devices WHERE id = ?').get(deviceId)) {
          throw new Error(`device not found: ${deviceId}`)
        }
        if (seen.has(deviceId)) throw new Error(`device listed twice: ${deviceId}`)
        seen.add(deviceId)
        return { deviceId, x: finite(item.x, 'x'), y: finite(item.y, 'y') }
      })
    }
    if (fields.wires !== undefined) {
      if (!Array.isArray(fields.wires)) throw new Error('wires must be a list')
      const seen = new Set()
      out.wires = []
      for (const item of fields.wires) {
        const wireRunId = item && item.wireRunId
        if (!wireRunId || !this.db.prepare('SELECT 1 FROM wire_runs WHERE id = ?').get(wireRunId)) {
          throw new Error(`wire run not found: ${wireRunId}`)
        }
        if (seen.has(wireRunId)) throw new Error(`wire run listed twice: ${wireRunId}`)
        seen.add(wireRunId)
        if (item.points !== undefined && item.points !== null && !Array.isArray(item.points)) {
          throw new Error('points must be a list')
        }
        const points = (item.points || []).map((p) => ({ x: finite(p && p.x, 'x'), y: finite(p && p.y, 'y') }))
        if (points.length > 0) out.wires.push({ wireRunId, points })
      }
    }
    return out
  }

  _writeSchematicLists (id, lists) {
    if (lists.devices) {
      this.db.prepare('DELETE FROM schematic_devices WHERE schematic_id = ?').run(id)
      const insert = this.db.prepare(
        'INSERT INTO schematic_devices (id, schematic_id, position, device_id, x, y) VALUES (?, ?, ?, ?, ?, ?)')
      lists.devices.forEach((d, i) => insert.run(crypto.randomUUID(), id, i, d.deviceId, d.x, d.y))
    }
    if (lists.wires) {
      this.db.prepare('DELETE FROM schematic_wires WHERE schematic_id = ?').run(id)
      const insert = this.db.prepare(
        'INSERT INTO schematic_wires (id, schematic_id, position, wire_run_id, points) VALUES (?, ?, ?, ?, ?)')
      lists.wires.forEach((w, i) => insert.run(crypto.randomUUID(), id, i, w.wireRunId, JSON.stringify(w.points)))
    }
  }

  _updateSchematic (id, patch, existing) {
    const fields = { ...patch }
    if ('name' in fields) fields.name = this._checkSchematicName(fields.name)
    const lists = this._checkSchematicLists(fields)
    const cols = TABLES.schematic.columns.filter((c) => c !== 'id' && c in fields)
    const idsOf = (list, key) => (list || []).map((i) => i[key]).sort()
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const layoutChanged =
      (lists.devices && !same(lists.devices, existing.devices)) ||
      (lists.wires && !same(lists.wires, existing.wires))
    const diff = {}
    this.db.transaction(() => {
      if (cols.length) {
        this.db.prepare(`UPDATE schematics SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
          .run({ ...fields, id })
      }
      if (layoutChanged) this._writeSchematicLists(id, lists)
    })()
    const updated = this.get('schematic', id)
    for (const c of cols) {
      if (existing[c] !== updated[c]) diff[c] = { before: existing[c], after: updated[c] }
    }
    if (lists.devices) {
      const before = idsOf(existing.devices, 'deviceId')
      const after = idsOf(updated.devices, 'deviceId')
      if (!same(before, after)) diff.devices = { before, after }
    }
    if (Object.keys(diff).length > 0) {
      const summary = existing.status !== REMOVED_STATUS && updated.status === REMOVED_STATUS ? 'removed' : 'updated'
      this._logChange('schematic', id, summary, diff)
    }
    return updated
  }

  // Cables list their conductors and devices their terminals. Both live in
  // child tables but are written and logged as part of their parent.
  _childrenOf (kind) {
    return CHILDREN[kind] || null
  }

  _withChildren (kind, rows) {
    if (kind === 'schematic') return this._withSchematicLists(rows)
    const children = this._childrenOf(kind)
    if (!children || rows.length === 0) return rows
    const all = rows.length === 1
      ? this.db.prepare(`SELECT * FROM ${children.table} WHERE ${children.parent} = ? ORDER BY position`).all(rows[0].id)
      : this.db.prepare(`SELECT * FROM ${children.table} ORDER BY ${children.parent}, position`).all()
    const byParent = new Map()
    for (const r of all) {
      if (!byParent.has(r[children.parent])) byParent.set(r[children.parent], [])
      byParent.get(r[children.parent]).push(children.fromRow(r))
    }
    return rows.map((row) => ({ ...row, [children.field]: byParent.get(row.id) || [] }))
  }

  _writeChildren (children, parentId, list) {
    this.db.prepare(`DELETE FROM ${children.table} WHERE ${children.parent} = ?`).run(parentId)
    const insert = this.db.prepare(
      `INSERT INTO ${children.table} (id, ${children.parent}, position, ${children.columns.join(', ')}) ` +
      `VALUES (?, ?, ?, ${children.columns.map(() => '?').join(', ')})`
    )
    list.forEach((item, index) => {
      insert.run(crypto.randomUUID(), parentId, index, ...children.columns.map((c) => item[children.toKey(c)] ?? null))
    })
  }

  // Validates and normalises the conductors of a cable or the terminals of a
  // device. Returns null when the field was not given at all.
  _checkChildren (kind, children, value, owner) {
    if (value === undefined) return null
    if (!Array.isArray(value)) throw new Error(`${children.field} must be a list`)
    return value.map((item) => children.check(item || {}, this, owner))
  }

  _checkWireRunEnds (fields) {
    for (const key of ['from_device_id', 'to_device_id']) {
      const id = fields[key]
      if (id !== null && id !== undefined && id !== '' && !this.db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id)) {
        throw new Error(`device not found: ${id}`)
      }
    }
  }

  // Circuit records follow the cables (plan 0014): after any change to a
  // device or cable they are brought in step. Implemented in syncCircuits.
  _afterWrite (kind) {
    if (kind === 'device' || kind === 'wireRun') this.syncCircuits()
  }

  // What the cables and devices imply right now (src/circuits.js).
  deriveAll () {
    const devices = this.list('device').map((d) => ({
      id: d.id,
      name: d.name,
      role: d.role,
      status: d.status,
      tripRatingA: d.trip_rating_a,
      nominalVoltage: d.nominal_voltage,
      terminals: d.terminals
    }))
    const cables = this.list('wireRun').map((w) => ({
      id: w.id,
      fromDeviceId: w.from_device_id,
      toDeviceId: w.to_device_id,
      status: w.status,
      conductors: w.conductors
    }))
    return deriveCircuits({ devices, cables })
  }

  // Which consumers can be switched remotely and which meters measure them
  // (src/switchability.js), from the devices, cables and circuit records now.
  deriveSwitching () {
    const devices = this.list('device').map((d) => ({
      id: d.id,
      name: d.name,
      role: d.role,
      status: d.status,
      tripRatingA: d.trip_rating_a,
      nominalVoltage: d.nominal_voltage,
      terminals: d.terminals,
      switchPath: d.switch_path,
      confirmSwitching: Boolean(d.confirm_switching),
      neverRemote: Boolean(d.never_remote),
      meterPath: d.meter_path,
      meterUnit: d.meter_unit
    }))
    const cables = this.list('wireRun').map((w) => ({
      id: w.id,
      fromDeviceId: w.from_device_id,
      toDeviceId: w.to_device_id,
      status: w.status,
      conductors: w.conductors
    }))
    const circuits = this.list('circuit').map((c) => ({
      id: c.id, key: c.key, status: c.status, voltage: c.voltage, meterPath: c.meter_path, meterUnit: c.meter_unit
    }))
    return deriveSwitchability({ devices, cables, circuits })
  }

  // An action worth keeping a trace of that is not a change to the record
  // (a switch command sent), written to the record's change log.
  logAction (kind, id, summary, diff) {
    this._logChange(kind, id, summary, diff)
  }

  // Brings the circuit records in step with the derived circuits. Records
  // are never created or deleted by hand: a new derived circuit gets one, a
  // circuit whose key changed (a fuse added or taken out) keeps its record,
  // name and notes, and a circuit that disappears is marked removed and
  // comes back to life if it reappears. Each change is logged.
  syncCircuits () {
    const derived = this.deriveAll()
    const deviceName = new Map(this.list('device').map((d) => [d.id, d.name]))
    const records = this.list('circuit')
    const byKey = new Map(records.filter((r) => r.key).map((r) => [r.key, r]))
    const derivedKeys = new Set(derived.circuits.map((c) => c.key))
    const spare = records
      .filter((r) => r.status !== REMOVED_STATUS && !derivedKeys.has(r.key))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    const claimed = new Set()

    this.db.transaction(() => {
      for (const circuit of derived.circuits) {
        const cableIds = JSON.stringify(circuit.cableIds)
        let record = byKey.get(circuit.key)
        if (record) {
          const patch = {}
          if (record.status === REMOVED_STATUS) patch.status = 'active'
          if (record.cable_ids !== cableIds) patch.cable_ids = cableIds
          if (Object.keys(patch).length) this.update('circuit', record.id, patch)
          continue
        }
        // Same cables under a new key: carry the record over.
        const wanted = new Set(circuit.cableIds)
        let best = null
        let bestOverlap = 0
        for (const candidate of spare) {
          if (claimed.has(candidate.id)) continue
          const overlap = JSON.parse(candidate.cable_ids || '[]').filter((id) => wanted.has(id)).length
          if (overlap > bestOverlap) { best = candidate; bestOverlap = overlap }
        }
        if (best) {
          claimed.add(best.id)
          this.update('circuit', best.id, { key: circuit.key, cable_ids: cableIds })
          continue
        }
        const name = circuit.protectorId
          ? deviceName.get(circuit.protectorId)
          : `Unprotected: ${circuit.endDeviceIds.map((id) => deviceName.get(id)).filter(Boolean).join(', ') || circuit.cableIds[0]}`
        this.create('circuit', { name, key: circuit.key, cable_ids: cableIds })
      }
      for (const record of spare) {
        if (!claimed.has(record.id)) this.update('circuit', record.id, { status: REMOVED_STATUS })
      }
    })()
  }

  update (kind, id, patch) {
    const existing = this.get(kind, id)
    if (!existing) return null

    if (kind === 'schematic') return this._updateSchematic(id, patch, existing)
    if (kind === 'zone' && 'name' in patch) patch = { ...patch, name: this._checkZoneName(patch.name, id) }
    else if (ZONED_KINDS.includes(kind)) patch = this._resolveZone(this._checkConduit(kind, patch, false))
    if (kind === 'device') patch = this._checkSwitching(this._checkIcon(id, this._checkRole(patch)), false)
    else if (kind === 'circuit') patch = this._checkSwitching(patch, false)

    if (kind === 'wireRun') this._checkWireRunEnds(patch)

    const { table, columns } = TABLES[kind]
    const children = this._childrenOf(kind)
    const list = children ? this._checkChildren(kind, children, patch[children.field], { ...existing, ...patch }) : null
    const cols = columns.filter((c) => c !== 'id' && c in patch)
    const childrenChanged = list !== null &&
      JSON.stringify(list) !== JSON.stringify(existing[children.field].map((i) => children.normalize(i)))
    if (cols.length === 0 && !childrenChanged) return existing

    this.db.transaction(() => {
      if (cols.length > 0) {
        const assignments = cols.map((c) => `${c} = @${c}`).join(', ')
        this.db
          .prepare(`UPDATE ${table} SET ${assignments} WHERE id = @id`)
          .run({ ...patch, id })
      }
      if (childrenChanged) this._writeChildren(children, id, list)
    })()

    const updated = this.get(kind, id)
    if (kind === 'zone' && existing.name !== updated.name) this._syncZoneName(id, updated.name)
    const diff = {}
    for (const c of cols) {
      if (existing[c] !== updated[c]) diff[c] = { before: existing[c], after: updated[c] }
    }
    if (childrenChanged) diff[children.field] = { before: existing[children.field], after: updated[children.field] }
    if (Object.keys(diff).length > 0) {
      const summary = existing.status !== 'removed' && updated.status === REMOVED_STATUS
        ? 'removed'
        : 'updated'
      this._logChange(kind, id, summary, diff)
    }
    this._afterWrite(kind)
    return updated
  }

  // A conduit needs a name; its kind is free text, trimmed.
  _checkConduit (kind, fields, creating) {
    if (kind !== 'conduit') return fields
    let out = fields
    if (creating || 'name' in fields) {
      const name = typeof fields.name === 'string' ? fields.name.trim() : ''
      if (!name) throw new Error('a conduit needs a name')
      out = { ...out, name }
    }
    if ('kind' in out && typeof out.kind === 'string') {
      out = { ...out, kind: out.kind.trim() || null }
    }
    return out
  }

  // Cable assignments (plan 0015). A cable, which is a wire run, lists the
  // conduits it passes through in order; `position` is that order, counted
  // from 0 per cable. Assignments are not records of their own: a change is
  // logged on the conduit (assigned, unassigned) or on the wire run (the
  // whole list replaced).
  conduitsOfCable (wireRunId) {
    return this.db
      .prepare('SELECT conduit_id FROM wire_run_conduits WHERE wire_run_id = ? ORDER BY position')
      .all(wireRunId).map((r) => r.conduit_id)
  }

  cablesOfConduit (conduitId) {
    return this.db
      .prepare('SELECT wire_run_id FROM wire_run_conduits WHERE conduit_id = ? ORDER BY rowid')
      .all(conduitId).map((r) => r.wire_run_id)
  }

  // Every assignment at once, for listing: { conduitId: [wireRunId], ... }
  // and { wireRunId: [conduitId], ... }.
  conduitAssignmentMaps () {
    const byConduit = {}
    const byCable = {}
    const rows = this.db
      .prepare('SELECT wire_run_id, conduit_id FROM wire_run_conduits ORDER BY position, rowid')
      .all()
    for (const r of rows) {
      (byCable[r.wire_run_id] = byCable[r.wire_run_id] || []).push(r.conduit_id)
    }
    const byRowid = this.db.prepare('SELECT wire_run_id, conduit_id FROM wire_run_conduits ORDER BY rowid').all()
    for (const r of byRowid) {
      (byConduit[r.conduit_id] = byConduit[r.conduit_id] || []).push(r.wire_run_id)
    }
    return { byConduit, byCable }
  }

  _requireAssignable (conduitId, wireRunId) {
    if (!this.get('conduit', conduitId)) throw new Error(`conduit not found: ${conduitId}`)
    if (!this.get('wireRun', wireRunId)) throw new Error(`wire run not found: ${wireRunId}`)
  }

  // Adds the cable to the end of its own conduit list. Already assigned is
  // a no-op (nothing logged).
  assignCable (conduitId, wireRunId) {
    this._requireAssignable(conduitId, wireRunId)
    const current = this.conduitsOfCable(wireRunId)
    if (current.includes(conduitId)) return current
    this.db
      .prepare('INSERT INTO wire_run_conduits (wire_run_id, conduit_id, position) VALUES (?, ?, ?)')
      .run(wireRunId, conduitId, current.length)
    this._logChange('conduit', conduitId, 'cable assigned', { wireRunId })
    return this.conduitsOfCable(wireRunId)
  }

  // Takes the cable out of the conduit; its other conduits keep their order.
  unassignCable (conduitId, wireRunId) {
    this._requireAssignable(conduitId, wireRunId)
    const current = this.conduitsOfCable(wireRunId)
    if (!current.includes(conduitId)) return current
    const apply = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM wire_run_conduits WHERE wire_run_id = ? AND conduit_id = ?')
        .run(wireRunId, conduitId)
      this._writeCableOrder(wireRunId, current.filter((c) => c !== conduitId))
    })
    apply()
    this._logChange('conduit', conduitId, 'cable unassigned', { wireRunId })
    return this.conduitsOfCable(wireRunId)
  }

  // Replaces the whole ordered conduit list of a cable (this is also how
  // conduits are reordered). One change-log entry on the wire run.
  setCableConduits (wireRunId, conduitIds) {
    if (!this.get('wireRun', wireRunId)) throw new Error(`wire run not found: ${wireRunId}`)
    const next = []
    for (const id of conduitIds || []) {
      if (!this.get('conduit', id)) throw new Error(`conduit not found: ${id}`)
      if (!next.includes(id)) next.push(id)
    }
    const before = this.conduitsOfCable(wireRunId)
    if (before.length === next.length && before.every((c, i) => c === next[i])) return before
    const apply = this.db.transaction(() => {
      this.db.prepare('DELETE FROM wire_run_conduits WHERE wire_run_id = ?').run(wireRunId)
      this._writeCableOrder(wireRunId, next)
    })
    apply()
    this._logChange('wireRun', wireRunId, 'conduits changed', { conduits: { before, after: next } })
    return next
  }

  _writeCableOrder (wireRunId, conduitIds) {
    const upsert = this.db.prepare(
      `INSERT INTO wire_run_conduits (wire_run_id, conduit_id, position) VALUES (?, ?, ?)
       ON CONFLICT (wire_run_id, conduit_id) DO UPDATE SET position = excluded.position`
    )
    conduitIds.forEach((id, i) => upsert.run(wireRunId, id, i))
  }

  // A device's icon must be one of its own JPEG, PNG or WebP attachments.
  _checkIcon (deviceId, fields) {
    if (!('icon_attachment_id' in fields)) return fields
    const id = fields.icon_attachment_id
    if (id === null || id === undefined || id === '') return { ...fields, icon_attachment_id: null }
    const attachment = this.getAttachment(id)
    if (!attachment || attachment.owner_type !== 'device' || attachment.owner_id !== deviceId ||
        !ICON_MIME_TYPES.includes(attachment.mime_type)) {
      throw new Error('icon must be a JPEG, PNG or WebP image attached to this device')
    }
    return fields
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

  // Plan 0017 fields. Paths are trimmed text or null, the meter unit is A or
  // W, and the two safety flags are stored as 0/1 whatever the caller sends.
  // On creation, a device of a critical-looking type that says nothing about
  // confirm_switching starts with it on; an explicit value always wins and an
  // existing device is never flagged by a later type change.
  _checkSwitching (fields, creating) {
    let out = fields
    for (const key of ['switch_path', 'meter_path']) {
      if (key in out) out = { ...out, [key]: textOrNull(out[key]) }
    }
    if ('meter_unit' in out) {
      const unit = out.meter_unit === '' || out.meter_unit === undefined ? null : out.meter_unit
      if (unit !== null && !METER_UNITS.includes(unit)) throw new Error(`meter_unit must be one of: ${METER_UNITS.join(', ')}`)
      out = { ...out, meter_unit: unit }
    }
    for (const key of ['confirm_switching', 'never_remote']) {
      if (key in out) out = { ...out, [key]: out[key] && out[key] !== '0' ? 1 : 0 }
    }
    if (creating && !('confirm_switching' in out)) {
      out = { ...out, confirm_switching: isCriticalType(out.type) ? 1 : 0 }
    }
    return out
  }

  // ---- Calibration runs (plan 0017). A run is a record of its own, written
  // often while it executes, so it is not part of the change log; accepting
  // or rejecting one is logged on the device it measures.
  createRun (fields) {
    if (!RUN_METHODS.includes(fields.method)) throw new Error(`method must be one of: ${RUN_METHODS.join(', ')}`)
    for (const key of ['device_id', 'switch_device_id']) {
      if (fields[key] && !this.db.prepare('SELECT 1 FROM devices WHERE id = ?').get(fields[key])) {
        throw new Error(`device not found: ${fields[key]}`)
      }
    }
    if (!fields.device_id) throw new Error('a run needs a device')
    const row = {
      status: 'running', review: 'pending', estimate: 0, started_at: new Date().toISOString(), ...fields,
      id: fields.id || crypto.randomUUID()
    }
    this._checkRunFields(row)
    this._insertRun(row)
    return this.getRun(row.id)
  }

  _checkRunFields (row) {
    if ('status' in row && !RUN_STATUSES.includes(row.status)) throw new Error(`status must be one of: ${RUN_STATUSES.join(', ')}`)
    if ('review' in row && !RUN_REVIEWS.includes(row.review)) throw new Error(`review must be one of: ${RUN_REVIEWS.join(', ')}`)
    if ('meter_unit' in row && row.meter_unit != null && !METER_UNITS.includes(row.meter_unit)) {
      throw new Error(`meter_unit must be one of: ${METER_UNITS.join(', ')}`)
    }
  }

  _insertRun (row) {
    const cols = ['id', ...RUN_COLUMNS.filter((c) => c in row)]
    const bound = Object.fromEntries(cols.map((c) => [c, this._runValue(c, row[c])]))
    this.db.prepare(`INSERT INTO calibration_runs (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`).run(bound)
  }

  _runValue (column, value) {
    if (value === undefined) return null
    if (RUN_JSON_COLUMNS.includes(column)) return value === null ? null : JSON.stringify(value)
    if (column === 'estimate') return value ? 1 : 0
    return value
  }

  getRun (id) {
    return runFromRow(this.db.prepare('SELECT * FROM calibration_runs WHERE id = ?').get(id))
  }

  listRuns ({ deviceId } = {}) {
    const rows = deviceId
      ? this.db.prepare('SELECT * FROM calibration_runs WHERE device_id = ? ORDER BY started_at DESC, rowid DESC').all(deviceId)
      : this.db.prepare('SELECT * FROM calibration_runs ORDER BY started_at DESC, rowid DESC').all()
    return rows.map(runFromRow)
  }

  updateRun (id, patch) {
    if (!this.getRun(id)) throw new Error(`run not found: ${id}`)
    this._checkRunFields(patch)
    const cols = RUN_COLUMNS.filter((c) => c in patch)
    if (cols.length === 0) return this.getRun(id)
    const bound = Object.fromEntries(cols.map((c) => [c, this._runValue(c, patch[c])]))
    this.db.prepare(`UPDATE calibration_runs SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...bound, id })
    return this.getRun(id)
  }

  // Accepting or rejecting a finished run. Accepted runs feed the load
  // check; the decision is logged on the device the result is about.
  reviewRun (id, review) {
    const run = this.getRun(id)
    if (!run) throw new Error(`run not found: ${id}`)
    if (!['accepted', 'rejected'].includes(review)) throw new Error('review must be accepted or rejected')
    if (run.status !== 'done') throw new Error('only a finished run can be accepted or rejected')
    this.db.prepare('UPDATE calibration_runs SET review = ? WHERE id = ?').run(review, id)
    this._logChange('device', run.device_id, `calibration ${review}`, {
      runId: id, method: run.method, avgW: run.avg_w, peakW: run.peak_w, dutyCycle: run.duty_cycle
    })
    return this.getRun(id)
  }

  // The accepted run that currently describes a device: its own, or a group
  // run on a switch that lists it among its consumers. Newest first.
  latestAcceptedRun (deviceId) {
    const rows = this.db
      .prepare("SELECT * FROM calibration_runs WHERE review = 'accepted' AND status = 'done' ORDER BY ended_at DESC, started_at DESC, rowid DESC")
      .all()
    const found = rows.map(runFromRow).find((r) => r.device_id === deviceId ||
      (Array.isArray(r.consumer_ids) && r.consumer_ids.includes(deviceId)))
    return found || null
  }

  // Every device's latest accepted run at once, for listing.
  latestAcceptedRuns () {
    const rows = this.db
      .prepare("SELECT * FROM calibration_runs WHERE review = 'accepted' AND status = 'done' ORDER BY ended_at DESC, started_at DESC, rowid DESC")
      .all().map(runFromRow)
    const byDevice = new Map()
    for (const r of rows) {
      for (const id of new Set([r.device_id, ...(r.consumer_ids || [])])) {
        if (!byDevice.has(id)) byDevice.set(id, r)
      }
    }
    return byDevice
  }

  // A run still marked running when the plugin starts was cut short by a
  // stop or a crash: it can not be resumed, so it is marked failed.
  abandonRunningRuns () {
    return this.db.prepare(
      "UPDATE calibration_runs SET status = 'failed', ended_at = ?, error = 'The plugin stopped while the run was in progress.' WHERE status = 'running'"
    ).run(new Date().toISOString()).changes
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
    for (const table of ZONED_TABLES) {
      this.db.prepare(`UPDATE ${table} SET zone = ? WHERE zone_id = ?`).run(name, zoneId)
    }
  }

  zoneUsage (zoneId) {
    const count = (table) => this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE zone_id = ? AND status != 'removed'`)
      .get(zoneId).n
    return { devices: count('devices'), wireRuns: count('wire_runs'), conduits: count('conduits') }
  }

  // Zones are a plain list, not part of the removed-but-kept lifecycle, so
  // an unused zone is really deleted (and the deletion logged). Removed
  // devices and wire runs that still point at it are detached.
  deleteZone (zoneId) {
    const zone = this.get('zone', zoneId)
    if (!zone) throw new Error(`zone not found: ${zoneId}`)
    const usage = this.zoneUsage(zoneId)
    if (usage.devices + usage.wireRuns + usage.conduits > 0) {
      throw new Error(`zone in use by ${usage.devices} devices, ${usage.wireRuns} wire runs and ${usage.conduits} conduits: ${zone.name}`)
    }
    for (const table of ZONED_TABLES) {
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
      for (const kind of ZONED_KINDS) {
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
    // A device whose icon this was loses the icon, and the change is logged.
    const attachment = this.getAttachment(id)
    if (attachment && attachment.owner_type === 'device') {
      const device = this.get('device', attachment.owner_id)
      if (device && device.icon_attachment_id === id) {
        this.update('device', device.id, { icon_attachment_id: null })
      }
    }
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

module.exports = { Store, REMOVED_STATUS, DEVICE_ROLES, ICON_MIME_TYPES, CONDUCTOR_TYPES, METER_UNITS }
