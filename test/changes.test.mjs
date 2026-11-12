import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEntry, rangeFor, buildQuery, recordRoute, appendGroups, replaceGroup, KIND_ORDER } from '../public/changes.js'

const entry = (summary, diff = {}) => ({ id: 'e', timestamp: '2026-11-10T10:00:00.000Z', summary, diff })
const names = new Map([['d1', 'Battery'], ['d2', 'Lamp']])

test('created, removed, restored, permanently deleted and removed with contents', () => {
  assert.equal(describeEntry('device', entry('created', { after: { name: 'x' } })).title, 'Created')
  assert.equal(describeEntry('conduit', entry('removed', { status: { before: 'active', after: 'removed' } })).title, 'Removed')
  const restored = describeEntry('zone', entry('restored (undo)', { status: { before: 'removed', after: 'active' } }))
  assert.equal(restored.title, 'Restored')
  assert.deepEqual(restored.lines, [])
  assert.equal(describeEntry('wireRun', entry('permanently deleted', { name: 'W1', kind: 'wireRun' })).title, 'Permanently deleted')
  const box = describeEntry('device', entry('removed with contents', { devices: ['a', 'b'], cables: ['c'], schematics: [] }))
  assert.deepEqual(box.lines, ['2 devices, 1 cable'])
})

test('device fields: names, units, yes and no, shares and empty values', () => {
  const d = describeEntry('device', entry('updated', {
    name: { before: 'Pump', after: 'Bilge pump' },
    rated_power_w: { before: 40, after: 60 },
    never_remote: { before: 0, after: 1 },
    usable_fraction: { before: 0.8, after: 0.5 },
    notes: { before: 'old', after: null },
    make_model: { before: null, after: 'Acme 3' },
    parent_id: { before: null, after: 'd1' }
  }), { names })
  assert.deepEqual(d.lines, [
    'name: Pump to Bilge pump',
    'rated power: 40 to 60 W',
    'never switch remotely: no to yes',
    'usable share: 80 % to 50 %',
    'notes cleared (was old)',
    'make and model set to Acme 3',
    'inside set to Battery'
  ])
  assert.equal(d.title, 'Changed')
})

test('device lists: terminals added and removed, and position as one line', () => {
  const d = describeEntry('device', entry('updated', {
    terminals: { before: [{ name: 'L+' }, { name: 'Old' }], after: [{ name: 'L+' }, { name: 'L-' }, { name: 'N' }] },
    pos_x: { before: 1, after: 2 },
    pos_y: { before: 1, after: 3 }
  }))
  assert.deepEqual(d.lines, ['terminals added: L-, N; removed: Old', 'position changed'])
})

test('cable fields: gauge with the unit from the record or the entry, ends by device name, conductors', () => {
  const a = describeEntry('wireRun', entry('updated', { gauge: { before: 6, after: 10 } }), { units: { gauge_unit: 'mm2' } })
  assert.deepEqual(a.lines, ['gauge: 6 to 10 mm2'])
  const b = describeEntry('wireRun', entry('updated', {
    gauge: { before: 0, after: 6 }, gauge_unit: { before: 'AWG', after: 'AWG' }
  }))
  assert.deepEqual(b.lines, ['gauge: 1/0 to 6 AWG'])
  const c = describeEntry('wireRun', entry('updated', {
    gauge: { before: 6, after: 10 }, gauge_unit: { before: 'AWG', after: 'mm2' }
  }))
  assert.deepEqual(c.lines, ['gauge: 6 AWG to 10 mm2'])
  const d = describeEntry('wireRun', entry('updated', {
    length: { before: 3, after: 4.5 }, from_device_id: { before: 'd1', after: 'd2' }, cable_label: { before: '', after: 'W7' },
    conductors: { before: [{ conductor: 'positive' }], after: [{ conductor: 'positive' }, { conductor: 'negative', color: 'black' }] }
  }), { names, units: { length_unit: 'm' } })
  assert.deepEqual(d.lines, ['length: 3 to 4.5 m', 'from: Battery to Lamp', 'label set to W7', 'conductors added: negative black'])
})

test('conduit, zone, plan, circuit and schematic fields', () => {
  assert.deepEqual(describeEntry('conduit', entry('updated', { kind: { before: 'hose', after: 'pipe' }, inner_diameter: { before: 20, after: 25 } }), { units: { diameter_unit: 'mm' } }).lines,
  ['type: hose to pipe', 'inner diameter: 20 to 25 mm'])
  assert.deepEqual(describeEntry('conduit', entry('cable assigned', { wireRunId: 'x' })).title, 'Cable assigned')
  assert.deepEqual(describeEntry('zone', entry('updated', { name: { before: 'Engine', after: 'Engine room' } })).lines, ['name: Engine to Engine room'])
  assert.equal(describeEntry('zone', entry('deleted', { before: { name: 'x' } })).title, 'Deleted zone')
  assert.equal(describeEntry('zone', entry('merged', { mergedInto: 'z' })).title, 'Merged into another zone')
  assert.deepEqual(describeEntry('plan', entry('updated', { view: { before: 'top', after: 'side' }, calibration: { before: null, after: { a: 1 } } })).lines,
    ['view: top to side', 'scale calibration set'])
  assert.deepEqual(describeEntry('circuit', entry('updated', { voltage: { before: 12, after: 24 } })).lines, ['voltage: 12 to 24 V'])
  const s = describeEntry('schematic', entry('updated', {
    devices: { before: [{ deviceId: 'd1' }], after: [{ deviceId: 'd1' }, { deviceId: 'd2' }] }, enclosure_id: { before: null, after: 'd1' }
  }), { names })
  assert.deepEqual(s.lines, ['devices added: Lamp', 'inside set to Battery'])
})

