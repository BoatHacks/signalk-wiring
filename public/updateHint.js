import { html, useState, useEffect } from './vendor/preact-standalone.module.js'

// Tells an open page that the plugin was updated. The page asks the plugin
// for its version at load (that is the version it runs), again whenever the
// tab becomes visible and every ten minutes. When the answer differs it shows
// "A new version is available" with a Reload button; the note can be
// dismissed until the version changes again.

const VERSION_URL = '/plugins/signalk-wiring/version'
export const CHECK_EVERY_MS = 10 * 60 * 1000

// The version stamped into this module's own address (`?v=1.2.3`) by the
// pack-time stamping, or null when the files are not stamped (a checkout).
export function stampOfUrl (url) {
  try { return new URL(url).searchParams.get('v') || null } catch (err) { return null }
}

// The version this page runs: its stamp when it has one, else the first
// answer of the version route.
export function runningVersion (stamp, firstAnswer) {
  return stamp || firstAnswer || null
}

// Whether to show the note: the plugin reports a version the page does not
// run, and the user has not dismissed that very version.
export function shouldShowHint (running, latest, dismissed) {
  return Boolean(running && latest && latest !== running && dismissed !== latest)
}

// The address that loads the new page fresh: the page itself is revalidated
// with a weak ETag built from the file size, which a release can leave
// unchanged, so the reload goes to an address the browser has not cached.
export function reloadUrl (location, latest) {
  const params = new URLSearchParams(location.search)
  params.set('v', latest)
  return `${location.pathname}?${params.toString()}${location.hash || ''}`
}

async function fetchVersion (fetchFn) {
  try {
    const res = await fetchFn(VERSION_URL, { cache: 'no-store' })
    if (!res.ok) return null
    const body = await res.json()
    return body && typeof body.version === 'string' ? body.version : null
  } catch (err) {
    return null
  }
}

export function UpdateHint ({ fetchFn = (...a) => fetch(...a), stamp = stampOfUrl(import.meta.url), intervalMs = CHECK_EVERY_MS }) {
  const [running, setRunning] = useState(stamp)
  const [latest, setLatest] = useState(null)
  const [dismissed, setDismissed] = useState(null)

  useEffect(() => {
    let cancelled = false
    let first = true
    const check = async () => {
      const version = await fetchVersion(fetchFn)
      if (cancelled || !version) return
      if (first) { first = false; setRunning(runningVersion(stamp, version)) }
      setLatest(version)
    }
    check()
    const timer = setInterval(check, intervalMs)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!shouldShowHint(running, latest, dismissed)) return null
  return html`
    <div class="update-hint" role="status" data-testid="update-hint">
      <span>A new version is available.</span>
      <button type="button" data-testid="update-reload" onClick=${() => window.location.assign(reloadUrl(window.location, latest))}>Reload</button>
      <button type="button" class="link-btn" data-testid="update-dismiss" onClick=${() => setDismissed(latest)}>Dismiss</button>
    </div>
  `
}
