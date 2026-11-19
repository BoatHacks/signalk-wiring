// A small made-up boat, as an example of the wiring data file the seed tool
// loads (node seed.mjs wiring-data.mjs --url ...). Copy it to the owner's
// working folder as wiring-data.mjs and replace the contents.
//
// The file is a JavaScript module, so helpers and loops are allowed. It exports:
//
//   namespace     A name for this boat's data. Record ids are derived from it
//                 and each record's key, so keep it unchanged once seeded.
//   units         { gauge: 'AWG' | 'mm2', length: 'ft' | 'm' }: the defaults
//                 for cables. A cable can override with gaugeUnit/lengthUnit.
//   zones         Zone names, in the spelling to keep. Optional: a zone named
//                 on a device or cable is created anyway.
//   devices       [{ key, name, role, type, zone, ...plugin fields }]. `key` is
//                 local to this file. `monitor` and `parent` take device keys
//                 (battery monitor, enclosure). `photos` lists image files
//                 relative to this file. Every other field is a signalk-wiring
//                 device field (SPEC.md section 4 or the server's OpenAPI
//                 document), for example tripRatingA, nominalVoltage, terminals,
//                 signalkPath, meterPath/meterUnit, capacityAh, chemistry.
//   cables        [{ key, from, to, c, g, len, ... }]. from = supply side,
//                 to = load side (device keys). c = conductors (default one
//                 positive); a conductor may land elsewhere with from/to device
//                 keys and name terminals with fromTerminal/toTerminal (needed
//                 on converters). g = gauge (number, or "4/0" style for AWG),
//                 len = length. Also: link, zone, cableLabel, tags, notes, photos.
//   conduits      [{ key, name, kind, zone, cables: [cable keys], notes }]
//   circuitNames  { <fuse or breaker device key>: 'name' | { name, notes, meterPath, meterUnit } }
//   groupNames    [[[device keys], 'name']]: names a circuit with no fuse or
//                 breaker by devices it contains (first match wins).
//   retired       { devices: [keys], cables: [keys], conduits: [keys] }: keys
//                 that were seeded before and must now be deleted.

export const namespace = 'example-sample-wind'
export const units = { gauge: 'AWG', length: 'ft' }
export const zones = ['Engine room', 'Saloon', 'Nav station', 'Galley', 'Cockpit', 'Bow']

const POS = { conductor: 'positive' }
const NEG = { conductor: 'negative' }
const AC = [{ conductor: 'line' }, { conductor: 'neutral' }, { conductor: 'earth' }]
const cable = (key, from, to, opts = {}) => ({ key, from, to, c: [POS], ...opts })

// Two house batteries, each with a terminal fuse on its post.
const house = [1, 2].flatMap((n) => [
  {
    key: `house${n}`, name: `House battery ${n}`, role: 'storage', type: 'LiFePO4 battery', zone: 'Saloon',
    nominalVoltage: 12.8, capacityAh: 100, chemistry: 'lifepo4', purpose: 'house', monitor: 'shunt',
    tags: ['house bank']
  },
  { key: `mrbf${n}`, name: `MRBF 150 A - house ${n}`, role: 'distribution', type: 'Fuse', zone: 'Saloon', tripRatingA: 150 }
])

