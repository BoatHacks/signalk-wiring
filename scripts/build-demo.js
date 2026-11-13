'use strict'

// Builds demo/wiring.db, the fictional "Demo yacht", from demo/source/boat.json
// through the plugin's own Store, so the schema, the migrations and the
// validation are the real ones (plan 0035). Needs Node 22.13 or newer
// (node:sqlite).
//
//   node scripts/build-demo.js [output.db]
//
// The output is deterministic: ids come from names (a name based UUID), the
// ids of rows nobody names (terminals, conductors, circuits, schematic
// entries) come from a counter in creation order, and the change log is
// replaced by the short history of the spec with times counted back from the
// spec's fixed build date. There is no randomness and no clock.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { calibrationFor } = require('./demo-geometry')

const SPEC_PATH = path.join(__dirname, '..', 'demo', 'source', 'boat.json')
const DEFAULT_OUT = path.join(__dirname, '..', 'demo', 'wiring.db')
const POSITIONS_PATH = path.join(__dirname, '..', 'demo', 'source', 'positions.json')
const DRAWINGS_DIR = path.join(__dirname, '..', 'demo', 'source', 'drawings')

const DAY_MS = 24 * 60 * 60 * 1000

function nameUuid (text) {
  const h = crypto.createHash('sha1').update('signalk-wiring-demo:' + text).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

const CONDUCTORS = {
  pos: () => [{ conductor: 'positive', color: 'red' }],
  neg: () => [{ conductor: 'negative', color: 'black' }],
  sig: () => [{ conductor: 'signal', color: 'blue' }],
  ac: () => [{ conductor: 'line', color: 'brown' }, { conductor: 'neutral', color: 'blue' }, { conductor: 'earth', color: 'green/yellow' }]
}

// The terminal a conductor lands on: a string names the one for the first
// (positive or line) conductor, a map names one per conductor type.
function terminalFor (term, conductor, index) {
  if (!term) return null
  if (typeof term === 'string') return index === 0 ? term : null
  return term[conductor] || null
}

const DEVICE_FIELDS = {
  type: 'type', role: 'role', zone: 'zone', w: 'rated_power_w', pf: 'power_factor', trip: 'trip_rating_a',
  v: 'nominal_voltage', current: 'current', box: 'schematic_box_color', icon: 'schematic_icon_color',
  cap: 'capacity_ah', usable: 'usable_fraction', chem: 'chemistry', purpose: 'purpose', make: 'make_model',
  installed: 'installed_on', vPath: 'voltage_path', cPath: 'current_path', sPath: 'soc_path',
  path: 'signalk_path', meter: 'meter_path', meterUnit: 'meter_unit', notes: 'notes', switch: 'switch_path',
  confirm: 'confirm_switching'
}

// Expands the relay banks of the spec into devices and cables. A channel is a
// relay device that carries the SignalK switch path and the fuse rating of the
// channel, fed from its bank's bus and wired to the consumer it switches.
// Channel 1 of bank 13 is a contactor beside the bow thruster instead, fed
// from the thruster fuse (the device and the feed cable are in the spec).
function expandBanks (spec) {
  const devices = []
  const cables = []
  for (const b of spec.relayBanks) {
    const bus = `${b.enclosure} bus`
    devices.push({ name: bus, type: 'Bus bar', role: 'distribution', zone: 'Engine room', parent: b.enclosure })
    cables.push({ label: `F-${b.bank}a`, from: 'DC panel bus', to: b.feedFuse, gauge: 6, len: 0.3, kind: 'pos' })
    cables.push({ label: `F-${b.bank}`, from: b.feedFuse, to: bus, gauge: 6, len: 1, kind: 'pos' })
    for (const c of b.channels) {
      const path = `electrical.switches.bank.${b.bank}.${c.ch}.state`
      const where = `Bank ${b.bank} channel ${c.ch}`
      let relay = c.contactor
      if (!relay) {
        relay = `${c.consumer} relay (${b.bank}.${c.ch})`
        devices.push({ name: relay, type: 'Relay', role: 'distribution', zone: 'Engine room', trip: c.trip, switch: path, parent: b.enclosure })
        cables.push({ label: `B${b.bank}-${c.ch}a`, from: bus, to: relay, gauge: 2.5, len: 0.4, kind: 'pos' })
      }
      const cable = { label: `B${b.bank}-${c.ch}`, from: relay, to: c.consumer, gauge: c.gauge, len: c.len, kind: 'dc', switchRef: where }
      if (c.negFrom) cable.negFrom = c.negFrom
      cables.push(cable)
    }
  }
  return { devices, cables }
}

function conductorsOf (cable, negBus) {
  const out = CONDUCTORS[cable.kind === 'dc' ? 'pos' : cable.kind]()
  if (cable.kind === 'dc') {
    out.push({ conductor: 'negative', color: 'black', fromDeviceId: cable.negFrom || negBus, toDeviceId: cable.to })
  }
  return out
}

// ---- Layout: columns by depth from the supply, consumers in blocks per zone.

const COL_W = 280
const ROW_H = 96
const ROWS_PER_COLUMN = 9

function layoutPage (devices, cables, zoneBlocks) {
  const ids = new Set(devices.map((d) => d.name))
  const edges = cables.filter((c) => ids.has(c.from) && ids.has(c.to) && c.kind !== 'sig' && c.kind !== 'neg')
  const rank = new Map(devices.map((d) => [d.name, 0]))
  for (let pass = 0; pass < devices.length; pass++) {
    let changed = false
    for (const e of edges) {
      const next = rank.get(e.from) + 1
      if (next > rank.get(e.to) && next < devices.length) { rank.set(e.to, next); changed = true }
    }
    if (!changed) break
  }
  const spread = zoneBlocks ? devices.filter((d) => d.role !== 'consumer') : devices
  const maxRank = Math.max(0, ...spread.map((d) => rank.get(d.name)))
  const pos = new Map()
  const columnsUsed = []
  for (let r = 0; r <= maxRank; r++) {
    const inRank = spread.filter((d) => rank.get(d.name) === r)
    inRank.forEach((d, i) => {
      const sub = Math.floor(i / ROWS_PER_COLUMN)
      pos.set(d.name, { x: 40 + (r + sub * 0.5) * COL_W, y: 40 + (i % ROWS_PER_COLUMN) * ROW_H })
    })
    columnsUsed.push(Math.ceil(inRank.length / ROWS_PER_COLUMN))
  }
  const shapes = []
  if (zoneBlocks) {
    let x = 40 + (maxRank + 1.5) * COL_W + 120
    for (const zone of zoneBlocks) {
      const members = devices.filter((d) => d.role === 'consumer' && d.zone === zone)
      if (members.length === 0) continue
      const cols = Math.ceil(members.length / ROWS_PER_COLUMN)
      members.forEach((d, i) => {
        pos.set(d.name, { x: x + Math.floor(i / ROWS_PER_COLUMN) * 240, y: 80 + (i % ROWS_PER_COLUMN) * ROW_H })
      })
      const rows = Math.min(members.length, ROWS_PER_COLUMN)
      shapes.push({ zone, kind: 'rect', x: x - 30, y: 20, width: cols * 240 + 20, height: 80 + rows * ROW_H })
      x += cols * 240 + 60
    }
  }
  return { pos, shapes }
}

function buildDemo (outFile = DEFAULT_OUT) {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'))
  const positions = fs.existsSync(POSITIONS_PATH) ? JSON.parse(fs.readFileSync(POSITIONS_PATH, 'utf8')) : {}
  const { Store } = require('../src/store')

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(outFile + suffix, { force: true })

  // The store draws ids for rows nobody names from crypto.randomUUID; swap in a
  // counter for the duration of the build.
  const realRandomUuid = crypto.randomUUID
  let counter = 0
  crypto.randomUUID = () => nameUuid(`auto:${counter++}`)
  const realLog = Store.prototype._logChange
  Store.prototype._logChange = function () {} // the history comes from the spec

  const store = new Store(outFile)
  try {
    return populate(store, spec, positions, path.join(path.dirname(outFile), 'plans'))
  } finally {
    Store.prototype._logChange = realLog
    crypto.randomUUID = realRandomUuid
  }
}

function populate (store, spec, positions, plansDir) {
  const banks = expandBanks(spec)
  // A consumer fed through a remotely controlled relay channel carries that
  // channel's switch path too, so its page shows how it is switched.
  const channelPath = new Map()
  for (const b of spec.relayBanks) for (const c of b.channels) channelPath.set(c.consumer, `electrical.switches.bank.${b.bank}.${c.ch}.state`)
  const devices = [...spec.devices.map((d) => (channelPath.has(d.name) && !d.switch ? { ...d, switch: channelPath.get(d.name) } : d)), ...banks.devices]
  const cables = [...spec.cables, ...banks.cables]
  const negBus = spec.negativeBus

  // ---- Zones
  const zoneId = new Map()
  for (const name of spec.zones) {
    const id = nameUuid(`zone:${name}`)
    store.create('zone', { id, name })
    zoneId.set(name, id)
  }

  // ---- Plans: the drawings go into the plans folder as <planId>.svg.
  fs.mkdirSync(plansDir, { recursive: true })
  for (const p of spec.plans) {
    const id = nameUuid(`plan:${p.name}`)
    const filename = `${id}${path.extname(p.drawing)}`
    fs.copyFileSync(path.join(DRAWINGS_DIR, p.drawing), path.join(plansDir, filename))
    store.create('plan', {
      id,
      name: p.name,
      view: p.view,
      filename,
      z_min: p.zMin,
      z_max: p.zMax,
      calibration: JSON.stringify(calibrationFor(p.originPx, p.bowPx, spec.hullLengthM)),
      notes: p.notes
    })
  }

  // ---- Devices: enclosures first so what they hold can point at them.
  const deviceId = new Map(devices.map((d) => [d.name, nameUuid(`device:${d.name}`)]))
  const byName = new Map(devices.map((d) => [d.name, d]))
  for (const name of Object.keys(positions)) {
    const d = byName.get(name)
    if (!d) throw new Error(`positions: unknown device ${name}`)
    if (d.parent) throw new Error(`positions: ${name} is inside an enclosure and is not placed`)
  }
  const ordered = [...devices.filter((d) => d.role === 'enclosure'), ...devices.filter((d) => d.role !== 'enclosure')]
  for (const d of ordered) {
    const row = { id: deviceId.get(d.name), name: d.name }
    for (const [key, column] of Object.entries(DEVICE_FIELDS)) if (d[key] !== undefined) row[column] = d[key]
    if (d.zone) row.zone_id = zoneId.get(d.zone)
    delete row.zone
    if (d.parent) row.parent_id = deviceId.get(d.parent)
    const at = positions[d.name]
    if (at) for (const axis of ['x', 'y', 'z']) if (at[axis] !== undefined && at[axis] !== null) row[`pos_${axis}`] = at[axis]
    if (d.terminals) {
      row.terminals = d.terminals.map(([name, conductor, voltage, port]) => ({ name, conductor, voltage, port }))
    }
    store.create('device', row)
  }

  // ---- Cables
  const cableId = new Map()
  for (const c of cables) {
    if (!deviceId.has(c.from) || !deviceId.has(c.to)) throw new Error(`cable ${c.label}: unknown device`)
    const id = nameUuid(`cable:${c.label}`)
    cableId.set(c.label, id)
    const conductors = conductorsOf(c, deviceId.get(negBus) ? negBus : null).map((k, i) => ({
      conductor: k.conductor,
      color: k.color,
      fromDeviceId: k.conductor === 'negative' && k.fromDeviceId ? deviceId.get(k.fromDeviceId) : null,
      toDeviceId: k.conductor === 'negative' && k.toDeviceId ? deviceId.get(k.toDeviceId) : null,
      fromTerminal: terminalFor(c.fromTerm, k.conductor, i),
      toTerminal: terminalFor(c.toTerm, k.conductor, i)
    }))
    const row = {
      id,
      from_device_id: deviceId.get(c.from),
      to_device_id: deviceId.get(c.to),
      gauge: c.gauge,
      gauge_unit: 'mm2',
      length: c.len,
      length_unit: 'm',
      cable_label: c.label,
      conductors
    }
    if (c.switchRef) row.switch_ref = c.switchRef
    store.create('wireRun', row)
  }

  // A circuit with no fuse is named when its first cable exists, before the
  // consumer at the end does; give it the final name.
  const derived = store.deriveAll()
  for (const circuit of store.list('circuit')) {
    if (!/^Unprotected: [0-9a-f-]{36}$/.test(circuit.name)) continue
    const found = derived.circuits.find((c) => c.key === circuit.key)
    const names = found ? found.endDeviceIds.map((id) => store.get('device', id).name).sort() : []
    if (names.length > 0) store.update('circuit', circuit.id, { name: `Unprotected: ${names.join(', ')}` })
  }

  // ---- Conduits
  const conduitId = new Map()
  for (const c of spec.conduits) {
    const id = nameUuid(`conduit:${c.name}`)
    conduitId.set(c.name, id)
    store.create('conduit', { id, name: c.name, kind: c.kind, inner_diameter: c.id, diameter_unit: 'mm', zone_id: zoneId.get(c.zone) })
    for (const label of c.cables) {
      if (!cableId.has(label)) throw new Error(`conduit ${c.name}: unknown cable ${label}`)
      store.assignCable(id, cableId.get(label))
    }
  }

  // ---- Schematic pages: the top level pages, then one inside page per enclosure.
  const schematicId = new Map()
  const makePage = (name, page, fields) => {
    const id = nameUuid(`schematic:${name}`)
    schematicId.set(name, id)
    const { pos, shapes } = layoutPage(page.devices, cables, page.zoneBlocks)
    store.create('schematic', {
      id,
      name,
      ...fields,
      devices: page.devices.map((d) => ({ deviceId: deviceId.get(d.name), x: pos.get(d.name).x, y: pos.get(d.name).y })),
      zone_shapes: shapes.map((s) => ({ zoneId: zoneId.get(s.zone), kind: s.kind, x: s.x, y: s.y, width: s.width, height: s.height }))
    })
  }
  for (const p of spec.pages) {
    makePage(p.name, { devices: devices.filter((d) => !d.parent && (d.page || []).includes(p.page)), zoneBlocks: spec.zones }, { notes: p.notes })
  }
  for (const e of devices.filter((d) => d.role === 'enclosure')) {
    makePage(`${e.name} (inside)`, { devices: devices.filter((d) => d.parent === e.name) }, { enclosure_id: deviceId.get(e.name) })
  }

  replaceHistory(store, spec, { deviceId, cableId, conduitId, schematicId, zoneId, byName })

  // Leave a single file: no -wal or -shm next to it.
  store.db.pragma('wal_checkpoint(TRUNCATE)')
  store.db.pragma('journal_mode = DELETE')
  const version = store.db.pragma('user_version', { simple: true })
  store.close()
  return { version, devices: devices.length, cables: cables.length }
}

// The change log of a new database is empty here (the store was told not to
// log); the spec's history goes in with times counted back from the build date.
function replaceHistory (store, spec, ids) {
  const build = Date.parse(spec.buildDate)
  const kinds = { device: ids.deviceId, wireRun: ids.cableId, conduit: ids.conduitId, schematic: ids.schematicId, zone: ids.zoneId }
  const insert = store.db.prepare(
    'INSERT INTO change_log (id, record_type, record_id, timestamp, summary, diff_json) VALUES (?, ?, ?, ?, ?, ?)')
  store.db.exec('DELETE FROM change_log')
  spec.history.forEach((h, i) => {
    const [hh, mm] = h.at.split(':').map(Number)
    const day = new Date(build - h.daysAgo * DAY_MS)
    day.setUTCHours(hh, mm, 0, 0)
    const idOf = kinds[h.kind]
    const id = idOf.get(h.ref)
    if (!id) throw new Error(`history ${i}: unknown ${h.kind} ${h.ref}`)
    let summary = 'updated'
    let diff
    if (h.created) {
      summary = 'created'
      diff = { after: store.get(h.kind, id) }
    } else if (h.layout) {
      const now = store.get('schematic', id).devices.map((d) => d.deviceId).sort()
      const before = now.filter((x) => x !== ids.deviceId.get('Deck light'))
      diff = { devices: { before, after: now } }
    } else {
      diff = Object.fromEntries(Object.entries(h.diff).map(([k, [before, after]]) => [k, { before, after }]))
    }
    insert.run(nameUuid(`history:${i}`), h.kind, id, day.toISOString(), summary, JSON.stringify(diff))
  })
}

module.exports = { buildDemo, nameUuid, SPEC_PATH, DEFAULT_OUT }

if (require.main === module) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT
  const result = buildDemo(out)
  console.log(`built ${out}: schema version ${result.version}, ${result.devices} devices, ${result.cables} cables`)
}
