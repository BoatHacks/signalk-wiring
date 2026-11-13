import { normalizeHex } from './colorTone.js'

// Pure helpers for the extra device fields of plan 0014: a trip rating on
// fuses and breakers, a nominal voltage on batteries and sources, a power
// factor on consumers of an AC circuit, and terminals.

// Whether a field applies to the device being edited.
//   values: the form values so far (role, terminals);
//   context.acDeviceIds: ids of devices whose circuit is AC (from the derived circuits);
//   context.deviceId: the device being edited, if it exists yet.
export function deviceFieldVisible (key, values, context = {}) {
  const role = values.role || 'consumer'
  switch (key) {
    case 'tripRatingA': return role === 'distribution'
    // Only an enclosure's contents carry power, so the power fields do not apply to it.
    case 'ratedPowerW': case 'current': return role !== 'enclosure'
    // Ratings are printed on switches, breakers, fuses, bus bars and panels.
    case 'ratedAcA': case 'ratedAcV': case 'ratedDcA': case 'ratedDcV': return role === 'distribution'
    case 'nominalVoltage': return role === 'storage' || role === 'source'
    case 'powerFactor':
      return role === 'consumer' && Boolean(context.deviceId) &&
        Boolean(context.acDeviceIds && context.acDeviceIds.has(context.deviceId))
    // Terminals only remove ambiguity on converters (ports), batteries with
    // several posts and fuse blocks, so consumers and sources show the editor
    // only when they already have some.
    case 'terminals':
      // An enclosure has none: cables land on what is inside it.
      if (role === 'enclosure') return false
      return !['consumer', 'source'].includes(role) || (Array.isArray(values.terminals) && values.terminals.length > 0)
    default: return true
  }
}

// Ids of the consumers that sit on an AC circuit, from the circuit resources.
export function acConsumerIds (circuits) {
  const ids = new Set()
  for (const circuit of circuits) {
    if (circuit.status === 'removed' || !circuit.derived || !circuit.derived.ac) continue
    for (const id of circuit.derived.endDeviceIds) ids.add(id)
  }
  return ids
}

// Trims names and drops rows with none; voltage is a number or null, the
// port is kept only when it has text.
export function cleanTerminals (list) {
  return (list || [])
    .map((t) => ({
      name: String(t.name || '').trim(),
      conductor: t.conductor || 'positive',
      voltage: t.voltage === '' || t.voltage == null || Number.isNaN(Number(t.voltage)) ? null : Number(t.voltage),
      port: String(t.port || '').trim() || null
    }))
    .filter((t) => t.name)
}

// The distinct port names of a device's terminals, in order.
export function portNames (terminals) {
  const seen = []
  for (const t of terminals || []) if (t.port && !seen.includes(t.port)) seen.push(t.port)
  return seen
}

// A one-line description of a terminal, for lists.
export function describeTerminal (t) {
  return [t.name, t.conductor, t.voltage != null ? `${t.voltage} V` : null, t.port ? `port ${t.port}` : null]
    .filter(Boolean).join(', ')
}

// Standard ports and terminals for common converters, so a new device of that
// type starts with them. Names are "<port> <pin>" and unique within a device.
const dc = (port) => [
  { name: `${port} +`, conductor: 'positive', port },
  { name: `${port} -`, conductor: 'negative', port }
]
const ac = (port) => [
  { name: `${port} L`, conductor: 'line', port },
  { name: `${port} N`, conductor: 'neutral', port },
  { name: `${port} PE`, conductor: 'earth', port }
]
const signal = (port) => [{ name: port, conductor: 'signal', port }]

const TERMINAL_PRESETS = [
  { match: /multi\s*plus/i, label: 'MultiPlus', terminals: () => [
    ...dc('DC in'), ...ac('AC in'), ...ac('AC out 1'), ...ac('AC out 2'),
    ...signal('VE.Bus'), ...signal('Relay 1'), ...signal('Relay 2')
  ] },
  { match: /^\s*dc-?dc( converter)?\s*$/i, label: 'DC-DC converter', terminals: () => [...dc('DC in'), ...dc('DC out')] },
  { match: /^\s*mppt( charger)?\s*$/i, label: 'MPPT charger', terminals: () => [...dc('PV in'), ...dc('Battery')] },
  { match: /^\s*inverter\/charger\s*$/i, label: 'Inverter/charger', terminals: () => [...dc('DC in'), ...ac('AC in'), ...ac('AC out')] },
  { match: /^\s*inverter\s*$/i, label: 'Inverter', terminals: () => [...dc('DC in'), ...ac('AC out')] },
  { match: /^\s*battery charger\s*$/i, label: 'Battery charger', terminals: () => [...ac('AC in'), ...dc('DC out')] }
]

// The standard terminals for a device type, or null when there is none.
// Returned as form rows (voltage is an empty string).
export function terminalPreset (type) {
  const found = TERMINAL_PRESETS.find((p) => p.match.test(String(type || '')))
  return found ? { label: found.label, terminals: found.terminals().map((t) => ({ ...t, voltage: '' })) } : null
}

// The rated values of a device as one line, "Rated: DC 300 A, 58 V" or
// "Rated: AC 16 A, 230 V; DC 16 A, 48 V", or null when none is set. A side
// with only a current or only a voltage shows just that value.
export function ratedLine (device) {
  const side = (label, amps, volts) => {
    const parts = []
    if (amps != null) parts.push(`${amps} A`)
    if (volts != null) parts.push(`${volts} V`)
    return parts.length ? `${label} ${parts.join(', ')}` : null
  }
  const sides = [
    side('AC', device.ratedAcA, device.ratedAcV),
    side('DC', device.ratedDcA, device.ratedDcV)
  ].filter(Boolean)
  return sides.length ? `Rated: ${sides.join('; ')}` : null
}

// The state of a device color field from the text typed in it (plan 0030).
// Empty means the theme color: valid, nothing stored. `value` is what is
// saved (lower case #rrggbb or null) and `picker` what the native color
// picker shows (it cannot be empty, so it falls back to black).
export function colorFieldState (text) {
  const raw = String(text == null ? '' : text).trim()
  if (raw === '') return { valid: true, value: null, picker: '#000000', message: null }
  const hex = normalizeHex(raw)
  if (!hex) return { valid: false, value: null, picker: '#000000', message: 'Not a hex color. Use #rrggbb or #rgb, for example #1a2b3c, or clear it for the theme color.' }
  return { valid: true, value: hex, picker: hex, message: null }
}
