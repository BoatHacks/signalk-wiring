'use strict'

// The series and parallel reduction shared by battery banks (src/banks.js) and
// solar arrays (src/arrays.js). Pure.
//
// ids: the devices of one group; cables: the links between them, each with
// fromDeviceId, toDeviceId and link ('series', anything else counts as parallel).

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// Series chains and the parallel joins between them, or null when the links
// do not make series strings in parallel.
function reduceToStrings (ids, cables) {
  const series = new Map(ids.map((id) => [id, new Set()]))
  const parallel = []
  const seriesPairs = new Set()
  const parallelPairs = new Set()
  const pair = (c) => [c.fromDeviceId, c.toDeviceId].sort(byString).join('\n')
  for (const c of cables) {
    if (c.link === 'series') {
      series.get(c.fromDeviceId).add(c.toDeviceId)
      series.get(c.toDeviceId).add(c.fromDeviceId)
      seriesPairs.add(pair(c))
    } else {
      parallel.push(c)
      parallelPairs.add(pair(c))
    }
  }
  // The same two devices joined both ways cannot be reduced.
  for (const p of seriesPairs) if (parallelPairs.has(p)) return null
  // A branch: a device in series with more than two others.
  for (const set of series.values()) if (set.size > 2) return null

  const seen = new Set()
  const strings = []
  const walk = (start) => {
    const chain = [start]
    seen.add(start)
    let prev = null
    let at = start
    for (;;) {
      const next = [...series.get(at)].filter((n) => n !== prev).sort(byString)[0]
      if (next === undefined) return chain
      if (seen.has(next)) return null // a series cycle
      chain.push(next)
      seen.add(next)
      prev = at
      at = next
    }
  }
  // Chains start at an end (one series neighbour or none), lowest id first.
  for (const id of ids) {
    if (seen.has(id) || series.get(id).size > 1) continue
    const chain = walk(id)
    if (!chain) return null
    // Read the chain from its lower-id end.
    if (chain.length > 1 && byString(chain[chain.length - 1], chain[0]) < 0) chain.reverse()
    strings.push(chain)
  }
  if (seen.size !== ids.length) return null // what remains is a cycle
  strings.sort((a, b) => byString(a[0], b[0]))
  const stringOf = new Map()
  strings.forEach((s, i) => s.forEach((id) => stringOf.set(id, i)))
  // A parallel link inside one string cannot be reduced.
  for (const c of parallel) if (stringOf.get(c.fromDeviceId) === stringOf.get(c.toDeviceId)) return null
  return strings
}

// A device of type "Solar panel" (the link type applies only between these).
const isSolarPanelType = (type) => typeof type === 'string' && /^\s*solar panel\s*$/i.test(type)

module.exports = { reduceToStrings, isSolarPanelType }
