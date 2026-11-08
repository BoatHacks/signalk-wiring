import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conduitCurrentMix, conduitMixText } from '../public/current.js'

const cable = (id, types, extra = {}) => ({ id, conductors: types.map((conductor) => ({ conductor })), ...extra })
const ac = cable('a', ['line', 'neutral', 'earth'])
const dc = cable('d', ['positive', 'negative'])

test('empty list is not mixed', () => {
  assert.deepEqual(conduitCurrentMix([]), { ac: [], dc: [], mixed: false })
  assert.equal(conduitCurrentMix(undefined).mixed, false)
})
test('AC only and DC only are not mixed', () => {
  assert.deepEqual(conduitCurrentMix([ac]), { ac: [ac], dc: [], mixed: false })
  assert.deepEqual(conduitCurrentMix([dc]), { ac: [], dc: [dc], mixed: false })
})
test('both is mixed', () => {
  const mix = conduitCurrentMix([ac, dc])
  assert.equal(mix.mixed, true)
  assert.deepEqual(mix.ac, [ac])
  assert.deepEqual(mix.dc, [dc])
})
test('removed cables are ignored', () => {
  const gone = cable('g', ['positive'], { status: 'removed' })
  assert.equal(conduitCurrentMix([ac, gone]).mixed, false)
  assert.equal(conduitCurrentMix([gone]).dc.length, 0)
})
test('signal-only and earth-only cables count as neither', () => {
  const sig = cable('s', ['signal'])
  const earth = cable('e', ['earth'])
  const mix = conduitCurrentMix([dc, sig])
  assert.equal(mix.mixed, false)
  assert.deepEqual(mix.ac, [])
  assert.equal(conduitCurrentMix([sig, earth, dc]).dc.length, 1)
})
test('warning text has heading, advice and the names', () => {
  const text = conduitMixText(conduitCurrentMix([ac, dc]), (c) => `Cable ${c.id}`)
  const lines = text.split('\n')
  assert.equal(lines[0], 'This conduit holds AC and DC cables.')
  assert.match(lines[1], /^Keep them in separate conduits where you can\. If they share one,/)
  assert.equal(lines[2], 'AC: Cable a')
  assert.equal(lines[3], 'DC: Cable d')
  assert.equal(conduitMixText(conduitCurrentMix([ac]), () => 'x'), null)
})
