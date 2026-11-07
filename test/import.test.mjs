import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseCsv,
  parseGermanNumber,
  parseCombinedGauge,
  groupImportRows,
  parseConduitNames,
  MAPPING_TARGETS
} from '../public/import.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('parseCsv splits fields and handles a quoted field with an embedded comma', () => {
  const { headers, rows } = parseCsv('Name,Gauge\nBilge pump,"2,5 mm²"\n')
  assert.deepEqual(headers, ['Name', 'Gauge'])
  assert.deepEqual(rows, [{ Name: 'Bilge pump', Gauge: '2,5 mm²' }])
})

test('parseCsv handles escaped quotes inside a quoted field', () => {
  const { rows } = parseCsv('Name,Notes\nPump,"Say ""hi"""\n')
  assert.equal(rows[0].Notes, 'Say "hi"')
})

test('parseCsv uniquifies duplicate and blank header names', () => {
  const { headers } = parseCsv('A,B,,B\nx,y,z,w\n')
  assert.deepEqual(headers, ['A', 'B', 'Column 3', 'B (2)'])
})

test('parseCsv works without a trailing newline', () => {
  const { rows } = parseCsv('Name\nPump')
  assert.deepEqual(rows, [{ Name: 'Pump' }])
})

test('parseGermanNumber handles comma decimals, plain decimals, and thousands separators', () => {
  assert.equal(parseGermanNumber('2,5'), 2.5)
  assert.equal(parseGermanNumber('6.92'), 6.92)
  assert.equal(parseGermanNumber('1.234,5'), 1234.5)
  assert.equal(parseGermanNumber(''), null)
  assert.equal(parseGermanNumber(null), null)
  assert.equal(parseGermanNumber('not a number'), null)
})

test('parseCombinedGauge extracts number + unit from "2,5 mm²" and "14 AWG"', () => {
  assert.deepEqual(parseCombinedGauge('2,5 mm²'), { gauge: 2.5, unit: 'mm2' })
  assert.deepEqual(parseCombinedGauge('6 mm²'), { gauge: 6, unit: 'mm2' })
  assert.deepEqual(parseCombinedGauge('14 AWG'), { gauge: 14, unit: 'AWG' })
  assert.equal(parseCombinedGauge(''), null)
  assert.equal(parseCombinedGauge('no gauge here'), null)
})

test('groupImportRows requires a device name mapping', () => {
  const result = groupImportRows([{ Name: 'x' }], ['Name'], {})
  assert.match(result.error, /Device: name/)
})

test('groupImportRows groups rows sharing a circuit key into one circuit with multiple wire runs', () => {
  const headers = ['Device', 'Fuse']
  const rows = [
    { Device: 'Nav Bug', Fuse: '1' },
    { Device: 'Nav Heck', Fuse: '1' },
    { Device: 'Anchor light', Fuse: '2' }
  ]
  const mapping = { Device: 'deviceName', Fuse: 'circuitGroupKey' }
  const grouped = groupImportRows(rows, headers, mapping)

  assert.equal(grouped.circuits.length, 2)
  assert.equal(grouped.devices.length, 3)
  assert.equal(grouped.wireRuns.length, 3)
  assert.equal(grouped.circuits.find((c) => c.name === 'Circuit 1').tempId,
    grouped.wireRuns.find((wr) => wr.deviceTempId === grouped.devices[0].tempId).circuitTempId)
})

test('groupImportRows: without a grouping column, every row gets its own circuit', () => {
  const rows = [{ Device: 'A' }, { Device: 'B' }]
  const grouped = groupImportRows(rows, ['Device'], { Device: 'deviceName' })
  assert.equal(grouped.circuits.length, 2)
  assert.equal(grouped.circuits[0].name, 'A circuit')
})

test('groupImportRows de-duplicates a device name repeated across rows within the batch', () => {
  const rows = [
    { Device: 'Autopilot', Fuse: '1' },
    { Device: 'Autopilot', Fuse: '2' }
  ]
  const mapping = { Device: 'deviceName', Fuse: 'circuitGroupKey' }
  const grouped = groupImportRows(rows, ['Device', 'Fuse'], mapping)
  assert.equal(grouped.devices.length, 1)
  assert.equal(grouped.wireRuns.length, 2)
  assert.equal(grouped.wireRuns[0].deviceTempId, grouped.wireRuns[1].deviceTempId)
})

