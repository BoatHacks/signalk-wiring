// Pure helpers for conduits: the kind dropdown, how cables and conduits are
// named in lists, and the small list operations behind the conduit page.
import { matchesFilter } from './zones.js'

// Popular kinds offered in the Kind dropdown. Not a closed list: any other
// kind can be added, and kinds already used are offered too.
export const KIND_SUGGESTIONS = ['Conduit', 'Hose', 'Loom', 'Trunking', 'Cable tray']

// The kind dropdown: suggestions, then other kinds in use (and the current
// value, so an older free-text kind is never lost), sorted, no case repeats.
export function kindOptions (usedKinds, current) {
  const seen = new Set(KIND_SUGGESTIONS.map((k) => k.toLowerCase()))
  const used = []
  for (const raw of [...(usedKinds || []), current]) {
    const kind = typeof raw === 'string' ? raw.trim() : ''
    if (!kind || seen.has(kind.toLowerCase())) continue
    seen.add(kind.toLowerCase())
    used.push(kind)
  }
  used.sort((a, b) => a.localeCompare(b))
  return { suggested: KIND_SUGGESTIONS, used }
}

// How a cable (a wire run) is named in a list: its label, else its two ends.
// `deviceNameById` turns the device id of each end into the device name.
export function cableName (run, deviceNameById) {
  if (run.cableLabel) return run.cableLabel
  if (!run.fromDeviceId && !run.toDeviceId) return 'Unnamed cable'
  const end = (e) => (e ? (deviceNameById && deviceNameById.get(e)) || '?' : '?')
  return `${end(run.fromDeviceId)} to ${end(run.toDeviceId)}`
}

export function conduitSummary (conduit) {
  const size = conduit.innerDiameter != null && conduit.innerDiameter !== ''
    ? `${conduit.innerDiameter}${conduit.diameterUnit ? ' ' + conduit.diameterUnit : ''} inner diameter`
    : ''
  return [conduit.kind, size].filter(Boolean).join(', ') || 'No kind recorded'
}

// Cables that can still be added to a conduit.
export function addableCables (runs, conduit) {
  const assigned = new Set(conduit.cableIds || [])
  return runs.filter((r) => r.status !== 'removed' && !assigned.has(r.id))
}

// The conduit records of a cable, in the order the cable passes through them.
export function conduitsOfRun (run, conduits) {
  const byId = new Map(conduits.map((c) => [c.id, c]))
  return (run.conduitIds || []).map((id) => byId.get(id)).filter(Boolean)
}

// Moves `id` one place earlier (-1) or later (+1); at the ends, or when the
// id is not in the list, the list comes back unchanged.
export function moveInList (list, id, delta) {
  const i = list.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list.slice()
  const out = list.slice()
  out[i] = list[j]
  out[j] = id
  return out
}

// filter: { zoneId?, kind? }. The zone matches like the other lists.
export function filterConduits (conduits, filter) {
  return conduits.filter((c) => {
    if (!matchesFilter(c, { zoneId: filter.zoneId })) return false
    if (filter.kind && (c.kind || '').toLowerCase() !== filter.kind.toLowerCase()) return false
    return true
  })
}
