// Turning records read from one server into bodies for another. Pure, so the
// rules can be tested: which fields are derived (never written), which refer
// to other records, and the order of writes.

// Fields a server adds when it serves a record. They are never written back.
const DERIVED = {
  device: ['id', 'zone', 'measured', 'contents', 'allContents', 'boundaryCables', 'circuits', 'taps', 'icon'],
  wireRun: ['id', 'zone', 'conduitIds', 'circuitIds'],
  conduit: ['id', 'zone'],
  zone: ['id'],
  backbone: ['id', 'zone'],
  plan: ['id', 'filename'],
  schematic: ['id']
}

// References written in a second pass, once every record exists.
const LATE = { device: ['parentId', 'monitorDeviceId', 'iconAttachmentId'] }

export function body (kind, record, { late = false } = {}) {
  const out = {}
  for (const [k, v] of Object.entries(record)) {
    if ((DERIVED[kind] || []).includes(k)) continue
    if (!late && (LATE[kind] || []).includes(k)) continue
    if (v === undefined) continue
    out[k] = v
  }
  return out
}

export function lateBody (kind, record, idMap = {}) {
  const out = {}
  for (const k of LATE[kind] || []) {
    if (record[k] === null || record[k] === undefined) continue
    out[k] = k === 'iconAttachmentId' ? idMap[record[k]] || null : record[k]
  }
  return out
}

// Records to copy, as [id, record] pairs, without removed ones unless asked.
export function pick (map, { includeRemoved = false } = {}) {
  return Object.entries(map || {}).filter(([, r]) => includeRemoved || r.status !== 'removed')
}

// Editable circuit fields that differ from what a fresh target derives, keyed
// by the circuit key the derivation gives (protector:<id> or cable:<id>).
const CIRCUIT_FIELDS = ['name', 'notes', 'voltage', 'convention', 'meterPath', 'meterUnit']

export function circuitUpdates (sourceCircuits, targetCircuits) {
  const byKey = new Map(Object.entries(targetCircuits || {}).filter(([, c]) => c.key).map(([id, c]) => [c.key, { id, c }]))
  const updates = []
  for (const [, src] of Object.entries(sourceCircuits || {})) {
    if (src.status === 'removed' || !src.key) continue
    const target = byKey.get(src.key)
    if (!target) continue
    const patch = {}
    for (const f of CIRCUIT_FIELDS) {
      if (src[f] !== undefined && src[f] !== null && src[f] !== target.c[f]) patch[f] = src[f]
    }
    if (Object.keys(patch).length) updates.push({ id: target.id, patch })
  }
  return updates
}
