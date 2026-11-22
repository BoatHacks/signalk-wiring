import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSolarPanel, arrayTitle, missingText, stringsText, singlePanelArrays, allArrays, arrayWarnings,
  pvReading, pvPathsToWatch, solarFieldVisible, fmtV, fmtA, fmtW
} from '../public/solar.js'
import { linkApplies, linkSubject, resolveLink } from '../public/cableForm.js'
import { dashboardChecks } from '../public/dashboard.js'
import { parseHash, hashForState } from '../public/router.js'

const panel = (id, name, extra = {}) => ({ id, name, type: 'Solar panel', role: 'source', status: 'active', ...extra })
const byId = (list) => new Map(list.map((d) => [d.id, d]))

test('isSolarPanel matches the whole type name, ignoring case and padding', () => {
  assert.equal(isSolarPanel({ type: ' solar PANEL ' }), true)
  assert.equal(isSolarPanel({ type: 'Solar panel array' }), false)
  assert.equal(isSolarPanel({ type: null }), false)
  assert.equal(isSolarPanel(null), false)
})

test('numbers show a dash when unknown', () => {
  assert.equal(fmtV(132.33), '132.3 V')
  assert.equal(fmtA(6.5), '6.5 A')
  assert.equal(fmtW(719.6), '720 W')
  assert.equal(fmtV(null), '-')
})

test('title, strings and missing text use the panel names', () => {
  const d = byId([panel('a', 'Port'), panel('b', 'Middle'), panel('c', 'Starboard'), panel('d', 'Extra')])
  assert.equal(arrayTitle({ panelIds: ['a', 'b', 'c'] }, d), 'Port + Middle + Starboard')
  assert.equal(arrayTitle({ panelIds: ['a', 'b', 'c', 'd'] }, d), 'Port + Middle + Starboard + 1 more')
  assert.equal(stringsText({ strings: [['a']] }, d), '')
  assert.equal(stringsText({ strings: [['a', 'b'], ['c', 'd']] }, d), 'Port + Middle | Starboard + Extra')
  assert.equal(missingText({ missing: [{ deviceId: 'a', fields: ['vocV', 'iscA'] }, { deviceId: 'b', fields: ['vmpV'] }] }, d),
    'Port has no Voc or Isc set. Middle has no Vmp set')
  assert.equal(missingText({ missing: [] }, d), '')
})

test('a panel with no array from the server gets an array of one', () => {
  const devices = [panel('a', 'A', { vocV: 44, iscA: 6, vmpV: 37, impA: 6, ratedPowerW: 240 }), panel('b', 'B'), panel('c', 'C', { status: 'removed' }), { id: 'x', type: 'Battery', status: 'active' }]
  const one = singlePanelArrays(devices, [{ panelIds: ['b'] }])
  assert.equal(one.length, 1)
  assert.equal(one[0].complete, true)
  assert.equal(allArrays(devices, [{ panelIds: ['b'] }]).length, 2)
  assert.equal(singlePanelArrays(devices, [])[1].complete, false)
})

test('arrayWarnings keeps the warning level checks and array warnings only', () => {
  const arrays = [{ panelIds: ['a'], checks: [{ level: 'ok' }, { level: 'note' }, { level: 'warning', code: 'voc-cold', message: 'x' }], warnings: [{ code: 'not-reducible', message: 'y' }] }]
  assert.deepEqual(arrayWarnings(arrays).map((w) => w.check.code), ['voc-cold', 'not-reducible'])
})

test('pvReading reads the controller paths; pvPathsToWatch lists them once', () => {
  const c = { pvVoltagePath: 'vessels.self.electrical.solar.mppt.panelVoltage', pvPowerPath: 'electrical.solar.mppt.panelPower' }
  const values = new Map([['electrical.solar.mppt.panelVoltage', 118.2], ['electrical.solar.mppt.panelPower', 310]])
  assert.equal(pvReading(c, values), '118.2 V, 310 W')
  assert.equal(pvReading(c, new Map()), null)
  assert.equal(pvReading(null, values), null)
  assert.deepEqual(pvPathsToWatch([c, { ...c }, { status: 'removed', pvPowerPath: 'a.b' }]), ['electrical.solar.mppt.panelPower', 'electrical.solar.mppt.panelVoltage'])
})

test('solar fields show on a panel and on a solar charge controller only', () => {
  assert.equal(solarFieldVisible('vocV', { type: 'Solar panel' }), true)
  assert.equal(solarFieldVisible('vocV', { type: 'Breaker' }), false)
  assert.equal(solarFieldVisible('pvMaxV', { type: 'MPPT charger', role: 'converter' }), true)
  assert.equal(solarFieldVisible('pvMaxV', { type: 'Inverter', role: 'converter' }), false)
  assert.equal(solarFieldVisible('pvMaxV', { type: 'DC-DC converter', role: 'converter', terminals: [{ name: 'PV in +', port: 'PV in' }] }), true)
  assert.equal(solarFieldVisible('pvMaxV', { type: 'MPPT charger', role: 'consumer' }), false)
  assert.equal(solarFieldVisible('name', {}), true)
})

test('the cable link applies to two solar panels as well as two batteries', () => {
  const p = panel('a', 'A'); const q = panel('b', 'B')
  const bat = { role: 'storage', type: 'Battery' }
  assert.equal(linkSubject(p, q), 'panel')
  assert.equal(linkSubject(bat, bat), 'battery')
  assert.equal(linkSubject(p, bat), null)
  assert.equal(linkApplies(p, q), true)
  assert.equal(resolveLink({ link: 'series' }, p, q), 'series')
  assert.equal(resolveLink({}, p, q), 'parallel')
  assert.equal(resolveLink({}, p, bat, 'series'), null)
})

test('the Solar tab has a route', () => {
  assert.deepEqual(parseHash('#/solar'), { tab: 'solar', id: null })
  assert.equal(hashForState({ tab: 'solar', id: null }), '#/solar')
})

test('a solar warning counts toward Needs attention', () => {
  const arrays = [{ panelIds: ['a'], checks: [{ level: 'warning', code: 'voc-cold', message: 'may exceed' }], warnings: [] }]
  const base = dashboardChecks({ devices: [panel('a', 'A')], cables: [], circuits: [], arrays })
  assert.equal(base.solar.length, 1)
  assert.ok(base.attention >= 1)
  assert.equal(dashboardChecks({ devices: [panel('a', 'A')], cables: [], circuits: [] }).solar.length, 0)
})
