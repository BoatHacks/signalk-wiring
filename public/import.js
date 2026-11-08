import { html, useState } from './vendor/preact-standalone.module.js'
import { newId } from './ids.js'

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

// A conduit cell names the conduits a cable passes through, in order,
// separated by ; or >. A comma is part of a name, so "Hose 1, port" stays
// one conduit. Blank entries and repeats (ignoring case) are dropped.
export function parseConduitNames (text) {
  const seen = new Set()
  const names = []
  for (const part of String(text ?? '').split(/[;>]/)) {
    const name = part.trim()
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); names.push(name) }
  }
  return names
}

export const MAPPING_TARGETS = [
  { value: 'skip', label: '(skip this column)' },
  { value: 'circuitGroupKey', label: 'Circuit: grouping key (a fuse per key; names the derived circuit)' },
  { value: 'circuitSourceLabel', label: 'Cable: supply device (fuse or breaker name)' },
  { value: 'circuitBreakerRating', label: 'Supply device: trip rating (A)' },
  { value: 'circuitVoltage', label: 'Circuit: voltage (overrides the supply voltage)' },
  { value: 'deviceName', label: 'Device: name (the load the cable goes to)' },
  { value: 'deviceType', label: 'Device: type' },
  { value: 'deviceZone', label: 'Device: zone' },
  { value: 'deviceRatedPowerW', label: 'Device: rated power (W)' },
  { value: 'notes', label: 'Notes (device)' },
  { value: 'wireFromDevice', label: 'Cable: from device (supply side)' },
  { value: 'wireToDevice', label: 'Cable: to device (load side)' },
  { value: 'wireConductor', label: 'Cable: conductor (positive, negative, line, neutral, earth)' },
  { value: 'wireGauge', label: 'Cable: gauge (number only)' },
  { value: 'wireGaugeUnit', label: 'Cable: gauge unit' },
  { value: 'wireGaugeCombined', label: 'Cable: gauge (combined, e.g. "2,5 mm²")' },
  { value: 'wireColor', label: 'Cable: color' },
  { value: 'wireLength', label: 'Cable: length' },
  { value: 'wireLengthUnit', label: 'Cable: length unit' },
  { value: 'wireZone', label: 'Cable: zone' },
  { value: 'wireCableLabel', label: 'Cable: cable label' },
  { value: 'wireSwitchRef', label: 'Cable: switch reference' },
  { value: 'wireConduit', label: 'Cable: conduit (several in order: separate with ; or >)' }
]

const CONDUCTOR_WORDS = {
  positive: 'positive', plus: 'positive', '+': 'positive', pos: 'positive',
  negative: 'negative', minus: 'negative', '-': 'negative', '−': 'negative', neg: 'negative',
  line: 'line', l: 'line', phase: 'line',
  neutral: 'neutral', n: 'neutral',
  earth: 'earth', ground: 'earth', pe: 'earth'
}

// A conductor cell as one of the five conductor types; blank or unknown is positive.
export function parseConductor (text) {
  return CONDUCTOR_WORDS[String(text ?? '').trim().toLowerCase()] || 'positive'
}

function cell (row, header) {
  if (!header) return ''
  const value = row[header]
  return value == null ? '' : String(value).trim()
}

