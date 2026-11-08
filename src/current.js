'use strict'

// AC and DC awareness (plan 0019), the parts the server needs. The browser has
// the same table and rule in public/current.js and public/deviceTypes.js;
// test/current.test.mjs and test/current.test.js keep both equal.

const CURRENTS = ['ac', 'dc']

// Device types that are plainly AC or DC, matched case-insensitively on the
// whole type name. Everything else (converters, distribution, consumers) is
// left unset.
const AC_TYPES = ['Shore power inlet', 'Generator', 'Isolation transformer']
const DC_TYPES = [
  'Solar panel', 'Alternator', 'Wind generator', 'Hydro generator', 'Fuel cell',
  'Battery', 'Battery bank', 'Lead-acid battery', 'AGM battery', 'LiFePO4 battery',
  'Starter battery', 'House battery', 'Shunt', 'Battery isolator', 'Battery switch'
]

const TYPE_CURRENT = new Map([
  ...AC_TYPES.map((t) => [t.toLowerCase(), 'ac']),
  ...DC_TYPES.map((t) => [t.toLowerCase(), 'dc'])
])

// 'ac', 'dc' or null for a device type name.
function typeCurrent (type) {
  if (typeof type !== 'string') return null
  return TYPE_CURRENT.get(type.trim().toLowerCase()) || null
}

const AC_CONDUCTORS = ['line', 'neutral', 'earth']
const DC_CONDUCTORS = ['positive', 'negative']

// The current a terminal list agrees on: all positive/negative is dc, all
// line/neutral/earth is ac, anything mixed or empty is null.
function terminalsCurrent (terminals) {
  const list = Array.isArray(terminals) ? terminals : []
  if (list.length === 0) return null
  if (list.every((t) => DC_CONDUCTORS.includes(t.conductor))) return 'dc'
  if (list.every((t) => AC_CONDUCTORS.includes(t.conductor))) return 'ac'
  return null
}

// True when a cable's conductors include a line or neutral one and a positive
// or negative one. Earth and signal never count. Takes conductor objects or
// plain type names.
function mixesAcAndDc (conductors) {
  const types = (Array.isArray(conductors) ? conductors : []).map((c) => (c && c.conductor) || c)
  return types.some((t) => t === 'line' || t === 'neutral') &&
    types.some((t) => t === 'positive' || t === 'negative')
}

module.exports = { CURRENTS, AC_TYPES, DC_TYPES, typeCurrent, terminalsCurrent, mixesAcAndDc }
