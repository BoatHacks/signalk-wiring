// Enclosures (plan 0024): a breaker box or a distribution panel that holds
// other devices, to any depth. Pure functions over plain lists:
//   devices: [{ id, name, role, status, parentId? }]
//   cables:  [{ id, fromDeviceId, toDeviceId, status, conductors? }]
// src/enclosures.js is the same logic for the server; a test keeps the
// two in step.

const isLive = (item) => item.status !== 'removed'

// The devices placed directly in an enclosure.
export function childrenOf (devices, enclosureId) {
  return devices.filter((d) => isLive(d) && d.parentId === enclosureId).map((d) => d.id)
}

// Everything inside an enclosure, direct and nested, outermost first.
export function contentsOf (devices, enclosureId) {
  const out = []
  const seen = new Set([enclosureId])
  const queue = [enclosureId]
  while (queue.length > 0) {
    const next = queue.shift()
    for (const id of childrenOf(devices, next)) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
      queue.push(id)
    }
  }
  return out
}

// The chain of enclosures a device sits in, outermost first, not including
// the device itself.
export function pathOf (devices, deviceId) {
  const byId = new Map(devices.map((d) => [d.id, d]))
  const chain = []
  const seen = new Set([deviceId])
  let at = byId.get(deviceId)
  while (at && at.parentId && !seen.has(at.parentId) && byId.has(at.parentId)) {
    seen.add(at.parentId)
    chain.unshift(at.parentId)
    at = byId.get(at.parentId)
  }
  return chain
}

// Whether putting `deviceId` inside `parentId` would make a loop: the parent
// is the device itself or sits somewhere inside it.
export function wouldCycle (devices, deviceId, parentId) {
  return parentId === deviceId || pathOf(devices, parentId).includes(deviceId)
}

// The live cables with exactly one end inside the enclosure, at any depth.
// Each is one outer port: the inner device and terminal, the conductors and
// the outer device it connects to. A cable with both ends inside is internal
// and is left out.
export function boundaryCables (devices, cables, enclosureId) {
  const inside = new Set(contentsOf(devices, enclosureId))
  const byId = new Map(devices.map((d) => [d.id, d]))
  const out = []
  for (const cable of cables) {
    if (!isLive(cable)) continue
    const fromIn = inside.has(cable.fromDeviceId)
    const toIn = inside.has(cable.toDeviceId)
    if (fromIn === toIn) continue
    const innerEnd = fromIn ? 'from' : 'to'
    const innerDeviceId = fromIn ? cable.fromDeviceId : cable.toDeviceId
    const outerDeviceId = fromIn ? cable.toDeviceId : cable.fromDeviceId
    const conductors = (cable.conductors || []).map((c) => ({
      conductor: c.conductor,
      color: c.color || null,
      terminal: (innerEnd === 'from' ? c.fromTerminal : c.toTerminal) || null
    }))
    const terminals = [...new Set(conductors.map((c) => c.terminal).filter(Boolean))]
    const innerName = (byId.get(innerDeviceId) || {}).name || innerDeviceId
    out.push({
      cableId: cable.id,
      innerDeviceId,
      innerEnd,
      outerDeviceId,
      conductors,
      terminals,
      name: terminals.length > 0 ? `${innerName} ${terminals.join('/')}` : innerName
    })
  }
  return out
}



// The live cables that end on any of the given devices, as the cable's own
// ends or as the landing of one of its conductors. Removing an enclosure
// removes these along with what it holds.
export function cablesTouching (cables, deviceIds) {
  const ids = new Set(deviceIds)
  return cables.filter((c) => isLive(c) && (ids.has(c.fromDeviceId) || ids.has(c.toDeviceId) ||
    (c.conductors || []).some((k) => ids.has(k.fromDeviceId) || ids.has(k.toDeviceId)))).map((c) => c.id)
}

// The confirmation before removing an enclosure: what goes with it.
//   facts: { names: the devices inside, cableTitles: their cables }
export function removalText (name, facts) {
  const list = (items) => (items.length > 6 ? `${items.slice(0, 6).join(', ')} and ${items.length - 6} more` : items.join(', '))
  const parts = [`Remove the enclosure "${name}" and everything inside it?`]
  parts.push(`Devices inside (${facts.names.length}): ${list(facts.names)}.`)
  parts.push(facts.cableTitles.length > 0
    ? `Their cables (${facts.cableTitles.length}): ${list(facts.cableTitles)}.`
    : 'No cables end on them.')
  parts.push('Its inside schematic is removed too. They are all kept as removed records, and Undo puts everything back.')
  return parts.join('\n\n')
}

