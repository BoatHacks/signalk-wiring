// Built-in icon library (plan 0029). Two sets:
//  - simple icons: 24 by 24 line icons, one per device type, with a fallback
//    per role and a generic one. Their markup lives here so lists can draw
//    them at once, in the text colour of the theme.
//  - detailed icons: planned, deferred by the user; none exist yet.
// Colours come from currentColor, so the icons follow the theme.


export const SIMPLE_ICONS = {
  generic: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="2"/>',
  // role fallbacks
  consumer: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  source: '<path d="M13 3L6 13h5l-1 8 8-11h-5z"/>',
  storage: '<rect x="2" y="7" width="18" height="10" rx="1.5"/><path d="M22 10v4M6 12h4M8 10v4M14 12h4"/>',
  distribution: '<path d="M4 12h6M10 12l6-6h4M10 12l6 6h4M10 12h10"/>',
  converter: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
  enclosure: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M9 11v2"/>',
  // consumers
  light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11c.7.6 1 1.3 1 2h4c0-.7.3-1.4 1-2a6 6 0 0 0-3-11z"/>',
  pump: '<circle cx="12" cy="12" r="8"/><path d="M9 8l7 4-7 4z"/>',
  fridge: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 10h12M9 5v2M9 13v4"/>',
  chartplotter: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4M6 13l4-4 3 3 4-5"/>',
  radio: '<rect x="7" y="8" width="10" height="14" rx="2"/><path d="M12 8V2M10 12h4M10 16h4"/>',
  autopilot: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6M12 14v6M4 12h6M14 12h6"/>',
  windlass: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8M5 14a7 7 0 0 0 14 0M5 14l-2 2M19 14l2 2"/>',
  fan: '<circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C12 6 14 4 16 5s1 4-4 5.5M13.3 12.7C17 15 17 18 15 19s-4-1-3-6M10.5 12.7C7 15 5 14 5 12s2-4 5.5-1"/>',
  heater: '<path d="M5 20h14M8 17c-2-3 2-4 0-7M12 17c-2-3 2-4 0-7M16 17c-2-3 2-4 0-7"/>',
  instrument: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6M6 17h2M16 17h2"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/>',
  ais: '<path d="M12 3l7 17-7-4-7 4z"/>',
  stereo: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  'water-heater': '<path d="M12 3c4 5 6 7 6 10a6 6 0 0 1-12 0c0-3 2-5 6-10z"/>',
  motor: '<circle cx="12" cy="12" r="7"/><path d="M9 15V9l3 4 3-4v6M3 12h2M19 12h2"/>',
  'gx-device': '<rect x="3" y="8" width="18" height="9" rx="2"/><path d="M6 12h2M10 12h2M14 12h2M6 17v2M18 17v2"/>',
  touchscreen: '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="13" r="2.5"/><path d="M12 5h0"/>',
  'can-adapter': '<circle cx="12" cy="4" r="2"/><path d="M12 6v15M12 11l-4-2v3M12 15l4-3v-2"/>',
  // sources
  'solar-panel': '<path d="M4 8h16l-2 11H6zM9 8l-1 11M15 8l1 11M5 13.5h14M12 2v3M5 4l2 2M19 4l-2 2"/>',
  'shore-inlet': '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1"/><circle cx="15.5" cy="10" r="1"/><circle cx="12" cy="15.5" r="1"/>',
  generator: '<circle cx="12" cy="12" r="9"/><path d="M13 6l-4 7h4l-1 5 4-7h-4z"/>',
  alternator: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M12 16v5"/>',
  wind: '<circle cx="12" cy="11" r="1.5"/><path d="M12 12.5V22M12 9.5L11 2M13.3 11.7L20 16M10.7 11.7L4 16"/>',
  hydro: '<circle cx="12" cy="7" r="3"/><path d="M3 15c3-3 6 3 9 0s6 3 9 0M3 20c3-3 6 3 9 0s6 3 9 0"/>',
  'fuel-cell': '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  // storage
  battery: '<rect x="2" y="7" width="18" height="10" rx="1.5"/><path d="M22 10v4M6 12h4M8 10v4M14 12h4"/>',
  'battery-bank': '<rect x="3" y="3" width="16" height="7" rx="1"/><rect x="3" y="14" width="16" height="7" rx="1"/><path d="M21 5v3M21 16v3"/>',
  // distribution
  switch: '<circle cx="5" cy="16" r="1.5"/><circle cx="19" cy="16" r="1.5"/><path d="M6 15l11-8"/>',
  breaker: '<rect x="7" y="3" width="10" height="18" rx="1"/><rect x="10" y="6" width="4" height="6"/>',
  fuse: '<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M7 12h10"/>',
  'bus-bar': '<rect x="3" y="10" width="18" height="4"/><path d="M7 10V5M12 10V5M17 10V5M7 14v5M12 14v5M17 14v5"/>',
  panel: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h3M13 8h3M8 12h3M13 12h3M8 16h3M13 16h3"/>',
  isolator: '<path d="M3 12h5M16 12h5M8 7v10l8-5zM16 7v10"/>',
  'battery-switch': '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="5"/><path d="M12 7v5"/>',
  relay: '<rect x="3" y="7" width="9" height="10"/><path d="M6 10l3 4M14 12h2M16 12l5-4"/>',
  shunt: '<rect x="6" y="9" width="12" height="6"/><path d="M2 12h4M18 12h4M9 9V5M15 9V5"/>',
  outlet: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M12 6v1M12 17v1"/>',
  bms: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  connector: '<rect x="3" y="8" width="7" height="8" rx="1"/><rect x="14" y="8" width="7" height="8" rx="1"/><path d="M10 11h4M10 13h4"/>',
  'nmea-bus': '<path d="M3 12h18M8 12v6M16 12v6"/><circle cx="8" cy="19" r="1.6"/><circle cx="16" cy="19" r="1.6"/>',
  'transfer-switch': '<path d="M3 12h5M16 6h5M16 18h5"/><circle cx="8" cy="12" r="1.5"/><path d="M9 11l7-5"/>',
  // converters
  inverter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 10h5M13 13c1-3 2-3 3 0s2 3 3 0"/>',
  charger: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M13 7l-4 5h4l-1 5 4-6h-4z"/>',
  'inverter-charger': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 10h8l-2-2M18 14h-8l2 2"/>',
  'dc-dc': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 10h5M6 14h1M9 14h1M13 12h5M16 10l2 2-2 2"/>',
  mppt: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 12h5M17 9l2 3-2 3"/>',
  transformer: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>'
}

