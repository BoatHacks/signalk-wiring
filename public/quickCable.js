// Pure helpers for the quick cable popover (plan 0016), shared by the
// schematic canvas and the floorplan connect tool. The popover builds the
// same values the full cable form builds and passes them through
// buildCablePayload, so validation and circuit derivation are shared.

import { kindByValue, defaultNegativeLanding, needsTerminal, terminalOptions, validateCable } from './cableForm.js'
import { supplyOrder, defaultKind } from './schematic.js'

// The kinds the popover offers: the three DC ones, plus the suggested kind
// when it is an AC or earth one.
export function popoverKinds (suggested, allKinds) {
  return allKinds.filter((k) => !k.more || k.value === suggested)
}

// For each conductor of the kind, the terminal to use at each end: the one
// the user dropped on when it carries that conductor, else the only terminal
// of that conductor on the device. `missing` lists the ends that need a
// choice the popover cannot make (a device with terminals where none fits).
export function resolveTerminals (kind, from, fromTerminal, to, toTerminal) {
  const terminals = {}
  const missing = []
  const pick = (device, chosen, conductor) => {
    const options = terminalOptions(device, conductor)
    const named = chosen && options.find((t) => t.name === chosen)
    if (named) return named.name
    if (options.length === 1) return options[0].name
    // The other conductors of the port the wire was dropped on: the "-" of
    // the port whose "+" was chosen.
    const dropped = chosen && (device.terminals || []).find((t) => t.name === chosen)
    if (dropped && dropped.port) {
      const inPort = options.filter((t) => t.port === dropped.port)
      if (inPort.length === 1) return inPort[0].name
    }
    if (needsTerminal(device)) return undefined
    return ''
  }
  for (const conductor of kindByValue(kind).conductors) {
    const f = pick(from, fromTerminal, conductor)
    const t = pick(to, toTerminal, conductor)
    if (f === undefined) missing.push({ device: from.name, conductor })
    if (t === undefined) missing.push({ device: to.name, conductor })
    terminals[conductor] = { from: f || '', to: t || '' }
  }
  return { terminals, missing }
}

// A dragged wire from device A (terminal ta) to device B (terminal tb)
// becomes a cable From the supply side To the load side. Returns the starting
// values for the popover and for the full form.
// `keepOrder` takes a and b as From and To as given (the floorplan tool asks
// for them in that order) instead of putting the supply side first.
export function startValues ({ a, ta, b, tb, cables, defaults = {}, keepOrder = false }) {
  const [from, to] = keepOrder ? [a, b] : supplyOrder(a, b)
  const swapped = from.id !== a.id
  const fromTerminal = swapped ? tb : ta
  const toTerminal = swapped ? ta : tb
  const kind = defaultKind(from, to)
  return {
    from,
    to,
    fromTerminal: fromTerminal || '',
    toTerminal: toTerminal || '',
    values: {
      fromDeviceId: from.id,
      toDeviceId: to.id,
      kind,
      colors: {},
      terminals: resolveTerminals(kind, from, fromTerminal, to, toTerminal).terminals,
      negativeLandingId: defaultNegativeLanding(cables) || '',
      existingConductors: [],
      gauge: '',
      gaugeUnit: defaults.gaugeUnit || '',
      length: '',
      lengthUnit: defaults.lengthUnit || '',
      cableLabel: '',
      zoneId: '',
      tags: [],
      notes: ''
    }
  }
}

// What stops the popover creating the cable right away; null when it can.
export function quickProblem (start, values) {
  const message = validateCable(values)
  if (message) return message
  const { missing } = resolveTerminals(values.kind, start.from, start.fromTerminal, start.to, start.toTerminal)
  if (missing.length) return `${missing[0].device} has several terminals: use More... to choose them.`
  return null
}

// Values with the terminals re-resolved for the chosen kind.
export function withKind (start, values, kind) {
  return {
    ...values,
    kind,
    terminals: resolveTerminals(kind, start.from, start.fromTerminal, start.to, start.toTerminal).terminals
  }
}
