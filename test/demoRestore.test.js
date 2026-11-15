'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { restoreDemoData, BACKUP_NAME } = require('../src/demoRestore')

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-restore-'))
}
function write (dir, rel, text) {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}
function read (dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8')
}

test('without demo/wiring.db nothing is touched', () => {
  const dir = tmp()
  write(dir, 'wiring.db', 'mine')
  write(dir, 'plans/a.svg', 'p')
  const r = restoreDemoData(dir)
  assert.equal(r.restored, false)
  assert.equal(read(dir, 'wiring.db'), 'mine')
  assert.equal(read(dir, 'plans/a.svg'), 'p')
  assert.equal(fs.existsSync(path.join(dir, BACKUP_NAME)), false)
})

test('a directory named demo/wiring.db does not count', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'demo/wiring.db'), { recursive: true })
  write(dir, 'wiring.db', 'mine')
  assert.equal(restoreDemoData(dir).restored, false)
  assert.equal(read(dir, 'wiring.db'), 'mine')
})

test('the restore replaces the database, plans and attachments and removes -wal and -shm', () => {
  const dir = tmp()
  write(dir, 'demo/wiring.db', 'demo-db')
  write(dir, 'demo/plans/p1.svg', 'demo-plan')
  write(dir, 'demo/attachments/a1.pdf', 'demo-att')
  write(dir, 'wiring.db', 'mine')
  write(dir, 'wiring.db-wal', 'wal')
  write(dir, 'wiring.db-shm', 'shm')
  write(dir, 'plans/old.svg', 'old')
  write(dir, 'attachments/old.pdf', 'old')
  const r = restoreDemoData(dir)
  assert.deepEqual(r, { restored: true, backedUp: true, reason: null })
  assert.equal(read(dir, 'wiring.db'), 'demo-db')
  assert.equal(fs.existsSync(path.join(dir, 'wiring.db-wal')), false)
  assert.equal(fs.existsSync(path.join(dir, 'wiring.db-shm')), false)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'plans')), ['p1.svg'])
  assert.deepEqual(fs.readdirSync(path.join(dir, 'attachments')), ['a1.pdf'])
  assert.equal(read(dir, BACKUP_NAME), 'mine')
  assert.deepEqual(fs.readdirSync(dir).sort(), ['attachments', 'demo', 'plans', 'wiring.db', BACKUP_NAME].sort())
})

test('the first restore keeps the backup and later ones never overwrite it', () => {
  const dir = tmp()
  write(dir, 'demo/wiring.db', 'demo-db')
  write(dir, 'wiring.db', 'real')
  assert.equal(restoreDemoData(dir).backedUp, true)
  write(dir, 'wiring.db', 'edited during the demo')
  const second = restoreDemoData(dir)
  assert.equal(second.backedUp, false)
  assert.equal(read(dir, BACKUP_NAME), 'real')
  assert.equal(read(dir, 'wiring.db'), 'demo-db')
})

test('a first start without a current database makes no backup, and missing demo folders become empty folders', () => {
  const dir = tmp()
  write(dir, 'demo/wiring.db', 'demo-db')
  write(dir, 'plans/old.svg', 'old')
  const r = restoreDemoData(dir)
  assert.equal(r.restored, true)
  assert.equal(r.backedUp, false)
  assert.equal(fs.existsSync(path.join(dir, BACKUP_NAME)), false)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'plans')), [])
  assert.deepEqual(fs.readdirSync(path.join(dir, 'attachments')), [])
})

test('the demo folder itself is left as it was', () => {
  const dir = tmp()
  write(dir, 'demo/wiring.db', 'demo-db')
  write(dir, 'demo/plans/p.svg', 'x')
  restoreDemoData(dir)
  restoreDemoData(dir)
  assert.equal(read(dir, 'demo/wiring.db'), 'demo-db')
  assert.equal(read(dir, 'demo/plans/p.svg'), 'x')
})
