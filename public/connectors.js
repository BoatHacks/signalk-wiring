// The physical connector of a terminal or port (plan 0047): a kind from a list
// (or free text), an optional size, an optional gender and an optional pin
// count. Pure helpers, no DOM.

export const CONNECTOR_KINDS = {
  terminal: [
    'M5 stud', 'M6 stud', 'M8 stud', 'M10 stud', 'Screw terminal', 'Ferrule',
    'Ring terminal', 'Spade', 'Push-in spring', 'Anderson-style plug'
  ],
  port: [
    'Schuko', 'IEC inlet', 'RJ45', 'Power connector', 'Serial (DB9)', 'USB-A', 'USB-B',
    'USB-C', 'M12', 'VE.Direct', 'CAN', 'NMEA 2000 micro'
  ]
}

export const CONNECTOR_GENDERS = ['socket', 'plug']

// The options for a connector dropdown: the two groups, then any other kinds in
// use (including the current value, so a free-text kind is never lost), sorted,
// with no case-insensitive repeats.
export function connectorOptions (usedKinds, current) {
  const seen = new Set([...CONNECTOR_KINDS.terminal, ...CONNECTOR_KINDS.port].map((k) => k.toLowerCase()))
  const used = []
  for (const raw of [...(usedKinds || []), current]) {
    const kind = typeof raw === 'string' ? raw.trim() : ''
    if (!kind || seen.has(kind.toLowerCase())) continue
    seen.add(kind.toLowerCase())
    used.push(kind)
  }
  used.sort((a, b) => a.localeCompare(b))
  return { terminal: CONNECTOR_KINDS.terminal, port: CONNECTOR_KINDS.port, used }
}

// The four connector fields of a form row as stored values: trimmed text or
// null, a gender from the list or null, pins a whole number of 1 or more or null.
export function cleanConnector (t) {
  const text = (v) => String(v == null ? '' : v).trim() || null
  const pins = t && t.pins !== '' && t.pins != null ? Number(t.pins) : null
  const gender = text(t && t.gender)
  return {
    connector: text(t && t.connector),
    size: text(t && t.size),
    gender: CONNECTOR_GENDERS.includes(gender) ? gender : null,
    pins: Number.isInteger(pins) && pins >= 1 ? pins : null
  }
}

// A compact line, for example "M8 stud", "Ferrule 1.5 mm2" or "RJ45 socket 8 pins".
// Empty when nothing is recorded.
export function describeConnector (t) {
  if (!t) return ''
  const c = cleanConnector(t)
  const size = c.size && c.connector && c.connector.toLowerCase().includes(c.size.toLowerCase()) ? null : c.size
  return [c.connector, size, c.gender, c.pins ? `${c.pins} pin${c.pins === 1 ? '' : 's'}` : null].filter(Boolean).join(' ')
}

// True when any connector field is set, to open the "more" fields of an editor row.
export function hasConnectorExtras (t) {
  const c = cleanConnector(t)
  return Boolean(c.gender || c.pins)
}
