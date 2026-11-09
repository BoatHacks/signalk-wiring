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
