import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { endCurrent, suggestKind, mixesAcAndDc, conductorCurrent, cableCurrent, mismatchText } from '../public/current.js'
import { startValues, popoverKinds } from '../public/quickCable.js'
import { CABLE_KINDS } from '../public/cableForm.js'

const t = (name, conductor, port) => ({ name, conductor, port })
const dev = (name, extra = {}) => ({ id: name, name, role: 'consumer', terminals: [], ...extra })
const inlet = dev('Shore inlet', { role: 'source', current: 'ac' })
const charger = dev('Charger', {
  role: 'converter',
  terminals: [t('AC L', 'line', 'AC in'), t('AC N', 'neutral', 'AC in'), t('AC PE', 'earth', 'AC in'),
    t('DC +', 'positive', 'DC out'), t('DC -', 'negative', 'DC out')]
})
const battery = dev('Battery', { role: 'storage', current: 'dc' })

test('conductorCurrent', () => {
  for (const c of ['line', 'neutral', 'earth']) assert.equal(conductorCurrent(c), 'ac')
  for (const c of ['positive', 'negative']) assert.equal(conductorCurrent(c), 'dc')
  assert.equal(conductorCurrent('signal'), null)
  assert.equal(conductorCurrent(undefined), null)
})

test('endCurrent: terminal, then mark, then agreeing terminals, then unknown', () => {
  assert.equal(endCurrent(charger, 'AC L'), 'ac')
  assert.equal(endCurrent(charger, 'DC +'), 'dc')
  assert.equal(endCurrent(charger, 'AC PE'), 'ac')
  assert.equal(endCurrent(charger, ''), null) // mixed terminals
  assert.equal(endCurrent(charger), null)
  assert.equal(endCurrent(inlet, ''), 'ac')
  // the dropped-on terminal beats the mark
  const odd = dev('Odd', { current: 'ac', terminals: [t('+', 'positive')] })
  assert.equal(endCurrent(odd, '+'), 'dc')
  assert.equal(endCurrent(odd, 'missing'), 'ac')
  // a signal terminal says nothing, even with a mark
  const gw = dev('Gateway', { current: 'dc', terminals: [t('Data', 'signal')] })
  assert.equal(endCurrent(gw, 'Data'), null)
  // agreeing terminals
  assert.equal(endCurrent(dev('Box', { terminals: [t('+', 'positive'), t('-', 'negative')] })), 'dc')
  assert.equal(endCurrent(dev('Socket', { terminals: [t('L', 'line'), t('N', 'neutral'), t('E', 'earth')] })), 'ac')
  assert.equal(endCurrent(dev('Plain')), null)
  assert.equal(endCurrent(null), null)
})

test('suggestKind: shore inlet to the charger AC in port is AC', () => {
  assert.deepEqual(suggestKind(inlet, '', charger, 'AC L'), { kind: 'ac', mismatch: null })
})

test('suggestKind: charger DC out to the battery is positive + negative', () => {
  assert.deepEqual(suggestKind(charger, 'DC +', battery, ''), { kind: 'both', mismatch: null })
})

test('suggestKind: both unknown falls back to the old rule', () => {
  assert.deepEqual(suggestKind(dev('Lamp'), '', dev('Pump'), ''), { kind: 'both', mismatch: null })
  assert.deepEqual(suggestKind(dev('Fuse', { role: 'distribution' }), '', dev('Lamp'), ''), { kind: 'positive', mismatch: null })
})

test('suggestKind: one known end decides', () => {
  assert.equal(suggestKind(inlet, '', dev('Socket'), '').kind, 'ac')
  assert.equal(suggestKind(dev('Lamp'), '', battery, '').kind, 'both')
  const fuse = dev('Fuse', { role: 'distribution' })
  assert.equal(suggestKind(battery, '', fuse, '').kind, 'positive')
  assert.equal(suggestKind(fuse, '', dev('Lamp', { current: 'dc' }), '').kind, 'positive')
})

test('suggestKind: a mismatch follows the From end and reports both', () => {
  assert.deepEqual(suggestKind(inlet, '', battery, ''), {
    kind: 'ac', mismatch: { fromCurrent: 'ac', toCurrent: 'dc' }
  })
  assert.deepEqual(suggestKind(battery, '', inlet, ''), {
    kind: 'both', mismatch: { fromCurrent: 'dc', toCurrent: 'ac' }
  })
})

test('suggestKind: signal ends stay signal', () => {
  const a = dev('Sensor', { current: 'dc', terminals: [t('Data', 'signal')] })
  const b = dev('Gateway', { terminals: [t('Data', 'signal')] })
  assert.deepEqual(suggestKind(a, 'Data', b, 'Data'), { kind: 'signal', mismatch: null })
})

