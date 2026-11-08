// Undo message shared by the lists and, later, the canvases.
//
// Usage:
//   const undo = useUndo()                  // anywhere under <UndoProvider>
//   undo.offer({
//     message: 'Cable "A to B" removed.',   // shown with an Undo button
//     onUndo: async () => { ... },          // Undo clicked: put the record back
//     onExpire: async () => { ... },        // optional: the window ended with no
//                                           // Undo (or the offer was replaced, or
//                                           // undo.flush() ran): finish the job,
//                                           // for example the permanent delete
//     timeout: 8000                         // optional, milliseconds
//   })
//   undo.flush()                            // finish the open offer now (tab change)
//
// Only one offer is open at a time; a new offer first expires the old one.
// The timer pauses while the pointer is on the message. UndoProvider renders
// the bar at the top of whatever it wraps (the main area), so the bar is
// always in the same place.
import { html, createContext, useContext, useEffect, useRef, useState } from './vendor/preact-standalone.module.js'

export const UNDO_TIMEOUT_MS = 8000

const UndoContext = createContext({ offer () {}, flush () {} })

export function useUndo () {
  return useContext(UndoContext)
}

export function UndoBar ({ message, onUndo, onExpire, timeout = UNDO_TIMEOUT_MS }) {
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const left = useRef(timeout)
  const startedAt = useRef(0)
  const latest = useRef({ onExpire })
  latest.current = { onExpire }

  const start = () => {
    clearTimeout(timer.current)
    startedAt.current = Date.now()
    timer.current = setTimeout(() => latest.current.onExpire && latest.current.onExpire(), left.current)
  }
  const pause = () => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    left.current = Math.max(1000, left.current - (Date.now() - startedAt.current))
  }
  useEffect(() => { start(); return () => clearTimeout(timer.current) }, [])

  const undo = async () => {
    clearTimeout(timer.current)
    try { await onUndo() } catch (err) { setError(err.message); start() }
  }
  return html`
    <div class="undo-bar" role="status" data-testid="undo-bar"
      onPointerEnter=${pause} onPointerLeave=${() => { if (!timer.current) start() }}>
      <span>${error || message}</span>
      <button type="button" data-testid="undo-button" onClick=${undo}>Undo</button>
    </div>
  `
}

export function UndoProvider ({ children }) {
  const [current, setCurrent] = useState(null)
  const ref = useRef(null)
  const seq = useRef(0)

  // Ends the open offer: runs its onExpire once and clears the bar.
  const finish = async (entry) => {
    if (!entry || entry.done) return
    entry.done = true
    if (ref.current === entry) { ref.current = null; setCurrent(null) }
    if (entry.onExpire) { try { await entry.onExpire() } catch (err) { /* the owner reports its own failures */ } }
  }
  const api = useRef(null)
  if (!api.current) {
    api.current = {
      offer (opts) {
        const old = ref.current
        const entry = { ...opts, key: ++seq.current, done: false }
        ref.current = entry
        setCurrent(entry)
        if (old) finish(old)
      },
      flush () { return finish(ref.current) }
    }
  }
  const dismiss = (entry) => {
    entry.done = true
    if (ref.current === entry) { ref.current = null; setCurrent(null) }
  }
  return html`
    <${UndoContext.Provider} value=${api.current}>
      ${current && html`<${UndoBar} key=${current.key} message=${current.message} timeout=${current.timeout}
        onExpire=${() => finish(current)}
        onUndo=${async () => { await current.onUndo(); dismiss(current) }} />`}
      ${children}
    <//>
  `
}
