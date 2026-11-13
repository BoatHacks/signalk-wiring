// The display of the cable checks (plan 0034): the badges on a cable row, the
// popover with the reasoning and the small helpers the tabs share. The checks
// themselves are in cableChecks.js.
import { html, useEffect, useRef } from './vendor/preact-standalone.module.js'
import { badgesFor, explain, TABLE_URL } from './cableChecks.js'
import { placePopover } from './popoverPlace.js'

const POP_SIZE = { width: 340, height: 360 }

// The limits in percent from the settings the webapp loaded.
export function limitsFrom (settings) {
  return {
    critical: settings.voltageDropLimitCritical,
    normal: settings.voltageDropLimitNormal
  }
}

const VERDICT_WORDS = { ok: 'ok', warning: 'warning', fail: 'too small', cannot: 'cannot check' }

// The badges of one result; each opens the reasoning. Nothing for a cable
// that has no result (signal only cables, removed cables).
//   onOpen(anchor): called with the screen point of the badge that was pressed.
export function CheckBadges ({ result, onOpen }) {
  const badges = badgesFor(result)
  if (badges.length === 0) return null
  return html`
    <span class="check-badges" data-testid="check-badges" data-verdict=${result.verdict}>
      ${badges.map((b) => html`
        <button type="button" key=${b.text} class=${`badge check-badge check-${b.kind}`} data-testid="check-badge" data-kind=${b.kind}
          title="Show how this was worked out"
          onClick=${(e) => { const r = e.currentTarget.getBoundingClientRect(); onOpen({ x: r.left + r.width / 2, y: r.bottom }) }}>${b.text}</button>
      `)}
    </span>
  `
}

// The reasoning of a result in a popover placed on screen near `anchor`.
// Closes on Escape, on a press outside it and on its Close button.
export function CheckPopover ({ result, title, anchor, onClose }) {
  const ref = useRef(null)
  const e = explain(result)
  useEffect(() => {
    const key = (ev) => { if (ev.key === 'Escape') onClose() }
    const press = (ev) => { if (ref.current && !ref.current.contains(ev.target) && !(ev.target.closest && ev.target.closest('.check-badge'))) onClose() }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', press, true)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', press, true) }
  }, [onClose])
  if (!e) return null
  const place = placePopover(anchor, POP_SIZE, { width: window.innerWidth, height: window.innerHeight })
  return html`
    <div class="check-popover" role="dialog" aria-label="Cable check reasoning" data-testid="check-popover" ref=${ref}
      style=${`left:${place.left}px;top:${place.top}px;max-width:${place.maxWidth}px;max-height:${place.maxHeight}px`}>
      <div class="check-pop-head"><strong>${title}</strong>
        <button type="button" class="link-btn" data-testid="check-close" onClick=${onClose}>Close</button></div>
      <div class="meta">Advisory. ${e.circuits.length ? `Circuit: ${e.circuits.join(', ')}.` : 'Not part of a circuit.'}</div>
      ${e.sections.map((s) => html`
        <div class="check-section" key=${s.heading}>
          <div class="check-heading">${s.heading}: <span class=${`check-verdict check-${s.verdict}`}>${VERDICT_WORDS[s.verdict] || s.verdict}</span></div>
          <ul>${s.lines.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>
        </div>
      `)}
      <div class="check-heading">Assumptions</div>
      <ul>${e.assumptions.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>
      <div class="check-note" data-testid="check-note">${e.note}</div>
      <div class="meta"><a href=${TABLE_URL} target="_blank" rel="noopener">The table, its sources and assumptions</a></div>
    </div>
  `
}
