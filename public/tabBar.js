// The tab bar (plan 0041): marks the current tab for assistive technology,
// keeps it in view when the bar scrolls sideways, and fades the edge where more
// tabs are hidden.
import { html, useEffect, useRef, useState } from './vendor/preact-standalone.module.js'

// Which edges of a scrolling row have more content: { left, right }. A small
// tolerance absorbs fractional scroll positions.
export function edgeState ({ scrollLeft, clientWidth, scrollWidth }, tolerance = 2) {
  return {
    left: scrollLeft > tolerance,
    right: scrollLeft + clientWidth < scrollWidth - tolerance
  }
}

export function TabBar ({ nav, tab, onSwitch }) {
  const ref = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = () => { if (ref.current) setEdges(edgeState(ref.current)) }

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [nav.length])

  // The current tab scrolls into view on load and when the route changes.
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('[aria-current="page"]')
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    measure()
  }, [tab])

  return html`
    <nav class=${'tabs' + (edges.left ? ' fade-left' : '') + (edges.right ? ' fade-right' : '')} ref=${ref} onScroll=${measure}>
      ${nav.map(([key, label]) => html`
        <button key=${key} class=${tab === key ? 'active' : ''} aria-current=${tab === key ? 'page' : undefined}
          onClick=${() => onSwitch(key)}>${label}</button>
      `)}
    </nav>
  `
}
