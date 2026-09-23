import { html, useState } from './vendor/preact-standalone.module.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'

// --- Pure parsing/mapping helpers (unit tested directly in test/import.test.mjs) ---

// Minimal RFC4180-ish parser: quoted fields, embedded commas, escaped
// quotes ("" -> "), CRLF/LF. Handles duplicate and blank header names
// (the real source CSV this was built for has both: "Sicherung" appears
// twice, and two columns have no header at all) by uniquifying them
// rather than letting a later column silently overwrite an earlier one
// with the same name.
export function parseCsv (text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = text.length

  while (i < len) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += char
      i++
      continue
    }
    if (char === '"') {
      inQuotes = true
      i++
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (char === '\r') {
      i++
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += char
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ''))
  if (nonEmptyRows.length === 0) return { headers: [], rows: [] }

  const [headerRow, ...dataRows] = nonEmptyRows
  const seen = new Map()
  const headers = headerRow.map((raw, idx) => {
    const base = raw.trim() || `Column ${idx + 1}`
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })

  const rowObjects = dataRows.map((r) => {
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : '' })
    return obj
  })

  return { headers, rows: rowObjects }
}

// European sheets commonly use a comma as the decimal separator
// ("2,5"). If a value has both '.' and ',', '.' is assumed to be a
// thousands separator and stripped; if it only has ',', that becomes
// the decimal point.
export function parseGermanNumber (value) {
  if (value == null) return null
  const str = String(value).trim()
  if (str === '') return null
  let normalized = str
  if (str.includes(',') && str.includes('.')) {
    normalized = str.replace(/\./g, '').replace(',', '.')
  } else if (str.includes(',')) {
    normalized = str.replace(',', '.')
  }
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

// For a column that combines gauge and unit in one cell, e.g. "2,5 mm²"
// or "14 AWG" — the shape of the real source CSV's Querschnitt column.
export function parseCombinedGauge (value) {
  if (!value) return null
  const match = String(value).match(/^\s*([\d.,]+)\s*(mm²|mm2|awg)/i)
  if (!match) return null
  const gauge = parseGermanNumber(match[1])
  if (gauge == null) return null
  const unit = match[2].toLowerCase() === 'awg' ? 'AWG' : 'mm2'
  return { gauge, unit }
}

export const MAPPING_TARGETS = [
  { value: 'skip', label: '(skip this column)' },
  { value: 'circuitGroupKey', label: 'Circuit: grouping key' },
  { value: 'circuitSourceLabel', label: 'Circuit: source label' },
  { value: 'circuitBreakerRating', label: 'Circuit: breaker rating (A)' },
  { value: 'circuitVoltage', label: 'Circuit: voltage' },
  { value: 'deviceName', label: 'Device: name' },
  { value: 'deviceType', label: 'Device: type' },
  { value: 'deviceZone', label: 'Device: zone' },
  { value: 'deviceRatedPowerW', label: 'Device: rated power (W)' },
  { value: 'notes', label: 'Notes (device)' },
  { value: 'wireFromEndpoint', label: 'Wire run: from' },
  { value: 'wireToEndpoint', label: 'Wire run: to' },
  { value: 'wireGauge', label: 'Wire run: gauge (number only)' },
  { value: 'wireGaugeUnit', label: 'Wire run: gauge unit' },
  { value: 'wireGaugeCombined', label: 'Wire run: gauge (combined, e.g. "2,5 mm²")' },
  { value: 'wireColor', label: 'Wire run: color' },
  { value: 'wireLength', label: 'Wire run: length' },
  { value: 'wireLengthUnit', label: 'Wire run: length unit' },
  { value: 'wireZone', label: 'Wire run: zone' },
  { value: 'wireCableLabel', label: 'Wire run: cable label' },
  { value: 'wireSwitchRef', label: 'Wire run: switch reference' }
]

function cell (row, header) {
  if (!header) return ''
  const value = row[header]
  return value == null ? '' : String(value).trim()
}

// One CSV row = one device + the wire run feeding it. Rows sharing a
// "circuit grouping key" become wire runs on the same circuit — but
// that column is optional, since not every export groups rows that
// way; without it, every row gets its own circuit. Device names repeat
// across rows (e.g. a device fed by more than one circuit) reuse the
// same device rather than creating a duplicate, scoped to this import
// batch only — not matched against already-existing devices, since a
// coincidental name collision silently merging two different real
// devices is worse than an extra one the user can clean up by hand.
export function groupImportRows (rows, headers, mapping) {
  const byTarget = {}
  for (const header of headers) {
    const target = mapping[header]
    if (target && target !== 'skip') byTarget[target] = header
  }

  if (!byTarget.deviceName) {
    return { error: 'Map at least one column to "Device: name" before importing.' }
  }

  const circuitsByKey = new Map()
  const devicesByName = new Map()
  const wireRuns = []
  let skippedRows = 0

  rows.forEach((row, index) => {
    const deviceName = cell(row, byTarget.deviceName)
    if (!deviceName) {
      skippedRows++
      return
    }

    const groupValue = cell(row, byTarget.circuitGroupKey)
    const circuitKey = byTarget.circuitGroupKey && groupValue ? groupValue : `__row_${index}`

    let circuit = circuitsByKey.get(circuitKey)
    if (!circuit) {
      circuit = {
        tempId: `circuit_${circuitsByKey.size}`,
        name: byTarget.circuitGroupKey && groupValue ? `Circuit ${groupValue}` : `${deviceName} circuit`,
        sourceLabel: cell(row, byTarget.circuitSourceLabel) || null,
        breakerRating: parseGermanNumber(cell(row, byTarget.circuitBreakerRating)),
        voltage: parseGermanNumber(cell(row, byTarget.circuitVoltage))
      }
      circuitsByKey.set(circuitKey, circuit)
    }

    let device = devicesByName.get(deviceName)
    if (!device) {
      device = {
        tempId: `device_${devicesByName.size}`,
        name: deviceName,
        type: cell(row, byTarget.deviceType) || null,
        zone: cell(row, byTarget.deviceZone) || null,
        ratedPowerW: parseGermanNumber(cell(row, byTarget.deviceRatedPowerW)),
        notes: cell(row, byTarget.notes) || null
      }
      devicesByName.set(deviceName, device)
    }

    let gauge = null
    let gaugeUnit = null
    if (byTarget.wireGaugeCombined) {
      const parsed = parseCombinedGauge(cell(row, byTarget.wireGaugeCombined))
      if (parsed) {
        gauge = parsed.gauge
        gaugeUnit = parsed.unit
      }
    } else {
      gauge = parseGermanNumber(cell(row, byTarget.wireGauge))
      gaugeUnit = cell(row, byTarget.wireGaugeUnit) || null
    }

    const explicitFrom = cell(row, byTarget.wireFromEndpoint)
    const fromEndpoint = explicitFrom || circuit.sourceLabel || 'Source'
    const explicitTo = cell(row, byTarget.wireToEndpoint)

    wireRuns.push({
      circuitTempId: circuit.tempId,
      deviceTempId: device.tempId,
      fromEndpoint,
      // an explicit "to" column wins if mapped; otherwise the wire run
      // goes to the device this row created/reused
      toEndpointOverride: explicitTo || null,
      gauge,
      gaugeUnit,
      color: cell(row, byTarget.wireColor) || null,
      length: parseGermanNumber(cell(row, byTarget.wireLength)),
      lengthUnit: cell(row, byTarget.wireLengthUnit) || null,
      zone: cell(row, byTarget.wireZone) || null,
      cableLabel: cell(row, byTarget.wireCableLabel) || null,
      switchRef: cell(row, byTarget.wireSwitchRef) || null
    })
  })

  return {
    circuits: [...circuitsByKey.values()],
    devices: [...devicesByName.values()],
    wireRuns,
    skippedRows
  }
}

async function putResource (type, id, value) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!res.ok) {
    const message = res.status === 401
      ? 'You need to be logged into the SignalK admin UI to do this.'
      : `Import failed (server responded ${res.status}).`
    throw new Error(message)
  }
}

