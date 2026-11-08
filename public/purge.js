// Permanent deletion of removed devices, conduits and schematics (admin
// only). The confirmation says what goes with the record, and a device that
// cables still end on is refused with the cables named.

const ROUTES_BASE = '/plugins/signalk-wiring'

// What each kind is called, the route segment and where its attachments live.
const KINDS = {
  device: { label: 'device', route: 'devices', owner: 'device' },
  conduit: { label: 'conduit', route: 'conduits', owner: 'conduit' },
  schematic: { label: 'schematic', route: 'schematics', owner: null }
}

// The cables, live or removed, that end on a device: either end of the cable
// or the landing of one of its conductors.
export function cablesEndingOn (deviceId, cables) {
  return cables.filter((c) =>
    c.fromDeviceId === deviceId || c.toDeviceId === deviceId ||
    (c.conductors || []).some((k) => k.fromDeviceId === deviceId || k.toDeviceId === deviceId))
}

// "Delete these cables first: lamp feed; Fuse to Lamp".
export function blockedText (name, cableNames) {
  return `"${name}" cannot be deleted permanently while cables still end on it. Delete these cables first: ${cableNames.join('; ')}.`
}

function plural (n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The confirmation question. `facts`: { history, attachments } counts.
export function purgeConfirmText (kind, name, facts = {}) {
  const history = facts.history || 0
  const goes = [`${history} history ${history === 1 ? 'entry' : 'entries'}`]
  if (KINDS[kind].owner) goes.push(plural(facts.attachments || 0, 'attachment'))
  const extra = kind === 'device'
    ? ' Its terminals and its places on schematics go too.'
    : kind === 'conduit'
      ? ' The cables stay, they just no longer run through it.'
      : ' Its devices and cables are not touched.'
  return `Delete the ${KINDS[kind].label} "${name}" permanently? ${goes.join(' and ')} are erased too.${extra} This cannot be undone.`
}

async function count (url, fetchFn) {
  try {
    const res = await fetchFn(url)
    if (!res.ok) return 0
    const list = await res.json()
    return Array.isArray(list) ? list.length : 0
  } catch (err) {
    return 0
  }
}

// How many history entries and attachments a record has, for the confirmation.
export async function purgeFacts (kind, id, fetchFn = fetch) {
  const q = encodeURIComponent(id)
  const history = await count(`${ROUTES_BASE}/changelog/${kind}/${q}`, fetchFn)
  const owner = KINDS[kind].owner
  const attachments = owner ? await count(`${ROUTES_BASE}/attachments?ownerType=${owner}&ownerId=${q}`, fetchFn) : 0
  return { history, attachments }
}

// Deletes a removed record for good. Resolves to null, or to a failure message.
export async function purgeRecord (kind, id, name, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${ROUTES_BASE}/${KINDS[kind].route}/${encodeURIComponent(id)}/purge`, { method: 'DELETE' })
    if (res.ok) return null
    if (res.status === 401) return `You need to be logged into the SignalK admin UI to delete "${name}" permanently.`
    let why = ''
    try { why = (await res.json()).error || '' } catch (err) { /* no body */ }
    return `Could not delete "${name}" permanently. ${why || `The server responded ${res.status}.`}`
  } catch (err) {
    return `Could not delete "${name}" permanently. ${err.message}`
  }
}
