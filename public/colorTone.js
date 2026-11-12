// Pure color helpers for device colors (plan 0030). No DOM, no imports.

// Parses "#rrggbb" or "#rgb" (any case) into [r, g, b] 0..255, or null.
export function parseHex (text) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(text == null ? '' : text).trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

// "#rrggbb" in lower case, or null when the text is not a hex color.
export function normalizeHex (text) {
  const rgb = parseHex(text)
  return rgb ? toHex(rgb) : null
}

export function toHex (rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}
