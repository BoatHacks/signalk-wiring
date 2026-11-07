'use strict'

function toCamelKey (key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

function toSnakeKey (key) {
  return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

// Columns holding structured data (a wire run's route, a plan's
// calibration, an item's tags). The database keeps them as JSON text so the change log
// records one diff per column; resources expose them as real values.
const JSON_COLUMNS = new Set(['route', 'calibration', 'tags'])

function rowToResource (row) {
  if (!row) return row
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[toCamelKey(k)] = JSON_COLUMNS.has(k) && typeof v === 'string' ? JSON.parse(v) : v
  }
  return out
}

function resourceToRow (resource) {
  const out = {}
  for (const [k, v] of Object.entries(resource)) {
    const key = toSnakeKey(k)
    out[key] = JSON_COLUMNS.has(key) && v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  }
  return out
}

// Cable assignments ride along on the two resources they connect: a conduit
// lists the ids of its cables (`cableIds`) and a wire run, which is the
// cable, lists the conduits it passes through in order (`conduitIds`). Both
// are read from the join table; when a write carries one it replaces that
// side's assignments, and when it is absent assignments are left alone.
function withAssignments (kind, resource, maps) {
  if (kind === 'conduit') return { ...resource, cableIds: maps.byConduit[resource.id] || [] }
  if (kind === 'wireRun') return { ...resource, conduitIds: maps.byCable[resource.id] || [] }
  return resource
}

function applyAssignments (store, kind, id, value) {
  if (kind === 'conduit' && Array.isArray(value.cableIds)) {
    const wanted = value.cableIds
    const current = store.cablesOfConduit(id)
    for (const cableId of current) if (!wanted.includes(cableId)) store.unassignCable(id, cableId)
    for (const cableId of wanted) if (!current.includes(cableId)) store.assignCable(id, cableId)
  } else if (kind === 'wireRun' && Array.isArray(value.conduitIds)) {
    store.setCableConduits(id, value.conduitIds)
  }
}

// Builds a SignalK ResourceProvider (for app.registerResourceProvider) backed
// by the store. `kind` is the store's internal key ('circuit' | 'wireRun' | 'conduit' |
// 'device' | 'plan'); `type` is the public resource type name served at
// /signalk/v2/api/resources/<type> (SPEC.md §6.1, ARCHITECTURE.md §2.1).
function createResourceProvider (store, kind, type) {
  return {
    type,
    methods: {
      listResources: async () => {
        const out = {}
        const maps = kind === 'conduit' || kind === 'wireRun' ? store.conduitAssignmentMaps() : null
        for (const row of store.list(kind)) {
          out[row.id] = maps ? withAssignments(kind, rowToResource(row), maps) : rowToResource(row)
        }
        return out
      },
      getResource: async (id) => {
        const row = store.get(kind, id)
        if (!row) throw new Error(`${type} resource not found: ${id}`)
        const resource = rowToResource(row)
        return kind === 'conduit' || kind === 'wireRun'
          ? withAssignments(kind, resource, store.conduitAssignmentMaps())
          : resource
      },
      // Upsert, matching the SignalK resource API contract: a client sets a
      // resource by id whether or not it already exists.
      setResource: async (id, value) => {
        const existing = store.get(kind, id)
        const row = resourceToRow(value)
        delete row.cable_ids
        delete row.conduit_ids
        if (existing) {
          store.update(kind, id, row)
        } else {
          store.create(kind, { ...row, id })
        }
        applyAssignments(store, kind, id, value)
      },
      // Soft-delete: marks the record removed rather than dropping the row,
      // per the domain rule that removed records are kept for history
      // (SPEC.md §3.1).
      deleteResource: async (id) => {
        const existing = store.get(kind, id)
        if (!existing) throw new Error(`${type} resource not found: ${id}`)
        // Zones are a plain list: an unused one is deleted, a used one refused.
        if (kind === 'zone') store.deleteZone(id)
        else store.remove(kind, id)
      }
    }
  }
}

module.exports = { createResourceProvider, rowToResource, resourceToRow }
