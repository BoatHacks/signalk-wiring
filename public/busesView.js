// The display of the bus checks (plan 0037): the verdict badge and the section
// with every check, its numbers, reasoning and sources. The checks come from
// GET /buses; nothing here works a limit out.
import { html } from './vendor/preact-standalone.module.js'
import { verdictWord, BUS_ADVISORY } from './buses.js'

export function VerdictBadge ({ verdict }) {
  if (!verdict) return null
  return html`<span class=${`badge check-badge check-${verdict}`} data-testid="bus-verdict" data-verdict=${verdict}>${verdictWord(verdict)}</span>`
}

export function BusChecks ({ entry }) {
  if (!entry) return html`<div class="empty-state">No checks for this bus (it may be removed).</div>`
  return html`
    <div class="bus-checks" data-testid="bus-checks">
      ${entry.checks.map((c) => html`
        <details class="check-section" key=${c.id} data-testid="bus-check" data-verdict=${c.verdict} open=${c.verdict === 'fail' || c.verdict === 'warning'}>
          <summary><strong>${c.title}</strong>: <span class=${`check-verdict check-${c.verdict}`}>${verdictWord(c.verdict)}</span></summary>
          <ul>${(c.reasoning || []).map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>
          ${(c.missing || []).length > 0 && html`<div class="meta">Missing: ${c.missing.join('; ')}</div>`}
          ${(c.sources || []).length > 0 && html`
            <div class="meta">Sources: ${c.sources.map((s, i) => html`<span key=${s.id}>${i > 0 ? '; ' : ''}<a class="route-link" href=${s.url} target="_blank" rel="noopener">${s.publisher}</a>${s.says ? ` (${s.says})` : ''}</span>`)}</div>
          `}
        </details>
      `)}
      ${(entry.assumptions || []).length > 0 && html`
        <div class="check-heading">Assumptions</div>
        <ul>${entry.assumptions.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>
      `}
      <div class="check-note" data-testid="check-note">${entry.note || BUS_ADVISORY}</div>
    </div>
  `
}