// Writes the grouped/mapped data via the same resource API the rest of
// the webapp uses (plan 0004) — an import is just a lot of creates, not
// a separate write path.
export async function importToStore (grouped) {
  const circuitIdByTempId = new Map()
  for (const c of grouped.circuits) {
    const id = crypto.randomUUID()
    await putResource('wiringCircuits', id, {
      name: c.name,
      sourceLabel: c.sourceLabel || undefined,
      breakerRating: c.breakerRating ?? undefined,
      voltage: c.voltage ?? undefined
    })
    circuitIdByTempId.set(c.tempId, id)
  }

  const deviceIdByTempId = new Map()
  for (const d of grouped.devices) {
    const id = crypto.randomUUID()
    await putResource('wiringDevices', id, {
      name: d.name,
      type: d.type || undefined,
      zone: d.zone || undefined,
      ratedPowerW: d.ratedPowerW ?? undefined,
      notes: d.notes || undefined
    })
    deviceIdByTempId.set(d.tempId, id)
  }

  for (const wr of grouped.wireRuns) {
    const id = crypto.randomUUID()
    await putResource('wiringWireRuns', id, {
      circuitId: circuitIdByTempId.get(wr.circuitTempId),
      fromEndpoint: wr.fromEndpoint,
      toEndpoint: wr.toEndpointOverride || deviceIdByTempId.get(wr.deviceTempId),
      gauge: wr.gauge ?? undefined,
      gaugeUnit: wr.gaugeUnit || undefined,
      color: wr.color || undefined,
      length: wr.length ?? undefined,
      lengthUnit: wr.lengthUnit || undefined,
      zone: wr.zone || undefined,
      cableLabel: wr.cableLabel || undefined,
      switchRef: wr.switchRef || undefined
    })
  }

  return {
    circuitsCreated: grouped.circuits.length,
    devicesCreated: grouped.devices.length,
    wireRunsCreated: grouped.wireRuns.length
  }
}

