import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROTOCOLS, protocolLabel, buildCablePayload, cableToValues } from '../public/cableForm.js'
import { terminalPresetList } from '../public/deviceFields.js'

test('the protocol list matches the server values and has labels', () => {
  assert.deepEqual(PROTOCOLS.map((p) => p.value), ['nmea2000', 'seatalk1', 'nmea0183', 'sensor', 'ethernet', 'canbus', 'usb', 'hdmi', 'serial', 'coax', 'other'])
  assert.equal(protocolLabel('nmea2000'), 'NMEA 2000 cable')
  assert.equal(protocolLabel(null), '')
})

test('the protocol travels through the cable form and clears with an empty choice', () => {
  const values = { fromDeviceId: 'a', toDeviceId: 'b', kind: 'signal', protocol: 'seatalk1', colors: {}, terminals: {} }
  assert.equal(buildCablePayload(values).protocol, 'seatalk1')
  assert.equal(buildCablePayload({ ...values, protocol: '' }).protocol, null)
  assert.equal(cableToValues({ id: 'x', fromDeviceId: 'a', toDeviceId: 'b', conductors: [], protocol: 'nmea0183' }).protocol, 'nmea0183')
  assert.equal(cableToValues({ id: 'x', fromDeviceId: 'a', toDeviceId: 'b', conductors: [] }).protocol, '')
})

test('the NMEA 2000 preset is in the list of presets to pick from', () => {
  assert.ok(terminalPresetList().some((p) => p.label === 'NMEA 2000 device'))
})
