// Pure helpers of the Buses tab (plan 0037): the list rows, the verdict
// badge, the tap rows of the detail view and the device page, and the clean
// up of the tap rows of the form. The rules and numbers are worked out by the
// server (GET /buses); nothing here decides whether a bus is fine.

export const BUS_CLASSES = [
  { value: 'micro', label: 'Micro (light cable)' },
  { value: 'mini', label: 'Mini (light cable)' },
  { value: 'maxi', label: 'Maxi (heavy cable)' }
]

export const VERDICT_WORDS = { ok: 'ok', warning: 'warning', fail: 'fail', cannot: 'cannot check' }

const CLASS_WORDS = { micro: 'Micro', mini: 'Mini', maxi: 'Maxi' }

export const BUS_ADVISORY = 'Advisory, not a guarantee. The bus maker\'s own instructions and your installer decide.'

export function verdictWord (verdict) {
  return VERDICT_WORDS[verdict] || 'not checked'
}

export function classLabel (cableClass) {
  return CLASS_WORDS[cableClass] || 'no class'
}

function trimNumber (n) {
  return String(Math.round(n * 100) / 100)
}

export function lengthText (backbone) {
  if (backbone == null || backbone.length == null) return 'no length'
  return `${trimNumber(backbone.length)} ${backbone.lengthUnit || 'm'}`
}

// "12 LEN (0.6 A)", "12+ LEN (some unknown)" or "no LEN".
export function lenText (derived) {
  if (!derived || derived.lenTotal == null) return (derived && derived.deviceCount > 0) ? 'LEN unknown' : 'no LEN'
  const unknown = (derived.lenUnknownDeviceIds || []).length
  const amps = derived.impliedCurrentA != null ? ` (${trimNumber(derived.impliedCurrentA)} A)` : ''
  return `${trimNumber(derived.lenTotal)}${unknown > 0 ? '+' : ''} LEN${amps}`
}

// The worst verdict first, so the list can be sorted by what needs a look.
const VERDICT_RANK = { fail: 0, warning: 1, cannot: 2, ok: 3 }

// One row of the list: the live backbone record joined with its entry of
// GET /buses (by id). `entry` may be missing, for example a removed backbone.
export function busRow (backbone, entry) {
  const derived = entry && entry.derived
  const verdict = entry ? entry.verdict : null
  const taps = backbone.taps || []
  const devices = new Set(taps.map((t) => t.deviceId))
  return {
    id: backbone.id,
    name: backbone.name,
    removed: backbone.status === 'removed',
    classText: classLabel(backbone.cableClass),
    lengthText: lengthText(backbone),
    deviceCount: derived ? derived.deviceCount : devices.size,
    lenText: lenText(derived || { deviceCount: devices.size }),
    verdict,
    verdictText: verdict ? verdictWord(verdict) : null
  }
}

export function busRows (backbones, buses) {
  const byId = new Map(((buses && buses.buses) || []).map((b) => [b.id, b]))
  return (backbones || []).map((b) => busRow(b, byId.get(b.id)))
}

export function sortBusRows (rows) {
  return [...rows].sort((a, b) =>
    (a.removed - b.removed) ||
    ((VERDICT_RANK[a.verdict] ?? 4) - (VERDICT_RANK[b.verdict] ?? 4)) ||
    a.name.localeCompare(b.name))
}

export function filterBuses (rows, text) {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => r.name.toLowerCase().includes(q))
}

// One line per tap for the detail view. `deviceById` is a Map of devices.
export function tapRows (backbone, deviceById) {
  return (backbone.taps || []).map((t, i) => {
    const device = deviceById.get(t.deviceId)
    const fed = t.powerFeed && t.fedFromDeviceId ? deviceById.get(t.fedFromDeviceId) : null
    return {
      key: `${t.deviceId}|${t.port || ''}|${i}`,
      deviceId: t.deviceId,
      device,
      name: (device && device.name) || t.deviceId,
      port: t.port || '',
      dropText: t.dropLength != null ? `${trimNumber(t.dropLength)} m` : 'no drop length',
      alongText: t.along != null ? `${trimNumber(t.along)} ${backbone.lengthUnit || 'm'}` : '',
      powerFeed: Boolean(t.powerFeed),
      fedFromId: t.fedFromDeviceId || null,
      fedFromName: fed ? fed.name : (t.fedFromDeviceId || ''),
      lenText: device && device.len != null ? `${trimNumber(device.len)} LEN` : 'no LEN'
    }
  })
}

// The live backbones a device sits on, with its tap(s) on each, for the
// device page. Removed backbones are left out.
export function busesOfDevice (deviceId, backbones) {
  const out = []
  for (const b of backbones || []) {
    if (b.status === 'removed') continue
    const taps = (b.taps || []).filter((t) => t.deviceId === deviceId)
    if (taps.length > 0) out.push({ backbone: b, taps })
  }
  return out
}

// Whether the device page has a bus block (plan 0041): the device is tapped
// onto a live backbone, has an NMEA 2000 port, or is typed as an NMEA 2000
// device. A plain consumer, a fridge for example, has none.
export function isBusDevice (device, backbones) {
  if (!device) return false
  if (busesOfDevice(device.id, backbones).length > 0) return true
  if (/^\s*nmea\s*2000( device)?\s*$/i.test(device.type || '')) return true
  return (device.terminals || []).some((t) => t && (t.port === 'NMEA 2000' || t.name === 'NMEA 2000'))
}

// A blank tap row for the form.
export function blankTap () {
  return { deviceId: '', port: '', dropLength: '', along: '', powerFeed: false, fedFromDeviceId: '' }
}

// Form rows to the payload: rows without a device are dropped, numbers become
// numbers or null, the fed-from device only counts on a power feed.
export function cleanTaps (rows) {
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Number(v)
  return (rows || [])
    .filter((r) => r && r.deviceId)
    .map((r) => ({
      deviceId: r.deviceId,
      port: String(r.port || '').trim() || null,
      dropLength: num(r.dropLength),
      along: num(r.along),
      powerFeed: Boolean(r.powerFeed),
      fedFromDeviceId: r.powerFeed && r.fedFromDeviceId ? r.fedFromDeviceId : null
    }))
}

// Stored taps to form rows (strings for the inputs).
export function tapsToForm (taps) {
  return (taps || []).map((t) => ({
    deviceId: t.deviceId,
    port: t.port || '',
    dropLength: t.dropLength != null ? String(t.dropLength) : '',
    along: t.along != null ? String(t.along) : '',
    powerFeed: Boolean(t.powerFeed),
    fedFromDeviceId: t.fedFromDeviceId || ''
  }))
}

// A copy of a backbone as the payload of a new one: no id, route or status,
// and no taps (a device can sit on one backbone only once).
export function duplicatePayload (backbone) {
  return {
    name: `${backbone.name} (copy)`,
    cableClass: backbone.cableClass ?? null,
    length: backbone.length ?? null,
    lengthUnit: backbone.lengthUnit ?? null,
    terminatorA: Boolean(backbone.terminatorA),
    terminatorB: Boolean(backbone.terminatorB),
    supplyRatingA: backbone.supplyRatingA ?? null,
    notes: backbone.notes ?? null,
    taps: []
  }
}