test('groupImportRows: wireRun.fromEndpoint falls back to the circuit source label, then "Source"', () => {
  const withSource = groupImportRows(
    [{ Device: 'A', Source: 'Breaker 4' }],
    ['Device', 'Source'],
    { Device: 'deviceName', Source: 'circuitSourceLabel' }
  )
  assert.equal(withSource.wireRuns[0].fromEndpoint, 'Breaker 4')

  const withoutSource = groupImportRows([{ Device: 'A' }], ['Device'], { Device: 'deviceName' })
  assert.equal(withoutSource.wireRuns[0].fromEndpoint, 'Source')
})

test('groupImportRows skips rows with no device name and counts them', () => {
  const rows = [{ Device: 'A' }, { Device: '' }, { Device: '  ' }]
  const grouped = groupImportRows(rows, ['Device'], { Device: 'deviceName' })
  assert.equal(grouped.devices.length, 1)
  assert.equal(grouped.skippedRows, 2)
})

test('real-world fixture: the tinarasia/laserbrain electrical CSV this feature was built for', () => {
  const csvText = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'tinarasia-electrical.csv'),
    'utf8'
  )
  const { headers, rows } = parseCsv(csvText)

  // The header's "Sicherung" appears twice; parseCsv must keep the
  // fuse-group column as plain "Sicherung" and rename the second
  // (a running per-row tally, unrelated) to "Sicherung (2)" — mapping
  // the wrong one would silently produce nonsense circuit grouping.
  assert.ok(headers.includes('Sicherung'))
  assert.ok(headers.includes('Sicherung (2)'))
  assert.equal(rows.length, 27)

  const mapping = {
    Verbraucher: 'deviceName',
    Sicherung: 'circuitGroupKey',
    'Leistung in W': 'deviceRatedPowerW',
    Kabellänge: 'wireLength',
    Querschnitt: 'wireGaugeCombined',
    'LS-Größe': 'circuitBreakerRating'
  }
  const grouped = groupImportRows(rows, headers, mapping)

  assert.equal(grouped.devices.length, 27)
  assert.equal(grouped.wireRuns.length, 27)
  assert.equal(grouped.skippedRows, 0)

  // Self-checking rather than a hand-counted magic number: every row
  // with a blank grouping value gets its own circuit (Kühlschrank has
  // no Sicherung in the source file), everything else groups by value.
  const nonBlankGroups = new Set(rows.map((r) => r.Sicherung).filter((v) => v && v.trim())).size
  const blankGroupRows = rows.filter((r) => !r.Sicherung || !r.Sicherung.trim()).length
  assert.equal(grouped.circuits.length, nonBlankGroups + blankGroupRows)

  // Spot check a real group: fuse "2" feeds Toplicht/Decklampe/Ankerlaterne.
  const circuit2 = grouped.circuits.find((c) => c.name === 'Circuit 2')
  assert.ok(circuit2)
  const circuit2WireRuns = grouped.wireRuns.filter((wr) => wr.circuitTempId === circuit2.tempId)
  assert.equal(circuit2WireRuns.length, 3)
  assert.equal(circuit2.breakerRating, 25) // LS-Größe of the first row in that group (Toplicht)

  // Spot check combined-gauge parsing against real cells: "2,5 mm²" and "6 mm²".
  const fridgeDevice = grouped.devices.find((d) => d.name === 'Kühlschrank')
  assert.ok(fridgeDevice)
  const fridgeWireRun = grouped.wireRuns.find((wr) => wr.deviceTempId === fridgeDevice.tempId)
  assert.equal(fridgeWireRun.gauge, 6)
  assert.equal(fridgeWireRun.gaugeUnit, 'mm2')

  const naviBugDevice = grouped.devices.find((d) => d.name === 'Navi Bug')
  const naviBugWireRun = grouped.wireRuns.find((wr) => wr.deviceTempId === naviBugDevice.tempId)
  assert.equal(naviBugWireRun.gauge, 2.5)
  assert.equal(naviBugWireRun.gaugeUnit, 'mm2')
  assert.equal(naviBugDevice.ratedPowerW, 2)
})

// Conduit column (plan 0015)

