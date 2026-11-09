import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as web from '../public/enclosures.js'

const server = createRequire(import.meta.url)('../src/enclosures.js')

const dev = (id, extra = {}) => ({ id, name: id, role: 'consumer', status: 'active', parentId: null, ...extra })
const devices = [
  dev('cabinet', { role: 'enclosure' }),
  dev('box', { role: 'enclosure', parentId: 'cabinet' }),
  dev('breaker', { parentId: 'box' }),
  dev('battery')
]
const cables = [{ id: 'feed', fromDeviceId: 'battery', toDeviceId: 'breaker', status: 'active', conductors: [{ conductor: 'positive', toTerminal: 'IN' }] }]

test('the browser copy matches the server copy', () => {
  assert.deepEqual(web.contentsOf(devices, 'cabinet'), server.contentsOf(devices, 'cabinet'))
  assert.deepEqual(web.pathOf(devices, 'breaker'), server.pathOf(devices, 'breaker'))
  assert.deepEqual(web.childrenOf(devices, 'box'), server.childrenOf(devices, 'box'))
  assert.equal(web.wouldCycle(devices, 'cabinet', 'box'), server.wouldCycle(devices, 'cabinet', 'box'))
  assert.deepEqual(web.boundaryCables(devices, cables, 'box'), server.boundaryCables(devices, cables, 'box'))
  assert.equal(web.boundaryCables(devices, cables, 'box')[0].name, 'breaker IN')
})

test('the Inside picker offers live enclosures that are not the device or inside it', () => {
  const opts = (id) => web.insideOptions(devices, id).map((d) => d.id)
  assert.deepEqual(opts('breaker'), ['box', 'cabinet'])
  assert.deepEqual(opts('cabinet'), [])
  assert.deepEqual(opts('box'), ['cabinet'])
  assert.deepEqual(opts(undefined), ['box', 'cabinet'])
  // the current enclosure stays listed when it has been removed
  const gone = devices.map((d) => (d.id === 'box' ? { ...d, status: 'removed' } : d))
  assert.deepEqual(web.insideOptions(gone, 'breaker').map((d) => d.id), ['box', 'cabinet'])
  assert.deepEqual(web.insideOptions(gone, 'battery').map((d) => d.id), ['cabinet'])
})

test('insideText names the enclosures innermost first; the filter matches at any depth', () => {
  assert.equal(web.insideText(devices, 'breaker'), 'box, cabinet')
  assert.equal(web.insideText(devices, 'battery'), '')
  assert.equal(web.matchesInside(devices, devices[2], 'cabinet'), true)
  assert.equal(web.matchesInside(devices, devices[3], 'cabinet'), false)
  assert.equal(web.matchesInside(devices, devices[3], web.NOT_INSIDE), true)
  assert.equal(web.matchesInside(devices, devices[2], web.NOT_INSIDE), false)
  assert.equal(web.matchesInside(devices, devices[2], ''), true)
  assert.equal(web.isInside(devices[2]), true)
  assert.equal(web.isInside(devices[3]), false)
})
