import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseCsv,
  parseGermanNumber,
  parseCombinedGauge,
  groupImportRows
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
