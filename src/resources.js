'use strict'

function toCamelKey (key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

function toSnakeKey (key) {
  return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

function rowToResource (row) {
  if (!row) return row
  const out = {}
  for (const [k, v] of Object.entries(row)) out[toCamelKey(k)] = v
  return out
}

function resourceToRow (resource) {
  const out = {}
  for (const [k, v] of Object.entries(resource)) out[toSnakeKey(k)] = v
  return out
}

// Builds a SignalK ResourceProvider (for app.registerResourceProvider) backed
// by the store. `kind` is the store's internal key ('circuit' | 'wireRun' |
// 'device'); `type` is the public resource type name served at
// /signalk/v2/api/resources/<type> (SPEC.md §6.1, ARCHITECTURE.md §2.1).
function createResourceProvider (store, kind, type) {
  return {
    type,
    methods: {
      listResources: async () => {
        const out = {}
        for (const row of store.list(kind)) out[row.id] = rowToResource(row)
        return out
      },
      getResource: async (id) => {
        const row = store.get(kind, id)
        if (!row) throw new Error(`${type} resource not found: ${id}`)
        return rowToResource(row)
      },
      // Upsert, matching the SignalK resource API contract: a client sets a
      // resource by id whether or not it already exists.
      setResource: async (id, value) => {
        const existing = store.get(kind, id)
        const row = resourceToRow(value)
        if (existing) {
          store.update(kind, id, row)
        } else {
          store.create(kind, { ...row, id })
        }
      },
      // Soft-delete: marks the record removed rather than dropping the row,
      // per the domain rule that removed records are kept for history
      // (SPEC.md §3.1).
      deleteResource: async (id) => {
        const existing = store.get(kind, id)
        if (!existing) throw new Error(`${type} resource not found: ${id}`)
        store.remove(kind, id)
      }
    }
  }
}

module.exports = { createResourceProvider, rowToResource, resourceToRow }