// One CSV row = one cable to a device (the load). The supply side comes from
// a "from device" column, else the "supply device" column, else a fuse made
// from the circuit grouping key (rows sharing a key share that fuse, so they
// become one circuit once the cables exist). A row with none of these still
// creates its device but no cable. Devices are matched by name, ignoring
// case, against the live devices already recorded and within the file, and
// created when missing; circuits are never imported, they follow the cables.
export function groupImportRows (rows, headers, mapping, existingConduits = [], existingDevices = []) {
  const byTarget = {}
  for (const header of headers) {
    const target = mapping[header]
    if (target && target !== 'skip') byTarget[target] = header
  }

  const toHeader = byTarget.wireToDevice || byTarget.deviceName
  if (!toHeader) {
    return { error: 'Map at least one column to "Device: name" (or "Cable: to device") before importing.' }
  }

  const groupsByKey = new Map()
  const devicesByName = new Map()
  const wireRuns = []
  const conduitsByName = new Map()
  let skippedRows = 0
  let unconnectedRows = 0

  const liveDevices = new Map()
  for (const d of existingDevices) {
    if (d.status !== 'removed' && !liveDevices.has(d.name.toLowerCase())) liveDevices.set(d.name.toLowerCase(), d)
  }
  const deviceFor = (name) => {
    const key = name.toLowerCase()
    let device = devicesByName.get(key)
    if (!device) {
      const existing = liveDevices.get(key)
      device = {
        tempId: `device_${devicesByName.size}`,
        name: existing ? existing.name : name,
        existingId: existing ? existing.id : null,
        role: 'consumer',
        usedAsSupply: false,
        type: null,
        zone: null,
        ratedPowerW: null,
        notes: null,
        tripRatingA: null
      }
      devicesByName.set(key, device)
    }
    return device
  }

  // Conduits are matched by name, ignoring case, to live conduits already
  // recorded, so importing cables into conduits you have already entered
  // does not duplicate them. Names are scoped to this batch otherwise.
  const liveConduits = new Map()
  for (const c of existingConduits) {
    if (c.status !== 'removed' && !liveConduits.has(c.name.toLowerCase())) liveConduits.set(c.name.toLowerCase(), c)
  }
  const conduitFor = (name) => {
    const key = name.toLowerCase()
    let conduit = conduitsByName.get(key)
    if (!conduit) {
      const existing = liveConduits.get(key)
      conduit = {
        tempId: `conduit_${conduitsByName.size}`,
        name: existing ? existing.name : name,
        existingId: existing ? existing.id : null
      }
      conduitsByName.set(key, conduit)
    }
    return conduit
  }

  rows.forEach((row) => {
    const toName = cell(row, toHeader)
    if (!toName) {
      skippedRows++
      return
    }

    const to = deviceFor(toName)
    if (!to.existingId) {
      // Row attributes describe the load; the first row naming it decides.
      to.type = to.type || cell(row, byTarget.deviceType) || null
      to.zone = to.zone || cell(row, byTarget.deviceZone) || null
      to.ratedPowerW = to.ratedPowerW ?? parseGermanNumber(cell(row, byTarget.deviceRatedPowerW))
      to.notes = to.notes || cell(row, byTarget.notes) || null
    }

    const groupValue = cell(row, byTarget.circuitGroupKey)
    let group = null
    if (byTarget.circuitGroupKey && groupValue) {
      group = groupsByKey.get(groupValue)
      if (!group) {
        group = {
          tempId: `circuit_${groupsByKey.size}`,
          key: groupValue,
          name: `Circuit ${groupValue}`,
          voltage: parseGermanNumber(cell(row, byTarget.circuitVoltage)),
          breakerRating: parseGermanNumber(cell(row, byTarget.circuitBreakerRating)),
          cableTempIds: []
        }
        groupsByKey.set(groupValue, group)
      }
    }

    const fromName = cell(row, byTarget.wireFromDevice) || cell(row, byTarget.circuitSourceLabel) ||
      (group ? `Fuse ${group.key}` : '')
    if (!fromName) {
      unconnectedRows++
      return
    }
    const from = deviceFor(fromName)
    from.usedAsSupply = true
    if (!from.existingId && from.tripRatingA == null) {
      from.tripRatingA = group && fromName === `Fuse ${group.key}`
        ? group.breakerRating
        : parseGermanNumber(cell(row, byTarget.circuitBreakerRating))
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

    const tempId = `cable_${wireRuns.length}`
    if (group) group.cableTempIds.push(tempId)
    wireRuns.push({
      tempId,
      circuitTempId: group ? group.tempId : null,
      fromTempId: from.tempId,
      toTempId: to.tempId,
      conductor: parseConductor(cell(row, byTarget.wireConductor)),
      gauge,
      gaugeUnit,
      color: cell(row, byTarget.wireColor) || null,
      length: parseGermanNumber(cell(row, byTarget.wireLength)),
      lengthUnit: cell(row, byTarget.wireLengthUnit) || null,
      zone: cell(row, byTarget.wireZone) || null,
      cableLabel: cell(row, byTarget.wireCableLabel) || null,
      switchRef: cell(row, byTarget.wireSwitchRef) || null,
      conduitTempIds: parseConduitNames(cell(row, byTarget.wireConduit)).map((n) => conduitFor(n).tempId)
    })
  })

  const devices = [...devicesByName.values()]
  for (const d of devices) if (d.usedAsSupply && !d.existingId) d.role = 'distribution'

  return {
    // The old import made circuits. They follow the cables now; these are
    // the named groups, used to name the derived circuits after the import.
    circuits: [...groupsByKey.values()],
    devices,
    conduits: [...conduitsByName.values()],
    wireRuns,
    skippedRows,
    unconnectedRows
  }
}

async function putResource (type, id, value) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!res.ok) {
    let message = res.status === 401
      ? 'You need to be logged into the SignalK admin UI to do this.'
      : `Import failed (server responded ${res.status}).`
    // A refused write says why (for example a cable that mixes AC and DC).
    if (res.status === 400 && typeof res.json === 'function') {
      try {
        const body = await res.json()
        if (body && typeof body.message === 'string' && body.message) message = body.message
      } catch (_) { /* keep the generic message */ }
    }
    throw new Error(message)
  }
}