// --- UI ---

export function CsvImport ({ onDone, onCancel }) {
  const [step, setStep] = useState('pick') // pick | map | preview | importing | done
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [grouped, setGrouped] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const onFile = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.headers.length === 0) {
      setError('Could not find any rows in that file.')
      return
    }
    setHeaders(parsed.headers)
    setRows(parsed.rows)
    setMapping({})
    setError(null)
    setStep('map')
  }

  const setColumnMapping = (header, target) => setMapping((m) => ({ ...m, [header]: target }))

  const toPreview = () => {
    const g = groupImportRows(rows, headers, mapping)
    if (g.error) {
      setError(g.error)
      return
    }
    setGrouped(g)
    setError(null)
    setStep('preview')
  }

  const runImport = async () => {
    setStep('importing')
    setError(null)
    try {
      const r = await importToStore(grouped)
      setResult(r)
      setStep('done')
    } catch (err) {
      setError(err.message)
      setStep('preview')
    }
  }

  return html`
    <div class="csv-import">
      <${ErrorBannerLocal} message=${error} />

      ${step === 'pick' && html`
        <div class="card">
          <p>Import circuits, wire runs, and devices from a CSV file.</p>
          <input type="file" accept=".csv,text/csv" onChange=${onFile} />
          <div class="form-actions">
            <button type="button" onClick=${onCancel}>Cancel</button>
          </div>
        </div>
      `}

      ${step === 'map' && html`
        <div class="card">
          <p>Map each column to a wiring field, or leave it skipped.</p>
          <table>
            <thead><tr><th>CSV column</th><th>Maps to</th></tr></thead>
            <tbody>
              ${headers.map((h) => html`
                <tr key=${h}>
                  <td>${h}</td>
                  <td>
                    <select
                      value=${mapping[h] || 'skip'}
                      onChange=${(e) => setColumnMapping(h, e.target.value)}
                    >
                      ${MAPPING_TARGETS.map((t) => html`<option value=${t.value} key=${t.value}>${t.label}</option>`)}
                    </select>
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
          <div class="form-actions">
            <button type="button" onClick=${toPreview}>Preview import</button>
            <button type="button" onClick=${onCancel}>Cancel</button>
          </div>
        </div>
      `}

      ${step === 'preview' && grouped && html`
        <div class="card">
          <p>
            This will create <strong>${grouped.circuits.length}</strong> circuit(s),
            <strong>${grouped.devices.length}</strong> device(s), and
            <strong>${grouped.wireRuns.length}</strong> wire run(s).
            ${grouped.skippedRows > 0 && html`
              <br />${grouped.skippedRows} row(s) skipped (no device name).
            `}
          </p>
          <ul class="changelog-list">
            ${grouped.circuits.map((c) => html`
              <li key=${c.tempId}>${c.name}${c.sourceLabel ? ` — ${c.sourceLabel}` : ''}</li>
            `)}
          </ul>
          <div class="form-actions">
            <button type="button" onClick=${runImport}>Import</button>
            <button type="button" onClick=${() => setStep('map')}>Back</button>
            <button type="button" onClick=${onCancel}>Cancel</button>
          </div>
        </div>
      `}

      ${step === 'importing' && html`<div class="empty-state">Importing&hellip;</div>`}

      ${step === 'done' && result && html`
        <div class="card">
          <p>
            Imported ${result.circuitsCreated} circuit(s), ${result.devicesCreated} device(s),
            and ${result.wireRunsCreated} wire run(s).
          </p>
          <div class="form-actions">
            <button type="button" onClick=${onDone}>Done</button>
          </div>
        </div>
      `}
    </div>
  `
}

function ErrorBannerLocal ({ message }) {
  if (!message) return null
  return html`<div class="error-banner">${message}</div>`
}
