import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KIND_SUGGESTIONS, kindOptions, cableName, conduitSummary, addableCables, conduitsOfRun,
  moveInList, filterConduits
} from '../public/conduits.js'

test('suggested kinds cover conduit, hose, loom, trunking and cable tray', () => {
  for (const k of ['Conduit', 'Hose', 'Loom', 'Trunking', 'Cable tray']) assert.ok(KIND_SUGGESTIONS.includes(k), k)
})

test('kindOptions lists used kinds after the suggestions, without case repeats, keeping the current one', () => {
  const { suggested, used } = kindOptions(['hose', 'Flexi tube', 'flexi TUBE', '', null], 'Old pipe')
  assert.deepEqual(suggested, KIND_SUGGESTIONS)
  assert.deepEqual(used, ['Flexi tube', 'Old pipe'])
})

test('cableName prefers the label, then names the ends, resolving device ids', () => {
  const names = new Map([['d1', 'Bilge pump']])
  assert.equal(cableName({ cableLabel: 'W12', fromEndpoint: 'a', toEndpoint: 'b' }, names), 'W12')
  assert.equal(cableName({ fromEndpoint: 'Breaker 4', toEndpoint: 'd1' }, names), 'Breaker 4 to Bilge pump')
  assert.equal(cableName({ fromEndpoint: 'Breaker 4' }, names), 'Breaker 4 to ?')
  assert.equal(cableName({ id: 'x' }, names), 'Unnamed cable')
})

test('conduitSummary joins kind and size', () => {
  assert.equal(conduitSummary({ kind: 'Hose', innerDiameter: 25, diameterUnit: 'mm' }), 'Hose, 25 mm inner diameter')
  assert.equal(conduitSummary({ kind: 'Loom' }), 'Loom')
  assert.equal(conduitSummary({ innerDiameter: 1 }), '1 inner diameter')
  assert.equal(conduitSummary({}), 'No kind recorded')
})

test('addableCables leaves out removed cables and ones already in the conduit', () => {
  const runs = [
    { id: 'a', status: 'active' }, { id: 'b', status: 'removed' }, { id: 'c', status: 'active' }
  ]
  assert.deepEqual(addableCables(runs, { cableIds: ['c'] }).map((r) => r.id), ['a'])
})

test('conduitsOfRun follows the cable order and skips unknown ids', () => {
  const conduits = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]
  assert.deepEqual(conduitsOfRun({ conduitIds: ['y', 'gone', 'x'] }, conduits).map((c) => c.id), ['y', 'x'])
  assert.deepEqual(conduitsOfRun({}, conduits), [])
})

test('moveInList moves one item and stays put at the ends', () => {
  assert.deepEqual(moveInList(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(moveInList(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'])
  assert.deepEqual(moveInList(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'])
  assert.deepEqual(moveInList(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'])
  assert.deepEqual(moveInList(['a'], 'zz', 1), ['a'])
})

test('filterConduits combines zone and kind, ignoring kind case', () => {
  const list = [
    { id: '1', kind: 'Hose', zoneId: 'z1' }, { id: '2', kind: 'hose' }, { id: '3', kind: 'Loom', zoneId: 'z1' }
  ]
  assert.deepEqual(filterConduits(list, {}).map((c) => c.id), ['1', '2', '3'])
  assert.deepEqual(filterConduits(list, { kind: 'HOSE' }).map((c) => c.id), ['1', '2'])
  assert.deepEqual(filterConduits(list, { zoneId: 'z1', kind: 'Hose' }).map((c) => c.id), ['1'])
  assert.deepEqual(filterConduits(list, { zoneId: '__none__' }).map((c) => c.id), ['2'])
})