export const devices = [
  ...house,
  { key: 'battBus', name: 'House positive bus', role: 'distribution', type: 'Bus bar', zone: 'Saloon' },
  { key: 'battSwitch', name: 'House battery switch', role: 'distribution', type: 'Battery switch', zone: 'Saloon' },
  { key: 'mainFuse', name: 'Class-T 300 A main fuse', role: 'distribution', type: 'Fuse', zone: 'Saloon', tripRatingA: 300 },
  { key: 'distBus', name: 'DC distribution bus', role: 'distribution', type: 'Bus bar', zone: 'Nav station' },
  {
    key: 'shunt', name: 'Battery monitor shunt', role: 'distribution', type: 'Shunt', zone: 'Saloon',
    makeModel: 'Victron SmartShunt 500 A', signalkPath: 'electrical.batteries.0',
    voltagePath: 'electrical.batteries.0.voltage', currentPath: 'electrical.batteries.0.current',
    socPath: 'electrical.batteries.0.capacity.stateOfCharge'
  },
  { key: 'negBus', name: 'House negative bus', role: 'distribution', type: 'Bus bar', zone: 'Saloon' },

  // DC panel: each breaker protects its own circuit.
  { key: 'dcPanel', name: 'DC breaker panel', role: 'enclosure', type: 'DC panel', zone: 'Nav station', tags: ['original'] },
  ...[
    ['brkNav', 'Nav lights', 10, 'navLights', 'Navigation lights', 'Navigation light'],
    ['brkVhf', 'VHF', 10, 'vhf', 'VHF radio', 'VHF radio'],
    ['brkFridge', 'Refrigerator', 15, 'fridge', 'Refrigerator', 'Refrigerator'],
    ['brkCabin', 'Cabin lights', 15, 'cabinLights', 'Cabin lights', 'Cabin light']
  ].flatMap(([key, label, amps, load, loadName, type]) => [
    { key, name: `Breaker - ${label} (${amps} A)`, role: 'distribution', type: 'Breaker', zone: 'Nav station', tripRatingA: amps, parent: 'dcPanel', tags: ['original'] },
    { key: load, name: loadName, role: 'consumer', type, ratedPowerW: { navLights: 25, vhf: 60, fridge: 60, cabinLights: 40 }[load] }
  ]),
  // The bilge pump is fused straight off the battery bus, so it runs with the switch off.
  { key: 'fuseBilge', name: 'Fuse 15 A - bilge pump (always on)', role: 'distribution', type: 'Fuse', zone: 'Saloon', tripRatingA: 15 },
  { key: 'bilge', name: 'Bilge pump', role: 'consumer', type: 'Bilge pump', zone: 'Engine room', ratedPowerW: 50, signalkPath: 'electrical.pumps.bilge.running' },

  // Engine start and charging.
  { key: 'startBatt', name: 'Engine start battery', role: 'storage', type: 'AGM battery', zone: 'Engine room', nominalVoltage: 12, capacityAh: 90, chemistry: 'agm', purpose: 'starter' },
  { key: 'startSwitch', name: 'Start battery switch', role: 'distribution', type: 'Battery switch', zone: 'Engine room' },
  { key: 'starter', name: 'Starter motor', role: 'consumer', type: 'Starter motor', zone: 'Engine room' },
  { key: 'alt', name: 'Alternator', role: 'source', type: 'Alternator', zone: 'Engine room' },
  { key: 'fuseB2bIn', name: 'Fuse 60 A - DC-DC charger input', role: 'distribution', type: 'Fuse', zone: 'Engine room', tripRatingA: 60 },
  {
    key: 'b2b', name: 'DC-DC charger', role: 'converter', type: 'DC-DC converter', zone: 'Engine room',
    makeModel: 'Victron Orion XS 12/12-50', ratedDcA: 50,
    terminals: [
      { name: 'In+', conductor: 'positive', voltage: 12, port: 'in' }, { name: 'In-', conductor: 'negative', voltage: 12, port: 'in' },
      { name: 'Out+', conductor: 'positive', voltage: 12, port: 'out' }, { name: 'Out-', conductor: 'negative', voltage: 12, port: 'out' }
    ]
  },
  { key: 'fuseB2bOut', name: 'Fuse 60 A - DC-DC charger output', role: 'distribution', type: 'Fuse', zone: 'Saloon', tripRatingA: 60 },

  // Solar.
  { key: 'solar', name: 'Solar panels (2 x 200 W)', role: 'source', type: 'Solar panel', zone: 'Cockpit', ratedPowerW: 400 },
  { key: 'brkPv', name: 'PV breaker 20 A', role: 'distribution', type: 'Breaker', zone: 'Saloon', tripRatingA: 20 },
  {
    key: 'mppt', name: 'Solar charge controller', role: 'converter', type: 'MPPT charger', zone: 'Saloon',
    makeModel: 'Victron SmartSolar MPPT 100/30', meterPath: 'electrical.solar.0.current', meterUnit: 'A',
    terminals: [
      { name: 'PV+', conductor: 'positive', voltage: 40, port: 'PV' }, { name: 'PV-', conductor: 'negative', voltage: 40, port: 'PV' },
      { name: 'Bat+', conductor: 'positive', voltage: 12, port: 'Battery' }, { name: 'Bat-', conductor: 'negative', voltage: 12, port: 'Battery' }
    ]
  },
  { key: 'fuseMppt', name: 'Fuse 40 A - solar charger', role: 'distribution', type: 'Fuse', zone: 'Saloon', tripRatingA: 40 },

  // AC: shore power through a main breaker to an inverter/charger, then the AC panel.
  { key: 'shore', name: 'Shore power inlet (30 A)', role: 'source', type: 'Shore power inlet', zone: 'Cockpit', ratedAcA: 30, ratedAcV: 120 },
  { key: 'brkShore', name: 'Shore main breaker (30 A)', role: 'distribution', type: 'Breaker', zone: 'Nav station', current: 'ac', tripRatingA: 30 },
  {
    key: 'multi', name: 'Inverter/charger', role: 'converter', type: 'Inverter/charger', zone: 'Saloon',
    makeModel: 'Victron MultiPlus 12/2000', signalkPath: 'electrical.inverters.0',
    terminals: [
      { name: 'DC+', conductor: 'positive', voltage: 12, port: 'DC' }, { name: 'DC-', conductor: 'negative', voltage: 12, port: 'DC' },
      { name: 'AC in L', conductor: 'line', voltage: 120, port: 'AC in' }, { name: 'AC in N', conductor: 'neutral', voltage: 120, port: 'AC in' },
      { name: 'AC out L', conductor: 'line', voltage: 120, port: 'AC out' }, { name: 'AC out N', conductor: 'neutral', voltage: 120, port: 'AC out' },
      { name: 'PE', conductor: 'earth', port: 'AC out' }
    ]
  },
  { key: 'fuseMulti', name: 'Fuse 250 A - inverter/charger', role: 'distribution', type: 'Fuse', zone: 'Saloon', tripRatingA: 250 },
  { key: 'acPanel', name: 'AC load bus', role: 'distribution', type: 'Distribution panel', zone: 'Nav station', current: 'ac' },
  { key: 'brkOutlets', name: 'AC breaker - outlets (15 A)', role: 'distribution', type: 'Breaker', zone: 'Nav station', current: 'ac', tripRatingA: 15 },
  { key: 'outlets', name: 'GFCI outlets', role: 'consumer', type: 'Outlet', zone: 'Galley', current: 'ac', ratedPowerW: 600 },
  { key: 'brkWaterHeater', name: 'AC breaker - water heater (15 A)', role: 'distribution', type: 'Breaker', zone: 'Nav station', current: 'ac', tripRatingA: 15 },
  {
    key: 'waterHeater', name: 'Water heater', role: 'consumer', type: 'Water heater', zone: 'Engine room', current: 'ac',
    ratedPowerW: 1500, tags: ['unverified'], notes: 'Rating from the old survey; check the nameplate.'
  },
  { key: 'bond', name: 'Bonding and ground point', role: 'ground', type: 'Ground', zone: 'Engine room' }
]

