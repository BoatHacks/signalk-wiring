import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  kindOfConductors, defaultNegativeLanding, needsTerminal, terminalOptions, buildCablePayload,
  cableToValues, validateCable, circuitsOfCable, cableTitle, negativeLandingCandidates
} from '../public/cableForm.js'

test('a cable with no conductors is a single positive; known sets map to a kind, others to custom', () => {
  assert.equal(kindOfConductors([]), 'positive')
  assert.equal(kindOfConductors([{ conductor: 'negative' }, { conductor: 'positive' }]), 'both')
  assert.equal(kindOfConductors([{ conductor: 'line' }, { conductor: 'earth' }, { conductor: 'neutral' }]), 'ac')
  assert.equal(kindOfConductors([{ conductor: 'positive' }, { conductor: 'earth' }]), 'custom')
})

test('the negative landing defaults to the last one used, skipping removed cables', () => {
  const cables = [
    { status: 'active', fromDeviceId: 'fuse1', conductors: [{ conductor: 'positive' }, { conductor: 'negative', fromDeviceId: 'busA' }] },
    { status: 'active', fromDeviceId: 'busB', conductors: [{ conductor: 'negative' }] },
    { status: 'removed', fromDeviceId: 'f', conductors: [{ conductor: 'negative', fromDeviceId: 'busC' }] },
    { status: 'active', fromDeviceId: 'fuse2', conductors: [{ conductor: 'positive' }] }
  ]
  assert.equal(defaultNegativeLanding(cables), 'busB')
  assert.equal(defaultNegativeLanding(cables.slice(0, 1)), 'busA')
  assert.equal(defaultNegativeLanding([cables[3]]), null)
  assert.equal(defaultNegativeLanding([]), null)
})

test('negative landing candidates are bus bars, batteries and sources', () => {
  const list = negativeLandingCandidates([
    { id: 'a', role: 'distribution' }, { id: 'b', role: 'storage' }, { id: 'c', role: 'consumer' },
    { id: 'd', role: 'source' }, { id: 'e', role: 'storage', status: 'removed' }, { id: 'f' }
  ])
  assert.deepEqual(list.map((d) => d.id), ['a', 'b', 'd'])
})

test('terminals are asked for only on converters and multi-terminal devices', () => {
  const t = (name, conductor) => ({ name, conductor })
  assert.equal(needsTerminal(null), false)
  assert.equal(needsTerminal({ role: 'consumer', terminals: [] }), false)
  assert.equal(needsTerminal({ role: 'consumer', terminals: [t('a', 'positive')] }), false)
  assert.equal(needsTerminal({ role: 'storage', terminals: [t('a', 'positive'), t('b', 'positive')] }), true)
  assert.equal(needsTerminal({ role: 'converter', terminals: [t('a', 'positive')] }), true)
  assert.deepEqual(terminalOptions({ terminals: [t('a', 'positive'), t('b', 'negative')] }, 'negative').map((x) => x.name), ['b'])
})

test('a two-conductor cable lands its negative on the chosen bus bar', () => {
  const payload = buildCablePayload({
    fromDeviceId: 'fuse', toDeviceId: 'lamp', kind: 'both', negativeLandingId: 'bus',
    colors: { positive: ' red ', negative: 'black' }, gauge: '2.5', gaugeUnit: 'mm2', length: '', zoneId: ''
  })
  assert.equal(payload.gauge, 2.5)
  assert.equal('length' in payload, false)
  assert.equal(payload.zoneId, null)
  assert.deepEqual(payload.conductors[0], { conductor: 'positive', color: 'red', fromTerminal: null, toTerminal: null })
  assert.equal(payload.conductors[1].fromDeviceId, 'bus')
  assert.equal(payload.conductors[1].color, 'black')
})

test('no override when the negative lands where the positive starts, nor for single conductors', () => {
  const same = buildCablePayload({ fromDeviceId: 'f', toDeviceId: 'l', kind: 'both', negativeLandingId: 'f' })
  assert.equal('fromDeviceId' in same.conductors[1], false)
  const single = buildCablePayload({ fromDeviceId: 'bus', toDeviceId: 'l', kind: 'negative', negativeLandingId: 'x' })
  assert.deepEqual(single.conductors.map((c) => c.conductor), ['negative'])
  assert.equal('fromDeviceId' in single.conductors[0], false)
})

