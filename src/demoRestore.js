'use strict'

const fs = require('fs')
const path = require('path')

const BACKUP_NAME = 'wiring.db.before-demo'

// Replaces a folder of the data directory by a copy of the demo one (or by an
// empty folder when the demo has none). The copy is made next to the target and
// renamed into place.
function replaceFolder (dataDir, demoDir, name) {
  const target = path.join(dataDir, name)
  const staging = path.join(dataDir, `${name}.demo-new`)
  fs.rmSync(staging, { recursive: true, force: true })
  const source = path.join(demoDir, name)
  if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
    fs.cpSync(source, staging, { recursive: true })
  } else {
    fs.mkdirSync(staging, { recursive: true })
  }
  fs.rmSync(target, { recursive: true, force: true })
  fs.renameSync(staging, target)
}

// Resets the working data to the demo boat. Only acts when
// <dataDir>/demo/wiring.db exists. The first time, the current wiring.db is
// kept as wiring.db.before-demo; that backup is never overwritten. Must run
// before the Store opens the database. Returns { restored, backedUp, reason }.
function restoreDemoData (dataDir) {
  const demoDir = path.join(dataDir, 'demo')
  const demoDb = path.join(demoDir, 'wiring.db')
  let isFile = false
  try { isFile = fs.statSync(demoDb).isFile() } catch (e) { /* none */ }
  if (!isFile) return { restored: false, backedUp: false, reason: 'no demo database' }

  const db = path.join(dataDir, 'wiring.db')
  const backup = path.join(dataDir, BACKUP_NAME)
  let backedUp = false
  if (fs.existsSync(db) && !fs.existsSync(backup)) {
    fs.copyFileSync(db, backup)
    backedUp = true
  }
  fs.rmSync(`${db}-wal`, { force: true })
  fs.rmSync(`${db}-shm`, { force: true })
  const staging = `${db}.demo-new`
  fs.copyFileSync(demoDb, staging)
  fs.renameSync(staging, db)
  replaceFolder(dataDir, demoDir, 'plans')
  replaceFolder(dataDir, demoDir, 'attachments')
  return { restored: true, backedUp, reason: null }
}

module.exports = { BACKUP_NAME, restoreDemoData }
