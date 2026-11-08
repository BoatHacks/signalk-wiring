// Cable removal on the canvases (schematic and floorplan): the cable is marked
// removed at once, an Undo message is offered, and when the window ends the
// cable is deleted for good (admin only). No confirm dialog; the Undo message
// is the safety net. The purge never throws: a failure leaves the cable
// removed and is reported through the notice callback.

const PURGE_BASE = '/plugins/signalk-wiring/cables'

export function purgeFailureMessage (status, title) {
  const why = status === 401
    ? 'You need to be logged into the SignalK admin UI to delete it for good.'
    : `The server responded ${status}.`
  return `Could not delete the cable "${title}" permanently. It stays removed and can be deleted on the Cables tab. ${why}`
}

// Deletes a removed cable for good. Resolves to null, or to a failure message.
export async function purgeCable (id, title, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${PURGE_BASE}/${encodeURIComponent(id)}/purge`, { method: 'DELETE' })
    if (res.ok) return null
    return purgeFailureMessage(res.status, title)
  } catch (err) {
    return `Could not delete the cable "${title}" permanently. It stays removed. ${err.message}`
  }
}

// A notice that outlives the view that raised it (the purge can finish after
// the canvas was left, since leaving a view ends the Undo window at once).
export function toast (message) {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'notice canvas-toast'
  el.setAttribute('role', 'alert')
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 12000)
}

// Offers the Undo message for a cable that is already marked removed.
//   undo     the useUndo() object
//   cable    the cable record
//   title    its display name
//   restore  async () => put it back (status active and anything else cleared)
//   notice   (message) => show a notice in the view; returns false if the view is gone
//   timeout  optional Undo window in milliseconds
export function offerCableUndo ({ undo, cable, title, restore, notice, timeout, fetchFn }) {
  undo.offer({
    message: `Cable "${title}" removed.`,
    timeout,
    onUndo: restore,
    onExpire: async () => {
      const failure = await purgeCable(cable.id, title, fetchFn)
      if (failure && notice(failure) === false) toast(failure)
    }
  })
}
