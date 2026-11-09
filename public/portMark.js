// The small symbol drawn inside a conductor dot on a port (plan 0023): "="
// for a DC conductor, "~" for an AC one, a two-way arrow for a signal wire and
// the grounding symbol for an earth conductor. Pure.

// `conductor` is the terminal's conductor type, `current` the device's
// current mark ('ac', 'dc' or empty) used when the conductor says nothing.
// Returns 'dc', 'ac', 'signal', 'ground' or null.
export function portMark (conductor, current) {
  if (conductor === 'positive' || conductor === 'negative') return 'dc'
  if (conductor === 'line' || conductor === 'neutral') return 'ac'
  if (conductor === 'signal') return 'signal'
  if (conductor === 'earth') return 'ground'
  if (current === 'ac' || current === 'dc') return current
  return null
}

// SVG path data for each kind, drawn around (0, 0) inside a dot of radius 5.5.
export const MARK_PATHS = {
  dc: 'M-3 -1.5H3 M-3 1.5H3',
  ac: 'M-3.4 0Q-1.7 -3.2 0 0T3.4 0',
  signal: 'M-3.4 0H3.4 M-1.7 -1.7L-3.4 0L-1.7 1.7 M1.7 -1.7L3.4 0L1.7 1.7',
  ground: 'M0 -3.8V-0.9 M-3.2 -0.9H3.2 M-2.1 1H2.1 M-1 2.9H1'
}

export const DOT_RADIUS = 5.5
