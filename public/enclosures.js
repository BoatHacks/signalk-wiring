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
