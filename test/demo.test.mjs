import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { checkAll, countVerdicts } from '../public/cableChecks.js'

const require = createRequire(import.meta.url)
const { buildDemo, SPEC_PATH, DEFAULT_OUT } = require('../scripts/build-demo.js')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-test-'))
const rebuilt = path.join(tmp, 'wiring.db')
const info = buildDemo(rebuilt)

const tablesOf = (file) => {
  const db = new DatabaseSync(file, { readOnly: true })
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name)
  const out = {}
  for (const name of names) {
    out[name] = db.prepare(`SELECT * FROM ${name}`).all().map((r) => JSON.stringify(r)).sort().map((r) => JSON.parse(r))
  }
  const version = db.prepare('PRAGMA user_version').get().user_version
  db.close()
  return { out, version }
}

// The resources the webapp reads, for the cable checks, from a copy of a database.
async function checkResults (file) {
  const copy = path.join(tmp, `copy-${Math.random().toString(36).slice(2)}.db`)
  fs.copyFileSync(file, copy)
  const store = new Store(copy)
  const list = async (kind, type) => Object.values(await createResourceProvider(store, kind, type).methods.listResources())
  const devices = await list('device', 'wiringDevices')
  const cables = await list('wireRun', 'wiringWireRuns')
  const conduits = await list('conduit', 'wiringConduits')
  const circuits = await list('circuit', 'wiringCircuits')
  const results = checkAll({ cables, circuits, devices, conduits })
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const label = (id) => cables.find((c) => c.id === id).cableLabel
  const bad = [...results].filter(([, r]) => r.verdict !== 'ok').map(([id, r]) => ({ label: label(id), verdict: r.verdict, missing: r.missing, result: r }))
  const view = { devices, cables, conduits, circuits, results, bad, deviceById, label }
  store.close()
  return view
}

test('the committed demo database has the same table contents as one built from the spec', () => {
  assert.ok(fs.existsSync(DEFAULT_OUT), 'demo/wiring.db is missing: run node scripts/build-demo.js')
  const committed = tablesOf(DEFAULT_OUT)
  const fresh = tablesOf(rebuilt)
  assert.equal(committed.version, fresh.version)
  assert.deepEqual(Object.keys(committed.out), Object.keys(fresh.out))
  for (const name of Object.keys(fresh.out)) assert.deepEqual(committed.out[name], fresh.out[name], `table ${name}`)
})

test('building twice gives the same database, and leaves no -wal or -shm file', () => {
  const again = path.join(tmp, 'again.db')
  buildDemo(again)
  assert.deepEqual(tablesOf(again).out, tablesOf(rebuilt).out)
  for (const file of [rebuilt, again, DEFAULT_OUT]) {
    assert.ok(!fs.existsSync(file + '-wal'), `${file}-wal`)
    assert.ok(!fs.existsSync(file + '-shm'), `${file}-shm`)
  }
})

test('the database has the schema version of the current code', () => {
  const probe = new Store(path.join(tmp, 'probe.db'))
  const latest = probe.db.pragma('user_version', { simple: true })
  probe.close()
  assert.equal(tablesOf(DEFAULT_OUT).version, latest)
  assert.equal(info.version, latest)
})

test('every SignalK path of the plan is on the boat', async () => {
  const { devices } = await checkResults(rebuilt)
  const paths = new Set()
  for (const d of devices) {
    for (const key of ['signalkPath', 'switchPath', 'meterPath', 'voltagePath', 'currentPath', 'socPath']) if (d[key]) paths.add(d[key])
  }
  const channels = { 10: 6, 11: 6, 12: 6, 13: 8 }
  for (const [bank, count] of Object.entries(channels)) {
    for (let ch = 1; ch <= count; ch++) assert.ok(paths.has(`electrical.switches.bank.${bank}.${ch}.state`), `bank ${bank} channel ${ch}`)
  }
  for (const name of ['house', 'starter', 'bowThruster']) {
    for (const suffix of ['voltage', 'current', 'capacity.stateOfCharge']) assert.ok(paths.has(`electrical.batteries.${name}.${suffix}`), `${name} ${suffix}`)
  }
  for (const name of ['bimini', 'deckPort', 'deckStarboard']) {
    assert.ok(paths.has(`electrical.solar.${name}`), `solar ${name}`)
    assert.ok(paths.has(`electrical.chargers.${name}`), `charger ${name}`)
  }
})

