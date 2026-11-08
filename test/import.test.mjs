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
  parseConductor,
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

test('groupImportRows: a cable goes from the supply device to the row device, devices matched by name once', () => {
  const rows = [
    { Device: 'Lamp', Fuse: 'Lamp fuse' },
    { Device: 'lamp', Fuse: 'LAMP FUSE' },
    { Device: 'Pump', Fuse: 'Lamp fuse' }
  ]
  const g = groupImportRows(rows, ['Device', 'Fuse'], { Device: 'deviceName', Fuse: 'circuitSourceLabel' })
  assert.deepEqual(g.devices.map((d) => [d.name, d.role]), [['Lamp', 'consumer'], ['Lamp fuse', 'distribution'], ['Pump', 'consumer']])
  assert.equal(g.wireRuns.length, 3)
  assert.equal(g.wireRuns[0].fromTempId, g.wireRuns[2].fromTempId)
  assert.equal(g.wireRuns[0].toTempId, g.wireRuns[1].toTempId)
})

test('groupImportRows: existing devices are matched by name, ignoring case, and not created again', () => {
  const existing = [
    { id: 'd1', name: 'Lamp Fuse', status: 'active' },
    { id: 'd2', name: 'Pump', status: 'removed' }
  ]
  const g = groupImportRows(
    [{ Device: 'Pump', Fuse: 'lamp fuse' }], ['Device', 'Fuse'],
    { Device: 'deviceName', Fuse: 'circuitSourceLabel' }, [], existing
  )
  assert.equal(g.devices.find((d) => d.name === 'Lamp Fuse').existingId, 'd1')
  assert.equal(g.devices.find((d) => d.name === 'Pump').existingId, null) // removed ones are not reused
})

test('groupImportRows: explicit from and to columns win, and the conductor column is read', () => {
  const g = groupImportRows(
    [{ A: 'Bus', B: 'Pump', Fuse: 'ignored', C: 'minus' }], ['A', 'B', 'Fuse', 'C'],
    { A: 'wireFromDevice', B: 'wireToDevice', Fuse: 'circuitSourceLabel', C: 'wireConductor' }
  )
  assert.deepEqual(g.devices.map((d) => d.name), ['Pump', 'Bus'])
  assert.equal(g.wireRuns[0].conductor, 'negative')
})

test('parseConductor knows the five types and common words, defaulting to positive', () => {
  assert.equal(parseConductor('Negative'), 'negative')
  assert.equal(parseConductor('+'), 'positive')
  assert.equal(parseConductor('PE'), 'earth')
  assert.equal(parseConductor('L'), 'line')
  assert.equal(parseConductor('N'), 'neutral')
  assert.equal(parseConductor(''), 'positive')
  assert.equal(parseConductor('purple'), 'positive')
})

test('groupImportRows: rows sharing a circuit key share a fuse made from the key', () => {
  const rows = [
    { Device: 'A', Fuse: '2', Rating: '10' },
    { Device: 'B', Fuse: '2', Rating: '16' },
    { Device: 'C', Fuse: '3', Rating: '5' }
  ]
  const g = groupImportRows(rows, ['Device', 'Fuse', 'Rating'], { Device: 'deviceName', Fuse: 'circuitGroupKey', Rating: 'circuitBreakerRating' })
  const fuse2 = g.devices.find((d) => d.name === 'Fuse 2')
  assert.equal(fuse2.role, 'distribution')
  assert.equal(fuse2.tripRatingA, 10) // the first row of the group decides
  assert.equal(g.circuits.length, 2)
  assert.equal(g.circuits[0].name, 'Circuit 2')
  assert.deepEqual(g.circuits[0].cableTempIds.length, 2)
  assert.equal(g.wireRuns[0].fromTempId, g.wireRuns[1].fromTempId)
  assert.notEqual(g.wireRuns[0].fromTempId, g.wireRuns[2].fromTempId)
})

test('groupImportRows: a row with no supply gives a device but no cable, and is counted', () => {
  const g = groupImportRows([{ Device: 'A' }], ['Device'], { Device: 'deviceName' })
  assert.equal(g.devices.length, 1)
  assert.equal(g.wireRuns.length, 0)
  assert.equal(g.unconnectedRows, 1)
})

