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
    case 'nominalVoltage': return role === 'storage' || role === 'source'
    case 'powerFactor':
      return role === 'consumer' && Boolean(context.deviceId) &&
        Boolean(context.acDeviceIds && context.acDeviceIds.has(context.deviceId))
    // Terminals only remove ambiguity on converters (ports), batteries with
    // several posts and fuse blocks, so consumers and sources show the editor
    // only when they already have some.
    case 'terminals':
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
