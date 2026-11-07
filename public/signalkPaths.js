import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js'

// Leaf paths of the vessel's data tree: nodes that carry a value. The
// meta, sentBy and per-source sub-trees are bookkeeping, not paths.
export function flattenPaths (tree) {
  const paths = []
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return
    if ('value' in node && ('timestamp' in node || '$source' in node)) {
      if (trail.length) paths.push(trail.join('.'))
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'meta' || key === 'sentBy' || key === 'values') continue
      walk(child, [...trail, key])
    }
  }
  walk(tree, [])
  return paths.sort()
}

// Every whitespace-separated term must appear in the path, in any order,
// so "bat volt" finds electrical.batteries.house.voltage. Paths where the
// first term starts the path, or a whole segment, rank first.
export function filterPaths (paths, query, limit = 12) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return paths.slice(0, limit)
  const scored = []
  for (const path of paths) {
    const lower = path.toLowerCase()
    if (!terms.every((t) => lower.includes(t))) continue
    const segments = lower.split('.')
    const rank = lower.startsWith(terms[0]) ? 0 : segments.includes(terms[0]) ? 1 : 2
    scored.push([rank, path])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
  return scored.slice(0, limit).map((s) => s[1])
}

let cachedPaths = null

// The data tree is read once per page load; it can be a couple of hundred
// kilobytes. Falls back to an empty list, so the field stays a plain text
// input if the request fails (a path can be documented before it exists).
export function useSignalkPaths () {
  const [paths, setPaths] = useState(cachedPaths || [])
  useEffect(() => {
    if (cachedPaths) return
    let cancelled = false
    fetch('/signalk/v1/api/vessels/self')
      .then((res) => (res.ok ? res.json() : null))
      .then((tree) => {
        if (!tree) return
        cachedPaths = flattenPaths(tree)
        if (!cancelled) setPaths(cachedPaths)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return paths
}

// A text input with a dropdown of matching paths that narrows as you type.
// Any text is accepted; the list only suggests.
export function PathCombobox ({ value, onChange, placeholder }) {
  const paths = useSignalkPaths()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const closeTimer = useRef(null)

  const matches = open ? filterPaths(paths, value || '') : []

  const choose = (path) => {
    onChange(path)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault()
      choose(matches[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return html`
    <div class="combobox">
      <input type="text" value=${value} placeholder=${placeholder || ''} autocomplete="off"
        onInput=${(e) => { onChange(e.target.value); setOpen(true); setActive(0) }}
        onFocus=${() => { clearTimeout(closeTimer.current); setOpen(true) }}
        onBlur=${() => { closeTimer.current = setTimeout(() => setOpen(false), 150) }}
        onKeyDown=${onKeyDown} />
      ${open && matches.length > 0 && html`
        <ul class="combobox-list">
          ${matches.map((p, i) => html`
            <li key=${p} class=${i === active ? 'active' : ''}
              onPointerDown=${(e) => { e.preventDefault(); choose(p) }}>${p}</li>
          `)}
        </ul>
      `}
    </div>
  `
}
