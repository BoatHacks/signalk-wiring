import { html, useState, useEffect } from './vendor/preact-standalone.module.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'

async function fetchResourceMap (type) {
  const res = await fetch(`${RESOURCE_BASE}/${type}`)
  if (!res.ok) throw new Error(`failed to load ${type}: ${res.status}`)
  const map = await res.json()
  return Object.values(map)
}

// A small self-contained copy of app.js's useResourceList rather than
// importing it — importing from app.js here would make app.js import
// LoadSummary and LoadSummary import app.js, a circular ES module
// dependency that's technically survivable (Preact hooks only run
// during render, after both modules finish evaluating) but fragile to
// get right. Same reasoning as import.js's own local putResource.
function useResourceList (type) {
  const [state, setState] = useState({ loading: true, error: null, items: [] })

  useEffect(() => {
    let cancelled = false
    fetchResourceMap(type)
      .then((items) => { if (!cancelled) setState({ loading: false, error: null, items }) })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, items: [] }) })
    return () => { cancelled = true }
  }, [type])

  return state
}

// Pure and unit-tested (test/loadSummary.test.mjs). Sums rated wattage
// across the *distinct* devices an active circuit's active wire runs
// reach (a device wired in twice within one circuit isn't double
// counted), converts to amps via the circuit's voltage, and compares
// against its breaker rating. Nulls propagate rather than being
// treated as zero — "unknown" and "definitely fine" are different
// answers a load check shouldn't blur together.
//
// Known simplification: a device's full rated wattage is attributed to
// *every* circuit that wires into it, even though in reality it draws
// from at most one at a time in most cases (e.g. a primary/backup-fed
// device) — this can overstate load on what's actually a backup path.
// Correct handling needs per-wire-run power, which isn't data this
// plugin collects. `LoadSummary`'s own UI states this, not just this
// comment.
export function calculateCircuitLoad (circuit, wireRuns, deviceById) {
  const activeWireRuns = wireRuns.filter(
    (wr) => wr.circuitId === circuit.id && wr.status === 'active'
  )

  const seenDeviceIds = new Set()
  let totalWatts = 0
  let knownDeviceCount = 0
  let unknownWattageCount = 0

  for (const wr of activeWireRuns) {
    const device = deviceById.get(wr.toEndpoint)
    if (!device || device.status !== 'active' || seenDeviceIds.has(device.id)) continue
    seenDeviceIds.add(device.id)
    knownDeviceCount++
    if (device.ratedPowerW == null) {
      unknownWattageCount++
    } else {
      totalWatts += device.ratedPowerW
    }
  }

  const amps = circuit.voltage ? totalWatts / circuit.voltage : null
  const overRating = amps != null && circuit.breakerRating != null && amps > circuit.breakerRating

  return {
    deviceCount: knownDeviceCount,
    unknownWattageCount,
    totalWatts,
    amps,
    overRating,
    missingVoltage: !circuit.voltage,
    missingRating: circuit.breakerRating == null
  }
}

function formatAmps (amps) {
  return amps == null ? '—' : `${amps.toFixed(2)} A`
}

export function LoadSummary () {
  const { loading: circuitsLoading, error: circuitsError, items: circuits } = useResourceList('wiringCircuits')
  const { items: wireRuns } = useResourceList('wiringWireRuns')
  const { items: devices } = useResourceList('wiringDevices')

  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const activeCircuits = circuits.filter((c) => c.status === 'active')

  return html`
    <div>
      <p class="meta">
        Total wattage is summed per circuit from each connected device's rated power, converted
        to amps using the circuit's voltage, and checked against its breaker rating.
        A device fed by more than one circuit has its full wattage counted on
        <em>each</em> circuit it's wired into, which can overstate load on a circuit that's
        actually just a backup path — treat this as a starting point, not a certified
        calculation.
      </p>
      ${circuitsLoading && html`<div class="empty-state">Loading&hellip;</div>`}
      <${ErrorBannerLocal} message=${circuitsError} />
      ${!circuitsLoading && !circuitsError && activeCircuits.length === 0 && html`
        <div class="empty-state">No active circuits recorded yet.</div>
      `}
      ${activeCircuits.length > 0 && html`
        <table>
          <thead>
            <tr>
              <th>Circuit</th><th>Devices</th><th>Total W</th><th>Voltage</th>
              <th>Amps</th><th>Breaker</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${activeCircuits.map((circuit) => {
              const load = calculateCircuitLoad(circuit, wireRuns, deviceById)
              return html`
                <tr key=${circuit.id}>
                  <td>${circuit.name}</td>
                  <td>
                    ${load.deviceCount}
                    ${load.unknownWattageCount > 0 && html`
                      <span class="meta">(${load.unknownWattageCount} unrated)</span>
                    `}
                  </td>
                  <td>${load.totalWatts} W</td>
                  <td>${circuit.voltage ? `${circuit.voltage} V` : '—'}</td>
                  <td>${formatAmps(load.amps)}</td>
                  <td>${circuit.breakerRating ? `${circuit.breakerRating} A` : '—'}</td>
                  <td>
                    ${load.overRating && html`<span class="badge over-rating">over rating</span>`}
                    ${!load.overRating && (load.missingVoltage || load.missingRating) && html`
                      <span class="badge">incomplete</span>
                    `}
                    ${!load.overRating && !load.missingVoltage && !load.missingRating && html`
                      <span class="badge ok">ok</span>
                    `}
                  </td>
                </tr>
              `
            })}
          </tbody>
        </table>
      `}
    </div>
  `
}

function ErrorBannerLocal ({ message }) {
  if (!message) return null
  return html`<div class="error-banner">${message}</div>`
}
