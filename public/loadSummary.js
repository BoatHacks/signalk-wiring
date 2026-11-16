import { html, useState, useEffect } from './vendor/preact-standalone.module.js'
import {
  calculateCircuitLoad, checkSummaryLine, incompleteReason, circuitsBehind, calculateBehindLoad, loadFindings, loadSummaryLine, isShownCircuit
} from './loadCalc.js'
import { readFlag, writeFlag } from './zones.js'
import { hashForState } from './router.js'
import { useSettings } from './settings.js'
import { checkAll, countVerdicts } from './cableChecks.js'
import { limitsFrom } from './cableCheckView.js'
import { useSort, SortHeader } from './sortView.js'
import { LoadError } from './loadError.js'

export { calculateCircuitLoad, checkSummaryLine, incompleteReason }

const RESOURCE_BASE = '/signalk/v2/api/resources'

async function fetchResourceMap (type) {
  const res = await fetch(`${RESOURCE_BASE}/${type}`)
  if (!res.ok) throw new Error(`failed to load ${type}: ${res.status}`)
  const map = await res.json()
  return Object.values(map)
}

// A small self-contained copy of app.js's useResourceList rather than
// importing it, since importing from app.js here would make app.js import
// LoadSummary and LoadSummary import app.js, a circular ES module
// dependency that's technically survivable (Preact hooks only run
// during render, after both modules finish evaluating) but fragile to
// get right. Same reasoning as import.js's own local putResource.
function useResourceList (type) {
  const [state, setState] = useState({ loading: true, error: null, items: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchResourceMap(type)
      .then((items) => { if (!cancelled) setState({ loading: false, error: null, items }) })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, items: [] }) })
    return () => { cancelled = true }
  }, [type, attempt])

  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

// Short explanations for the status badges and the load source labels, used
// as tooltips and in the legend under the table.
export const BADGE_HELP = {
  'over rating': 'The summed load is more than the fuse or breaker is rated for.',
  'over rating behind': 'The load of everything behind this fuse, added up as if it all ran at once, is more than the fuse or breaker is rated for.',
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
  return amps == null ? '-' : `${amps.toFixed(2)} A`
}

