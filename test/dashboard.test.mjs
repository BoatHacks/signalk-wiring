import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dashboardStats, dashboardChecks, configuredSide, autoInputSide, autoOutputSide, liveFlows, batteryCards,
  switchesOn, dashboardPaths, formatWatts, formatMetres, netText, percentText, onFloorplan, schematicPlaced,
  cableLengthOf, cableReason, busReasons, batteryTotals, batteryNote, switchSummary, hasLiveValue, dashboardOrder, isChargingSource, historyPaths, readLivePref, writeLivePref, STALE_MS
} from '../public/dashboard.js'

const NOW = 1_000_000_000

// ---- A small boat, worked out by hand ----

const devices = [
  { id: 'd1', name: 'Pump', role: 'consumer', ratedPowerW: 60, posX: 1, status: 'active' },
  { id: 'd2', name: 'Light', role: 'consumer', status: 'active' },
  { id: 'd3', name: 'Solar', role: 'source', status: 'active' },
  { id: 'd4', name: 'Batt', role: 'storage', capacityAh: 100, nominalVoltage: 12, status: 'active' },
  { id: 'd5', name: 'Fuse 10A', role: 'distribution', type: 'Fuse', tripRatingA: 10, status: 'active' },
  { id: 'd6', name: 'Breaker', role: 'distribution', type: 'Breaker', status: 'active' },
  { id: 'd7', name: 'Gone', role: 'consumer', ratedPowerW: 999, status: 'removed' },
  { id: 'd8', name: 'Box', role: 'enclosure', posX: 0, status: 'active' },
  { id: 'd9', name: 'Inside', role: 'consumer', ratedPowerW: 25, parentId: 'd8', status: 'active' }
]
const cables = [
  { id: 'w1', fromDeviceId: 'd3', toDeviceId: 'd5', gauge: 10, gaugeUnit: 'AWG', length: 3, lengthUnit: 'm', status: 'active' },
  { id: 'w2', fromDeviceId: 'd5', toDeviceId: 'd1', length: 10, lengthUnit: 'ft', status: 'active' },
  // no recorded length, but waypoints 3 m and 4 m apart: 5 m measured
  { id: 'w3', fromDeviceId: 'd5', toDeviceId: 'd2', route: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }], status: 'active' },
  { id: 'w4', fromDeviceId: 'd5', toDeviceId: 'd2', length: 50, lengthUnit: 'm', status: 'removed' },
  { id: 'w5', fromDeviceId: 'd1', toDeviceId: 'd2', length: 2, lengthUnit: 'm', conductors: [{ conductor: 'signal' }], status: 'active' },
  { id: 'w6', fromDeviceId: 'd5', toDeviceId: 'd9', status: 'active' }
]
const circuits = [
  { id: 'c1', name: 'Pump circuit', status: 'active', derived: { cableIds: ['w1', 'w2'], returnCableIds: [], voltage: 12, ratingA: 10, unprotected: false, endDeviceIds: ['d1'] } },
  { id: 'c2', name: 'Light circuit', status: 'active', derived: { cableIds: ['w3'], returnCableIds: [], voltage: null, ratingA: null, unprotected: true, endDeviceIds: ['d2'] } },
  { id: 'c3', name: 'Old', status: 'removed', derived: { cableIds: [], returnCableIds: [], unprotected: true } }
]
const schematics = [
  { id: 's1', name: 'Main', status: 'active', devices: [{ deviceId: 'd3', x: 0, y: 0 }, { deviceId: 'd5', x: 400, y: 0 }, { deviceId: 'd1', x: 800, y: 0 }] },
  { id: 's2', name: 'Box', status: 'active', devices: [{ deviceId: 'd8', x: 0, y: 0 }] },
  { id: 's3', name: 'Old', status: 'removed', devices: [{ deviceId: 'd2', x: 0, y: 0 }] }
]
const banks = [
  { batteryIds: ['d4'], capacityAh: 100, energyWh: 1200, voltage: 12 },
  { batteryIds: ['x'], capacityAh: 50, energyWh: null, voltage: null },
  { batteryIds: ['y'], capacityAh: null, energyWh: null, voltage: null }
]
const base = {
  devices, cables, circuits, schematics, banks,
  conduits: [{ id: 'k1', name: 'Conduit', status: 'active' }],
  zones: [{ id: 'z1' }, { id: 'z2' }],
  plans: [{ id: 'p1', status: 'active' }, { id: 'p2', status: 'removed' }],
  backbones: [{ id: 'b1', status: 'active' }]
}

test('statistics: counts of devices by role leave removed devices out', () => {
  const s = dashboardStats(base)
  assert.equal(s.devices.total, 8)
  assert.deepEqual(s.devices.byRole, { consumer: 3, source: 1, storage: 1, distribution: 2, enclosure: 1 })
})

