import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CABLE_KINDS, buildCablePayload } from '../public/cableForm.js'
import { popoverKinds, resolveTerminals, startValues, quickProblem, withKind } from '../public/quickCable.js'

const dev = (id, over = {}) => ({ id, name: id, role: 'consumer', terminals: [], ...over })

test('popoverKinds: DC kinds, plus the suggested AC kind', () => {
  assert.deepEqual(popoverKinds('both', CABLE_KINDS).map((k) => k.value), ['positive', 'negative', 'both'])
  assert.deepEqual(popoverKinds('ac', CABLE_KINDS).map((k) => k.value), ['positive', 'negative', 'both', 'ac'])
})

test('resolveTerminals: named terminal wins, a single match is used, several need a choice', () => {
  const batt = dev('bat', { role: 'storage', terminals: [{ name: 'B+', conductor: 'positive' }, { name: 'B-', conductor: 'negative' }] })
  const lamp = dev('lamp')
  const r = resolveTerminals('both', batt, 'B+', lamp, '')
  assert.deepEqual(r.terminals.positive, { from: 'B+', to: '' })
  assert.deepEqual(r.terminals.negative, { from: 'B-', to: '' })
  assert.deepEqual(r.missing, [])

  const bank = dev('bank', { role: 'storage', terminals: [
    { name: 'P1', conductor: 'positive' }, { name: 'P2', conductor: 'positive' }, { name: 'N', conductor: 'negative' }] })
  const r2 = resolveTerminals('positive', bank, '', lamp, '')
  assert.equal(r2.missing.length, 1)
  assert.deepEqual(resolveTerminals('positive', bank, 'P2', lamp, '').terminals.positive, { from: 'P2', to: '' })
})

test('startValues puts the supply side first and carries the dropped terminals with it', () => {
  const bat = dev('bat', { role: 'storage', terminals: [{ name: 'B+', conductor: 'positive' }, { name: 'B-', conductor: 'negative' }] })
  const lamp = dev('lamp')
  const s = startValues({ a: lamp, ta: '', b: bat, tb: 'B+', cables: [], defaults: { gaugeUnit: 'AWG', lengthUnit: 'm' } })
  assert.equal(s.values.fromDeviceId, 'bat')
  assert.equal(s.values.toDeviceId, 'lamp')
  assert.equal(s.fromTerminal, 'B+')
  assert.equal(s.values.kind, 'both')
  assert.equal(s.values.gaugeUnit, 'AWG')
  const payload = buildCablePayload(s.values)
  assert.equal(payload.fromDeviceId, 'bat')
  assert.deepEqual(payload.conductors.map((c) => c.conductor), ['positive', 'negative'])
  assert.equal(payload.conductors[0].fromTerminal, 'B+')
  assert.equal(quickProblem(s, s.values), null)
})

test('startValues reuses the last negative landing', () => {
  const cables = [{ id: 'c', status: 'active', fromDeviceId: 'x', conductors: [{ conductor: 'negative', fromDeviceId: 'busbar' }] }]
  const s = startValues({ a: dev('bat', { role: 'storage' }), b: dev('lamp'), cables })
  assert.equal(s.values.negativeLandingId, 'busbar')
})

test('quickProblem: needs two different devices and resolvable terminals', () => {
  const bank = dev('bank', { role: 'storage', terminals: [
    { name: 'P1', conductor: 'positive' }, { name: 'P2', conductor: 'positive' }] })
  const s = startValues({ a: bank, b: dev('lamp'), cables: [] })
  assert.match(quickProblem(s, withKind(s, s.values, 'positive')), /several terminals/)
  const same = startValues({ a: dev('x'), b: dev('x'), cables: [] })
  assert.match(quickProblem(same, same.values), /different/)
})

test('withKind re-resolves terminals for the new kind', () => {
  const bat = dev('bat', { role: 'storage', terminals: [{ name: 'B+', conductor: 'positive' }, { name: 'B-', conductor: 'negative' }] })
  const s = startValues({ a: bat, ta: 'B+', b: dev('lamp'), cables: [] })
  const v = withKind(s, s.values, 'positive')
  assert.equal(v.kind, 'positive')
  assert.deepEqual(Object.keys(v.terminals), ['positive'])
})

test('startValues keepOrder keeps From and To as given', () => {
  const bat = dev('bat', { role: 'storage' })
  const lamp = dev('lamp')
  assert.equal(startValues({ a: lamp, b: bat, cables: [] }).values.fromDeviceId, 'bat')
  const kept = startValues({ a: lamp, b: bat, cables: [], keepOrder: true })
  assert.equal(kept.values.fromDeviceId, 'lamp')
  assert.equal(kept.values.toDeviceId, 'bat')
})