export const cables = [
  // House bank: terminal fuse on each post, 2/0 to the bus. The two link cables
  // are not physical: they tell the plugin the batteries form one 1S2P bank.
  ...[1, 2].flatMap((n) => [
    cable(`house${n}-mrbf`, `house${n}`, `mrbf${n}`, { len: 0, notes: 'Terminal fuse on the battery post.' }),
    cable(`mrbf${n}-bus`, `mrbf${n}`, 'battBus', { g: '2/0', len: 2 }),
    cable(`house${n}-neg`, `house${n}`, 'shunt', { c: [NEG], g: '2/0', len: 2, notes: 'Negatives go through the shunt.' })
  ]),
  cable('house1-house2-link', 'house1', 'house2', { link: 'parallel', c: [POS, NEG], notes: 'Bank link only, not a cable.' }),
  cable('shunt-negBus', 'shunt', 'negBus', { c: [NEG], g: '2/0', len: 1 }),
  cable('bus-switch', 'battBus', 'battSwitch', { g: '4/0', len: 1 }),
  cable('switch-mainFuse', 'battSwitch', 'mainFuse', { g: '4/0', len: 0.5 }),
  cable('mainFuse-distBus', 'mainFuse', 'distBus', { g: '4/0', len: 6, zone: 'Saloon' }),

  // DC panel breakers to their loads (the panel bus is the distribution bus).
  ...[['brkNav', 'navLights', 14, 30], ['brkVhf', 'vhf', 12, 15], ['brkFridge', 'fridge', 10, 20], ['brkCabin', 'cabinLights', 14, 25]].flatMap(([brk, load, g, len]) => [
    cable(`distBus-${brk}`, 'distBus', brk, { len: 0, notes: 'Panel bus.' }),
    cable(`${brk}-${load}`, brk, load, { g, len, c: [POS, { conductor: 'negative', to: 'negBus' }] })
  ]),
  cable('battBus-fuseBilge', 'battBus', 'fuseBilge', { g: 14, len: 0.5 }),
  cable('fuseBilge-bilge', 'fuseBilge', 'bilge', { g: 14, len: 12 }),

  // Engine.
  cable('startBatt-switch', 'startBatt', 'startSwitch', { g: '2/0', len: 2 }),
  cable('startSwitch-starter', 'startSwitch', 'starter', { g: '2/0', len: 4 }),
  cable('alt-startBatt', 'alt', 'startBatt', { g: 4, len: 4, notes: 'Alternator charges the start battery directly.' }),
  cable('startBatt-fuseB2b', 'startBatt', 'fuseB2bIn', { g: 6, len: 1 }),
  cable('fuseB2b-b2b', 'fuseB2bIn', 'b2b', { g: 6, len: 8, c: [{ conductor: 'positive', toTerminal: 'In+' }] }),
  cable('distBus-fuseB2bOut', 'distBus', 'fuseB2bOut', { g: 6, len: 1 }),
  cable('fuseB2bOut-b2b', 'fuseB2bOut', 'b2b', { g: 6, len: 8, c: [{ conductor: 'positive', toTerminal: 'Out+' }], notes: 'Charge current flows to the bus; drawn from the fuse side.' }),

  // Solar.
  cable('solar-brkPv', 'solar', 'brkPv', { g: 10, len: 25, c: [POS, NEG] }),
  cable('brkPv-mppt', 'brkPv', 'mppt', { g: 10, len: 1, c: [{ conductor: 'positive', toTerminal: 'PV+' }, { conductor: 'negative', toTerminal: 'PV-' }] }),
  cable('distBus-fuseMppt', 'distBus', 'fuseMppt', { g: 8, len: 1 }),
  cable('fuseMppt-mppt', 'fuseMppt', 'mppt', { g: 8, len: 3, c: [{ conductor: 'positive', toTerminal: 'Bat+' }] }),

  // Inverter/charger: DC side fused at the battery bus, AC through the shore breaker.
  cable('battBus-fuseMulti', 'battBus', 'fuseMulti', { g: '2/0', len: 0.5 }),
  cable('fuseMulti-multi', 'fuseMulti', 'multi', { g: '2/0', len: 4, c: [{ conductor: 'positive', toTerminal: 'DC+' }] }),
  cable('shore-brk', 'shore', 'brkShore', { g: 10, len: 15, c: AC }),
  cable('brkShore-multi', 'brkShore', 'multi', { g: 10, len: 8, c: [{ conductor: 'line', toTerminal: 'AC in L' }, { conductor: 'neutral', toTerminal: 'AC in N' }, { conductor: 'earth' }] }),
  cable('multi-acPanel', 'multi', 'acPanel', { g: 10, len: 8, c: [{ conductor: 'line', fromTerminal: 'AC out L' }, { conductor: 'neutral', fromTerminal: 'AC out N' }, { conductor: 'earth', fromTerminal: 'PE' }] }),
  ...[['brkOutlets', 'outlets', 14, 20], ['brkWaterHeater', 'waterHeater', 12, 15]].flatMap(([brk, load, g, len]) => [
    cable(`acPanel-${brk}`, 'acPanel', brk, { c: AC, len: 0, notes: 'Panel bus.' }),
    cable(`${brk}-${load}`, brk, load, { c: AC, g, len })
  ]),
  cable('acPanel-bond', 'acPanel', 'bond', { c: [{ conductor: 'earth' }], g: 8, len: 10, notes: 'AC earth to the bonding point.' })
]

export const conduits = [
  { key: 'mastLoom', name: 'Loom to the bow', kind: 'Loom', zone: 'Saloon', cables: ['brkNav-navLights', 'brkCabin-cabinLights'] }
]

export const circuitNames = {
  mainFuse: { name: 'House main (300 A)', meterPath: 'electrical.batteries.0.current', meterUnit: 'A' },
  fuseBilge: 'Bilge pump (always on)',
  fuseMulti: 'Inverter/charger DC',
  brkShore: 'Shore power',
  brkPv: 'Solar panels (PV side)',
  mrbf1: 'House battery 1',
  mrbf2: 'House battery 2'
}

export const groupNames = [
  [['startSwitch', 'starter'], 'Starter cable'],
  [['alt'], 'Alternator to start battery'],
  [['multi', 'acPanel'], 'Inverter/charger AC output']
]

export const retired = { devices: [], cables: [], conduits: [] }
