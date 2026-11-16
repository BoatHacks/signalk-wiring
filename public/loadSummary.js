import { html, useState, useEffect } from './vendor/preact-standalone.module.js'
import { calculateCircuitLoad, checkSummaryLine, incompleteReason } from './loadCalc.js'
import { hashForState } from './router.js'
import { useSettings } from './settings.js'
import { checkAll, countVerdicts } from './cableChecks.js'
import { limitsFrom } from './cableCheckView.js'
import { useSort, SortHeader } from './sortView.js'

export { calculateCircuitLoad, checkSummaryLine, incompleteReason }

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
  ['incomplete', 'The voltage, the supply or the fuse or breaker rating is missing, so no check can be made.'],
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
  const loadOf = new Map(activeCircuits.map((c) => [c.id, calculateCircuitLoad(c, deviceById)]))
  const STATUS_RANK = (load) => (load.overRating ? 0 : incompleteReason(load) ? 1 : 2)
  const [sort, setSort, sorted] = useSort('loadSummary', {
    circuit: (c) => c.name,
    devices: (c) => loadOf.get(c.id).deviceCount,
    totalW: (c) => loadOf.get(c.id).totalWatts,
    averageW: (c) => (loadOf.get(c.id).source === 'rated' ? null : loadOf.get(c.id).averageWatts),
    voltage: (c) => loadOf.get(c.id).voltage,
    amps: (c) => loadOf.get(c.id).amps,
    protection: (c) => loadOf.get(c.id).ratingA,
    status: (c) => STATUS_RANK(loadOf.get(c.id))
  })
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
              <${SortHeader} label="Circuit" k="circuit" sort=${sort} onSort=${setSort} />
              <${SortHeader} label="Devices" k="devices" sort=${sort} onSort=${setSort} />
              <${SortHeader} label="Total W" k="totalW" sort=${sort} onSort=${setSort} />
              <${SortHeader} label="Average W" k="averageW" sort=${sort} onSort=${setSort} />
              <${SortHeader} label="Voltage" k="voltage" sort=${sort} onSort=${setSort} />
              <${SortHeader} label="Amps" k="amps" sort=${sort} onSort=${setSort} />
              <${SortHeader} label="Protection" k="protection" sort=${sort} onSort=${setSort} />
              <${SortHeader} label="Status" k="status" sort=${sort} onSort=${setSort} />
            </tr>
          </thead>
          <tbody>
            ${sorted(activeCircuits).map((circuit) => {
              const load = loadOf.get(circuit.id)
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