export function LoadSummary () {
  const { loading: circuitsLoading, error: circuitsError, retry: retryCircuits, items: circuits } = useResourceList('wiringCircuits')
  const { items: devices } = useResourceList('wiringDevices')
  const { items: cables } = useResourceList('wiringWireRuns')
  const { items: conduits } = useResourceList('wiringConduits')
  const settings = useSettings()

  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const activeCircuits = circuits.filter((c) => c.status === 'active' && c.derived)
  const loadOf = new Map(activeCircuits.map((c) => [c.id, calculateCircuitLoad(c, deviceById)]))
  const circuitById = new Map(activeCircuits.map((c) => [c.id, c]))
  // What is behind each fuse: the circuits that hang on what its cables end at,
  // and their summed load (plan 0043).
  const behind = circuitsBehind(activeCircuits, cables, deviceById)
  const behindOf = new Map()
  for (const c of activeCircuits) {
    const ids = (behind.get(c.id) || []).filter((id) => circuitById.has(id))
    if (ids.length === 0) continue
    behindOf.set(c.id, { circuits: ids.map((id) => circuitById.get(id)), load: calculateBehindLoad(c, ids.map((id) => circuitById.get(id)), deviceById) })
  }
  const behindLoadOf = (c) => (behindOf.has(c.id) ? behindOf.get(c.id).load : null)
  const findingOf = new Map(activeCircuits.map((c) => [c.id, loadFindings(loadOf.get(c.id), behindLoadOf(c))]))
  const shownOf = (c) => isShownCircuit(loadOf.get(c.id), behindLoadOf(c), findingOf.get(c.id))
  const folded = activeCircuits.filter((c) => !shownOf(c))
  const [showEmpty, setShowEmptyState] = useState(() => readFlag('loadSummaryEmpty', false))
  const setShowEmpty = (v) => { setShowEmptyState(v); writeFlag('loadSummaryEmpty', v) }
  const [openRows, setOpenRows] = useState(() => new Set())
  const toggleRow = (id) => setOpenRows((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const rows = activeCircuits.filter((c) => showEmpty || shownOf(c))
  const summaryLine = loadSummaryLine(activeCircuits.map((c) => findingOf.get(c.id)))
  const STATUS_RANK = (load, finding) => (finding.over ? 0 : incompleteReason(load) ? 1 : 2)
  const [sort, setSort, sorted] = useSort('loadSummary', {
    circuit: (c) => c.name,
    devices: (c) => loadOf.get(c.id).deviceCount,
    totalW: (c) => loadOf.get(c.id).totalWatts,
    averageW: (c) => (loadOf.get(c.id).source === 'rated' ? null : loadOf.get(c.id).averageWatts),
    voltage: (c) => loadOf.get(c.id).voltage,
    amps: (c) => loadOf.get(c.id).amps,
    protection: (c) => loadOf.get(c.id).ratingA,
    status: (c) => STATUS_RANK(loadOf.get(c.id), findingOf.get(c.id))
  })
  const checkLine = checkSummaryLine(countVerdicts(checkAll({ cables, circuits, devices, conduits, limits: limitsFrom(settings) })))

  return html`
    <div class="load-summary">
      <p class="meta">
        Total wattage is summed per circuit from the consumers it feeds and checked against the fuse or breaker
        that protects it. Advisory only, not a certified calculation.
      </p>
      <details class="how-worked-out" data-testid="how-worked-out">
        <summary>How this is worked out</summary>
        <p class="meta">
          A device that has an accepted calibration run counts at its <em>measured</em> peak, and every other at
          its rated power. The measured average is shown as well, for energy. Peaks are summed as if they all
          happened at once, which is a cautious figure. Total wattage is converted to amps using the voltage of
          its supply (on AC circuits, divided by each device's power factor where one is set), and checked against
          the rating of the fuse or breaker that protects it. A device fed by more than one circuit has its full
          wattage counted on <em>each</em> circuit it's wired into, which can overstate load on a circuit that's
          actually just a backup path. Treat this as a starting point, not a certified calculation.
        </p>
      </details>
      ${summaryLine && html`<p class="meta" data-testid="load-summary-line">${summaryLine}.</p>`}
      ${checkLine && html`
        <p class="meta check-summary" data-testid="check-summary">${checkLine}
          ${' '}<a class="route-link" href=${hashForState({ tab: 'cables' })}>See the Cables tab</a>.</p>
      `}
      ${folded.length > 0 && html`
        <label class="check-inline load-fold" data-testid="load-fold">
          <input type="checkbox" class="checkbox-input" checked=${showEmpty} onChange=${(e) => setShowEmpty(e.target.checked)} />
          Show ${folded.length} ${folded.length === 1 ? 'circuit' : 'circuits'} with no consumers
        </label>
      `}
      ${circuitsLoading && html`<div class="empty-state">Loading…</div>`}
      <${LoadError} message=${circuitsError} what="load summary" onRetry=${retryCircuits} />
      ${!circuitsLoading && !circuitsError && activeCircuits.length === 0 && html`
        <div class="empty-state">No circuits yet. They appear once cables join devices.</div>
      `}
      ${activeCircuits.length > 0 && html`
        <div class="table-scroll"><table>
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
            ${sorted(rows).flatMap((circuit) => {
              const load = loadOf.get(circuit.id)
              const finding = findingOf.get(circuit.id)
              const more = behindOf.get(circuit.id) || null
              const open = more && openRows.has(circuit.id)
              const main = html`
                <tr key=${circuit.id}>
                  <td>
                    ${more && html`<button type="button" class="zone-toggle" data-testid="behind-toggle" aria-expanded=${Boolean(open)}
                      aria-label=${open ? `Hide what is behind ${circuit.name}` : `Show what is behind ${circuit.name}`}
                      onClick=${() => toggleRow(circuit.id)}>${open ? '\u25BE' : '\u25B8'}</button>`}
                    <a class="route-link" href=${hashForState({ tab: 'circuits', id: circuit.id })}>${circuit.name}</a>
                  </td>
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
                    ${finding.overOwn && html`<span class="badge over-rating" title=${BADGE_HELP['over rating']}>over rating</span>`}
                    ${finding.overBehind && html`<span class="badge over-rating" data-testid="over-behind" title=${BADGE_HELP['over rating behind']}>over rating with everything behind it</span>`}
                    ${!finding.over && incompleteReason(load) && html`
                      <span class="badge" title=${incompleteReason(load)}>incomplete</span>
                      <div class="meta incomplete-reason" data-testid="incomplete-reason">${incompleteReason(load)}</div>
                    `}
                    ${!finding.over && !incompleteReason(load) && html`
                      <span class="ok-tick" role="img" aria-label="ok" title=${BADGE_HELP.ok}>\u2713</span>
                    `}
                  </td>
                </tr>`
              if (!open) return [main]
              const bl = more.load
              return [main, html`
                <tr key=${circuit.id + '-behind'} class="behind-row" data-testid="behind-row">
                  <td colspan="8">
                    <div class="behind-box">
                      <strong>Everything behind this fuse</strong>
                      <span class="meta">${more.circuits.length} ${more.circuits.length === 1 ? 'circuit' : 'circuits'}, ${Math.round(bl.totalWatts * 10) / 10} W${bl.amps != null ? `, ${bl.amps.toFixed(2)} A` : ''}${bl.ratingA ? ` of ${bl.ratingA} A` : ''}${bl.overRating ? ', over the rating' : ''}</span>
                      <ul class="behind-list">
                        ${more.circuits.map((c) => html`<li key=${c.id}><a class="route-link" href=${hashForState({ tab: 'circuits', id: c.id })}>${c.name}</a>
                          <span class="meta">${Math.round(loadOf.get(c.id).totalWatts * 10) / 10} W</span></li>`)}
                      </ul>
                      <p class="meta" data-testid="behind-advisory">Advisory only: peaks are added as if everything ran at once, each device counts once, and converter losses are not counted.</p>
                    </div>
                  </td>
                </tr>`]
            })}
          </tbody>
        </table></div>
        <p class="meta load-legend" data-testid="load-legend">
          ${LEGEND.map(([name, text], i) => html`<span key=${name}>${i > 0 ? ' ' : ''}<strong>${name}</strong>: ${text}</span>`)}
        </p>
      `}
    </div>
  `
}