test('statistics: counts of cables, circuits, conduits, zones, pages, plans, backbones', () => {
  const s = dashboardStats(base)
  assert.equal(s.cables, 5)
  assert.equal(s.circuits, 2)
  assert.equal(s.conduits, 1)
  assert.equal(s.zones, 2)
  assert.equal(s.schematics, 2)
  assert.equal(s.floorplans, 1)
  assert.equal(s.backbones, 1)
})

test('statistics: cable length is recorded first, then measured, and counts the cables with neither', () => {
  const { cableLength } = dashboardStats(base)
  // w1 3 m + w2 10 ft (3.048 m) + w5 2 m recorded, w3 5 m measured, w6 none
  assert.ok(Math.abs(cableLength.totalM - 13.048) < 1e-9)
  assert.equal(cableLength.recorded, 3)
  assert.equal(cableLength.measured, 1)
  assert.equal(cableLength.none, 1)
})

test('a cable with no length and no route has no length at all', () => {
  assert.deepEqual(cableLengthOf({ id: 'q', fromDeviceId: 'd1' }, new Map(), new Map()), { metres: null, source: 'none' })
  assert.equal(cableLengthOf({ length: 12, lengthUnit: 'ft', route: [{ x: 0, y: 0 }, { x: 99, y: 0 }] }, new Map(), new Map()).source, 'recorded')
})

test('statistics: protected and unprotected circuits', () => {
  assert.deepEqual(dashboardStats(base).protection, { protected: 1, unprotected: 1 })
})

test('statistics: battery capacity uses the bank energy, else the voltage, else 12 V', () => {
  const b = dashboardStats(base).battery
  // 100 Ah / 1200 Wh, plus 50 Ah at 12 V = 600 Wh (assumed), one bank with no capacity
  assert.equal(b.ah, undefined, 'amp hours are not summed')
  assert.deepEqual(b.perBank.map((x) => x.ah), [100, 50])
  assert.equal(b.wh, 1800)
  assert.equal(b.assumed12, 1)
  assert.equal(b.unknown, 1)
  assert.equal(b.banks, 3)
})

test('statistics: a battery in no bank still counts', () => {
  const only = dashboardStats({ ...base, banks: [] })
  // d4 is a stray battery of 100 Ah at its 12 V nominal voltage
  assert.equal(only.battery.banks, 1)
  assert.deepEqual(only.battery.perBank.map((x) => x.ah), [100])
  assert.equal(only.battery.wh, 1200)
})

test('batteryTotals: a bank with a voltage and no energy uses that voltage', () => {
  assert.deepEqual(batteryTotals([{ capacityAh: 10, energyWh: null, voltage: 24 }]), { banks: 1, wh: 240, perBank: [{ name: 'Battery', ah: 10 }], assumed12: 0, unknown: 0 })
})

test('statistics: consumer load sums each consumer once and counts the unrated', () => {
  // Pump 60 W + Inside 25 W; Light has no rating; Gone is removed
  assert.deepEqual(dashboardStats(base).consumerLoad, { watts: 85, unrated: 1 })
})

test('statistics: a measured peak replaces the rating', () => {
  const d = devices.map((x) => (x.id === 'd1' ? { ...x, measured: { avgW: 20, peakW: 70 } } : x))
  assert.equal(dashboardStats({ ...base, devices: d }).consumerLoad.watts, 95)
})

test('statistics: completeness counts', () => {
  const c = dashboardStats(base).completeness
  // power cables with no gauge: w2, w3, w6 (w5 is signal only)
  assert.equal(c.cablesNoGauge, 3)
  // no recorded length: w3, w6
  assert.equal(c.cablesNoLength, 2)
  // power cables with no circuit voltage: w3 (circuit with none) and w6 (in no circuit)
  assert.equal(c.cablesNoVoltage, 2)
  assert.equal(c.consumersUnrated, 1)
  assert.equal(c.protectorsNoRating, 1)
})

test('statistics: share of devices placed on a floorplan and on a schematic', () => {
  const c = dashboardStats(base).completeness
  // floorplan: Pump, Box, and Inside (in the box) of 8
  assert.deepEqual(c.onFloorplan, { count: 3, of: 8, share: 0.375 })
  // schematic: Solar, Fuse, Pump, Box and Inside; the removed page does not count
  assert.deepEqual(c.onSchematic, { count: 5, of: 8, share: 0.625 })
})

test('statistics of an empty boat are zeros and null shares, never NaN', () => {
  const s = dashboardStats({})
  assert.equal(s.devices.total, 0)
  assert.equal(s.cableLength.totalM, 0)
  assert.equal(s.completeness.onFloorplan.share, null)
  assert.equal(s.battery.wh, 0)
})

test('placement helpers', () => {
  const byId = new Map(devices.map((d) => [d.id, d]))
  assert.equal(onFloorplan(byId.get('d9'), byId), true)
  assert.equal(onFloorplan(byId.get('d2'), byId), false)
  assert.deepEqual([...schematicPlaced(devices.filter((d) => d.status !== 'removed'), schematics)].sort(), ['d1', 'd3', 'd5', 'd8', 'd9'])
})

// ---- Failed checks ----