test('the relay channels light up in the live view: each consumer is switchable through its own channel', () => {
  const copy = path.join(tmp, 'live.db')
  fs.copyFileSync(rebuilt, copy)
  const store = new Store(copy)
  const live = store.deriveSwitching()
  const devices = store.list('device')
  const nameOf = new Map(devices.map((d) => [d.id, d]))
  const channelOf = new Map()
  for (const b of spec.relayBanks) for (const c of b.channels) channelOf.set(c.consumer, `electrical.switches.bank.${b.bank}.${c.ch}.state`)
  assert.equal(channelOf.size, 26)
  for (const [consumer, path_] of channelOf) {
    const device = devices.find((d) => d.name === consumer)
    const entry = live.consumers[device.id]
    assert.ok(entry.switchable, `${consumer} is switchable`)
    assert.equal(nameOf.get(entry.switchDeviceId).switch_path, path_, consumer)
    assert.deepEqual(entry.sharedWith, [], `${consumer} has its own switch`)
    assert.equal(entry.reason, null, consumer)
  }
  store.close()
})

test('the deliberate findings are there and every other cable passes', async () => {
  const { bad, results } = await checkResults(rebuilt)
  const summary = Object.fromEntries(bad.map((b) => [b.label, b]))
  assert.deepEqual(Object.keys(summary).sort(), ['B11-6', 'B13-3'], JSON.stringify(bad.map((b) => [b.label, b.verdict, b.missing])))
  // B13-3: bilge pump, long and thin, drop above the critical limit.
  assert.equal(summary['B13-3'].result.drop.verdict, 'warning')
  assert.equal(summary['B13-3'].result.drop.limitKind, 'critical')
  assert.ok(summary['B13-3'].result.drop.dropPercent > 3 && summary['B13-3'].result.drop.dropPercent < 10)
  // B11-6: deck wash pump, 25 A relay on a 1.5 mm2 cable.
  assert.equal(summary['B11-6'].result.ampacity.verdict, 'fail')
  assert.ok(summary['B11-6'].result.ampacity.issues.includes('protection'))
  const counts = countVerdicts(results)
  assert.equal(counts.cannot, 0)
  assert.equal(counts.fail + counts.warning, 2)
  assert.ok(counts.ok > 60)
})

test('signal cables are exempt from the checks', async () => {
  const { cables, results } = await checkResults(rebuilt)
  const signal = cables.filter((c) => c.conductors.every((k) => k.conductor === 'signal'))
  assert.ok(signal.length >= 4)
  for (const c of signal) assert.ok(!results.has(c.id), c.cableLabel)
})

test('the enclosures have inside pages with their contents', () => {
  const store = new Store((() => { const p = path.join(tmp, 'enc.db'); fs.copyFileSync(rebuilt, p); return p })())
  const devices = store.list('device')
  const pages = store.list('schematic')
  const enclosures = devices.filter((d) => d.role === 'enclosure')
  assert.deepEqual(enclosures.map((d) => d.name).sort(), ['AC panel', 'DC distribution panel', 'Relay bank 10', 'Relay bank 11', 'Relay bank 12', 'Relay bank 13'])
  for (const e of enclosures) {
    const page = pages.find((p) => p.enclosure_id === e.id)
    assert.ok(page, `${e.name} has an inside page`)
    const held = devices.filter((d) => d.parent_id === e.id)
    assert.ok(held.length >= 5, `${e.name} holds devices`)
    assert.deepEqual(page.devices.map((d) => d.deviceId).sort(), held.map((d) => d.id).sort(), e.name)
    assert.ok(store.enclosureInfo(e.id).boundaryCables.length >= 1, `${e.name} has boundary cables`)
  }
  assert.ok(pages.some((p) => p.name === '12 V DC' && !p.enclosure_id && p.zone_shapes.length >= 5))
  assert.ok(pages.some((p) => p.name === '230 V AC' && !p.enclosure_id))
  store.close()
})

test('the change log is a short history over the previous four weeks', () => {
  const db = new DatabaseSync(rebuilt, { readOnly: true })
  const rows = db.prepare('SELECT * FROM change_log ORDER BY timestamp').all()
  db.close()
  assert.equal(rows.length, spec.history.length)
  assert.ok(rows.length >= 15 && rows.length <= 25)
  assert.ok(new Set(rows.map((r) => r.record_type)).size >= 4)
  assert.ok(new Set(rows.map((r) => r.timestamp.slice(0, 10))).size >= 15)
  const build = Date.parse(spec.buildDate)
  for (const r of rows) {
    const age = (build - Date.parse(r.timestamp)) / 86400000
    assert.ok(age > 0 && age <= 28, r.timestamp)
    JSON.parse(r.diff_json)
  }
})

test('nothing from demo/ is in the npm package', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(pkg.files, ['index.js', 'src', 'public'])
})

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }) })
