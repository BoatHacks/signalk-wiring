// The status badge and the bare mark (plan 0050, issue #35): the form of a
// status comes from statusMarks.js, the colors from the .status-* rules in
// style.css. The word is always visible next to the mark, so the mark is
// decoration and hidden from screen readers.
import { html } from './vendor/preact-standalone.module.js'
import { levelOf, markFor } from './statusMarks.js'
import { roleShape, shapePath } from './roles.js'

// A small inline SVG mark for a level.
export function StatusMark ({ level }) {
  const m = markFor(level)
  if (!m) return null
  return html`<svg class=${'status-mark mark-' + m.mark} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    ${m.parts.map((p, i) => html`<path key=${i} class=${'mk-' + p.role} d=${p.d} />`)}
  </svg>`
}

// A badge for a kind or level: mark and word in the form of the level. `tag` is
// 'span' or 'button'; extra props (test ids, handlers) pass through. A kind
// with no level is drawn as a plain badge.
export function StatusBadge ({ kind, text, tag = 'span', className = '', ...rest }) {
  const level = levelOf(kind)
  const cls = `badge ${level ? 'status-badge status-' + level : ''} ${className}`.trim()
  const Tag = tag
  return html`<${Tag} class=${cls} ...${rest}>${level && html`<${StatusMark} level=${level} />`}${text}<//>`
}

// A colored word with its mark, for a verdict inside a heading or a sentence.
export function StatusWord ({ kind, text, className = '' }) {
  const level = levelOf(kind)
  return html`<span class=${`status-word ${level ? 'status-' + level : ''} ${className}`.trim()}>${level && html`<${StatusMark} level=${level} />`}${text}</span>`
}

// The role shape as a small inline SVG, for the legend and the schematic corner.
export function RoleShape ({ role, size = 12 }) {
  const c = size / 2
  return html`<svg class=${'role-shape role-' + role} width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
    <path d=${shapePath(roleShape(role), c, c, c * 0.75)} />
  </svg>`
}
