import { useState, useEffect } from './vendor/preact-standalone.module.js'

export const DEFAULT_SETTINGS = {
  convention: 'freestyle',
  defaultGaugeUnit: 'AWG',
  defaultLengthUnit: 'm',
  autoTheme: false,
  showFloorplan: true,
  demoMode: false,
  voltageDropLimitCritical: 3,
  voltageDropLimitNormal: 10,
  dashboardInputs: [],
  dashboardOutputs: []
}

// Values a new wire run form starts with. Edits use the record's own
// values instead, so a stored unit is never overridden by the default.
export function wireRunInitialValues (settings) {
  return {
    gaugeUnit: settings.defaultGaugeUnit,
    lengthUnit: settings.defaultLengthUnit
  }
}

// Example colours shown as the colour field's placeholder. A labeling
// hint only: any value is accepted whatever the convention.
export function colorPlaceholder (convention) {
  if (convention === 'abyc-e11') return 'e.g. red (DC +), yellow (DC −)'
  if (convention === 'din-en-iso-13297') return 'e.g. brown (L), blue (N), green/yellow (PE)'
  return ''
}

// Loads the plugin settings from the anonymous resource API. Falls back
// to the defaults while loading or if the request fails, so a form is
// never blocked on it.
export function useSettings () {
  return useSettingsLoaded().settings
}

// Like useSettings, and says when the answer is in (or has failed), for a page
// that should not draw once with defaults and again with the real values.
export function useSettingsLoaded () {
  const [state, setState] = useState({ settings: DEFAULT_SETTINGS, loaded: false })

  useEffect(() => {
    let cancelled = false
    fetch('/signalk/v2/api/resources/wiringSettings/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((loaded) => { if (!cancelled) setState({ settings: loaded ? { ...DEFAULT_SETTINGS, ...loaded } : DEFAULT_SETTINGS, loaded: true }) })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, loaded: true })) })
    return () => { cancelled = true }
  }, [])

  return state
}