const checkData = {
  devices: [
    ...devices.filter((d) => d.status !== 'removed'),
    { id: 'm1', name: 'Mast light', role: 'consumer', ratedPowerW: 10, posX: 1, status: 'active' }
  ],
  cables: [
    ...cables,
    // 18 AWG carries 15 A at most, less than the 30 A breaker that protects it
    { id: 'w7', fromDeviceId: 'd5', toDeviceId: 'm1', gauge: 18, gaugeUnit: 'AWG', length: 1, lengthUnit: 'm', status: 'active' }
  ],
  circuits: [
    ...circuits,
    { id: 'c4', name: 'Mast', status: 'active', derived: { cableIds: ['w7'], returnCableIds: [], voltage: 12, ratingA: 30, unprotected: false, endDeviceIds: ['m1'] } }
  ],
  conduits: [],
  schematics,
  limits: { critical: 3, normal: 10 },
  buses: {
    buses: [
      { id: 'b1', name: 'N2K main', verdict: 'ok' },
      { id: 'b2', name: 'N2K aft', verdict: 'fail' },
      { id: 'b3', name: 'Alpha', verdict: 'cannot' },
      { id: 'b4', name: 'Beta', verdict: 'warning' },
      { id: 'b5', name: 'Gamma', verdict: 'cannot' },
      { id: 'b6', name: 'Delta', verdict: 'fail' }
    ]
  }
}

test('checks: cable verdict counts come from the shared cable check', () => {
  const c = dashboardChecks(checkData)
  assert.equal(c.cables.fail, 1)
  // no gauge or no circuit: w2, w3, w6 cannot be checked
  assert.equal(c.cables.cannot, 3)
  assert.equal(c.cables.ok, 1)
})

test('checks: worst cables first, fail before cannot, linked to a record', () => {
  const c = dashboardChecks(checkData)
  assert.equal(c.worstCables[0].id, 'w7')
  assert.equal(c.worstCables[0].verdict, 'fail')
  assert.equal(c.worstCables[0].text, 'too small')
  assert.equal(c.worstCables[0].href, '#/circuits/c4')
  assert.deepEqual(c.worstCables.slice(1).map((x) => x.verdict), ['cannot', 'cannot', 'cannot'])
  // w6 is in no circuit: its link is the Cables tab
  assert.equal(c.worstCables.find((x) => x.id === 'w6').href, '#/cables')
})

test('checks: at most five cables are listed', () => {
  const many = []
  for (let i = 0; i < 9; i++) many.push({ id: 'n' + i, fromDeviceId: 'd5', toDeviceId: 'd1', status: 'active' })
  const c = dashboardChecks({ ...checkData, cables: many })
  assert.equal(c.worstCables.length, 5)
  assert.equal(c.cables.cannot, 9)
})

test('checks: the worst three buses, fail then warning then cannot, ok left out', () => {
  const c = dashboardChecks(checkData)
  assert.deepEqual(c.buses, { ok: 1, warning: 1, fail: 2, cannot: 2 })
  assert.deepEqual(c.worstBuses.map((b) => b.name), ['Delta', 'N2K aft', 'Beta'])
  assert.equal(c.worstBuses[0].href, '#/buses/b6')
})

test('checks: no bus answer gives no buses', () => {
  const c = dashboardChecks({ ...checkData, buses: null })
  assert.deepEqual(c.worstBuses, [])
})

test('checks: unprotected circuits, cables in no circuit, unplaced devices', () => {
  const c = dashboardChecks(checkData)
  assert.deepEqual(c.unprotected.map((x) => x.name), ['Light circuit'])
  assert.equal(c.unprotected[0].href, '#/circuits/c2')
  // w6 is a power cable in no circuit; w5 is signal only
  assert.deepEqual(c.noCircuit.map((x) => x.id), ['w6'])
  // on no plan and no schematic: Light, Batt, Breaker (the removed page does not count)
  assert.deepEqual(c.unplaced.map((x) => x.name), ['Batt', 'Breaker', 'Light'])
  assert.equal(c.unplaced[0].href, '#/devices/d4')
})

test('checks: devices that overlap on a schematic page', () => {
  const pages = [
    { id: 's1', name: 'Tight', status: 'active', devices: [{ deviceId: 'd1', x: 10, y: 10 }, { deviceId: 'd2', x: 12, y: 12 }, { deviceId: 'd3', x: 3000, y: 3000 }] },
    { id: 's2', name: 'Roomy', status: 'active', devices: [{ deviceId: 'd1', x: 0, y: 0 }, { deviceId: 'd2', x: 2000, y: 0 }] }
  ]
  const c = dashboardChecks({ ...checkData, schematics: pages })
  assert.deepEqual(c.overlaps.map((o) => [o.name, o.pairs]), [['Tight', 1]])
  assert.equal(c.overlaps[0].href, '#/schematics/s1')
})

test('checks: attention is the sum of everything listed', () => {
  const c = dashboardChecks({ ...checkData, buses: null })
  // 1 fail + 3 cannot, 1 unprotected, 1 cable in no circuit, 3 unplaced, 0 overlaps
  assert.equal(c.attention, 1 + 3 + 1 + 1 + 3 + 0)
})

