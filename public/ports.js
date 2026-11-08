// Drawing of a device's terminals, shared by the schematic canvas and the
// circuit diagram. A device with more than one terminal shows each as a dot
// coloured by its conductor, the name (and port) as hover text. A device
// whose terminals name ports also shows each port as a block with its name
// written on the box and its terminals grouped inside.

import { html } from './vendor/preact-standalone.module.js'

function shorten (text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// `box` comes from deviceBox; (originX, originY) is where the drawing's
// local (0, 0) sits in the box's coordinates.
export function PortBlocks ({ box, originX = box.x, originY = box.y }) {
  const hasPorts = (box.ports || []).length > 0
  if (box.terminals.length < 2 && !hasPorts) return null
  return html`
    <g class="sch-ports">
      ${(box.ports || []).map((p) => html`
        <g key=${p.name || '(unnamed)'} class="sch-port" data-port=${p.name}>
          <rect x=${p.block.x} y=${p.block.y} width=${p.block.w} height=${p.block.h} rx="6" class="sch-port-block" />
          ${p.label && html`<text x=${p.label.x} y=${p.label.y} text-anchor=${p.label.anchor} class="sch-port-label">${shorten(p.name, 16)}</text>`}
        </g>
      `)}
      ${box.terminals.map((t) => html`
        <circle key=${t.name} cx=${t.x - originX} cy=${t.y - originY} r="4" class="sch-terminal c-${t.conductor}" data-terminal=${t.name}>
          <title>${t.name}${t.port ? ` (${t.port})` : ''}</title>
        </circle>
      `)}
    </g>
  `
}
