// Tests for the pure parts of the document-boat-wiring skill's tools.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveId, normalizeData, validateData, gaugeValue, deviceBody, cableBody, circuitPatch
} from '../skills/document-boat-wiring/tools/lib/data.mjs'
import { body, lateBody, pick, circuitUpdates } from '../skills/document-boat-wiring/tools/lib/transfer.mjs'
import { summarizeGaps } from '../skills/document-boat-wiring/tools/lib/gaps.mjs'
import * as example from '../skills/document-boat-wiring/tools/wiring-data.example.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('deriveId is stable, a v5-style UUID, and depends on namespace, kind and key', () => {
  const a = deriveId('boat', 'device', 'bus')
  assert.match(a, UUID)
  assert.equal(a, deriveId('boat', 'device', 'bus'))
  assert.notEqual(a, deriveId('other', 'device', 'bus'))
  assert.notEqual(a, deriveId('boat', 'cable', 'bus'))
})

test('the example data file is valid', () => {
  assert.deepEqual(validateData(normalizeData(example)), [])
})

test('normalizeData fills defaults and accepts short cable fields', () => {
  const d = normalizeData({ namespace: 'n', cables: [{ key: 'c', from: 'a', to: 'b', g: 10, len: 3 }] })
  assert.deepEqual(d.units, { gauge: 'AWG', length: 'ft' })
  assert.deepEqual(d.cables[0].conductors, [{ conductor: 'positive' }])
  assert.equal(d.cables[0].gauge, 10)
  assert.equal(d.cables[0].length, 3)
})

test('validateData finds the usual mistakes', () => {
  const data = normalizeData({
    devices: [
      { key: 'a', name: 'A', role: 'storage' },
      { key: 'a', name: 'A again' },
      { key: 'b', name: 'B', role: 'consumer', monitor: 'nope' },
      { key: 'c', name: 'C', role: 'pump' }
    ],
    cables: [
      { key: 'x', from: 'a', to: 'missing' },
      { key: 'y', from: 'a', to: 'b', c: [{ conductor: 'line' }, { conductor: 'positive' }] },
      { key: 'z', from: 'a', to: 'b', link: 'series' },
      { key: 'w', from: 'a', to: 'b', g: '5/0' }
    ],
    circuitNames: { ghost: 'Ghost' },
    retired: { devices: ['b'] }
  })
  const errors = validateData(data).join('\n')
  for (const expected of ['namespace', 'duplicate device key a', 'monitor nope', 'role must be', 'to missing',
    'both AC and DC', 'link only joins two storage', 'gauge "5/0"', 'circuitNames: ghost', 'retired device b']) {
    assert.ok(errors.includes(expected), `expected "${expected}" in:\n${errors}`)
  }
})

test('gaugeValue turns AWG ought sizes into the plugin encoding', () => {
  assert.equal(gaugeValue('4/0', 'AWG'), -3)
  assert.equal(gaugeValue('1/0', 'AWG'), 0)
  assert.equal(gaugeValue('2/0', 'AWG'), -1)
  assert.equal(gaugeValue(6, 'AWG'), 6)
  assert.equal(gaugeValue('2.5', 'mm2'), 2.5)
  assert.equal(gaugeValue(undefined, 'AWG'), null)
})

test('deviceBody and cableBody map keys to derived ids and units', () => {
  const ns = 'n'
  const d = deviceBody({ key: 'bat', name: 'Bat', role: 'storage', zone: 'Saloon', monitor: 'shunt', photos: ['x.jpg'] }, ns)
  assert.equal(d.monitorDeviceId, deriveId(ns, 'device', 'shunt'))
  assert.equal(d.zone, 'Saloon')
  assert.equal(d.key, undefined)
  assert.equal(d.photos, undefined)
  assert.equal(deviceBody({ key: 'bat', name: 'Bat', monitor: 'shunt' }, ns, { withRefs: false }).monitorDeviceId, undefined)

  const c = cableBody({
    key: 'k', from: 'a', to: 'b', conductors: [{ conductor: 'positive', toTerminal: 'In+' }, { conductor: 'negative', to: 'neg' }],
    gauge: '4/0', length: 2
  }, ns, { gauge: 'AWG', length: 'ft' })
  assert.equal(c.fromDeviceId, deriveId(ns, 'device', 'a'))
  assert.equal(c.gauge, -3)
  assert.equal(c.gaugeUnit, 'AWG')
  assert.equal(c.lengthUnit, 'ft')
  assert.equal(c.conductors[0].toTerminal, 'In+')
  assert.equal(c.conductors[1].toDeviceId, deriveId(ns, 'device', 'neg'))
})

