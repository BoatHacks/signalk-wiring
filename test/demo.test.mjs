import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { checkAll, countVerdicts } from '../public/cableChecks.js'
import { axesForView, calibrationFromClicks, metersToPx, pointToPx, pxToMeters, planShowsPoint } from '../public/floorplan.js'

const require = createRequire(import.meta.url)
const { buildDemo, SPEC_PATH, DEFAULT_OUT } = require('../scripts/build-demo.js')
const { Store } = require('../src/store')
const { pointInPolygon, readHull } = require('../scripts/demo-geometry.js')
const { nameUuid } = require('../scripts/build-demo.js')
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
    assert.equal(device.switch_path, path_, `${consumer} carries its channel's switch path`)
    assert.deepEqual(entry.sharedWith, [], `${consumer} has its own switch`)
    assert.equal(entry.reason, null, consumer)
  }
  store.close()
})

test('the deliberate findings are there and every other cable passes', async () => {
  const { bad, results } = await checkResults(rebuilt)
  const summary = Object.fromEntries(bad.map((b) => [b.label, b]))
  // The three PV input cables (array to charge controller) have no fuse of their own, so they cannot be checked.
  assert.deepEqual(Object.keys(summary).sort(), ['B11-6', 'B13-3', 'S-01', 'S-11', 'S-21'], JSON.stringify(bad.map((b) => [b.label, b.verdict, b.missing])))
  for (const l of ['S-01', 'S-11', 'S-21']) assert.equal(summary[l].verdict, 'cannot', l)
  // B13-3: bilge pump, long and thin, drop above the critical limit.
  assert.equal(summary['B13-3'].result.drop.verdict, 'warning')
  assert.equal(summary['B13-3'].result.drop.limitKind, 'critical')
  assert.ok(summary['B13-3'].result.drop.dropPercent > 3 && summary['B13-3'].result.drop.dropPercent < 10)
  // B11-6: deck wash pump, 25 A relay on a 1.5 mm2 cable.
  assert.equal(summary['B11-6'].result.ampacity.verdict, 'fail')
  assert.ok(summary['B11-6'].result.ampacity.issues.includes('protection'))
  const counts = countVerdicts(results)
  assert.equal(counts.cannot, 3)
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
  assert.deepEqual(enclosures.map((d) => d.name).sort(), ['AC panel', 'DC distribution panel', 'Relay bank 10', 'Relay bank 11', 'Relay bank 12', 'Relay bank 13', 'Switch panel'])
  for (const e of enclosures) {
    const page = pages.find((p) => p.enclosure_id === e.id)
    assert.ok(page, `${e.name} has an inside page`)
    const held = devices.filter((d) => d.parent_id === e.id)
    assert.ok(held.length >= 3, `${e.name} holds devices`)
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

// ---- Floorplans and positions (plan 0035 step 3)

const demoDir = path.join(path.dirname(DEFAULT_OUT))
const positions = JSON.parse(fs.readFileSync(path.join(demoDir, 'source', 'positions.json'), 'utf8'))
const planRows = () => {
  const p = path.join(tmp, `plans-${Math.random().toString(36).slice(2)}.db`)
  fs.copyFileSync(rebuilt, p)
  const store = new Store(p)
  const out = { plans: store.list('plan'), devices: store.list('device'), zones: store.list('zone'), store }
  return out
}
const asPlan = (row) => ({ view: row.view, zMin: row.z_min, zMax: row.z_max })
const drawingSize = (file) => {
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(fs.readFileSync(file, 'utf8'))
  return { width: Number(m[1]), height: Number(m[2]) }
}

test('the four plans exist with their drawings, calibrations and height ranges', () => {
  const { plans, store } = planRows()
  store.close()
  assert.deepEqual(plans.map((p) => [p.name, p.view]).sort((a, b) => a[0].localeCompare(b[0])), [['Deck', 'top'], ['Interior', 'top'], ['Interior profile', 'side'], ['Side profile', 'side']])
  for (const p of plans) {
    assert.equal(p.id, nameUuid(`plan:${p.name}`))
    assert.equal(p.filename, `${p.id}.svg`)
    const file = path.join(demoDir, 'plans', p.filename)
    assert.ok(fs.existsSync(file), p.filename)
    const source = spec.plans.find((x) => x.name === p.name)
    assert.ok(fs.readFileSync(file).equals(fs.readFileSync(path.join(demoDir, 'source', 'drawings', source.drawing))), `${p.name}: drawing is byte for byte the supplied one`)
    const cal = JSON.parse(p.calibration)
    assert.ok(cal.pxPerMeter > 10 && cal.pxPerMeter < 500, p.name)
    assert.deepEqual(cal.dir, [1, 0], `${p.name}: the bow points to the right`)
    assert.equal(cal.flip, false)
    assert.ok(p.z_min < p.z_max, p.name)
    assert.ok(axesForView(p.view))
  }
  const byName = Object.fromEntries(plans.map((p) => [p.name, p]))
  assert.deepEqual([byName.Deck.z_min, byName.Deck.z_max], [1, 15])
  assert.deepEqual([byName.Interior.z_min, byName.Interior.z_max], [-1.5, 1])
})

test('a drawing point maps to the expected meters and back with the app functions', () => {
  const { plans, store } = planRows()
  store.close()
  for (const p of plans) {
    const cal = JSON.parse(p.calibration)
    const source = spec.plans.find((x) => x.name === p.name)
    // The stern end of the hull outline is the origin, the bow end is the hull length.
    const stern = pxToMeters(cal, source.originPx)
    const bow = pxToMeters(cal, source.bowPx)
    assert.ok(Math.abs(stern[0]) < 1e-6 && Math.abs(stern[1]) < 1e-6, `${p.name} origin`)
    assert.ok(Math.abs(bow[0] - spec.hullLengthM) < 1e-4 && Math.abs(bow[1]) < 1e-6, `${p.name} bow ${bow}`)
    // The same numbers the app derives from the two clicks.
    const clicked = calibrationFromClicks(source.originPx, source.bowPx, spec.hullLengthM)
    assert.ok(Math.abs(clicked.pxPerMeter - cal.pxPerMeter) < 1e-4)
    assert.deepEqual(clicked.dir, cal.dir)
    // One meter up (port on a top view, higher on a side view) is up the drawing.
    const up = metersToPx(cal, 0, 1)
    assert.ok(up[1] < source.originPx[1] && Math.abs(up[0] - source.originPx[0]) < 1e-9, p.name)
    // 5 m from the stern and 0.5 m up: and back.
    const px = metersToPx(cal, 5, 0.5)
    const back = pxToMeters(cal, px)
    assert.ok(Math.abs(back[0] - 5) < 1e-9 && Math.abs(back[1] - 0.5) < 1e-9, p.name)
    const view = p.view
    const at = view === 'top' ? { x: 5, y: 0.5, z: 0.5 } : { x: 5, y: 0, z: 0.5 }
    assert.deepEqual(pointToPx(cal, view, at), px)
  }
  // A known deck point: the end of the centerline of the deck drawing at the bow.
  const deck = plans.find((p) => p.name === 'Deck')
  const [x, y] = pxToMeters(JSON.parse(deck.calibration), [1388, 329])
  assert.ok(Math.abs(x - 10.9) < 1e-4 && Math.abs(y) < 1e-9)
})

test('placed devices carry the position of positions.json, unplaced ones have none, and enclosure contents are never placed', () => {
  const { devices, store } = planRows()
  store.close()
  for (const d of devices) {
    const placed = d.pos_x != null && d.pos_y != null && d.pos_z != null
    if (d.parent_id) assert.ok(d.pos_x == null && d.pos_y == null && d.pos_z == null, `${d.name} is inside an enclosure and stays unplaced`)
    else if (!placed) assert.equal(positions[d.name], undefined, `${d.name} is unplaced and has no entry`)
    if (!d.parent_id && placed) assert.deepEqual({ x: d.pos_x, y: d.pos_y, z: d.pos_z }, positions[d.name], d.name)
  }
  assert.equal(Object.keys(positions).length, devices.filter((d) => !d.parent_id && d.pos_x != null).length)
  assert.ok(devices.filter((d) => d.role === 'enclosure').every((d) => d.pos_x != null), 'enclosure markers are placed')
})

test('no two devices share a position', () => {
  const seen = new Map()
  for (const [name, p] of Object.entries(positions)) {
    const key = `${p.x},${p.y},${p.z}`
    assert.ok(!seen.has(key), `${name} and ${seen.get(key)} at ${key}`)
    seen.set(key, name)
  }
  // Nor two on the same spot of a top view (centimeter apart or less).
  const flat = Object.entries(positions)
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i][1]
      const b = flat[j][1]
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.02) assert.ok(Math.abs(a.z - b.z) >= 0.2, `${flat[i][0]} and ${flat[j][0]} stacked`)
    }
  }
})