test('groupImportRows skips rows with no device name and counts them', () => {
  const rows = [{ Device: 'A', S: 'f' }, { Device: '', S: 'f' }, { Device: '  ', S: 'f' }]
  const grouped = groupImportRows(rows, ['Device', 'S'], { Device: 'deviceName', S: 'circuitSourceLabel' })
  assert.equal(grouped.wireRuns.length, 1)
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

  assert.equal(grouped.skippedRows, 0)

  // Every row with a fuse value is a cable from that fuse; the one row with a
  // blank value (Kühlschrank) has no supply and gets no cable.
  const blankGroupRows = rows.filter((r) => !r.Sicherung || !r.Sicherung.trim()).length
  assert.equal(grouped.unconnectedRows, blankGroupRows)
  assert.equal(grouped.wireRuns.length, 27 - blankGroupRows)
  const nonBlankGroups = new Set(rows.map((r) => r.Sicherung).filter((v) => v && v.trim())).size
  assert.equal(grouped.circuits.length, nonBlankGroups)
  assert.equal(grouped.devices.filter((d) => d.role === 'distribution').length, nonBlankGroups)

  // Spot check a real group: fuse "2" feeds Toplicht/Decklampe/Ankerlaterne.
  const circuit2 = grouped.circuits.find((c) => c.name === 'Circuit 2')
  assert.ok(circuit2)
  assert.equal(circuit2.cableTempIds.length, 3)
  assert.equal(grouped.devices.find((d) => d.name === 'Fuse 2').tripRatingA, 25) // LS-Größe of the first row (Toplicht)

  // Spot check combined-gauge parsing against real cells: "2,5 mm²" and "6 mm²".
  const naviBugDevice = grouped.devices.find((d) => d.name === 'Navi Bug')
  const naviBugWireRun = grouped.wireRuns.find((wr) => wr.toTempId === naviBugDevice.tempId)
  assert.equal(naviBugWireRun.gauge, 2.5)
  assert.equal(naviBugWireRun.gaugeUnit, 'mm2')
  assert.equal(naviBugDevice.ratedPowerW, 2)
  assert.equal(grouped.devices.find((d) => d.name === 'Kühlschrank').ratedPowerW != null, true)
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
  const headers = ['Device', 'Conduit', 'Fuse']
  const rows = [
    { Device: 'A', Conduit: 'Galley conduit', Fuse: 'F' },
    { Device: 'B', Conduit: 'galley CONDUIT; Mast hose', Fuse: 'F' },
    { Device: 'C', Conduit: '', Fuse: 'F' }
  ]
  const grouped = groupImportRows(rows, headers, { Device: 'deviceName', Conduit: 'wireConduit', Fuse: 'circuitSourceLabel' })
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
  const rows = [{ Device: 'A', Conduit: 'galley conduit; Old hose', Fuse: 'F' }]
  const grouped = groupImportRows(rows, ['Device', 'Conduit', 'Fuse'], { Device: 'deviceName', Conduit: 'wireConduit', Fuse: 'circuitSourceLabel' }, existing)
  assert.equal(grouped.conduits.length, 2)
  assert.equal(grouped.conduits[0].existingId, 'k1')
  assert.equal(grouped.conduits[0].name, 'Galley Conduit')
  assert.equal(grouped.conduits[1].existingId, null) // removed ones are not reused
})

