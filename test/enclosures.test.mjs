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
  const more = [...cables, { id: 'neg', fromDeviceId: 'battery', toDeviceId: 'battery', status: 'active', conductors: [{ conductor: 'negative', toDeviceId: 'breaker' }] },
    { id: 'dead', fromDeviceId: 'breaker', toDeviceId: 'battery', status: 'removed', conductors: [] }]
  assert.deepEqual(web.cablesTouching(more, ['breaker']), server.cablesTouching(more, ['breaker']))
  assert.deepEqual(web.cablesTouching(more, ['breaker']), ['feed', 'neg'])
})

test('removalText lists the devices and the cables, shortened when long', () => {
  const text = web.removalText('Panel', { names: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], cableTitles: ['x to y'] })
  assert.match(text, /Remove the enclosure "Panel" and everything inside it\?/)
  assert.match(text, /Devices inside \(8\): a, b, c, d, e, f and 2 more\./)
  assert.match(text, /Their cables \(1\): x to y\./)
  assert.match(web.removalText('P', { names: ['a'], cableTitles: [] }), /No cables end on them\./)
  assert.match(text, /Undo puts everything back/)
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

test('placementBlock says why a device inside an enclosure is not placed', () => {
  const inside = devices.find((d) => d.id === 'breaker')
  assert.equal(web.placementBlock(devices, inside), 'breaker is inside cabinet. Place the enclosure instead.')
  assert.equal(web.placementBlock(devices, devices.find((d) => d.id === 'battery')), null)
  assert.equal(web.placementBlock(devices, devices.find((d) => d.id === 'cabinet')), null)
})

// ---- the page model ----

const pdev = (id, extra = {}) => ({ id, name: id, role: 'consumer', status: 'active', parentId: null, terminals: [], ...extra })
const pcab = (id, from, to, conductors = [{ conductor: 'positive' }]) => ({ id, fromDeviceId: from, toDeviceId: to, status: 'active', conductors })
const pdevices = [
  pdev('shore', { role: 'source' }),
  pdev('box', { role: 'enclosure', name: 'AC box' }),
  pdev('main', { role: 'distribution', name: 'Main breaker', parentId: 'box' }),
  pdev('bar', { role: 'distribution', name: 'Live bar', parentId: 'box' }),
  pdev('outlet', { name: 'Outlet' })
]
const pcables = [
  pcab('in', 'shore', 'main', [{ conductor: 'line', toTerminal: 'IN' }, { conductor: 'neutral', toTerminal: 'N' }]),
  pcab('inner', 'main', 'bar'),
  pcab('out', 'bar', 'outlet', [{ conductor: 'line', fromTerminal: 'L1' }])
]

test('pageModel: an enclosure box with one port per boundary cable, contents hidden, internal cables dropped', () => {
  const m = web.pageModel(pdevices, pcables, ['shore', 'box', 'outlet', 'main'])
  assert.deepEqual([...m.hidden], ['main'])
  const box = m.devices.get('box')
  assert.equal(box.isEnclosure, true)
  assert.equal(box.holds, 2)
  assert.deepEqual(box.terminals.map((t) => [t.name, t.port, t.conductor]), [['Main breaker IN/N', 'In', 'line'], ['Live bar L1', 'Out', 'line']])
  assert.deepEqual(m.cables.map((c) => c.id), ['in', 'out'])
  const cin = m.cables[0]
  assert.equal(cin.fromDeviceId, 'shore')
  assert.equal(cin.toDeviceId, 'box')
  assert.deepEqual(cin.conductors.map((c) => [c.toDeviceId, c.toTerminal]), [['box', 'Main breaker IN/N'], ['box', 'Main breaker IN/N']])
  assert.equal(cin.source.toDeviceId, 'main')
  assert.equal(m.repOf('bar'), 'box')
  assert.equal(m.repOf('shore'), 'shore')
})

test('pageModel: an unrelated page is untouched, the inside page has the cables as stubs', () => {
  const plain = web.pageModel(pdevices, pcables, ['shore', 'outlet'])
  assert.deepEqual(plain.cables, pcables)
  assert.equal(plain.devices.size, 0)
  const inside = web.pageModel(pdevices, pcables, ['main', 'bar'])
  assert.deepEqual(inside.cables, pcables)
  assert.equal(inside.hidden.size, 0)
})

test('pageModel: nested enclosures show as boxes with their own ports on the outer inside page', () => {
  const devices = [
    pdev('cab', { role: 'enclosure' }), pdev('sub', { role: 'enclosure', parentId: 'cab', name: 'Sub box' }),
    pdev('fuse', { parentId: 'sub', name: 'Fuse' }), pdev('lamp', { parentId: 'cab' }), pdev('out')
  ]
  const cables = [pcab('a', 'fuse', 'lamp'), pcab('b', 'fuse', 'out')]
  const m = web.pageModel(devices, cables, ['sub', 'lamp'])
  assert.deepEqual(m.cables.map((c) => [c.id, c.fromDeviceId, c.toDeviceId]), [['a', 'sub', 'lamp'], ['b', 'sub', 'out']])
  assert.deepEqual(m.devices.get('sub').terminals.map((t) => t.name), ['Fuse', 'Fuse (2)'])
  // placed on one page together, the outer box wins and the inner one is hidden
  const both = web.pageModel(devices, cables, ['cab', 'sub', 'lamp'])
  assert.deepEqual([...both.hidden].sort(), ['lamp', 'sub'])
  assert.deepEqual(both.cables.map((c) => c.id), ['b'])
})

test('insidePageSpec places what the enclosure holds directly, named after it', async () => {
  const { insidePageSpec } = await import('../public/insidePage.js')
  const spec = insidePageSpec(pdevices, pcables, 'box')
  assert.equal(spec.name, 'AC box (inside)')
  assert.deepEqual(spec.devices.map((d) => d.deviceId).sort(), ['bar', 'main'])
  for (const d of spec.devices) assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y))
  assert.notDeepEqual(spec.devices[0], spec.devices[1])
  assert.throws(() => insidePageSpec(pdevices, pcables, 'nope'), /not found/)
  assert.deepEqual(insidePageSpec([pdev('e', { role: 'enclosure' })], [], 'e').devices, [])
})
