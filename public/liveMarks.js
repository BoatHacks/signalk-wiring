// Small shared drawing pieces of the Live mode, for SVG views (floorplan,
// circuit diagram, schematics) and a legend/status bar. Colours come from
// the theme tokens in style.css (--live-on, --live-off), so the red night
// theme keeps working.

import { html } from './vendor/preact-standalone.module.js'

// A padlock, drawn from rectangles and a path so it needs no font. (x, y) is
// the centre; size is its height.
export function LiveLock ({ x, y, size }) {
  const w = size * 0.8
  const bodyH = size * 0.55
  const top = y - size / 2
  return html`
    <g class="live-lock" style="pointer-events: none">
      <path d="M ${x - w * 0.28} ${top + size * 0.45} v ${-size * 0.18} a ${w * 0.28} ${w * 0.28} 0 0 1 ${w * 0.56} 0 v ${size * 0.18}"
        fill="none" stroke-width=${size * 0.12} />
      <rect x=${x - w / 2} y=${top + size - bodyH} width=${w} height=${bodyH} rx=${size * 0.1} />
    </g>
  `
}

// The reading under a marker, for example "36 W".
export function LiveReading ({ x, y, size, text, stale }) {
  if (!text) return null
  return html`<text class=${stale ? 'live-reading stale' : 'live-reading'} x=${x} y=${y} font-size=${size} text-anchor="middle">${text}</text>`
}

// What the colours mean, and the connection state, above a Live view.
export function LiveBar ({ live, error }) {
  return html`
    <div class="live-bar" data-testid="live-bar">
      <span class="live-legend"><i class="live-swatch on"></i> on</span>
      <span class="live-legend"><i class="live-swatch off"></i> off</span>
      <span class="live-legend"><i class="live-swatch unknown"></i> state unknown</span>
      <span class="live-legend"><i class="live-swatch fixed"></i> cannot be switched remotely</span>
      <span class="live-legend"><i class="live-swatch locked"></i> never switched remotely</span>
      <span class="meta live-status" data-testid="live-status">
        ${error ? error : !live.live ? 'Loading…' : live.connected ? 'Connected to the SignalK stream.' : 'Connecting to the SignalK stream…'}
      </span>
    </div>
    <p class="meta">Click a lamp or any other consumer to switch it on or off through the relay that feeds it. Where a relay feeds several consumers, they all switch together.</p>
  `
}