// ---- Live power ----

const stamps = (obj) => new Map(Object.entries(obj))

test('configured side: watts as they are, amps with a fixed voltage or a voltage path', () => {
  const values = new Map([['e.shore', 230], ['e.solar', 5], ['e.alt', 10], ['v.alt', 14]])
  const side = configuredSide([
    { label: 'Shore', path: 'e.shore', unit: 'W', voltage: null, voltagePath: null },
    { label: 'Solar', path: 'e.solar', unit: 'A', voltage: 12, voltagePath: null },
    { label: 'Alternator', path: 'e.alt', unit: 'A', voltage: 12, voltagePath: 'v.alt' }
  ], values, new Map(), NOW)
  // 230 + 5 x 12 + 10 x 14 (the voltage reading beats the fixed one)
  assert.deepEqual(side.entries.map((e) => e.watts), [230, 60, 140])
  assert.equal(side.totalW, 430)
  assert.equal(side.counted, 3)
  assert.equal(side.mode, 'configured')
})

test('configured side: no voltage, no data and stale entries stay out of the sum', () => {
  const values = new Map([['a', 3], ['b', 500], ['c', 100]])
  const side = configuredSide([
    { label: 'A', path: 'a', unit: 'A', voltage: null, voltagePath: null },
    { label: 'B', path: 'b', unit: 'W', voltage: null, voltagePath: null },
    { label: 'Missing', path: 'none', unit: 'W', voltage: null, voltagePath: null },
    { label: 'C', path: 'c', unit: 'W', voltage: null, voltagePath: null }
  ], values, stamps({ b: NOW - STALE_MS - 1, c: NOW - STALE_MS }), NOW)
  assert.deepEqual(side.entries.map((e) => e.status), ['novoltage', 'stale', 'nodata', 'ok'])
  // exactly one minute old is still fresh
  assert.equal(side.totalW, 100)
  assert.equal(side.entries[1].watts, 500)
  assert.equal(side.counted, 1)
})

test('configured side: nothing readable means no total, not zero', () => {
  const side = configuredSide([{ label: 'A', path: 'a', unit: 'W', voltage: null, voltagePath: null }], new Map(), new Map(), NOW)
  assert.equal(side.totalW, null)
  assert.equal(side.counted, 0)
  assert.equal(configuredSide([], new Map(), new Map(), NOW).totalW, null)
})

test('configured side: a reading below zero counts by its size, and a stale voltage makes the entry stale', () => {
  const side = configuredSide([
    { label: 'A', path: 'a', unit: 'A', voltage: 12, voltagePath: null },
    { label: 'B', path: 'b', unit: 'A', voltage: null, voltagePath: 'vb' }
  ], new Map([['a', -5], ['b', 2], ['vb', 13]]), stamps({ vb: NOW - 2 * STALE_MS }), NOW)
  assert.equal(side.entries[0].watts, 60)
  assert.equal(side.entries[1].status, 'stale')
  assert.equal(side.totalW, 60)
})

test('configured side: a path may carry the vessels.self prefix and a non-number is no data', () => {
  const side = configuredSide([
    { label: 'A', path: 'vessels.self.a', unit: 'W', voltage: null, voltagePath: null },
    { label: 'B', path: 'b', unit: 'W', voltage: null, voltagePath: null }
  ], new Map([['a', 7], ['b', 'x']]), new Map(), NOW)
  assert.deepEqual(side.entries.map((e) => e.status), ['ok', 'nodata'])
  assert.equal(side.totalW, 7)
})

test('automatic input: sources and charging converters, once each, by their meter', () => {
  const devs = [
    { id: 's1', name: 'Shore', role: 'source', meterPath: 'm.s1', meterUnit: 'W', status: 'active' },
    { id: 's2', name: 'Solar MPPT', role: 'converter', type: 'Solar MPPT', meterPath: 'm.s2', meterUnit: 'A', nominalVoltage: 24, status: 'active' },
    { id: 's3', name: 'Inverter', role: 'converter', type: 'Inverter', meterPath: 'm.s3', meterUnit: 'W', status: 'active' },
    { id: 's4', name: 'Wind', role: 'source', status: 'active' },
    { id: 's5', name: 'Shore copy', role: 'source', meterPath: 'm.s1', meterUnit: 'W', status: 'active' }
  ]
  const side = autoInputSide(devs, new Map([['m.s1', 100], ['m.s2', 5], ['m.s3', 999]]), new Map(), NOW)
  // 100 W + 5 A at 24 V = 120 W; the inverter is not a source; the copy is the same meter
  assert.equal(side.totalW, 220)
  assert.deepEqual(side.entries.map((e) => e.label), ['Shore', 'Solar MPPT'])
  assert.deepEqual(side.notMetered.map((e) => e.label), ['Wind'])
  assert.equal(side.mode, 'auto')
})

