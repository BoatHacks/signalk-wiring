// Pure helpers for zones and tags: parsing the tags field and the zone and
// tag filters on the lists.

export const NO_ZONE = '__none__'

export function parseTags (text) {
  const seen = new Set()
  const tags = []
  for (const part of String(text ?? '').split(',')) {
    const tag = part.trim()
    if (tag && !seen.has(tag)) { seen.add(tag); tags.push(tag) }
  }
  return tags
}

export function tagsToText (tags) {
  return Array.isArray(tags) ? tags.join(', ') : ''
}

// Every tag in use, once each (case-insensitive), in alphabetical order.
export function collectTags (items) {
  const byKey = new Map()
  for (const item of items) {
    for (const tag of item.tags || []) {
      const key = tag.toLowerCase()
      if (!byKey.has(key)) byKey.set(key, tag)
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

// filter: { zoneId?, tag? }. A zoneId of NO_ZONE matches items without one.
export function matchesFilter (item, filter) {
  if (filter.zoneId) {
    if (filter.zoneId === NO_ZONE ? item.zoneId : item.zoneId !== filter.zoneId) return false
  }
  if (filter.tag) {
    const wanted = filter.tag.toLowerCase()
    if (!(item.tags || []).some((t) => t.toLowerCase() === wanted)) return false
  }
  return true
}

// Circuits carry no zone of their own: one matches when any of its live
// cables (the feed cables the derivation lists for it) does.
export function circuitMatches (circuit, cables, filter) {
  if (!filter.zoneId && !filter.tag) return true
  const ids = new Set(circuit.derived ? circuit.derived.cableIds : [])
  return cables.some((cable) =>
    ids.has(cable.id) && cable.status !== 'removed' && matchesFilter(cable, filter))
}

// List search: every word of the query must appear (case-insensitive) in the
// item's name, label, type, zone or tags, or in one of the extra strings the
// caller passes (for a cable: the names of its two ends). An empty query
// matches everything.
export function matchesSearch (item, query, extra = []) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [item.name, item.label, item.cableLabel, item.type, item.zone, ...(item.tags || []), ...extra]
    .filter((v) => v != null && v !== '')
    .map((v) => String(v).toLowerCase())
    .join('\n')
  return words.every((w) => hay.includes(w))
}

// Removed records are hidden unless the list's "Show removed" toggle is on.
export function matchesRemoved (item, showRemoved) {
  return showRemoved || item.status !== 'removed'
}

// The remembered "Show removed" choice of one list. Storage may be missing or
// throw (private windows, blocked site data), so every access is guarded and
// the default is off.
export function readShowRemoved (listKey, storage) {
  try {
    return (storage || globalThis.localStorage).getItem(`wiring.showRemoved.${listKey}`) === '1'
  } catch (err) {
    return false
  }
}

export function writeShowRemoved (listKey, value, storage) {
  try {
    (storage || globalThis.localStorage).setItem(`wiring.showRemoved.${listKey}`, value ? '1' : '0')
  } catch (err) {
    // the choice just is not remembered
  }
}