test('mixesAcAndDc', () => {
  const m = (...types) => mixesAcAndDc(types.map((conductor) => ({ conductor })))
  assert.equal(m('line', 'positive'), true)
  assert.equal(m('neutral', 'negative'), true)
  assert.equal(m('line', 'neutral', 'earth'), false)
  assert.equal(m('positive', 'negative', 'earth'), false)
  assert.equal(m('earth', 'positive'), false)
  assert.equal(m('signal', 'line'), false)
  assert.equal(m('earth', 'signal'), false)
  assert.equal(m(), false)
  assert.equal(mixesAcAndDc(['line', 'positive']), true)
})

test('the browser and server mixesAcAndDc agree on every pair and triple', () => {
  const server = createRequire(import.meta.url)('../src/current.js')
  const types = ['positive', 'negative', 'line', 'neutral', 'earth', 'signal']
  const lists = [[]]
  for (const a of types) { lists.push([a]); for (const b of types) { lists.push([a, b]); for (const c of types) lists.push([a, b, c]) } }
  for (const l of lists) {
    const objs = l.map((conductor) => ({ conductor }))
    assert.equal(mixesAcAndDc(objs), server.mixesAcAndDc(objs), l.join())
  }
})

test('cableCurrent', () => {
  const c = (...types) => ({ conductors: types.map((conductor) => ({ conductor })) })
  assert.equal(cableCurrent(c('line', 'neutral', 'earth')), 'ac')
  assert.equal(cableCurrent(c('neutral')), 'ac')
  assert.equal(cableCurrent(c('positive', 'negative')), 'dc')
  assert.equal(cableCurrent(c('negative')), 'dc')
  assert.equal(cableCurrent({}), 'dc')
  assert.equal(cableCurrent(c()), 'dc')
  assert.equal(cableCurrent(c('earth')), null)
  assert.equal(cableCurrent(c('signal')), null)
})

test('mismatchText names the devices', () => {
  assert.equal(mismatchText({ fromCurrent: 'ac', toCurrent: 'dc' }, inlet, battery),
    'Shore inlet is AC, Battery is DC. Choose the cable type.')
  assert.equal(mismatchText(null, inlet, battery), null)
})

test('the quick popover start uses the rule and carries the mismatch', () => {
  const s = startValues({ a: battery, ta: '', b: inlet, tb: '', cables: [] })
  assert.equal(s.values.kind, 'ac') // the inlet is the supply end
  assert.deepEqual(s.mismatch, { fromCurrent: 'ac', toCurrent: 'dc' })
  assert.equal(s.from.id, 'Shore inlet')
  const ok = startValues({ a: charger, ta: 'DC +', b: battery, tb: '', cables: [], keepOrder: true })
  assert.equal(ok.values.kind, 'both')
  assert.equal(ok.mismatch, null)
  const swapped = startValues({ a: charger, ta: 'AC L', b: inlet, tb: '', cables: [] })
  assert.equal(swapped.values.kind, 'ac')
  assert.equal(swapped.fromTerminal, '')
  assert.equal(swapped.toTerminal, 'AC L')
})

test('popoverKinds offers AC as well on a mismatch', () => {
  assert.deepEqual(popoverKinds('both', CABLE_KINDS, { fromCurrent: 'dc', toCurrent: 'ac' }).map((k) => k.value),
    ['positive', 'negative', 'both', 'ac'])
  assert.deepEqual(popoverKinds('both', CABLE_KINDS).map((k) => k.value), ['positive', 'negative', 'both'])
})

test('suggestKind: both ends dropped on signal terminals of a mixed device is a signal cable', () => {
  const board = {
    id: 'rb', name: 'Relay board', role: 'consumer',
    terminals: [
      { name: 'DC supply +', conductor: 'positive', port: 'DC supply' },
      { name: 'DC supply -', conductor: 'negative', port: 'DC supply' },
      { name: 'Relay 1 COM', conductor: 'signal', port: 'Relay 1' },
      { name: 'Relay 2 COM', conductor: 'signal', port: 'Relay 2' }
    ]
  }
  assert.deepEqual(suggestKind(board, 'Relay 1 COM', board, 'Relay 2 COM'), { kind: 'signal', mismatch: null })
  // a power terminal at one end is not a signal cable
  assert.notEqual(suggestKind(board, 'DC supply +', board, 'Relay 2 COM').kind, 'signal')
})

test('startValues: a wire between two relay ports of one device starts as a signal cable with both terminals', () => {
  const board = {
    id: 'rb', name: 'Relay board', role: 'consumer',
    terminals: [
      { name: 'DC supply +', conductor: 'positive', port: 'DC supply' },
      { name: 'Relay 1 COM', conductor: 'signal', port: 'Relay 1' },
      { name: 'Relay 2 COM', conductor: 'signal', port: 'Relay 2' }
    ]
  }
  const start = startValues({ a: board, ta: 'Relay 1 COM', b: board, tb: 'Relay 2 COM', cables: [] })
  assert.equal(start.values.kind, 'signal')
  assert.equal(start.values.fromDeviceId, 'rb')
  assert.equal(start.values.toDeviceId, 'rb')
  assert.deepEqual(start.values.terminals.signal, { from: 'Relay 1 COM', to: 'Relay 2 COM' })
})