test('zone change shows the zone once, by name when known', () => {
  const d = describeEntry('device', entry('updated', {
    zone: { before: 'Bilge', after: 'Engine room' }, zone_id: { before: 'z1', after: 'z2' }
  }))
  assert.deepEqual(d.lines, ['zone: Bilge to Engine room'])
  const only = describeEntry('device', entry('updated', { zone_id: { before: 'z1', after: 'z2' } }), { zones: new Map([['z1', 'Bilge'], ['z2', 'Cabin']]) })
  assert.deepEqual(only.lines, ['zone: Bilge to Cabin'])
})

test('unknown fields, summaries and odd shapes fall back to plain words', () => {
  assert.deepEqual(describeEntry('device', entry('updated', { fancy_new_field: { before: 1, after: 2 } })).lines, ['fancy new field changed'])
  assert.deepEqual(describeEntry('device', entry('updated', {})).lines, ['details changed'])
  assert.deepEqual(describeEntry('device', entry('updated', { name: 'oddly shaped' })).lines, ['name changed'])
  const sw = describeEntry('device', entry('switch on refused', { by: 'claude', reason: 'never remote' }))
  assert.equal(sw.title, 'Switch on refused')
  assert.deepEqual(sw.lines, ['by claude', 'never remote'])
  assert.equal(describeEntry('device', { summary: '', diff: null }).title, 'Changed')
  assert.match(describeEntry('device', entry('updated', { notes: { before: null, after: 'x'.repeat(200) } })).lines[0], /\.\.\.$/)
})

test('rangeFor: today, 7 days, 30 days and a custom range in local time', () => {
  const now = new Date(2026, 10, 12, 15, 30)
  assert.equal(rangeFor('today', now).since, new Date(2026, 10, 12, 0, 0).toISOString())
  assert.equal(rangeFor('7', now).since, new Date(2026, 10, 6, 0, 0).toISOString())
  assert.equal(rangeFor('30', now).since, new Date(2026, 9, 14, 0, 0).toISOString())
  assert.equal(rangeFor('30', now).until, null)
  const c = rangeFor('custom', now, { from: '2026-11-01', to: '2026-11-03' })
  assert.equal(c.since, new Date(2026, 10, 1, 0, 0, 0, 0).toISOString())
  assert.equal(c.until, new Date(2026, 10, 3, 23, 59, 59, 999).toISOString())
  assert.deepEqual(rangeFor('custom', now, { from: '', to: 'x' }), { since: null, until: null })
})

test('buildQuery carries range, kinds in a fixed order, text, cursor, record and caps', () => {
  const now = new Date(2026, 10, 12, 15, 30)
  const q = new URLSearchParams(buildQuery({ range: '7', kinds: ['zone', 'device'], text: ' pump ', cursor: 'c|1', id: 'r1', entries: 500 }, now))
  assert.equal(q.get('kind'), 'device,zone')
  assert.equal(q.get('q'), 'pump')
  assert.equal(q.get('cursor'), 'c|1')
  assert.equal(q.get('id'), 'r1')
  assert.equal(q.get('entries'), '500')
  assert.equal(q.get('since'), new Date(2026, 10, 6).toISOString())
  assert.equal(buildQuery({ range: 'custom' }, now), '')
  assert.deepEqual(KIND_ORDER.slice().sort(), ['circuit', 'conduit', 'device', 'plan', 'schematic', 'wireRun', 'zone'])
})

test('recordRoute links to the record, its tab, or nothing once permanently deleted', () => {
  assert.deepEqual(recordRoute({ kind: 'device', id: 'd', status: 'active' }), { tab: 'devices', id: 'd' })
  assert.deepEqual(recordRoute({ kind: 'plan', id: 'p', status: 'removed' }), { tab: 'floorplan', id: 'p' })
  assert.deepEqual(recordRoute({ kind: 'wireRun', id: 'w', status: 'active' }), { tab: 'cables', id: null })
  assert.deepEqual(recordRoute({ kind: 'zone', id: 'z', status: 'active' }), { tab: 'zones', id: null })
  assert.equal(recordRoute({ kind: 'device', id: 'd', status: 'purged' }), null)
})

test('appendGroups keeps order and skips repeats; replaceGroup swaps in all entries', () => {
  const g = (id, n = 1) => ({ kind: 'device', id, entries: new Array(n).fill({}), more: 0 })
  const merged = appendGroups([g('a'), g('b')], [g('b'), g('c')])
  assert.deepEqual(merged.map((x) => x.id), ['a', 'b', 'c'])
  const full = replaceGroup([{ ...g('a'), more: 4 }, g('b')], { kind: 'device', id: 'a', entries: [1, 2, 3, 4, 5, 6] })
  assert.equal(full[0].entries.length, 6)
  assert.equal(full[0].more, 0)
  assert.equal(full[1].entries.length, 1)
})
