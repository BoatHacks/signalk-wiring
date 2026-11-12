import { html, useState, useEffect } from './vendor/preact-standalone.module.js'
import { loadFigures } from './measured.js'
import { hashForState } from './router.js'
import { useSettings } from './settings.js'
import { checkAll, countVerdicts } from './cableChecks.js'
import { limitsFrom } from './cableCheckView.js'

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
// across the consumers a derived circuit ends at (plan 0014), converts to
// amps with the circuit's voltage, and compares against the rating of the
// fuse or breaker that protects it. On an AC circuit a consumer's optional
// power factor turns its watts into volt-amperes first (a blank one counts
// as 1). Nulls propagate rather than being treated as zero: "unknown" and
// "definitely fine" are different answers a load check shouldn't blur.
//
// Known simplification: a device's full rated wattage is attributed to
// *every* circuit that feeds it, even though in reality it draws from at
// most one at a time in most cases (e.g. a primary/backup-fed device).
// Correct handling needs per-cable power, which isn't data this plugin
// collects. `LoadSummary`'s own UI states this, not just this comment.
export function calculateCircuitLoad (circuit, deviceById) {
  const derived = circuit.derived || { endDeviceIds: [], deviceIds: [], ac: false, ratingA: null, voltage: null }
  const ac = Boolean(derived.ac)

  const seenDeviceIds = new Set()
  const seenGroups = new Set()
  let totalWatts = 0
  let totalVa = 0
  let averageWatts = 0
  let knownDeviceCount = 0
  let unknownWattageCount = 0
  let measuredCount = 0
  let estimateCount = 0
  let groupCount = 0

  for (const id of derived.endDeviceIds) {
    const device = deviceById.get(id)
    if (!device || device.status !== 'active' || seenDeviceIds.has(device.id)) continue
    // Only consumers draw from the circuit; sources, storage, switches and
    // converters sit on it without adding load of their own.
    if (device.role && device.role !== 'consumer') continue
    seenDeviceIds.add(device.id)
    knownDeviceCount++
    // A device with an accepted calibration run counts at its measured peak
    // (the breaker check) and measured average (energy); any other at its
    // nameplate rating. A measured figure already includes the power factor,
    // so none is applied to it. A group figure, measured on a switch shared
    // by several consumers, covers all of them, so it is counted once.
    const figures = loadFigures(device)
    if (figures.source === null) {
      unknownWattageCount++
    } else if (figures.source === 'measured') {
      measuredCount++
      if (figures.estimate) estimateCount++
      if (figures.group) {
        const key = figures.group.switchDeviceId
        if (seenGroups.has(key)) continue
        seenGroups.add(key)
        groupCount++
      }
      totalWatts += figures.peakW
      totalVa += figures.peakW
      averageWatts += figures.avgW
    } else {
      totalWatts += figures.peakW
      const pf = ac && device.powerFactor > 0 && device.powerFactor <= 1 ? device.powerFactor : 1
      totalVa += figures.peakW / pf
      averageWatts += figures.avgW
    }
  }

  const voltage = derived.voltage || null
  const rating = derived.ratingA || null
  const amps = voltage ? totalVa / voltage : null
  const overRating = amps != null && rating != null && amps > rating

  return {
    deviceCount: knownDeviceCount,
    unknownWattageCount,
    totalWatts,
    averageWatts,
    measuredCount,
    estimateCount,
    groupCount,
    source: measuredCount === 0 ? 'rated' : measuredCount === knownDeviceCount - unknownWattageCount ? 'measured' : 'mixed',
    amps,
    overRating,
    missingVoltage: !voltage,
    missingRating: rating == null,
    voltage,
    ratingA: rating,
    ac
  }
}

// The one line about the cable checks, or null when there is nothing to say:
// "Cable checks (advisory): 2 cables too small or with a high voltage drop,
// 3 cannot be checked, 9 ok." Counts come from countVerdicts().
export function checkSummaryLine (counts) {
  const total = counts.ok + counts.warning + counts.fail + counts.cannot
  if (total === 0) return null
  const parts = []
  if (counts.fail > 0) parts.push(`${counts.fail} too small`)
  if (counts.warning > 0) parts.push(`${counts.warning} with a high voltage drop`)
  if (counts.cannot > 0) parts.push(`${counts.cannot} cannot be checked yet`)
  parts.push(`${counts.ok} ok`)
  return `Cable checks (advisory): ${parts.join(', ')}.`
}

// What an "incomplete" circuit is missing and what to do about it, or null
// when nothing is. Shown as a line under the badge and as its tooltip.
export function incompleteReason (load) {
  const parts = []
  if (load.missingVoltage) parts.push('No voltage: set the nominal voltage on the supply')
  if (load.missingRating) parts.push('No rating: set the trip rating of the fuse or breaker')
  return parts.length ? parts.join('. ') : null
}

// Short explanations for the status badges and the load source labels, used
// as tooltips and in the legend under the table.
export const BADGE_HELP = {
  'over rating': 'The summed load is more than the fuse or breaker is rated for.',
  ok: 'The summed load is within the rating of the fuse or breaker.',
  incomplete: 'The check cannot be made yet: see the line under the badge.',
  measured: 'The total uses figures measured in an accepted calibration run.',
  estimate: 'A measured figure that is still an estimate, from a short or uncertain run.'
}