test('isChargingSource', () => {
  assert.equal(isChargingSource({ role: 'source' }), true)
  assert.equal(isChargingSource({ role: 'converter', type: 'Alternator regulator' }), true)
  assert.equal(isChargingSource({ role: 'converter', type: 'Battery charger' }), true)
  assert.equal(isChargingSource({ role: 'converter', type: 'Inverter' }), false)
  // a DC-DC charger moves energy between batteries that are already counted
  assert.equal(isChargingSource({ role: 'converter', type: 'DC-DC charger' }), false)
  assert.equal(isChargingSource({ role: 'converter', type: 'Orion DC/DC converter' }), false)
  assert.equal(isChargingSource({ role: 'consumer', type: 'Solar lamp' }), false)
})

const devs = ['a', 'b', 'c', 'd', 'e', 'f', 'p'].map((id) => ({ id, name: id.toUpperCase(), role: id === 'p' ? 'distribution' : 'consumer', status: 'active' }))
const meter = (path, unit, deviceId, lowConfidence = false) => ({ path, unit, deviceId, lowConfidence, source: 'device' })
const live = {
  consumers: {
    a: { meters: [meter('M_A', 'W', 'a')], voltage: 12 },
    b: { meters: [meter('M_B', 'W', 'b'), meter('M_P', 'W', 'p')], voltage: 12 },
    c: { meters: [meter('M_P', 'W', 'p')], voltage: 12 },
    d: { meters: [], voltage: 12 },
    e: { meters: [meter('low', 'A', 'x', true)], voltage: 12 },
    f: { meters: [meter('M_F', 'A', 'f')], voltage: 12 }
  }
}

test('automatic output: a meter inside another one is not added twice', () => {
  const values = new Map([['M_A', 50], ['M_B', 20], ['M_P', 80], ['M_F', 2.5]])
  const side = autoOutputSide(live, devs, [], values, new Map(), NOW)
  // M_B measures B, which M_P (B and C) already contains: left out.
  // 50 W (A) + 80 W (panel P) + 2.5 A x 12 V (F) = 160 W
  assert.deepEqual(side.entries.map((e) => e.path), ['M_A', 'M_F', 'M_P'])
  assert.equal(side.totalW, 160)
  // D has no meter and E only a low confidence one
  assert.deepEqual(side.notMetered.map((e) => e.label), ['D', 'E'])
})

test('automatic output: two consumers on one meter are one reading', () => {
  const l = { consumers: { a: { meters: [meter('M', 'W', 'p')], voltage: 12 }, b: { meters: [meter('M', 'W', 'p')], voltage: 12 } } }
  const side = autoOutputSide(l, devs, [], new Map([['M', 40]]), new Map(), NOW)
  assert.equal(side.entries.length, 1)
  assert.equal(side.entries[0].consumers, 2)
  assert.equal(side.totalW, 40)
})

test('automatic output: a stale reading is greyed and out of the sum, amps with no voltage are not guessed', () => {
  const l = { consumers: { a: { meters: [meter('M_A', 'W', 'a')], voltage: 12 }, f: { meters: [meter('M_F', 'A', 'f')], voltage: null } } }
  const side = autoOutputSide(l, devs, [], new Map([['M_A', 50], ['M_F', 3]]), stamps({ M_A: NOW - 61000 }), NOW)
  assert.deepEqual(side.entries.map((e) => e.status), ['stale', 'novoltage'])
  assert.equal(side.totalW, null)
})

test('automatic output: a circuit meter is named after its circuit', () => {
  const l = { consumers: { a: { meters: [{ path: 'M_C', unit: 'A', circuitId: 'c1', lowConfidence: false, source: 'circuit' }], voltage: 12 } } }
  const side = autoOutputSide(l, devs, [{ id: 'c1', name: 'Pump circuit' }], new Map([['M_C', 1]]), new Map(), NOW)
  assert.equal(side.entries[0].label, 'Pump circuit')
  assert.equal(side.totalW, 12)
})

test('automatic output: no live answer means no entries and no total', () => {
  const side = autoOutputSide(null, devs, [], new Map(), new Map(), NOW)
  assert.equal(side.totalW, null)
  assert.deepEqual(side.entries, [])
})

test('liveFlows: a filled list replaces the automatic rule on its side only', () => {
  const settings = { dashboardInputs: [{ label: 'Shore', path: 'sh', unit: 'W', voltage: null, voltagePath: null }], dashboardOutputs: [] }
  const f = liveFlows({ settings, live, devices: devs, circuits: [], values: new Map([['sh', 10], ['M_A', 5]]), stamps: new Map(), now: NOW })
  assert.equal(f.inputs.mode, 'configured')
  assert.equal(f.inputs.totalW, 10)
  assert.equal(f.outputs.mode, 'auto')
  assert.equal(f.outputs.totalW, 5)
})

// ---- Batteries ----