// Writes the grouped/mapped data via the same resource API the rest of
// the webapp uses (plan 0004) — an import is just a lot of creates, not
// a separate write path.
export async function importToStore (grouped) {
  // Conduits first, so the cables can list them. Existing ones keep their id.
  const conduitIdByTempId = new Map()
  let conduitsCreated = 0
  for (const k of grouped.conduits || []) {
    if (k.existingId) {
      conduitIdByTempId.set(k.tempId, k.existingId)
      continue
    }
    const id = newId()
    await putResource('wiringConduits', id, { name: k.name })
    conduitIdByTempId.set(k.tempId, id)
    conduitsCreated++
  }

  // Devices matched by name keep their record; missing ones are created.
  const deviceIdByTempId = new Map()
  let devicesCreated = 0
  for (const d of grouped.devices) {
    if (d.existingId) {
      deviceIdByTempId.set(d.tempId, d.existingId)
      continue
    }
    const id = newId()
    await putResource('wiringDevices', id, {
      name: d.name,
      role: d.role || 'consumer',
      type: d.type || undefined,
      zone: d.zone || undefined,
      ratedPowerW: d.ratedPowerW ?? undefined,
      tripRatingA: d.tripRatingA ?? undefined,
      notes: d.notes || undefined
    })
    deviceIdByTempId.set(d.tempId, id)
    devicesCreated++
  }

  // A cable the store refuses (it mixes AC and DC, say) is reported as an
  // error row and does not stop the others.
  const cableIdByTempId = new Map()
  const rowErrors = []
  const deviceName = (tempId) => (grouped.devices.find((d) => d.tempId === tempId) || {}).name || '?'
  for (const wr of grouped.wireRuns) {
    const id = newId()
    try {
      await putResource('wiringWireRuns', id, {
        fromDeviceId: deviceIdByTempId.get(wr.fromTempId),
        toDeviceId: deviceIdByTempId.get(wr.toTempId),
        conductors: [{ conductor: wr.conductor || 'positive', color: wr.color || undefined }],
        gauge: wr.gauge ?? undefined,
        gaugeUnit: wr.gaugeUnit || undefined,
        length: wr.length ?? undefined,
        lengthUnit: wr.lengthUnit || undefined,
        zone: wr.zone || undefined,
        cableLabel: wr.cableLabel || undefined,
        switchRef: wr.switchRef || undefined,
        conduitIds: (wr.conduitTempIds || []).length > 0
          ? wr.conduitTempIds.map((t) => conduitIdByTempId.get(t))
          : undefined
      })
    } catch (err) {
      if (/logged into/.test(err.message)) throw err
      rowErrors.push({ cable: `${deviceName(wr.fromTempId)} to ${deviceName(wr.toTempId)}`, message: err.message })
      continue
    }
    cableIdByTempId.set(wr.tempId, id)
  }

  const circuitsNamed = await nameDerivedCircuits(grouped, cableIdByTempId)

  return {
    devicesCreated,
    devicesMatched: grouped.devices.length - devicesCreated,
    wireRunsCreated: cableIdByTempId.size,
    rowErrors,
    unconnectedRows: grouped.unconnectedRows || 0,
    circuitsNamed,
    conduitsCreated
  }
}

