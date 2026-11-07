import { useState, useEffect } from './vendor/preact-standalone.module.js'

export const DEFAULT_SETTINGS = {
  convention: 'freestyle',
  defaultGaugeUnit: 'AWG',
  defaultLengthUnit: 'm',
  autoTheme: false
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
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  useEffect(() => {
    let cancelled = false
    fetch('/signalk/v2/api/resources/wiringSettings/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((loaded) => { if (!cancelled && loaded) setSettings({ ...DEFAULT_SETTINGS, ...loaded }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return settings
}
