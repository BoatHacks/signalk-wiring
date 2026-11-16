// The Floorplan legend and the plan settings disclosure body (plan 0041).
// A small static legend: what the dot colors, numbered badges, line styles and
// edge arrows on a plan mean. Always available, not only in Live mode.
import { html } from './vendor/preact-standalone.module.js'

const ROLE_SWATCHES = [
  ['consumer', 'Consumer'], ['source', 'Source'], ['storage', 'Storage'], ['distribution', 'Distribution'], ['converter', 'Converter']
]

export function FloorplanLegend () {
  return html`
    <details class="show-menu legend-menu" data-testid="floorplan-legend">
      <summary>Legend</summary>
      <div class="show-menu-body legend-body">
        <div class="legend-row"><span class="meta">Device dots</span>
          <span class="legend-swatches">${ROLE_SWATCHES.map(([role, label]) => html`
            <span class="legend-item" key=${role}><i class=${'legend-dot role-' + role}></i>${label}</span>`)}
          </span>
        </div>
        <div class="legend-row"><span class="legend-item"><i class="legend-badge">3</i></span>
          <span>A number on a box is that many devices close together (click it to list them). A number on a line is that many cables along the same path.</span>
        </div>
        <div class="legend-row"><span class="legend-item"><i class="legend-line cable"></i></span><span>A cable route.</span></div>
        <div class="legend-row"><span class="legend-item"><i class="legend-line conduit"></i></span><span>A conduit, hose or tray.</span></div>
        <div class="legend-row"><span class="legend-item"><i class="legend-line chosen"></i></span><span>The chosen cable or circuit.</span></div>
        <div class="legend-row"><span class="legend-item legend-arrow" aria-hidden="true">→</span>
          <span>A thin arrow at a route's end means the cable crosses over to a different plan here. Point at it to see which plan, click it to go there.</span>
        </div>
      </div>
    </details>
  `
}
