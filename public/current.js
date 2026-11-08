// AC and DC awareness (plan 0019): which current each end of a cable carries
// and which cable type that suggests. Pure. The server has the type table and
// mixesAcAndDc in src/current.js; tests keep both in step.

import { defaultKind } from './schematic.js'

// 'ac' for line, neutral and earth, 'dc' for positive and negative, null for
// signal or anything else.
export function conductorCurrent (conductorType) {
  if (conductorType === 'line' || conductorType === 'neutral' || conductorType === 'earth') return 'ac'
  if (conductorType === 'positive' || conductorType === 'negative') return 'dc'
  return null
}

// The current a device's terminals agree on: all AC or all DC. Mixed, signal
// only or none is unknown.
function terminalsCurrent (device) {
  const terminals = device.terminals || []
  if (terminals.length === 0) return null
  const set = new Set(terminals.map((t) => conductorCurrent(t.conductor)))
  return set.size === 1 && !set.has(null) ? [...set][0] : null
}

// The current at one end of a cable: the terminal dropped on decides, else
// the device mark, else what all its terminals agree on, else null.
export function endCurrent (device, terminalName) {
  if (!device) return null
  if (terminalName) {
    const terminal = (device.terminals || []).find((t) => t.name === terminalName)
    if (terminal) {
      if (terminal.conductor === 'signal') return null
      const fromTerminal = conductorCurrent(terminal.conductor)
      if (fromTerminal) return fromTerminal
    }
  }
  if (device.current === 'ac' || device.current === 'dc') return device.current
  return terminalsCurrent(device)
}

// The cable type to start with for a new cable From a device (the supply end)
// To another. `mismatch` is null, or { fromCurrent, toCurrent } when both ends
// are known and differ; the kind then follows the From end.
export function suggestKind (from, fromTerminal, to, toTerminal) {
  const terminals = [...(from.terminals || []), ...(to.terminals || [])]
  if (terminals.length > 0 && terminals.every((t) => t.conductor === 'signal')) {
    return { kind: 'signal', mismatch: null }
  }
  const fromCurrent = endCurrent(from, fromTerminal)
  const toCurrent = endCurrent(to, toTerminal)
  if (!fromCurrent && !toCurrent) return { kind: defaultKind(from, to), mismatch: null }
  const current = fromCurrent || toCurrent
  const mismatch = fromCurrent && toCurrent && fromCurrent !== toCurrent ? { fromCurrent, toCurrent } : null
  if (current === 'ac') return { kind: 'ac', mismatch }
  const lone = from.role === 'distribution' || to.role === 'distribution'
  return { kind: lone ? 'positive' : 'both', mismatch }
}

// True when the conductors (objects with a `conductor`, or plain type names)
// include a line or neutral one and a positive or negative one. Earth and
// signal never count.
export function mixesAcAndDc (conductors) {
  const types = (Array.isArray(conductors) ? conductors : []).map((c) => (c && c.conductor) || c)
  return types.some((t) => t === 'line' || t === 'neutral') &&
    types.some((t) => t === 'positive' || t === 'negative')
}

// 'ac' when the cable has a line or neutral conductor, 'dc' when it has a
// positive or negative one, null otherwise. A cable with no conductors listed
// is a single positive, so dc.
export function cableCurrent (cable) {
  const types = ((cable && cable.conductors) || []).map((c) => c.conductor)
  if (types.length === 0) return 'dc'
  if (types.some((t) => t === 'line' || t === 'neutral')) return 'ac'
  if (types.some((t) => t === 'positive' || t === 'negative')) return 'dc'
  return null
}

// The warning shown above the kind choice when the two ends disagree, using
// the device names. Null when there is no mismatch.
export function mismatchText (mismatch, from, to) {
  if (!mismatch) return null
  const label = (c) => (c === 'ac' ? 'AC' : 'DC')
  return `${from.name} is ${label(mismatch.fromCurrent)}, ${to.name} is ${label(mismatch.toCurrent)}. Choose the cable type.`
}

// The live (not removed) cables of a conduit sorted by current: `ac` and `dc`
// hold the cables, `mixed` is true only when both are non-empty. Cables that
// are neither (signal only, earth only) count as neither.
export function conduitCurrentMix (cables) {
  const ac = []
  const dc = []
  for (const cable of cables || []) {
    if (!cable || cable.status === 'removed') continue
    const current = cableCurrent(cable)
    if (current === 'ac') ac.push(cable)
    else if (current === 'dc') dc.push(cable)
  }
  return { ac, dc, mixed: ac.length > 0 && dc.length > 0 }
}

// The warning for a mixed conduit: a heading, the advice and the cables named
// under AC and under DC, as lines joined with newlines. Null when not mixed.
// `cableName` turns a cable into the name shown.
export function conduitMixText (mix, cableName) {
  if (!mix || !mix.mixed) return null
  const names = (list) => list.map((c) => cableName(c)).join(', ')
  return [
    'This conduit holds AC and DC cables.',
    'Keep them in separate conduits where you can. If they share one, the AC must be in its own sheathed cable, all insulation rated for the highest voltage present, and ideally a partition.',
    `AC: ${names(mix.ac)}`,
    `DC: ${names(mix.dc)}`
  ].join('\n')
}