test('every device shows inside the hull of at least one plan, and every plan has devices', () => {
  const { plans, devices, store } = planRows()
  store.close()
  const shown = new Map(plans.map((p) => [p.name, 0]))
  const hulls = new Map()
  for (const p of plans) hulls.set(p.name, readHull(path.join(demoDir, 'plans', p.filename)))
  for (const d of devices.filter((x) => !x.parent_id)) {
    if (d.pos_x == null) continue // the user may leave a device unplaced (a bus, for example)
    const point = { x: d.pos_x, y: d.pos_y, z: d.pos_z }
    assert.ok(point.x > 0 && point.x < spec.hullLengthM, `${d.name} x ${point.x}`)
    let inHull = false
    for (const p of plans) {
      const cal = JSON.parse(p.calibration)
      if (!planShowsPoint(asPlan(p), point)) continue
      const px = pointToPx(cal, p.view, point)
      const size = drawingSize(path.join(demoDir, 'plans', p.filename))
      const inView = px[0] >= 0 && px[0] <= size.width && px[1] >= 0 && px[1] <= size.height
      if (p.view === 'top' && pointInPolygon(hulls.get(p.name), px)) { inHull = true; shown.set(p.name, shown.get(p.name) + 1) }
      // Below the deck it also lies in the hull of the interior profile.
      if (p.name === 'Interior profile' && point.z <= 1.0) assert.ok(pointInPolygon(hulls.get(p.name), px), `${d.name} is outside the interior profile`)
      // Masthead items may sit at or above the top edge of the exterior profile; that is the user's choice.
    }
    assert.ok(inHull, `${d.name} at ${JSON.stringify(point)} is on no top plan hull`)
  }
  for (const [name, n] of shown) if (name === 'Deck' || name === 'Interior') assert.ok(n >= 10, `${name} shows ${n} devices`)
  // Where it belongs: below the deck on the interior plan, at and above it on the deck plan.
  const interior = plans.find((p) => p.name === 'Interior')
  const deck = plans.find((p) => p.name === 'Deck')
  for (const d of devices.filter((x) => !x.parent_id && x.pos_x != null)) {
    const point = { x: d.pos_x, y: d.pos_y, z: d.pos_z }
    if (point.z < 1) assert.ok(planShowsPoint(asPlan(interior), point) && !planShowsPoint(asPlan(deck), point), d.name)
    else assert.ok(planShowsPoint(asPlan(deck), point) && !planShowsPoint(asPlan(interior), point), d.name)
  }
})