test('circuitPatch names by protector first, then by member devices', () => {
  const data = normalizeData({ namespace: 'n', circuitNames: { fuse: { name: 'Pump', meterUnit: 'A' } }, groupNames: [[['starter'], 'Starter cable']] })
  const id = (k) => deriveId('n', 'device', k)
  assert.deepEqual(circuitPatch({ derived: { protectorId: id('fuse'), deviceIds: [] } }, data), { name: 'Pump', meterUnit: 'A' })
  assert.deepEqual(circuitPatch({ derived: { protectorId: null, deviceIds: [id('starter'), id('bus')] } }, data), { name: 'Starter cable' })
  assert.equal(circuitPatch({ derived: { protectorId: null, deviceIds: [id('bus')] } }, data), null)
  assert.equal(circuitPatch({ derived: null }, data), null)
})

test('transfer bodies drop derived fields and hold back references', () => {
  const device = { id: 'd1', name: 'Bat', zone: 'Saloon', zoneId: 'z1', measured: null, contents: [], parentId: 'p', monitorDeviceId: 'm', iconAttachmentId: 'a1' }
  assert.deepEqual(body('device', device), { name: 'Bat', zoneId: 'z1' })
  assert.deepEqual(lateBody('device', device, { a1: 'a2' }), { parentId: 'p', monitorDeviceId: 'm', iconAttachmentId: 'a2' })
  assert.deepEqual(body('wireRun', { id: 'c', fromDeviceId: 'a', conduitIds: ['x'], zone: 'Z' }), { fromDeviceId: 'a' })
  assert.deepEqual(pick({ a: { status: 'active' }, b: { status: 'removed' } }).map(([k]) => k), ['a'])
  assert.equal(pick({ b: { status: 'removed' } }, { includeRemoved: true }).length, 1)
})

test('circuitUpdates matches circuits by key and sends only what differs', () => {
  const source = {
    s1: { key: 'protector:f1', name: 'Bilge', notes: 'always on', status: 'active' },
    s2: { key: 'protector:f2', name: 'Same', status: 'active' },
    s3: { key: 'protector:f3', name: 'Gone', status: 'removed' }
  }
  const target = {
    t1: { key: 'protector:f1', name: 'Fuse 15 A' },
    t2: { key: 'protector:f2', name: 'Same' },
    t3: { key: 'protector:f3', name: 'x' }
  }
  assert.deepEqual(circuitUpdates(source, target), [{ id: 't1', patch: { name: 'Bilge', notes: 'always on' } }])
})

test('summarizeGaps lists unrated fuses, loose devices, missing gauges and tags', () => {
  const devices = {
    f: { name: 'Fuse', role: 'distribution', type: 'Fuse' },
    g: { name: 'Fuse 10 A', role: 'distribution', type: 'Fuse', tripRatingA: 10 },
    p: { name: 'Pump', role: 'consumer', tags: ['unverified'] },
    lone: { name: 'Lonely', role: 'consumer' },
    old: { name: 'Old', role: 'consumer', status: 'removed' }
  }
  const cables = {
    c1: { fromDeviceId: 'f', toDeviceId: 'p', conductors: [{ conductor: 'positive' }] },
    c2: { fromDeviceId: 'g', toDeviceId: 'p', gauge: 14 },
    c3: { fromDeviceId: 'f', toDeviceId: 'g', length: 0 },
    c4: { fromDeviceId: 'g', toDeviceId: 'p', conductors: [{ conductor: 'signal' }] }
  }
  const circuits = { k1: { name: 'Unprotected: Pump', derived: { unprotected: true, warnings: [{ code: 'backwards', message: 'm' }] } } }
  const explanation = { sections: [{ heading: 'Cable size', verdict: 'fail', lines: ['Table figure 30 A.', 'too small'] }] }
  const r = summarizeGaps({ devices, cables, circuits, checks: { counts: { fail: 1 }, results: [{ name: 'Fuse -> Pump', verdict: 'fail', explanation }] } })
  assert.deepEqual(r.unratedProtectors, ['Fuse'])
  assert.deepEqual(r.unconnected, ['Lonely'])
  assert.deepEqual(r.noGauge, ['Fuse -> Pump'])
  assert.deepEqual(r.unverified, [{ kind: 'device', name: 'Pump' }])
  assert.deepEqual(r.unprotected, ['Unprotected: Pump'])
  assert.equal(r.warnings.length, 1)
  assert.deepEqual(r.failingCables, ['Fuse -> Pump: fail (Cable size: too small)'])
  assert.equal(r.counts.devices, 4)
})