const bdevs = ['b1', 'b2', 'b3', 'b4'].map((id, i) => ({ id, name: ['House 1', 'House 2', 'Starter', 'Spare'][i], role: 'storage', status: 'active' }))
const blive = {
  batteries: {
    b1: { voltagePath: 'v1', currentPath: 'i1', socPath: 's1', timeRemainingPath: 't1' },
    b2: { voltagePath: 'v1', currentPath: 'i1', socPath: 's1', timeRemainingPath: 't1' },
    b3: { voltagePath: 'v3' },
    b4: { voltagePath: 'v4', currentPath: 'i1' }
  }
}
const bbanks = [{ batteryIds: ['b1', 'b2'], capacityAh: 200, energyWh: 2400, voltage: 12 }]

test('battery cards: per bank voltage, charge, current and time remaining', () => {
  const values = new Map([['v1', 12.8], ['i1', 10], ['s1', 0.87], ['t1', 22800], ['v3', 12.6]])
  const { cards } = batteryCards(bdevs.slice(0, 3), bbanks, blive, values, new Map(), NOW)
  assert.equal(cards.length, 2)
  assert.equal(cards[0].title, 'House 1 + House 2')
  assert.equal(cards[0].voltage, 12.8)
  assert.equal(cards[0].soc, 0.87)
  assert.equal(cards[0].current, 10)
  assert.equal(cards[0].powerW, 128)
  assert.equal(cards[1].powerW, null)
  assert.equal(cards[0].timeText, '6 h 20 min')
  assert.equal(cards[1].title, 'Starter')
  assert.equal(cards[1].voltage, 12.6)
  assert.equal(cards[1].soc, null)
  assert.equal(cards[1].hasData, true)
})

test('battery cards: net flow is current times voltage, shared monitors count once', () => {
  const values = new Map([['v1', 12.8], ['i1', 10], ['v4', 12.8]])
  // b4 reads the same current path i1 as the bank: counted once, 10 A x 12.8 V
  const r = batteryCards([...bdevs.slice(0, 2), bdevs[3]], bbanks, blive, values, new Map(), NOW)
  assert.equal(r.cards.length, 2)
  assert.ok(Math.abs(r.netW - 128) < 1e-9)
})

test('battery cards: stale banks are marked and leave the net flow, no data is not zero', () => {
  const values = new Map([['v1', 12.8], ['i1', 10]])
  const stale = batteryCards(bdevs.slice(0, 2), bbanks, blive, values, stamps({ v1: NOW - 70000, i1: NOW - 70000 }), NOW)
  assert.equal(stale.cards[0].stale, true)
  assert.equal(stale.netW, null)
  const none = batteryCards(bdevs.slice(0, 2), bbanks, blive, new Map(), new Map(), NOW)
  assert.equal(none.cards[0].hasData, false)
  assert.equal(none.cards[0].voltage, null)
  assert.equal(none.netW, null)
})

test('battery cards: a charging battery has a negative net flow', () => {
  const r = batteryCards(bdevs.slice(0, 2), bbanks, blive, new Map([['v1', 13], ['i1', -20]]), new Map(), NOW)
  assert.equal(r.netW, -260)
  assert.equal(netText(r.netW), 'charging 260 W')
  assert.equal(netText(128), 'discharging 128 W')
  assert.equal(netText(0.2), 'balanced')
  assert.equal(netText(null), null)
})

// ---- Switches ----

test('switches on: the switchable consumers that are on, with the switch that feeds them', () => {
  const l = {
    consumers: {
      lampA: { switchable: true, switchDeviceId: 'relay' },
      lampB: { switchable: true, switchDeviceId: 'relay' },
      pump: { switchable: true, switchDeviceId: 'sw2' },
      fan: { switchable: true, switchDeviceId: 'sw3' },
      fixed: { switchable: false, switchDeviceId: null }
    },
    switches: { relay: { switchPath: 'vessels.self.sw.relay' }, sw2: { switchPath: 'sw.two' }, sw3: { switchPath: 'sw.three' } }
  }
  const d = [{ id: 'lampA', name: 'Lamp A' }, { id: 'lampB', name: 'Lamp B' }, { id: 'pump', name: 'Pump' }, { id: 'relay', name: 'Relay' }]
  const r = switchesOn(l, new Map([['sw.relay', true], ['sw.two', 'off']]), d)
  assert.deepEqual(r.on.map((x) => [x.name, x.via]), [['Lamp A', 'Relay'], ['Lamp B', 'Relay']])
  assert.equal(r.off, 1)
  assert.equal(r.unknown, 1)
  assert.equal(r.on[0].href, '#/devices/lampA')
  // the chips: every switchable consumer once, by name, with its state
  assert.deepEqual(r.all.map((x) => [x.name, x.state]), [['fan', 'unknown'], ['Lamp A', 'on'], ['Lamp B', 'on'], ['Pump', 'off']])
  assert.equal(r.all.find((x) => x.name === 'Pump').via, 'sw2')
  assert.equal(r.all.find((x) => x.name === 'Lamp A').via, 'Relay')
})

test('switches on: no answer from the plugin is an empty list', () => {
  assert.deepEqual(switchesOn(null, new Map(), []), { on: [], off: 0, unknown: 0, all: [] })
})

