// Presenting what a calibration run measured (plan 0017), beside the
// nameplate rating. Pure, tested in test/measured.test.mjs.

const fmt = (n) => (Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10))

// Lines describing a device's latest accepted run (the `measured` field of a
// device resource), or an empty list when it has none.
export function describeMeasured (measured, ratedPowerW) {
  if (!measured) return []
  const parts = []
  if (measured.avgW != null) parts.push(`average ${fmt(measured.avgW)} W`)
  if (measured.peakW != null) parts.push(`peak ${fmt(measured.peakW)} W`)
  if (measured.dutyCycle != null && measured.dutyCycle < 0.995) parts.push(`on ${Math.round(measured.dutyCycle * 100)}% of the time`)
  let line = `Measured: ${parts.join(', ')}`
  if (ratedPowerW != null) line += ` (rated ${fmt(ratedPowerW)} W)`
  const how = [measured.method === 'watch' ? 'watched while running' : 'switched on and off']
  if (measured.confidence) how.push(`${measured.confidence} confidence`)
  if (measured.estimate) how.push('estimate from amps')
  if (measured.at) how.push(new Date(measured.at).toLocaleDateString())
  return [line, how.join(', ')]
}

// A sentence naming the other consumers a group figure covers, or null.
export function describeGroup (measured, nameOf) {
  if (!measured || !measured.group) return null
  const names = measured.group.consumerIds.map(nameOf).join(', ')
  return `Measured together with: ${names}. The figure is for the whole group.`
}

// The power figures the load check uses for a device. A device with an
// accepted run uses the measured peak for the breaker check and the measured
// average for energy; others use the nameplate rating. A power factor is not
// applied to a measured figure: a watt meter already includes it, and amps
// times volts is the apparent power. A group figure covers the whole group,
// which the load check counts once per circuit.
export function loadFigures (device) {
  const m = device.measured
  if (m && m.avgW != null && m.peakW != null) {
    return { avgW: m.avgW, peakW: m.peakW, source: 'measured', estimate: Boolean(m.estimate), group: m.group || null }
  }
  if (device.ratedPowerW != null) {
    return { avgW: device.ratedPowerW, peakW: device.ratedPowerW, source: 'rated', estimate: false, group: null }
  }
  return { avgW: null, peakW: null, source: null, estimate: false, group: null }
}
