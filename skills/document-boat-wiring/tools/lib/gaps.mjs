// What is still missing in a wiring data set. Pure, so it can be tested.

const PROTECTOR_TYPE = /fuse|breaker/i
const isActive = (r) => r.status !== 'removed'

// `devices`, `cables`, `circuits`: resource maps (id -> record) as the API
// lists them. `derived` and `checks`: the plugin routes' responses or null.
export function summarizeGaps ({ devices, cables, circuits, derived = null, checks = null }) {
  const dev = Object.entries(devices).map(([id, d]) => ({ id, ...d })).filter(isActive)
  const cab = Object.entries(cables).map(([id, c]) => ({ id, ...c })).filter(isActive)
  const cir = Object.entries(circuits).map(([id, c]) => ({ id, ...c })).filter(isActive)
  const name = new Map(dev.map((d) => [d.id, d.name]))
  const cableName = (c) => `${name.get(c.fromDeviceId) || c.fromDeviceId} -> ${name.get(c.toDeviceId) || c.toDeviceId}`

  const tagged = (r) => (r.tags || []).includes('unverified')
  const used = new Set()
  for (const c of cab) {
    used.add(c.fromDeviceId); used.add(c.toDeviceId)
    for (const k of c.conductors || []) { if (k.fromDeviceId) used.add(k.fromDeviceId); if (k.toDeviceId) used.add(k.toDeviceId) }
  }
  const power = (c) => {
    if (c.link) return false // a battery bank link, often not a physical cable
    const kinds = (c.conductors && c.conductors.length ? c.conductors : [{ conductor: 'positive' }]).map((k) => k.conductor)
    return kinds.some((k) => k !== 'signal' && k !== 'earth')
  }
  // A zero length marks a link bar or a stud, which has no gauge to record.
  const hasGauge = (c) => (c.gauge !== null && c.gauge !== undefined) || c.length === 0

  const warnings = cir.flatMap((c) => (c.derived && c.derived.warnings) || [])
  if (derived && Array.isArray(derived.warnings)) warnings.push(...derived.warnings)

  const report = {
    counts: { devices: dev.length, cables: cab.length, circuits: cir.length },
    unverified: [
      ...dev.filter(tagged).map((d) => ({ kind: 'device', name: d.name })),
      ...cab.filter(tagged).map((c) => ({ kind: 'cable', name: cableName(c) }))
    ],
    unratedProtectors: dev.filter((d) => d.role === 'distribution' && PROTECTOR_TYPE.test(d.type || '') && !(d.tripRatingA > 0)).map((d) => d.name),
    unconnected: dev.filter((d) => !used.has(d.id) && d.role !== 'enclosure').map((d) => d.name),
    noGauge: cab.filter((c) => power(c) && !hasGauge(c)).map(cableName),
    unprotected: cir.filter((c) => c.derived && c.derived.unprotected).map((c) => c.name),
    warnings,
    checks: null,
    failingCables: []
  }
  if (checks && checks.counts) {
    report.checks = checks.counts
    for (const r of checks.results || []) {
      if (r.verdict === 'fail' || r.verdict === 'warning') {
        const sections = (r.explanation && r.explanation.sections) || []
        const bad = sections.find((s) => s.verdict === r.verdict) || sections[0]
        const why = bad ? `${bad.heading}: ${(bad.lines || []).slice(-1)[0] || ''}` : ''
        report.failingCables.push(`${r.name}: ${r.verdict}${why ? ` (${why.slice(0, 160)})` : ''}`)
      }
    }
  }
  return report
}
