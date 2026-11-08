import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCablePayload, cableToValues, linkApplies, linkKind, resolveLink } from '../public/cableForm.js'
import { startValues, withLink } from '../public/quickCable.js'

const dev = (id, role, over = {}) => ({ id, name: id, role, terminals: [], ...over })
const b1 = dev('b1', 'storage')
const b2 = dev('b2', 'storage')
const lamp = dev('lamp', 'consumer')

test('linkApplies only when both ends are storage', () => {
  assert.equal(linkApplies(b1, b2), true)
  assert.equal(linkApplies(b1, lamp), false)
  assert.equal(linkApplies(undefined, b2), false)
})

test('linkKind: parallel is both, series is one positive', () => {
  assert.equal(linkKind('parallel'), 'both')
  assert.equal(linkKind('series'), 'positive')
  assert.equal(linkKind('x'), null)
})

test('resolveLink: chosen link between batteries, null to clear a stored one, otherwise not sent', () => {
  assert.equal(resolveLink({ link: 'series' }, b1, b2), 'series')
  assert.equal(resolveLink({}, b1, b2), 'parallel')
  assert.equal(resolveLink({ link: 'series' }, b1, lamp, 'series'), null)
  assert.equal(resolveLink({ link: 'series' }, b1, lamp, null), undefined)
})

test('buildCablePayload carries the link; absent for ordinary cables', () => {
  const base = { fromDeviceId: 'b1', toDeviceId: 'b2', kind: 'positive', negativeLandingId: '' }
  assert.equal(buildCablePayload({ ...base, link: 'series' }).link, 'series')
  assert.equal(buildCablePayload({ ...base, link: null }).link, null)
  assert.equal('link' in buildCablePayload(base), false)
})

test('cableToValues reads the link and round-trips it', () => {
  const cable = { fromDeviceId: 'b1', toDeviceId: 'b2', link: 'series', conductors: [{ conductor: 'positive' }] }
  const values = cableToValues(cable)
  assert.equal(values.link, 'series')
  assert.equal(buildCablePayload(values).link, 'series')
  assert.equal(cableToValues({ fromDeviceId: 'a', toDeviceId: 'b' }).link, null)
})

test('startValues between batteries starts as a parallel link; the series choice is one positive', () => {
  const start = startValues({ a: b1, ta: '', b: b2, tb: '', cables: [] })
  assert.equal(start.values.link, 'parallel')
  assert.equal(start.values.kind, 'both')
  const series = withLink(start, start.values, 'series')
  assert.equal(series.link, 'series')
  assert.equal(series.kind, 'positive')
  const payload = buildCablePayload(series, { defaults: true })
  assert.equal(payload.link, 'series')
  assert.deepEqual(payload.conductors.map((c) => c.conductor), ['positive'])
  const par = buildCablePayload(withLink(start, series, 'parallel'))
  assert.deepEqual(par.conductors.map((c) => c.conductor), ['positive', 'negative'])
  assert.equal(par.link, 'parallel')
})

test('startValues for any other pair has no link', () => {
  const start = startValues({ a: b1, ta: '', b: lamp, tb: '', cables: [] })
  assert.equal('link' in start.values, false)
  assert.equal('link' in buildCablePayload(start.values), false)
})