// The circuits are worked out from the cables just written. Each named group
// of the file (the old circuit column) names the derived circuit that holds
// most of its cables; a circuit is named once, by the first group to claim it.
// Best effort: if the circuits cannot be read, they keep their default names.
async function nameDerivedCircuits (grouped, cableIdByTempId) {
  const groups = (grouped.circuits || []).filter((g) => g.cableTempIds.length > 0)
  if (groups.length === 0) return 0
  let circuits = []
  try {
    const res = await fetch(`${RESOURCE_BASE}/wiringCircuits`)
    if (res.ok && typeof res.json === 'function') circuits = Object.values(await res.json())
  } catch (_) { return 0 }

  const claimed = new Set()
  let named = 0
  for (const g of groups) {
    const ids = new Set(g.cableTempIds.map((t) => cableIdByTempId.get(t)))
    let best = null
    let bestOverlap = 0
    for (const c of circuits) {
      if (claimed.has(c.id) || !c.derived) continue
      const overlap = c.derived.cableIds.filter((id) => ids.has(id)).length
      if (overlap > bestOverlap) { best = c; bestOverlap = overlap }
    }
    if (!best) continue
    claimed.add(best.id)
    try {
      await putResource('wiringCircuits', best.id, {
        name: g.name,
        ...(g.voltage != null ? { voltage: g.voltage } : {})
      })
      named++
    } catch (_) { /* leave the default name */ }
  }
  return named
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

  const toPreview = async () => {
    // Conduits already recorded are matched by name; if they cannot be
    // read, every conduit in the file is treated as new.
    let existingConduits = []
    if (Object.values(mapping).includes('wireConduit')) {
      try {
        const res = await fetch(`${RESOURCE_BASE}/wiringConduits`)
        if (res.ok) existingConduits = Object.values(await res.json())
      } catch (_) { /* preview without matching */ }
    }
    // Devices are matched by name too; unreadable means every device is new.
    let existingDevices = []
    try {
      const res = await fetch(`${RESOURCE_BASE}/wiringDevices`)
      if (res.ok) existingDevices = Object.values(await res.json())
    } catch (_) { /* preview without matching */ }
    const g = groupImportRows(rows, headers, mapping, existingConduits, existingDevices)
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
          <p>Import devices and cables from a CSV file. Circuits are worked out from the cables.</p>
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
            This will create <strong>${grouped.devices.filter((d) => !d.existingId).length}</strong> device(s)
            (${grouped.devices.filter((d) => d.existingId).length} matched by name to devices you already have) and
            <strong>${grouped.wireRuns.length}</strong> cable(s). Circuits are worked out from the cables.
            ${grouped.conduits.length > 0 && html`
              <br />${grouped.conduits.filter((k) => !k.existingId).length} new conduit(s) will be created and
              ${grouped.conduits.filter((k) => k.existingId).length} existing one(s) reused.
            `}
            ${grouped.skippedRows > 0 && html`
              <br />${grouped.skippedRows} row(s) skipped (no device name).
            `}
            ${grouped.unconnectedRows > 0 && html`
              <br />${grouped.unconnectedRows} row(s) have no supply device, so their device is created without a cable.
            `}
          </p>
          <ul class="changelog-list">
            ${grouped.devices.map((d) => html`
              <li key=${d.tempId}>${d.name} (${d.role}${d.tripRatingA ? `, ${d.tripRatingA} A` : ''})${d.existingId ? ' – existing' : ' – new'}</li>
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
            Imported ${result.devicesCreated} new device(s) (${result.devicesMatched} matched by name)
            and ${result.wireRunsCreated} cable(s)${result.circuitsNamed > 0 ? `; ${result.circuitsNamed} circuit(s) named from the circuit column` : ''}${result.conduitsCreated > 0 ? `, plus ${result.conduitsCreated} new conduit(s)` : ''}.
          </p>
          ${(result.rowErrors || []).length > 0 && html`
            <div class="error-banner" data-testid="import-row-errors">
              ${result.rowErrors.length} cable(s) were not imported:
              <ul>${result.rowErrors.map((e, i) => html`<li key=${i}>${e.cable}: ${e.message}</li>`)}</ul>
            </div>
          `}
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