test('terminals travel with their conductor, and a custom cable keeps its conductors', () => {
  const p = buildCablePayload({
    fromDeviceId: 'a', toDeviceId: 'inv', kind: 'positive', terminals: { positive: { from: '', to: 'DC +' } }
  })
  assert.equal(p.conductors[0].toTerminal, 'DC +')
  const kept = [{ conductor: 'positive' }, { conductor: 'earth' }]
  assert.deepEqual(buildCablePayload({ fromDeviceId: 'a', toDeviceId: 'b', kind: 'custom', existingConductors: kept }).conductors, kept)
})

test('cableToValues is the reverse of buildCablePayload for a two-conductor cable', () => {
  const payload = buildCablePayload({
    fromDeviceId: 'fuse', toDeviceId: 'lamp', kind: 'both', negativeLandingId: 'bus',
    colors: { positive: 'red', negative: 'black' }, gauge: 2.5, gaugeUnit: 'mm2', cableLabel: 'W1'
  })
  const values = cableToValues({ ...payload, tags: [] })
  assert.equal(values.kind, 'both')
  assert.equal(values.negativeLandingId, 'bus')
  assert.equal(values.colors.negative, 'black')
  assert.equal(values.cableLabel, 'W1')
  assert.equal(values.gauge, 2.5)
})

test('validation asks for both ends, different ones', () => {
  assert.match(validateCable({ toDeviceId: 'b' }), /From/)
  assert.match(validateCable({ fromDeviceId: 'a' }), /To/)
  assert.match(validateCable({ fromDeviceId: 'a', toDeviceId: 'a' }), /different/)
  assert.equal(validateCable({ fromDeviceId: 'a', toDeviceId: 'b' }), null)
})

test('cable title and the circuits a cable is part of', () => {
  const names = new Map([['a', 'Fuse'], ['b', 'Lamp']])
  assert.equal(cableTitle({ fromDeviceId: 'a', toDeviceId: 'b' }, names), 'Fuse to Lamp')
  assert.equal(cableTitle({ cableLabel: 'W9' }, names), 'W9')
  assert.equal(cableTitle({ fromDeviceId: 'a' }, names), 'Fuse to ?')
  const circuits = [
    { id: 'c1', status: 'active', derived: { cableIds: ['w1'], returnCableIds: [] } },
    { id: 'c2', status: 'active', derived: { cableIds: ['w2'], returnCableIds: ['w1'] } },
    { id: 'c3', status: 'removed', derived: null },
    { id: 'c4', status: 'active', derived: { cableIds: ['w3'], returnCableIds: [] } }
  ]
  assert.deepEqual(circuitsOfCable('w1', circuits).map((x) => [x.circuit.id, x.via]), [['c1', 'feed'], ['c2', 'return']])
})

import { buildBulkPayload } from '../public/cableForm.js'

test('bulk payload sends only filled-in fields and adds tags without duplicates', () => {
  assert.deepEqual(buildBulkPayload({ gauge: '', cableLabel: '  ' }, { tags: [] }), {})
  assert.deepEqual(
    buildBulkPayload({ gauge: '4', gaugeUnit: 'mm2', addTags: ['audio', 'Main'] }, { tags: ['main'] }),
    { gauge: 4, gaugeUnit: 'mm2', tags: ['main', 'audio'] }
  )
  assert.deepEqual(buildBulkPayload({ zoneId: 'z1', clearZone: true }, {}), { zoneId: null })
  assert.deepEqual(buildBulkPayload({ zoneId: 'z1' }, {}), { zoneId: 'z1' })
})

import { defaultColorFor } from '../public/cableForm.js'

test('new cables start with red, black and brown/blue/green-yellow, and edits do not', () => {
  assert.equal(defaultColorFor('positive'), 'red')
  assert.equal(defaultColorFor('negative'), 'black')
  const base = { fromDeviceId: 'a', toDeviceId: 'b', colors: {}, terminals: {} }
  const both = buildCablePayload({ ...base, kind: 'both' }, { defaults: true })
  assert.deepEqual(both.conductors.map((c) => c.color), ['red', 'black'])
  const ac = buildCablePayload({ ...base, kind: 'ac' }, { defaults: true })
  assert.deepEqual(ac.conductors.map((c) => c.color), ['brown', 'blue', 'green/yellow'])
  // Typed or deliberately emptied colours win over the defaults.
  const own = buildCablePayload({ ...base, kind: 'both', colors: { positive: 'orange', negative: '' } }, { defaults: true })
  assert.deepEqual(own.conductors.map((c) => c.color), ['orange', null])
  // Without the flag (editing) nothing is filled in.
  assert.deepEqual(buildCablePayload({ ...base, kind: 'both' }).conductors.map((c) => c.color), [null, null])
})
