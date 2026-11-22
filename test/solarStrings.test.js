'use strict'

// Plan 0048: solar panel figures, panel links, migration 22, and the circuit an
// array feeds.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Store } = require('../src/store')

const mk = (s, name, type, role, extra = {}) => s.create('device', { name, type, role, ...extra })
const cable = (s, a, b, extra = {}) => s.create('wireRun', { from_device_id: a.id, to_device_id: b.id, ...extra })
const fig = { voc_v: 44.11, isc_a: 6.5, vmp_v: 37.89, imp_a: 6.2, rated_power_w: 240, voc_temp_coeff: -0.3 }

// The boat's string: three panels in series, positive cable to a PV breaker,
// then a MPPT charger.
function boat (s, { workaround = false } = {}) {
  const p = ['port', 'middle', 'starboard'].map((n) => mk(s, n, 'Solar panel', 'source', fig))
  const brk = mk(s, 'PV breaker', 'Breaker', 'distribution', { trip_rating_a: 10 })
  const ctl = mk(s, 'MPPT', 'MPPT charger', 'converter', {
    pv_max_v: 150, pv_max_a: 35,
    terminals: [{ name: 'PV in +', conductor: 'positive', port: 'PV in' }, { name: 'PV in -', conductor: 'negative', port: 'PV in' }]
  })
  const links = workaround
    ? [cable(s, p[0], p[1], { conductors: [{ conductor: 'negative' }] }), cable(s, p[1], p[2], { conductors: [{ conductor: 'negative' }] })]
    : [cable(s, p[0], p[1], { link: 'series' }), cable(s, p[1], p[2], { link: 'series' })]
  cable(s, p[0], brk)
  cable(s, brk, ctl, { conductors: [{ conductor: 'positive', toTerminal: 'PV in +' }] })
  return { p, brk, ctl, links }
}

test('panel figures are stored, validated and cleared', () => {
  const s = new Store(':memory:')
  const d = mk(s, 'P', 'Solar panel', 'source', fig)
  assert.equal(s.get('device', d.id).voc_v, 44.11)
  assert.equal(s.update('device', d.id, { voc_v: '' }).voc_v, null)
  assert.equal(s.update('device', d.id, { isc_a: '6.8' }).isc_a, 6.8)
  for (const bad of [{ voc_v: 0 }, { isc_a: -1 }, { vmp_v: 'x' }, { pv_max_v: -5 }, { voc_temp_coeff: 0.3 }, { voc_temp_coeff: -2 }]) {
    assert.throws(() => s.update('device', d.id, bad), /must be/)
  }
  assert.equal(s.update('device', d.id, { voc_temp_coeff: 0 }).voc_temp_coeff, 0)
  assert.equal(s.update('device', d.id, { pv_voltage_path: ' electrical.solar.x.panelVoltage ' }).pv_voltage_path, 'electrical.solar.x.panelVoltage')
  assert.throws(() => s.update('device', d.id, { pv_power_path: 'not a path' }), /dotted SignalK path/)
  s.close()
})

test('a link type is allowed between two solar panels and refused otherwise', () => {
  const s = new Store(':memory:')
  const a = mk(s, 'A', 'Solar panel', 'source')
  const b = mk(s, 'B', ' solar PANEL ', 'source')
  const other = mk(s, 'W', 'Wind generator', 'source')
  assert.equal(cable(s, a, b, { link: 'series' }).link, 'series')
  assert.throws(() => cable(s, a, other, { link: 'series' }), /two batteries or two solar panels/)
  s.close()
})

test('a string is one array with its figures and controller check', () => {
  const s = new Store(':memory:')
  const { p, ctl } = boat(s)
  const { arrays } = s.deriveAll({ coldTemperatureC: -10 })
  assert.equal(arrays.length, 1)
  assert.deepEqual(arrays[0].strings[0].length, 3)
  assert.equal(arrays[0].layout.label, '3S1P')
  assert.deepEqual(arrays[0].controllerIds, [ctl.id])
  assert.equal(arrays[0].checks.find((c) => c.code === 'voc-cold').level, 'note')
  assert.ok(p.every((x) => arrays[0].panelIds.includes(x.id)))
  s.close()
})

test('the array makes one circuit with no false warnings and its Vmp as voltage', () => {
  const s = new Store(':memory:')
  const { brk } = boat(s)
  const { circuits, warnings } = s.deriveAll()
  assert.deepEqual(warnings, [])
  const circuit = circuits.find((c) => c.protectorId === brk.id)
  assert.ok(circuit)
  assert.equal(circuit.unprotected, false)
  assert.ok(Math.abs(circuit.voltage - 113.67) < 0.01)
  assert.equal(circuits.filter((c) => c.unprotected).length, 0)
  s.close()
})

test('migration 22 turns the negative workaround links into series links, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'))
  const file = path.join(dir, 'w.db')
  const s = new Store(file)
  const { links } = boat(s, { workaround: true })
  const keep = mk(s, 'Neg', 'Busbar', 'distribution')
  const bat = mk(s, 'Bat', 'Battery', 'storage')
  const other = cable(s, bat, keep, { conductors: [{ conductor: 'negative' }] })
  s.close()
  const { Database } = require('../src/db')
  const raw = new Database(file)
  for (const c of ['voc_v', 'isc_a', 'vmp_v', 'imp_a', 'voc_temp_coeff', 'pv_max_v', 'pv_max_a', 'pv_max_w', 'pv_voltage_path', 'pv_power_path']) {
    raw.exec(`ALTER TABLE devices DROP COLUMN ${c}`)
  }
  raw.pragma('user_version = 21')
  raw.close()
  for (let i = 0; i < 2; i++) {
    const again = new Store(file)
    for (const l of links) {
      const c = again.get('wireRun', l.id)
      assert.equal(c.link, 'series')
      assert.deepEqual(c.conductors.map((x) => x.conductor), ['positive'])
    }
    assert.equal(again.get('wireRun', other.id).link, null)
    assert.deepEqual(again.get('wireRun', other.id).conductors.map((x) => x.conductor), ['negative'])
    again.db.prepare('SELECT voc_v, pv_power_path FROM devices').all()
    again.db.pragma('user_version = 21')
    again.close()
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
