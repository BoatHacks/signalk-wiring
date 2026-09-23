'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')

const TABLES = {
  circuit: {
    table: 'circuits',
    columns: ['id', 'name', 'source', 'panel_ref', 'convention', 'status', 'notes']
  },
  wireRun: {
    table: 'wire_runs',
    columns: [
      'id', 'circuit_id', 'from_endpoint', 'to_endpoint', 'gauge', 'gauge_unit',
      'color', 'length', 'zone', 'status', 'notes'
    ]
  },
  device: {
    table: 'devices',
    columns: ['id', 'name', 'type', 'zone', 'status', 'notes']
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
  }

  close () {
    this.db.close()
  }

  create (kind, fields) {
    const { table, columns } = TABLES[kind]
    const id = fields.id || crypto.randomUUID()
    const row = { ...fields, id, status: fields.status || 'active' }
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
    return this.db.prepare(`SELECT * FROM ${table}`).all()
  }

  update (kind, id, patch) {
    const existing = this.get(kind, id)
    if (!existing) return null

    const { table, columns } = TABLES[kind]
    const cols = columns.filter((c) => c !== 'id' && c in patch)
    if (cols.length === 0) return existing

    const assignments = cols.map((c) => `${c} = @${c}`).join(', ')
    this.db
      .prepare(`UPDATE ${table} SET ${assignments} WHERE id = @id`)
      .run({ ...patch, id })

    const updated = this.get(kind, id)
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

module.exports = { Store, REMOVED_STATUS }
