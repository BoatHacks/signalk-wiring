// The inside page of an enclosure (plan 0024): an ordinary schematic page,
// made the first time the enclosure is opened, with what it holds placed and
// arranged. Opening it again finds it; a removed one is brought back.

import dagre from './vendor/dagre.esm.js'
import { newId } from './ids.js'
import { autoLayout } from './schematic.js'
import { pageModel, childrenOf } from './enclosures.js'

const RESOURCE_BASE = '/signalk/v2/api/resources'

async function fetchMap (type) {
  const res = await fetch(`${RESOURCE_BASE}/${type}`)
  if (!res.ok) throw new Error(`Could not read ${type} (${res.status}).`)
  return Object.values(await res.json())
}

async function put (type, id, value) {
  const res = await fetch(`${RESOURCE_BASE}/${type}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
  })
  if (!res.ok) {
    let message = `The change was refused (${res.status}).`
    try { message = (await res.json()).error || message } catch (err) { /* keep the generic message */ }
    throw new Error(message)
  }
}

// The new page for an enclosure: its name and the devices it holds directly,
// arranged from the supply side. A held enclosure is laid out as the box it
// shows on the page, with its ports.
export function insidePageSpec (devices, cables, enclosureId) {
  const enclosure = devices.find((d) => d.id === enclosureId)
  if (!enclosure) throw new Error('The enclosure was not found.')
  const ids = childrenOf(devices, enclosureId)
  const model = pageModel(devices, cables, ids)
  const byId = new Map(devices.map((d) => [d.id, d]))
  const drawn = ids.map((id) => model.devices.get(id) || byId.get(id))
  const layout = ids.length > 0 ? autoLayout(dagre, drawn, model.cables.filter((c) => c.status !== 'removed')) : {}
  return {
    name: `${enclosure.name} (inside)`,
    devices: ids.map((id) => ({ deviceId: id, x: Math.round((layout[id] || { x: 0 }).x), y: Math.round((layout[id] || { y: 0 }).y) }))
  }
}

// Finds or makes the inside page of an enclosure and returns its id.
export async function ensureInsidePage (enclosureId) {
  const [schematics, devices, cables] = await Promise.all([
    fetchMap('wiringSchematics'), fetchMap('wiringDevices'), fetchMap('wiringWireRuns')
  ])
  const existing = schematics.find((s) => s.enclosureId === enclosureId)
  if (existing) {
    if (existing.status === 'removed') await put('wiringSchematics', existing.id, { status: 'active' })
    return existing.id
  }
  const spec = insidePageSpec(devices, cables.filter((c) => c.status !== 'removed'), enclosureId)
  const id = newId()
  await put('wiringSchematics', id, { name: spec.name, enclosureId, devices: spec.devices })
  return id
}
