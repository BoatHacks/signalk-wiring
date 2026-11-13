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

// The theme surfaces a box tint is mixed into. They match --surface-alt in
// style.css for the light theme and the red night theme.
export const DAY_SURFACE = '#f7f7f5'
export const NIGHT_SURFACE = '#262a31'

// Share of the custom color in a box fill.
export const TINT = 0.18

// The fill of a colored box: TINT of the color mixed into the theme surface.
// Returns "#rrggbb", or null when either value is not a hex color.
export function boxFill (hex, surface = DAY_SURFACE, share = TINT) {
  const c = parseHex(hex)
  const s = parseHex(surface)
  if (!c || !s) return null
  return toHex(c.map((v, i) => s[i] + (v - s[i]) * share))
}

// The brightest red channel a night tone may have, so a box never glares.
export const NIGHT_MAX_RED = 190
const NIGHT_MIN_RED = 95

// Night theme: the color's perceived brightness (0 black to 1 white) mapped to
// a dim red of the same relative brightness, capped at NIGHT_MAX_RED. Green
// and blue are small fractions of red so the result stays in the red family.
export function nightTone (hex) {
  const c = parseHex(hex)
  if (!c) return null
  const [r, g, b] = c.map((v) => v / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const red = NIGHT_MIN_RED + (NIGHT_MAX_RED - NIGHT_MIN_RED) * lum
  return toHex([red, red * 0.24, red * 0.2])
}

// Everything the schematic needs for a device color, or null for no color:
// day outline and fill, night outline and fill.
export function boxColors (hex) {
  const day = normalizeHex(hex)
  if (!day) return null
  const night = nightTone(day)
  return { stroke: day, fill: boxFill(day, DAY_SURFACE), nightStroke: night, nightFill: boxFill(night, NIGHT_SURFACE) }
}
