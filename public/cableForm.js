// Pure helpers for the cable form (plan 0014): which conductors a cable
// carries, how the form values become a wire run and back, which terminals
// are worth asking for, and the default for the negative landing.

// DC first: the three common choices. AC and earth sit behind "More".
export const CABLE_KINDS = [
  { value: 'positive', label: 'Positive', conductors: ['positive'], more: false },
  { value: 'negative', label: 'Negative', conductors: ['negative'], more: false },
  { value: 'both', label: 'Positive + negative', conductors: ['positive', 'negative'], more: false },
  { value: 'line', label: 'AC line', conductors: ['line'], more: true },
  { value: 'ac', label: 'AC line, neutral and earth', conductors: ['line', 'neutral', 'earth'], more: true },
  { value: 'earth', label: 'Earth', conductors: ['earth'], more: true }
]

export const CONDUCTOR_LABELS = {
  positive: 'Positive',
  negative: 'Negative',
  line: 'AC line',
  neutral: 'AC neutral',
  earth: 'Earth'
}

export function kindByValue (value) {
  return CABLE_KINDS.find((k) => k.value === value) || CABLE_KINDS[0]
}

// The kind that matches a cable's conductors, so editing opens on it.
// A cable with none listed is a single positive conductor. Anything that
// matches no kind is 'custom': the editor keeps its conductors as they are.
export function kindOfConductors (conductors) {
  const types = (conductors || []).map((c) => c.conductor)
  if (types.length === 0) return 'positive'
  const found = CABLE_KINDS.find((k) =>
    k.conductors.length === types.length && k.conductors.every((c) => types.includes(c)))
  return found ? found.value : 'custom'
}

// The negative landing to offer first: the device the most recently listed
// live cable lands its negative on at the supply end. Cables are in the order
// they were listed, so the last one wins. Null when no cable has one yet.
export function defaultNegativeLanding (cables) {
  for (let i = cables.length - 1; i >= 0; i--) {
    const cable = cables[i]
    if (cable.status === 'removed') continue
    const negative = (cable.conductors || []).find((c) => c.conductor === 'negative')
    if (!negative) continue
    const landing = negative.fromDeviceId || (kindOfConductors(cable.conductors) === 'negative' ? cable.fromDeviceId : null)
    if (landing) return landing
  }
  return null
}

// Devices that can take a negative landing: bus bars and other distribution
// devices, and batteries and sources (a post). Newest-used first is the
// caller's job; this keeps them in the given order.
export function negativeLandingCandidates (devices) {
  return devices.filter((d) =>
    d.status !== 'removed' && ['distribution', 'storage', 'source'].includes(d.role || 'consumer'))
}

// Terminals are asked for only where they remove ambiguity: on a converter
// (each port is a side of it) and on a device with several terminals.
export function needsTerminal (device) {
  if (!device) return false
  const terminals = device.terminals || []
  return terminals.length > 0 && (device.role === 'converter' || terminals.length > 1)
}

// The terminals of a device that suit a conductor type, in order.
export function terminalOptions (device, conductor) {
  return ((device && device.terminals) || []).filter((t) => t.conductor === conductor)
}

const blank = (v) => v === '' || v === null || v === undefined

// Form values -> wire run resource.
//   values: { fromDeviceId, toDeviceId, kind, colors: {conductor: text},
//             negativeLandingId, terminals: {conductor: {from, to}},
//             existingConductors (kept as they are for a 'custom' kind),
//             gauge, gaugeUnit, length, lengthUnit, cableLabel, zoneId, tags,
//             notes }
export function buildCablePayload (values) {
  const out = {
    fromDeviceId: values.fromDeviceId,
    toDeviceId: values.toDeviceId
  }
  for (const key of ['gauge', 'length']) if (!blank(values[key])) out[key] = Number(values[key])
  for (const key of ['gaugeUnit', 'lengthUnit', 'cableLabel', 'notes']) if (!blank(values[key])) out[key] = values[key]
  // Cleared zone and tags must reach the server, so they are always sent.
  out.zoneId = blank(values.zoneId) ? null : values.zoneId
  if (values.tags !== undefined) out.tags = values.tags

  if (values.kind === 'custom') {
    out.conductors = values.existingConductors || []
    return out
  }
  const kind = kindByValue(values.kind)
  const both = kind.conductors.includes('negative') && kind.conductors.includes('positive')
  out.conductors = kind.conductors.map((conductor) => {
    const terminals = (values.terminals && values.terminals[conductor]) || {}
    const c = {
      conductor,
      color: blank(values.colors && values.colors[conductor]) ? null : values.colors[conductor].trim(),
      fromTerminal: blank(terminals.from) ? null : terminals.from,
      toTerminal: blank(terminals.to) ? null : terminals.to
    }
    // The negative of a two-conductor cable starts on its own device (a
    // negative bus bar or battery post), not at the fuse the positive uses.
    if (both && conductor === 'negative' && !blank(values.negativeLandingId) && values.negativeLandingId !== values.fromDeviceId) {
      c.fromDeviceId = values.negativeLandingId
    }
    return c
  })
  return out
}

// Wire run resource -> form values (the reverse of buildCablePayload).
export function cableToValues (cable) {
  const conductors = cable.conductors || []
  const kind = kindOfConductors(conductors)
  const colors = {}
  const terminals = {}
  for (const c of conductors) {
    colors[c.conductor] = c.color || ''
    terminals[c.conductor] = { from: c.fromTerminal || '', to: c.toTerminal || '' }
  }
  const negative = conductors.find((c) => c.conductor === 'negative')
  return {
    fromDeviceId: cable.fromDeviceId || '',
    toDeviceId: cable.toDeviceId || '',
    kind,
    colors,
    terminals,
    negativeLandingId: kind === 'both' ? (negative && negative.fromDeviceId) || cable.fromDeviceId || '' : '',
    existingConductors: conductors,
    gauge: cable.gauge ?? '',
    gaugeUnit: cable.gaugeUnit || '',
    length: cable.length ?? '',
    lengthUnit: cable.lengthUnit || '',
    cableLabel: cable.cableLabel || '',
    zoneId: cable.zoneId || '',
    tags: cable.tags || [],
    notes: cable.notes || ''
  }
}

// A readable name for a cable: its label, else "From to To".
export function cableTitle (cable, deviceNameById) {
  if (cable.cableLabel) return cable.cableLabel
  const name = (id) => (id ? deviceNameById.get(id) || '?' : '?')
  return `${name(cable.fromDeviceId)} to ${name(cable.toDeviceId)}`
}

// What to check before saving; returns a message or null.
export function validateCable (values) {
  if (!values.fromDeviceId) return 'Choose the supply side (From).'
  if (!values.toDeviceId) return 'Choose the load side (To).'
  if (values.fromDeviceId === values.toDeviceId) return 'From and To must be different devices.'
  return null
}

// The circuits a cable is part of, from the circuit resources: its own feed
// circuit and every circuit its negative serves.
export function circuitsOfCable (cableId, circuits) {
  return circuits
    .filter((c) => c.status !== 'removed' && c.derived &&
      (c.derived.cableIds.includes(cableId) || c.derived.returnCableIds.includes(cableId)))
    .map((c) => ({ circuit: c, via: c.derived.cableIds.includes(cableId) ? 'feed' : 'return' }))
}
