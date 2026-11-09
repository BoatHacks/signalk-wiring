// Popular device types per role, offered in the Type dropdown. Not a closed
// list: a type that is not here can be added, and types already used on
// devices are offered too, so the list grows with the boat.
export const TYPE_SUGGESTIONS = {
  consumer: [
    'Navigation light', 'Cabin light', 'Anchor light', 'Bilge pump', 'Freshwater pump',
    'Refrigerator', 'Chartplotter', 'VHF radio', 'Autopilot', 'Anchor windlass',
    'Fan', 'Heater', 'Instrument', 'Radar', 'AIS transceiver', 'Stereo', 'Water heater'
  ],
  source: [
    'Solar panel', 'Shore power inlet', 'Generator', 'Alternator', 'Wind generator',
    'Hydro generator', 'Fuel cell'
  ],
  storage: ['Battery', 'Battery bank'],
  distribution: [
    'Switch', 'Breaker', 'Fuse', 'Bus bar', 'Distribution panel', 'Battery isolator',
    'Battery switch', 'Relay', 'Shunt'
  ],
  converter: [
    'Inverter', 'Battery charger', 'Inverter/charger', 'DC-DC converter', 'MPPT charger', 'Isolation transformer'
  ],
  enclosure: ['Breaker box', 'AC panel', 'DC panel', 'Fuse box', 'Cabinet']
}

// The options for a role's Type dropdown: the role's suggestions, then any
// other types in use (including the device's current value, so an older
// free-text type is never lost), sorted, with no case-insensitive repeats.
export function typeOptions (role, usedTypes, current) {
  const suggested = TYPE_SUGGESTIONS[role] || TYPE_SUGGESTIONS.consumer
  const seen = new Set(suggested.map((t) => t.toLowerCase()))
  const used = []
  for (const raw of [...(usedTypes || []), current]) {
    const type = typeof raw === 'string' ? raw.trim() : ''
    if (!type || seen.has(type.toLowerCase())) continue
    seen.add(type.toLowerCase())
    used.push(type)
  }
  used.sort((a, b) => a.localeCompare(b))
  return { suggested, used }
}

// Types that look critical: switching them off by mistake could hurt the
// boat or the crew. A new device of one of these starts with "confirm before
// switching" on. Matched ignoring case against the free-text type. The same
// list is in src/safety.js (the store applies it too); a test keeps both equal.
export const CRITICAL_TYPE_WORDS = [
  'bilge', 'refrigerator', 'fridge', 'freezer', 'autopilot', 'navigation light', 'nav light', 'windlass'
]

export function isCriticalType (type) {
  if (typeof type !== 'string') return false
  const text = type.trim().toLowerCase()
  return text !== '' && CRITICAL_TYPE_WORDS.some((word) => text.includes(word))
}

// Device types that are plainly AC or DC (plan 0019), matched ignoring case on
// the whole type name. Converters, distribution devices and consumers are not
// listed: their ports or the supply side decide. The same table is in
// src/current.js (the store applies it too); a test keeps both equal.
export const AC_TYPES = ['Shore power inlet', 'Generator', 'Isolation transformer']
export const DC_TYPES = [
  'Solar panel', 'Alternator', 'Wind generator', 'Hydro generator', 'Fuel cell',
  'Battery', 'Battery bank', 'Lead-acid battery', 'AGM battery', 'LiFePO4 battery',
  'Starter battery', 'House battery', 'Shunt', 'Battery isolator', 'Battery switch'
]

// 'ac', 'dc' or null for a type name.
export function typeCurrent (type) {
  if (typeof type !== 'string') return null
  const text = type.trim().toLowerCase()
  if (AC_TYPES.some((t) => t.toLowerCase() === text)) return 'ac'
  if (DC_TYPES.some((t) => t.toLowerCase() === text)) return 'dc'
  return null
}
