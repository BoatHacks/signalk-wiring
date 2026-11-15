import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashForState, parseHash, TABS } from '../public/router.js'

test('hashForState: the Dashboard is the default tab and has its own address', () => {
  assert.equal(hashForState({ tab: 'dashboard', id: null }), '#/dashboard')
  assert.equal(hashForState({}), '#/dashboard')
  assert.equal(hashForState({ tab: 'circuits', id: null }), '#/circuits')
  assert.equal(TABS[0], 'dashboard')
})

test('hashForState: tabs and ids', () => {
  assert.equal(hashForState({ tab: 'cables' }), '#/cables')
  assert.equal(hashForState({ tab: 'devices', id: 'd1' }), '#/devices/d1')
  assert.equal(hashForState({ tab: 'circuits', id: 'c 1/x' }), '#/circuits/c%201%2Fx')
  assert.equal(hashForState({ tab: 'floorplan', id: 'p1' }), '#/floorplan/p1')
  assert.equal(hashForState({ tab: 'unknown' }), '#/dashboard')
})

test('hashForState: tabs without detail routes ignore an id', () => {
  assert.equal(hashForState({ tab: 'cables', id: 'x' }), '#/cables')
  assert.equal(hashForState({ tab: 'load', id: 'x' }), '#/load')
})

test('parseHash: empty and default', () => {
  assert.deepEqual(parseHash(''), { tab: 'dashboard', id: null })
  assert.deepEqual(parseHash('#/'), { tab: 'dashboard', id: null })
  assert.deepEqual(parseHash(undefined), { tab: 'dashboard', id: null })
  assert.deepEqual(parseHash('#/dashboard'), { tab: 'dashboard', id: null })
  assert.deepEqual(parseHash('#/dashboard/x'), { tab: 'dashboard', id: null })
})

test('parseHash: unknown tab falls back to the default', () => {
  assert.deepEqual(parseHash('#/nonsense'), { tab: 'dashboard', id: null })
  assert.deepEqual(parseHash('#/nonsense/abc'), { tab: 'dashboard', id: null })
})

test('parseHash: ids, decoding and malformed input', () => {
  assert.deepEqual(parseHash('#/devices/d1'), { tab: 'devices', id: 'd1' })
  assert.deepEqual(parseHash('#/circuits/c%201%2Fx'), { tab: 'circuits', id: 'c 1/x' })
  assert.deepEqual(parseHash('#/devices/%E0%A4%A'), { tab: 'devices', id: null })
  assert.deepEqual(parseHash('#/devices/'), { tab: 'devices', id: null })
  assert.deepEqual(parseHash('#/cables/x'), { tab: 'cables', id: null })
  assert.deepEqual(parseHash('#/zones'), { tab: 'zones', id: null })
  assert.deepEqual(parseHash('#/batteries'), { tab: 'batteries', id: null })
  assert.deepEqual(parseHash('#/batteries/x'), { tab: 'batteries', id: null })
  assert.equal(hashForState({ tab: 'batteries', id: null }), '#/batteries')
})

test('round trip', () => {
  for (const tab of TABS) {
    for (const id of [null, 'abc', 'a b/c?d#e']) {
      const parsed = parseHash(hashForState({ tab, id }))
      assert.equal(parsed.tab, tab)
      const hasId = id && ['circuits', 'devices', 'conduits', 'buses', 'schematics', 'floorplan'].includes(tab)
      assert.equal(parsed.id, hasId ? id : null)
    }
  }
})

test('changes tab: routes with no id', () => {
  assert.ok(TABS.includes('changes'))
  assert.equal(hashForState({ tab: 'changes', id: 'x' }), '#/changes')
  assert.deepEqual(parseHash('#/changes'), { tab: 'changes', id: null })
  assert.deepEqual(parseHash('#/changes/x'), { tab: 'changes', id: null })
})