test('parseConduitNames splits on ; and >, trims, and drops blanks and repeats', () => {
  assert.deepEqual(parseConduitNames('Galley conduit'), ['Galley conduit'])
  assert.deepEqual(parseConduitNames(' A ; B > a ;; C '), ['A', 'B', 'C'])
  assert.deepEqual(parseConduitNames(''), [])
  assert.deepEqual(parseConduitNames(null), [])
  // A comma is part of a name, not a separator.
  assert.deepEqual(parseConduitNames('Hose 1, port'), ['Hose 1, port'])
})

test('the conduit column is an import target', () => {
  assert.ok(MAPPING_TARGETS.some((t) => t.value === 'wireConduit'))
})

test('groupImportRows: a conduit column names the conduits of each wire run, once per conduit', () => {
  const headers = ['Device', 'Conduit']
  const rows = [
    { Device: 'A', Conduit: 'Galley conduit' },
    { Device: 'B', Conduit: 'galley CONDUIT; Mast hose' },
    { Device: 'C', Conduit: '' }
  ]
  const grouped = groupImportRows(rows, headers, { Device: 'deviceName', Conduit: 'wireConduit' })
  assert.deepEqual(grouped.conduits.map((c) => c.name), ['Galley conduit', 'Mast hose'])
  assert.ok(grouped.conduits.every((c) => c.existingId === null))
  const [a, b, c] = grouped.wireRuns
  assert.deepEqual(a.conduitTempIds, [grouped.conduits[0].tempId])
  assert.deepEqual(b.conduitTempIds, [grouped.conduits[0].tempId, grouped.conduits[1].tempId])
  assert.deepEqual(c.conduitTempIds, [])
})

test('groupImportRows: a conduit that already exists (live, any case) is reused, not created again', () => {
  const existing = [
    { id: 'k1', name: 'Galley Conduit', status: 'active' },
    { id: 'k2', name: 'Old hose', status: 'removed' }
  ]
  const rows = [{ Device: 'A', Conduit: 'galley conduit; Old hose' }]
  const grouped = groupImportRows(rows, ['Device', 'Conduit'], { Device: 'deviceName', Conduit: 'wireConduit' }, existing)
  assert.equal(grouped.conduits.length, 2)
  assert.equal(grouped.conduits[0].existingId, 'k1')
  assert.equal(grouped.conduits[0].name, 'Galley Conduit')
  assert.equal(grouped.conduits[1].existingId, null) // removed ones are not reused
})

test('groupImportRows without a conduit column makes no conduits', () => {
  const grouped = groupImportRows([{ Device: 'A' }], ['Device'], { Device: 'deviceName' })
  assert.deepEqual(grouped.conduits, [])
  assert.deepEqual(grouped.wireRuns[0].conduitTempIds, [])
})

test('importToStore writes new conduits first, reuses existing ones, and lists them on each cable in order', async () => {
  const { importToStore } = await import('../public/import.js')
  const writes = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    writes.push({ url: String(url).replace('/signalk/v2/api/resources/', ''), body: JSON.parse(init.body) })
    return { ok: true, status: 200 }
  }
  try {
    const existing = [{ id: 'k-old', name: 'Galley conduit', status: 'active' }]
    const rows = [
      { Device: 'A', Conduit: 'Galley conduit; Mast hose' },
      { Device: 'B', Conduit: 'Mast hose' }
    ]
    const grouped = groupImportRows(rows, ['Device', 'Conduit'], { Device: 'deviceName', Conduit: 'wireConduit' }, existing)
    const result = await importToStore(grouped)
    assert.equal(result.conduitsCreated, 1)

    const conduitWrites = writes.filter((w) => w.url.startsWith('wiringConduits/'))
    assert.equal(conduitWrites.length, 1)
    assert.equal(conduitWrites[0].body.name, 'Mast hose')
    const newConduitId = conduitWrites[0].url.split('/')[1]
    const firstRunWrite = writes.findIndex((w) => w.url.startsWith('wiringWireRuns/'))
    assert.ok(writes.indexOf(conduitWrites[0]) < firstRunWrite)

    const runs = writes.filter((w) => w.url.startsWith('wiringWireRuns/')).map((w) => w.body)
    assert.deepEqual(runs[0].conduitIds, ['k-old', newConduitId])
    assert.deepEqual(runs[1].conduitIds, [newConduitId])
  } finally {
    globalThis.fetch = realFetch
  }
})