test('positions.json only names devices of the spec that are not inside an enclosure', () => {
  const place = require('../scripts/place-demo.js')
  const byName = new Map(spec.devices.map((d) => [d.name, d]))
  for (const name of Object.keys(positions)) {
    assert.ok(byName.has(name), `${name} is a device of the spec`)
    assert.ok(!byName.get(name).parent, `${name} is not inside an enclosure`)
  }
  // the first-pass generator still refuses a zone without a box
  assert.throws(() => place.place({ devices: [{ name: 'X', zone: 'Nowhere' }] }), /no box/)
})

test('read-positions turns a server listing into positions.json entries', () => {
  const { positionsOf } = require('../scripts/read-positions.js')
  const listing = {
    a: { name: 'B', posX: 1, posY: 0, posZ: 2 },
    b: { name: 'A', posX: 3.5, posY: null, posZ: null },
    c: { name: 'Inside', parentId: 'x', posX: 1 },
    d: { name: 'Gone', status: 'removed', posX: 1 },
    e: { name: 'Unplaced' }
  }
  assert.deepEqual(positionsOf(listing), { A: { x: 3.5 }, B: { x: 1, y: 0, z: 2 } })
  assert.deepEqual(Object.keys(positionsOf(listing)), ['A', 'B'])
})

test('npm pack leaves out demo/ and the files list is unchanged', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })
  const parsed = JSON.parse(out)
  const files = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]).files.map((f) => f.path)
  assert.ok(files.length > 10)
  assert.deepEqual(files.filter((f) => f.startsWith('demo/') || f.startsWith('scripts/')), [])
  assert.ok(files.includes('index.js'))
})

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }) })
