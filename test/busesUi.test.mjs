import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  busRow, busRows, sortBusRows, filterBuses, tapRows, busesOfDevice, isBusDevice, cleanTaps, tapsToForm, duplicatePayload, lenText, lengthText, verdictWord
} from '../public/buses.js'

const bb = { id: 'b1', name: 'Main', status: 'active', cableClass: 'mini', length: 12.5, lengthUnit: 'm', taps: [{ deviceId: 'd1', port: 'NMEA 2000', dropLength: 1.5, along: 2, powerFeed: true, fedFromDeviceId: 'f1' }, { deviceId: 'd2', dropLength: null }] }

test('verdict words', () => {
  assert.equal(verdictWord('cannot'), 'cannot check')
  assert.equal(verdictWord(undefined), 'not checked')
})

test('length and LEN text', () => {
  assert.equal(lengthText(bb), '12.5 m')
  assert.equal(lengthText({ length: null }), 'no length')
  assert.equal(lenText({ deviceCount: 2, lenTotal: 3, impliedCurrentA: 0.15, lenUnknownDeviceIds: [] }), '3 LEN (0.15 A)')
  assert.equal(lenText({ deviceCount: 2, lenTotal: 3, impliedCurrentA: 0.15, lenUnknownDeviceIds: ['d2'] }), '3+ LEN (0.15 A)')
  assert.equal(lenText({ deviceCount: 2, lenTotal: null, lenUnknownDeviceIds: ['d1', 'd2'] }), 'LEN unknown')
  assert.equal(lenText({ deviceCount: 0, lenTotal: null }), 'no LEN')
})

test('a row joins the record with its entry', () => {
  const row = busRow(bb, { id: 'b1', verdict: 'warning', derived: { deviceCount: 2, lenTotal: 4, impliedCurrentA: 0.2, lenUnknownDeviceIds: [] } })
  assert.equal(row.classText, 'Mini')
  assert.equal(row.deviceCount, 2)
  assert.equal(row.lenText, '4 LEN (0.2 A)')
  assert.equal(row.verdictText, 'warning')
  const bare = busRow(bb, undefined)
  assert.equal(bare.verdict, null)
  assert.equal(bare.deviceCount, 2)
})

test('rows sort worst verdict first, removed last', () => {
  const list = [
    { id: 'a', status: 'active', name: 'A', taps: [] },
    { id: 'b', status: 'active', name: 'B', taps: [] },
    { id: 'c', status: 'removed', name: 'C', taps: [] },
    { id: 'd', status: 'active', name: 'D', taps: [] }
  ]
  const rows = busRows(list, { buses: [
    { id: 'a', verdict: 'ok', derived: { deviceCount: 0 } },
    { id: 'b', verdict: 'fail', derived: { deviceCount: 0 } },
    { id: 'd', verdict: 'cannot', derived: { deviceCount: 0 } }
  ] })
  assert.deepEqual(sortBusRows(rows).map((r) => r.id), ['b', 'd', 'a', 'c'])
  assert.deepEqual(filterBuses(rows, ' b').map((r) => r.id), ['b'])
  assert.equal(filterBuses(rows, '').length, 4)
})

test('tap rows name the device, the drop and the feed', () => {
  const devices = new Map([['d1', { id: 'd1', name: 'Plotter', len: 2 }], ['f1', { id: 'f1', name: 'Fuse 5A' }]])
  const rows = tapRows(bb, devices)
  assert.equal(rows[0].name, 'Plotter')
  assert.equal(rows[0].dropText, '1.5 m')
  assert.equal(rows[0].alongText, '2 m')
  assert.equal(rows[0].lenText, '2 LEN')
  assert.equal(rows[0].fedFromName, 'Fuse 5A')
  assert.equal(rows[1].name, 'd2')
  assert.equal(rows[1].dropText, 'no drop length')
  assert.equal(rows[1].lenText, 'no LEN')
})

test('buses of a device skip removed ones', () => {
  const list = [bb, { ...bb, id: 'b2', status: 'removed' }]
  assert.deepEqual(busesOfDevice('d1', list).map((x) => x.backbone.id), ['b1'])
  assert.equal(busesOfDevice('nope', list).length, 0)
})

test('form rows round trip and clean', () => {
  const rows = tapsToForm(bb.taps)
  assert.equal(rows[0].dropLength, '1.5')
  assert.deepEqual(cleanTaps(rows)[0], bb.taps[0])
  const cleaned = cleanTaps([{ deviceId: '' }, { deviceId: 'd9', port: ' ', dropLength: 'x', along: '3', powerFeed: false, fedFromDeviceId: 'f1' }])
  assert.equal(cleaned.length, 1)
  assert.deepEqual(cleaned[0], { deviceId: 'd9', port: null, dropLength: null, along: 3, powerFeed: false, fedFromDeviceId: null })
})

test('a duplicate keeps the settings but no taps or route', () => {
  const d = duplicatePayload({ ...bb, route: [{ x: 1, y: 2 }], terminatorA: true })
  assert.equal(d.name, 'Main (copy)')
  assert.deepEqual(d.taps, [])
  assert.equal(d.terminatorA, true)
  assert.equal('route' in d, false)
})

test('isBusDevice is true for a tapped device, an NMEA 2000 port or type, and false for a plain consumer', () => {
  const backbones = [{ id: 'b1', status: 'active', taps: [{ deviceId: 'tapped' }] }]
  assert.equal(isBusDevice({ id: 'tapped' }, backbones), true)
  assert.equal(isBusDevice({ id: 'x', terminals: [{ name: 'NMEA 2000' }] }, []), true)
  assert.equal(isBusDevice({ id: 'x', terminals: [{ name: 'Signal', port: 'NMEA 2000' }] }, []), true)
  assert.equal(isBusDevice({ id: 'x', type: 'NMEA 2000 device' }, []), true)
  assert.equal(isBusDevice({ id: 'fridge', type: 'Refrigerator', len: 0 }, backbones), false)
  assert.equal(isBusDevice({ id: 'gone' }, [{ id: 'b2', status: 'removed', taps: [{ deviceId: 'gone' }] }]), false)
  assert.equal(isBusDevice(null, []), false)
})
