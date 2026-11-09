'use strict'

// A thin SQLite handle on Node's built-in node:sqlite, with the two helpers the
// store uses beyond the standard API: pragma() and nestable transaction().
const { DatabaseSync } = require('node:sqlite')

const plain = (row) => (row ? { ...row } : row)

// node:sqlite returns rows with a null prototype; the store expects plain objects.
class Statement {
  constructor (stmt) { this._stmt = stmt }
  run (...args) { return this._stmt.run(...args) }
  get (...args) { return plain(this._stmt.get(...args)) }
  all (...args) { return this._stmt.all(...args).map(plain) }
  * iterate (...args) { for (const row of this._stmt.iterate(...args)) yield plain(row) }
}

class Database extends DatabaseSync {
  constructor (path) {
    super(path, { allowUnknownNamedParameters: true })
    this._txDepth = 0
  }

  prepare (sql) {
    return new Statement(super.prepare(sql))
  }

  // pragma('name = value') runs it; pragma('name', { simple: true }) returns the value.
  pragma (text, options) {
    const stmt = this.prepare(`PRAGMA ${text}`)
    if (options && options.simple) {
      const row = stmt.get()
      return row ? Object.values(row)[0] : undefined
    }
    return stmt.all()
  }

  // Returns a function that runs fn in a transaction; nested calls become savepoints.
  transaction (fn) {
    return (...args) => {
      const depth = this._txDepth
      const name = `sp_${depth}`
      this.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`)
      this._txDepth = depth + 1
      try {
        const result = fn(...args)
        this._txDepth = depth
        this.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
        return result
      } catch (err) {
        this._txDepth = depth
        try {
          this.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`)
        } catch (_) { /* the transaction is already gone */ }
        throw err
      }
    }
  }
}

module.exports = { Database }