// ---- Paths and text ----

test('dashboardPaths: configured paths, voltage paths, meters, battery paths and switches, once each', () => {
  const paths = dashboardPaths({
    settings: { dashboardInputs: [{ path: 'vessels.self.a.b', voltagePath: 'v.x' }], dashboardOutputs: [{ path: 'a.b' }] },
    live: {
      switches: { s: { switchPath: 'sw.1' } },
      consumers: { c: { meters: [{ path: 'm.1', lowConfidence: false }, { path: 'm.low', lowConfidence: true }] } },
      batteries: { b: { voltagePath: 'v.1', currentPath: null } }
    },
    devices: [{ id: 's', role: 'source', meterPath: 'm.src', status: 'active' }, { id: 't', role: 'consumer', meterPath: 'm.no', status: 'active' }]
  })
  assert.deepEqual(paths, ['a.b', 'm.1', 'm.src', 'sw.1', 'v.1', 'v.x'])
})

test('dashboardPaths with nothing is empty', () => {
  assert.deepEqual(dashboardPaths({ settings: {}, live: null, devices: [] }), [])
})

test('text helpers', () => {
  assert.equal(formatWatts(0), '0 W')
  assert.equal(formatWatts(36.04), '36 W')
  assert.equal(formatWatts(-230), '230 W')
  assert.equal(formatWatts(1234), '1.2 kW')
  assert.equal(formatWatts(null), null)
  assert.equal(formatMetres(13.048), '13 m')
  assert.equal(formatMetres(250.4), '250 m')
  assert.equal(formatMetres(1234), '1.2 km')
  assert.equal(percentText(0.375), '38 %')
  assert.equal(percentText(null), '-')
})

test('battery cards carry the charge and voltage paths of their first battery that has them', () => {
  const { cards } = batteryCards(bdevs.slice(0, 3), bbanks, blive, new Map(), new Map(), NOW)
  assert.equal(cards[0].socPath, 's1')
  assert.equal(cards[0].voltagePath, 'v1')
  assert.equal(cards[1].socPath, null)
})

test('historyPaths: every entry of both sides and the charge of each bank, once', () => {
  const flows = {
    inputs: { entries: [{ path: 'a' }, { path: 'b' }] },
    outputs: { entries: [{ path: 'b' }, { path: 'c' }] }
  }
  assert.deepEqual(historyPaths(flows, [{ socPath: 's1' }, { socPath: null }, { socPath: 'a' }]), ['a', 'b', 'c', 's1'])
})

test('the Live switch is on by default and remembered per browser', () => {
  const store = new Map()
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }
  assert.equal(readLivePref(storage), true)
  writeLivePref(false, storage)
  assert.equal(readLivePref(storage), false)
  writeLivePref(true, storage)
  assert.equal(readLivePref(storage), true)
})

test('the Live switch survives storage that throws or is missing', () => {
  const broken = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } }
  assert.equal(readLivePref(broken), true)
  assert.doesNotThrow(() => writeLivePref(false, broken))
  assert.equal(readLivePref(undefined), true)
})

test('checks: every listed cable says why', () => {
  const c = dashboardChecks(checkData)
  const fail = c.worstCables.find((x) => x.id === 'w7')
  // 18 AWG carries 15 A, the breaker is 30 A
  assert.match(fail.reason, /^Cable too small for 15 A: the 30 A fuse or breaker is more than the cable can carry/)
  assert.ok(!/Advisory only/.test(fail.reason))
  for (const x of c.worstCables.filter((y) => y.verdict === 'cannot')) assert.match(x.reason, /^Needs .+\.$/)
})

test('cableReason: nothing for no result, needs text for a check that cannot be made', () => {
  assert.equal(cableReason(null), '')
  const r = cableReason({ verdict: 'cannot', missing: ['a gauge', 'a length'], ampacity: { verdict: 'cannot', missing: ['a gauge'] } })
  assert.equal(r, 'Needs a gauge and a length.')
})

test('busReasons: the checks that are not ok, with their first reasoning line or what is missing', () => {
  const bus = {
    checks: [
      { id: 'len', title: 'Backbone length', verdict: 'ok', reasoning: ['fine'] },
      { id: 'drop', title: 'Drop length', verdict: 'fail', reasoning: ['Drop of 8 m is over the 6 m limit.', 'more'] },
      { id: 'term', title: 'Terminators', verdict: 'cannot', missing: ['a terminator flag on each end'], reasoning: ['x'] }
    ]
  }
  assert.deepEqual(busReasons(bus), [
    { title: 'Drop length', verdict: 'fail', text: 'Drop of 8 m is over the 6 m limit.' },
    { title: 'Terminators', verdict: 'cannot', text: 'needs a terminator flag on each end' }
  ])
  assert.deepEqual(busReasons(null), [])
})