export const LEGEND = [
  ['over rating', BADGE_HELP['over rating']],
  ['ok', BADGE_HELP.ok],
  ['incomplete', 'Voltage or rating is missing, so no check can be made.'],
  ['measured', BADGE_HELP.measured],
  ['estimate', BADGE_HELP.estimate]
]

function formatAmps (amps) {
  return amps == null ? '—' : `${amps.toFixed(2)} A`
}

export function LoadSummary () {
  const { loading: circuitsLoading, error: circuitsError, items: circuits } = useResourceList('wiringCircuits')
  const { items: devices } = useResourceList('wiringDevices')
  const { items: cables } = useResourceList('wiringWireRuns')
  const { items: conduits } = useResourceList('wiringConduits')
  const settings = useSettings()

  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const activeCircuits = circuits.filter((c) => c.status === 'active' && c.derived)
  const checkLine = checkSummaryLine(countVerdicts(checkAll({ cables, circuits, devices, conduits, limits: limitsFrom(settings) })))

  return html`
    <div>
      <p class="meta">
        Total wattage is summed per circuit from the consumers it feeds: a device that has an accepted
        calibration run counts at its <em>measured</em> peak, and every other at its rated power. The
        measured average is shown as well, for energy. Peaks are summed as if they all happened at once,
        which is a cautious figure. Total wattage is converted
        to amps using the voltage of its supply (on AC circuits, divided by each device's power
        factor where one is set), and checked against the rating of the fuse or breaker that protects it.
        A device fed by more than one circuit has its full wattage counted on${" "}
        <em>each</em> circuit it's wired into, which can overstate load on a circuit that's
        actually just a backup path — treat this as a starting point, not a certified
        calculation.
      </p>
      ${checkLine && html`
        <p class="meta check-summary" data-testid="check-summary">${checkLine}
          ${' '}<a class="route-link" href=${hashForState({ tab: 'cables' })}>See the Cables tab</a>.</p>
      `}
      ${circuitsLoading && html`<div class="empty-state">Loading…</div>`}
      <${ErrorBannerLocal} message=${circuitsError} />
      ${!circuitsLoading && !circuitsError && activeCircuits.length === 0 && html`
        <div class="empty-state">No circuits yet. They appear once cables join devices.</div>
      `}
      ${activeCircuits.length > 0 && html`
        <table>
          <thead>
            <tr>
              <th>Circuit</th><th>Devices</th><th>Total W</th><th>Average W</th><th>Voltage</th>
              <th>Amps</th><th>Protection</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${activeCircuits.map((circuit) => {
              const load = calculateCircuitLoad(circuit, deviceById)
              return html`
                <tr key=${circuit.id}>
                  <td><a class="route-link" href=${hashForState({ tab: 'circuits', id: circuit.id })}>${circuit.name}</a></td>
                  <td>
                    ${load.deviceCount}
                    ${load.unknownWattageCount > 0 && html`
                      <span class="meta">(${load.unknownWattageCount} unrated)</span>
                    `}
                  </td>
                  <td>
                    ${Math.round(load.totalWatts * 10) / 10} W
                    ${load.source !== 'rated' && html`<div class="meta" data-testid="load-source" title=${load.estimateCount > 0 ? BADGE_HELP.measured + ' ' + BADGE_HELP.estimate : BADGE_HELP.measured}>${load.source === 'measured' ? 'measured' : 'partly measured'}${load.estimateCount > 0 ? ', estimate' : ''}</div>`}
                  </td>
                  <td>${load.source === 'rated' ? '-' : `${Math.round(load.averageWatts * 10) / 10} W`}</td>
                  <td>${load.voltage ? `${load.voltage} V${load.ac ? ' AC' : ''}` : '-'}</td>
                  <td>${formatAmps(load.amps)}</td>
                  <td>${load.ratingA ? `${load.ratingA} A` : 'none'}</td>
                  <td>
                    ${load.overRating && html`<span class="badge over-rating" title=${BADGE_HELP['over rating']}>over rating</span>`}
                    ${!load.overRating && incompleteReason(load) && html`
                      <span class="badge" title=${incompleteReason(load)}>incomplete</span>
                      <div class="meta incomplete-reason" data-testid="incomplete-reason">${incompleteReason(load)}</div>
                    `}
                    ${!load.overRating && !incompleteReason(load) && html`
                      <span class="badge ok" title=${BADGE_HELP.ok}>ok</span>
                    `}
                  </td>
                </tr>
              `
            })}
          </tbody>
        </table>
        <p class="meta load-legend" data-testid="load-legend">
          ${LEGEND.map(([name, text], i) => html`<span key=${name}>${i > 0 ? ' ' : ''}<strong>${name}</strong>: ${text}</span>`)}
        </p>
      `}
    </div>
  `
}

function ErrorBannerLocal ({ message }) {
  if (!message) return null
  return html`<div class="error-banner">${message}</div>`
}