// Ordered rules over the lower-cased type text: the first match wins, so the
// more specific words come first.
const TYPE_RULES = [
  [/transfer switch/, 'transfer-switch'],
  [/isolation transformer|transformer/, 'transformer'],
  [/inverter\/charger|inverter charger|multi/, 'inverter-charger'],
  [/dc-dc|dc\/dc/, 'dc-dc'],
  [/mppt|solar charge/, 'mppt'],
  [/battery charger|charger/, 'charger'],
  [/inverter/, 'inverter'],
  [/battery isolator|isolator/, 'isolator'],
  [/battery switch|main switch/, 'battery-switch'],
  [/bms|battery management/, 'bms'],
  [/battery bank/, 'battery-bank'],
  [/battery/, 'battery'],
  [/shunt/, 'shunt'],
  [/bus ?bar/, 'bus-bar'],
  [/breaker|mcb|rcbo|rcd|fi\/ls/, 'breaker'],
  [/fuse/, 'fuse'],
  [/relay/, 'relay'],
  [/switch/, 'switch'],
  [/outlet|socket|schuko/, 'outlet'],
  [/panel|distribution/, 'panel'],
  [/connector|plug/, 'connector'],
  [/nmea|n2k|canbus|can bus/, 'nmea-bus'],
  [/can adapter|can-usb|usb/, 'can-adapter'],
  [/touch/, 'touchscreen'],
  [/gx|cerbo/, 'gx-device'],
  [/motor|drive/, 'motor'],
  [/solar|photovoltaic|\bpv\b/, 'solar-panel'],
  [/shore/, 'shore-inlet'],
  [/generator|genset/, 'generator'],
  [/alternator/, 'alternator'],
  [/wind/, 'wind'],
  [/hydro/, 'hydro'],
  [/fuel cell/, 'fuel-cell'],
  [/windlass/, 'windlass'],
  [/water heater|boiler/, 'water-heater'],
  [/heater/, 'heater'],
  [/light|lamp|\bled\b/, 'light'],
  [/pump/, 'pump'],
  [/refrigerator|fridge|freezer/, 'fridge'],
  [/chartplotter|plotter|mfd/, 'chartplotter'],
  [/vhf|radio/, 'radio'],
  [/autopilot|pilot/, 'autopilot'],
  [/fan|blower/, 'fan'],
  [/radar/, 'radar'],
  [/\bais\b/, 'ais'],
  [/stereo|speaker|audio/, 'stereo'],
  [/instrument|display|gauge/, 'instrument'],
  [/cabinet|box/, 'enclosure']
]

const ROLE_FALLBACKS = ['consumer', 'source', 'storage', 'distribution', 'converter', 'enclosure']

function simpleKeyFor (device) {
  const type = String(device.type || '').trim().toLowerCase()
  const model = String(device.makeModel || '').trim().toLowerCase()
  for (const text of [type, model]) {
    if (!text) continue
    for (const [re, key] of TYPE_RULES) if (re.test(text)) return key
  }
  return ROLE_FALLBACKS.includes(device.role) ? device.role : 'generic'
}

// { simple, detailed } for a device: the simple key always exists. The
// detailed key is null until the detailed set (plan 0029, deferred) is drawn.
export function iconFor (device) {
  const d = device || {}
  return { simple: simpleKeyFor(d), detailed: null }
}

// The markup of a simple icon, ready to inline. currentColor strokes, so it
// follows the text colour of the theme.
export function simpleIconSvg (key, size = 20) {
  const inner = SIMPLE_ICONS[key] || SIMPLE_ICONS.generic
  return `<svg class="simple-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
}