// The Inside picker of a device: the live enclosures it may go in, which are
// not the device itself or anything inside it. The enclosure it is in now is
// kept in the list even when removed, so the form shows it.
export function insideOptions (devices, deviceId) {
  const current = (devices.find((d) => d.id === deviceId) || {}).parentId
  return devices
    .filter((d) => d.role === 'enclosure' && (d.id === current || (d.status !== 'removed' && !wouldCycle(devices, deviceId || '', d.id))))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// "Box, Cabinet": the enclosures a device sits in, innermost first, as names.
export function insideText (devices, deviceId) {
  const byId = new Map(devices.map((d) => [d.id, d]))
  return pathOf(devices, deviceId).reverse().map((id) => (byId.get(id) || {}).name).filter(Boolean).join(', ')
}

// The Devices tab filter: '' all, NOT_INSIDE the ones in no enclosure, or an
// enclosure id for everything inside it, at any depth.
export const NOT_INSIDE = '__not_inside__'
export function matchesInside (devices, device, inside) {
  if (!inside) return true
  if (inside === NOT_INSIDE) return !device.parentId
  return contentsOf(devices, inside).includes(device.id)
}

// Devices that cannot be placed on the floorplan because an enclosure holds them.
export const isInside = (device) => Boolean(device && device.parentId)

// Why a device cannot be placed on a plan, or null when it can: its enclosure
// is placed instead.
export function placementBlock (devices, device) {
  if (!isInside(device)) return null
  const chain = pathOf(devices, device.id)
  const outer = devices.find((d) => d.id === chain[0])
  return `${device.name} is inside ${outer ? outer.name : 'an enclosure'}. Place the enclosure instead.`
}

// ---- A schematic page with enclosures (plan 0024) ----

export const PORT_IN = 'In'
export const PORT_OUT = 'Out'
const PORT_CHAR_W = 6.2

// What a page draws, given the devices placed on it. An enclosure placed on
// the page stands for what is inside it: the devices it holds are hidden, a
// cable with one end inside is drawn to a port of the box (one port per
// cable, named after the inner device and terminal), and a cable with both
// ends inside is left out. Everything else passes through unchanged, so the
// router and the checks see an ordinary page. `source` on a changed cable is
// the stored cable, which is what editing must write.
//   devices, cables: the resources; placedIds: the ids of the devices placed on the page
//   -> { devices: Map (id -> the device to draw, a placed enclosure gets
//        ports as terminals), cables, hidden: Set of ids, repOf(id) }
export function pageModel (devices, cables, placedIds) {
  const placed = new Set(placedIds)
  const byId = new Map(devices.map((d) => [d.id, d]))
  const chainOf = (id) => {
    const chain = []
    const seen = new Set([id])
    for (let at = byId.get(id); at && at.parentId && !seen.has(at.parentId) && byId.has(at.parentId); at = byId.get(at.parentId)) {
      seen.add(at.parentId)
      chain.unshift(at.parentId)
    }
    return chain
  }
  // The box a device is drawn in on this page: the outermost placed
  // enclosure around it, else itself when placed, else none.
  const repOf = (id) => {
    if (!id) return null
    for (const c of chainOf(id)) if (placed.has(c)) return c
    return placed.has(id) ? id : null
  }
  const hidden = new Set([...placed].filter((id) => repOf(id) !== id))

  const ports = new Map() // enclosure id -> Map(cable id -> { name, side, conductor })
  const nameOf = (id) => (byId.get(id) || {}).name || id
  const portFor = (enclosureId, cable, deviceId, side) => {
    if (!ports.has(enclosureId)) ports.set(enclosureId, new Map())
    const mine = ports.get(enclosureId)
    if (mine.has(cable.id)) return mine.get(cable.id)
    const terminals = [...new Set((cable.conductors || [])
      .filter((c) => (c[side === 'right' ? 'fromDeviceId' : 'toDeviceId'] || cable[side === 'right' ? 'fromDeviceId' : 'toDeviceId']) === deviceId)
      .map((c) => c[side === 'right' ? 'fromTerminal' : 'toTerminal']).filter(Boolean))]
    const base = terminals.length > 0 ? `${nameOf(deviceId)} ${terminals.join('/')}` : nameOf(deviceId)
    const taken = new Set([...mine.values()].map((p) => p.name))
    let name = base
    for (let i = 2; taken.has(name); i++) name = `${base} (${i})`
    const first = (cable.conductors || [])[0]
    const port = { name, side, conductor: (first && first.conductor) || 'positive' }
    mine.set(cable.id, port)
    return port
  }

  const out = []
  for (const cable of cables) {
    if (cable.status === 'removed') { out.push(cable); continue }
    const a = repOf(cable.fromDeviceId)
    const b = repOf(cable.toDeviceId)
    const fromE = a && a !== cable.fromDeviceId ? a : null
    const toE = b && b !== cable.toDeviceId ? b : null
    if (!fromE && !toE) { out.push(cable); continue }
    if (a && a === b) continue // both ends inside one box: drawn on its inside page only
    if (fromE) portFor(fromE, cable, cable.fromDeviceId, 'right')
    if (toE) portFor(toE, cable, cable.toDeviceId, 'left')
    const conductors = (cable.conductors || []).map((c) => {
      const next = { ...c }
      for (const [end, side] of [['from', 'right'], ['to', 'left']]) {
        const device = c[end + 'DeviceId'] || cable[end + 'DeviceId']
        const r = repOf(device)
        if (r && r !== device) {
          next[end + 'DeviceId'] = r
          next[end + 'Terminal'] = portFor(r, cable, device, side).name
        }
      }
      return next
    })
    out.push({ ...cable, fromDeviceId: fromE || cable.fromDeviceId, toDeviceId: toE || cable.toDeviceId, conductors, source: cable })
  }

  const drawn = new Map()
  for (const id of placed) {
    const device = byId.get(id)
    if (!device || device.role !== 'enclosure' || hidden.has(id)) continue
    const mine = [...(ports.get(id) || new Map()).values()]
    const sorted = [...mine.filter((p) => p.side === 'left'), ...mine.filter((p) => p.side === 'right')]
    const widest = (side) => Math.max(0, ...sorted.filter((p) => p.side === side).map((p) => p.name.length))
    drawn.set(id, {
      ...device,
      isEnclosure: true,
      holds: contentsOf(devices, id).length,
      terminals: sorted.map((p) => ({ name: p.name, conductor: p.conductor, voltage: null, port: p.side === 'left' ? PORT_IN : PORT_OUT })),
      boxW: Math.min(520, Math.max(170, Math.ceil(48 + (widest('left') + widest('right')) * PORT_CHAR_W)))
    })
  }
  return { devices: drawn, cables: out, hidden, repOf }
}
