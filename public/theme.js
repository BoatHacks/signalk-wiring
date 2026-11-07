import { useState, useEffect } from './vendor/preact-standalone.module.js'

// Light/dark theme, persisted in localStorage and defaulting to the
// browser's preference on a first visit. The dark theme is a red-shifted
// night mode for use on deck, so it disturbs night vision as little as
// possible. Same behaviour as the stowage webapp.
const STORAGE_KEY = 'wiring-theme'

// Sun phases that count as dark, protecting night vision from dusk through dawn.
const SUN_DARK_PHASES = new Set(['dawn', 'sunrise', 'sunset', 'dusk', 'night'])

export function getStoredTheme () {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch (_) {
    return null // localStorage can throw in restricted or embedded browsers
  }
}

export function getPreferredTheme () {
  const stored = getStoredTheme()
  if (stored === 'light' || stored === 'dark') return stored
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

export function applyTheme (theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch (_) {
    // the theme just will not persist on this browser
  }
}

// SignalK values arrive either bare or wrapped as { value, timestamp }.
function plain (raw) {
  return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw
}

// The theme the vessel's environment recommends, or null when it has none:
// environment.sun (day, dawn, sunrise, sunset, dusk, night) first, then the
// simpler environment.mode (day or night).
export function themeFromEnvironment (sun, mode) {
  const s = plain(sun)
  if (s === 'day') return 'light'
  if (SUN_DARK_PHASES.has(s)) return 'dark'
  const m = plain(mode)
  if (typeof m === 'string') {
    const normalized = m.toLowerCase()
    if (normalized === 'day') return 'light'
    if (normalized === 'night') return 'dark'
  }
  return null
}

async function fetchEnvironmentValue (name) {
  try {
    const res = await fetch(`/signalk/v1/api/vessels/self/environment/${name}`)
    return res.ok ? await res.json() : null
  } catch (_) {
    return null
  }
}

const POLL_MS = 60 * 1000

// Returns [theme, toggle]. With autoTheme on, the theme follows the
// environment (checked once a minute) instead of waiting for a click.
export function useTheme (autoTheme) {
  const [theme, setTheme] = useState(getPreferredTheme())

  useEffect(() => { applyTheme(theme) }, [theme])

  useEffect(() => {
    if (!autoTheme) return undefined
    let cancelled = false
    const check = async () => {
      const [sun, mode] = await Promise.all([fetchEnvironmentValue('sun'), fetchEnvironmentValue('mode')])
      const recommended = themeFromEnvironment(sun, mode)
      if (!cancelled && recommended) setTheme(recommended)
    }
    check()
    const timer = setInterval(check, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [autoTheme])

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}
