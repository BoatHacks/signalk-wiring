// Pure helpers for the Duplicate action on devices and cables.

// "Pump" -> "Pump copy", then "Pump copy 2", "Pump copy 3" while the name is
// taken (case-insensitive, so two names never differ only by case).
export function uniqueCopyName (name, existingNames) {
  const taken = new Set([...existingNames].map((n) => String(n || '').trim().toLowerCase()))
  const base = `${String(name || 'Device').trim()} copy`
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

// What a copy of a device keeps: what the device is and how it is rated and
// wired (type, role, ratings, terminals, paths, nominal voltage, zone, tags,
// notes). Not copied: the position, the icon, attachments, the calibration
// (a measurement belongs to the one device) and the history.
const DEVICE_COPY_KEYS = [
  'role', 'type', 'zoneId', 'tags', 'ratedPowerW', 'tripRatingA', 'nominalVoltage', 'powerFactor',
  'terminals', 'signalkPath', 'switchPath', 'confirmSwitching', 'neverRemote', 'meterPath', 'meterUnit', 'notes'
]

export function duplicateDevicePayload (device, existingNames) {
  const copy = {}
  for (const key of DEVICE_COPY_KEYS) {
    if (device[key] === undefined || device[key] === null) continue
    copy[key] = JSON.parse(JSON.stringify(device[key]))
  }
  copy.name = uniqueCopyName(device.name, existingNames)
  return copy
}

// A cable copy is opened in the cable form as a prefill: conductors, gauge,
// label, zone and tags are kept; the route, attachments, length and notes are
// not. `values` is cableToValues(cable). The ends stay filled in so the form
// can be saved after changing one of them.
export function duplicateCablePrefill (values) {
  return {
    fromDeviceId: values.fromDeviceId,
    toDeviceId: values.toDeviceId,
    kind: values.kind,
    colors: { ...values.colors },
    terminals: JSON.parse(JSON.stringify(values.terminals || {})),
    negativeLandingId: values.negativeLandingId,
    existingConductors: (values.existingConductors || []).map((c) => ({ ...c })),
    gauge: values.gauge,
    gaugeUnit: values.gaugeUnit,
    cableLabel: values.cableLabel,
    zoneId: values.zoneId,
    tags: [...(values.tags || [])]
  }
}
