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
// wire runs does.
export function circuitMatches (circuit, wireRuns, filter) {
  if (!filter.zoneId && !filter.tag) return true
  return wireRuns.some((run) =>
    run.circuitId === circuit.id && run.status !== 'removed' && matchesFilter(run, filter))
}