test('groupImportRows without a conduit column makes no conduits', () => {
  const grouped = groupImportRows([{ Device: 'A', Fuse: 'F' }], ['Device', 'Fuse'], { Device: 'deviceName', Fuse: 'circuitSourceLabel' })
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
      { Device: 'A', Conduit: 'Galley conduit; Mast hose', Fuse: 'F' },
      { Device: 'B', Conduit: 'Mast hose', Fuse: 'F' }
    ]
    const grouped = groupImportRows(rows, ['Device', 'Conduit', 'Fuse'], { Device: 'deviceName', Conduit: 'wireConduit', Fuse: 'circuitSourceLabel' }, existing)
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

test('importToStore writes devices first, cables with their conductor, and names the derived circuits', async () => {
  const { importToStore } = await import('../public/import.js')
  const writes = []
  const realFetch = globalThis.fetch
  let cableIds = []
  globalThis.fetch = async (url, init) => {
    const u = String(url).replace('/signalk/v2/api/resources/', '')
    if (!init) {
      // The circuits the server derived from the cables just written.
      return { ok: true, status: 200, json: async () => ({ k1: { id: 'k1', derived: { cableIds } } }) }
    }
    writes.push({ url: u, body: JSON.parse(init.body) })
    if (u.startsWith('wiringWireRuns/')) cableIds.push(u.split('/')[1])
    return { ok: true, status: 200 }
  }
  try {
    const existing = [{ id: 'dev-lamp', name: 'Lamp', status: 'active' }]
    const rows = [
      { Device: 'Lamp', Fuse: '2', Color: 'red', Cond: 'positive', V: '12' },
      { Device: 'Pump', Fuse: '2', Color: 'black', Cond: 'negative', V: '12' }
    ]
    const headers = ['Device', 'Fuse', 'Color', 'Cond', 'V']
    const mapping = { Device: 'deviceName', Fuse: 'circuitGroupKey', Color: 'wireColor', Cond: 'wireConductor', V: 'circuitVoltage' }
    const grouped = groupImportRows(rows, headers, mapping, [], existing)
    const result = await importToStore(grouped)

    assert.equal(result.devicesCreated, 2) // Fuse 2 and Pump; Lamp matched
    assert.equal(result.devicesMatched, 1)
    assert.equal(result.wireRunsCreated, 2)
    assert.equal(result.circuitsNamed, 1)
    const deviceWrites = writes.filter((w) => w.url.startsWith('wiringDevices/'))
    assert.deepEqual(deviceWrites.map((w) => w.body.name).sort(), ['Fuse 2', 'Pump'])
    assert.equal(deviceWrites.find((w) => w.body.name === 'Fuse 2').body.role, 'distribution')
    const cables = writes.filter((w) => w.url.startsWith('wiringWireRuns/')).map((w) => w.body)
    assert.equal(cables[0].toDeviceId, 'dev-lamp')
    assert.deepEqual(cables[1].conductors, [{ conductor: 'negative', color: 'black' }])
    const naming = writes.find((w) => w.url === 'wiringCircuits/k1')
    assert.deepEqual(naming.body, { name: 'Circuit 2', voltage: 12 })
  } finally {
    globalThis.fetch = realFetch
  }
})

test('importToStore reports a cable the store refuses as an error row and carries on', async () => {
  const { importToStore } = await import('../public/import.js')
  const realFetch = globalThis.fetch
  const written = []
  globalThis.fetch = async (url, init) => {
    const u = String(url).replace('/signalk/v2/api/resources/', '')
    if (!init) return { ok: true, status: 200, json: async () => ({}) }
    const body = JSON.parse(init.body)
    if (u.startsWith('wiringWireRuns/') && body.conductors[0].conductor === 'neutral') {
      return { ok: false, status: 400, json: async () => ({ state: 'FAILED', message: 'A cable cannot carry both AC and DC' }) }
    }
    written.push(u)
    return { ok: true, status: 200 }
  }
  try {
    const headers = ['Device', 'Fuse', 'Cond']
    const rows = [
      { Device: 'Lamp', Fuse: '2', Cond: 'positive' },
      { Device: 'Socket', Fuse: '2', Cond: 'neutral' },
      { Device: 'Pump', Fuse: '2', Cond: 'negative' }
    ]
    const mapping = { Device: 'deviceName', Fuse: 'circuitGroupKey', Cond: 'wireConductor' }
    const result = await importToStore(groupImportRows(rows, headers, mapping, [], []))
    assert.equal(result.rowErrors.length, 1)
    assert.match(result.rowErrors[0].message, /A cable cannot carry both AC and DC/)
    assert.equal(result.wireRunsCreated, written.filter((u) => u.startsWith('wiringWireRuns/')).length)
    assert.ok(result.wireRunsCreated >= 1)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('gauges written as 1/0 to 4/0 are read as the numbers 0 to -3', () => {
  assert.deepEqual(parseCombinedGauge('1/0 AWG'), { gauge: 0, unit: 'AWG' })
  assert.deepEqual(parseCombinedGauge('4/0 awg'), { gauge: -3, unit: 'AWG' })
  assert.deepEqual(parseCombinedGauge('000 AWG'), { gauge: -2, unit: 'AWG' })
  assert.equal(parseCombinedGauge('1/0 mm²'), null)
})

test('a plain gauge column accepts 1/0 and sets AWG when no unit column is mapped', () => {
  const headers = ['Load', 'Fuse', 'Gauge']
  const rows = [{ Load: 'Windlass', Fuse: '1', Gauge: '1/0' }, { Load: 'Lamp', Fuse: '2', Gauge: '2,5' }]
  const grouped = groupImportRows(rows, headers, { Load: 'deviceName', Fuse: 'circuitGroupKey', Gauge: 'wireGauge' })
  assert.equal(grouped.wireRuns.length, 2)
  assert.equal(grouped.wireRuns[0].gauge, 0)
  assert.equal(grouped.wireRuns[0].gaugeUnit, 'AWG')
  assert.equal(grouped.wireRuns[1].gauge, 2.5)
  assert.equal(grouped.wireRuns[1].gaugeUnit, null)
})