test('checks: a listed bus carries the reasons of its checks that are not ok', () => {
  const c = dashboardChecks({ ...checkData, buses: { buses: [{ id: 'b9', name: 'Zed', verdict: 'fail', checks: [{ title: 'Drops', verdict: 'fail', reasoning: ['too long'] }] }] } })
  assert.deepEqual(c.worstBuses[0].reasons, [{ title: 'Drops', verdict: 'fail', text: 'too long' }])
})

test('checks: with the floorplan off, a device on a floorplan only still counts as unplaced', () => {
  const on = dashboardChecks(checkData)
  const off = dashboardChecks({ ...checkData, floorplan: false })
  assert.ok(off.unplaced.length > on.unplaced.length)
  const onIds = new Set(on.unplaced.map((x) => x.id))
  for (const id of onIds) assert.ok(off.unplaced.some((x) => x.id === id))
})

const ahText = (v) => `${v} Ah`

test('batteryNote lists each bank with its own amp hours, three at most', () => {
  const t = { perBank: [{ name: 'House', ah: 5120 }, { name: 'Starter', ah: 1280 }, { name: 'Thruster', ah: 2304 }], assumed12: 0, unknown: 0 }
  assert.equal(batteryNote(t, ahText), 'House 5120 Ah, Starter 1280 Ah, Thruster 2304 Ah')
  assert.equal(batteryNote({ ...t, perBank: [...t.perBank, { name: 'Spare', ah: 100 }, { name: 'Other', ah: 50 }] }, ahText),
    'House 5120 Ah, Starter 1280 Ah, Thruster 2304 Ah and 2 more')
})

test('batteryNote says what was assumed or missing, and is null for no banks', () => {
  assert.equal(batteryNote({ perBank: [{ name: 'A', ah: 10 }], assumed12: 1, unknown: 0 }, ahText), 'A 10 Ah; 1 bank counted at 12 V')
  assert.equal(batteryNote({ perBank: [], assumed12: 0, unknown: 2 }, ahText), '2 banks without capacity')
  assert.equal(batteryNote({ perBank: [], assumed12: 0, unknown: 0 }, ahText), null)
})

test('switchSummary: none, all unknown, or chips once one state is known', () => {
  assert.deepEqual(switchSummary({ all: [] }), { mode: 'none', total: 0 })
  assert.deepEqual(switchSummary(null), { mode: 'none', total: 0 })
  assert.deepEqual(switchSummary({ all: [{ state: 'unknown' }, { state: 'unknown' }] }), { mode: 'unknown', total: 2 })
  assert.deepEqual(switchSummary({ all: [{ state: 'unknown' }, { state: 'off' }] }), { mode: 'chips', total: 2 })
})

test('hasLiveValue: a counted, stale or no-voltage reading, a battery reading or a known switch', () => {
  const none = { flows: { inputs: { entries: [{ status: 'nodata' }] }, outputs: { entries: [] } }, battery: { cards: [{ hasData: false }] }, switches: { all: [{ state: 'unknown' }] } }
  assert.equal(hasLiveValue(none), false)
  assert.equal(hasLiveValue({ ...none, flows: { inputs: { entries: [{ status: 'ok' }] }, outputs: { entries: [] } } }), true)
  assert.equal(hasLiveValue({ ...none, flows: { inputs: { entries: [] }, outputs: { entries: [{ status: 'stale' }] } } }), true)
  assert.equal(hasLiveValue({ ...none, flows: { inputs: { entries: [{ status: 'novoltage' }] }, outputs: { entries: [] } } }), true)
  assert.equal(hasLiveValue({ ...none, battery: { cards: [{ hasData: true }] } }), true)
  assert.equal(hasLiveValue({ ...none, switches: { all: [{ state: 'on' }] } }), true)
  assert.equal(hasLiveValue({}), false)
})

test('dashboardOrder: live first only with live on and a value seen', () => {
  assert.equal(dashboardOrder({ liveOn: true, seen: true }), 'live-first')
  assert.equal(dashboardOrder({ liveOn: true, seen: false }), 'findings-first')
  assert.equal(dashboardOrder({ liveOn: false, seen: true }), 'findings-first')
})


test('dashboardChecks: loads with no earth path are a quiet note, not counted in attention', () => {
  const devices = [{ id: 'd1', name: 'Toaster', status: 'active' }, { id: 'd2', name: 'Lamp', status: 'active' }]
  const derived = (noEarth) => ({ cableIds: [], returnCableIds: [], noEarthDeviceIds: noEarth })
  const circuits = [
    { id: 'c1', name: 'A', status: 'active', derived: derived(['d1']) },
    { id: 'c2', name: 'B', status: 'active', derived: derived(['d1', 'd2']) }
  ]
  const c = dashboardChecks({ devices, cables: [], circuits, conduits: [], schematics: [] })
  assert.deepEqual(c.noEarth.map((x) => x.name), ['Lamp', 'Toaster']) // sorted, each load once
  const without = dashboardChecks({ devices, cables: [], circuits: circuits.map((x) => ({ ...x, derived: derived([]) })), conduits: [], schematics: [] })
  assert.equal(c.attention, without.attention)
  assert.deepEqual(without.noEarth, [])
})
