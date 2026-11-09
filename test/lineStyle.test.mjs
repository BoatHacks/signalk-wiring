import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../public/schematic.js'

const cable = (...types) => ({ conductors: types.map((conductor) => ({ conductor })) })

test('wireLineStyle: DC solid, AC long dash, signal and earth only plain', () => {
  assert.deepEqual(S.wireLineStyle(cable('positive', 'negative')), { current: 'dc', dasharray: null })
  assert.deepEqual(S.wireLineStyle({}), { current: 'dc', dasharray: null })
  assert.deepEqual(S.wireLineStyle(cable('line', 'neutral', 'earth')), { current: 'ac', dasharray: '10 6' })
  assert.deepEqual(S.wireLineStyle(cable('signal')), { current: null, dasharray: null })
  assert.deepEqual(S.wireLineStyle(cable('earth')), { current: null, dasharray: null })
})

test('scaledDash scales the pattern and passes null through', () => {
  assert.equal(S.scaledDash('10 6', 0.5), '5 3')
  assert.equal(S.scaledDash(null, 2), null)
})

test('offsetPath: moves a polyline sideways with mitred corners', () => {
  assert.deepEqual(S.offsetPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 4), [{ x: 0, y: 4 }, { x: 10, y: 4 }])
  const bent = S.offsetPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 4)
  assert.deepEqual(bent.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
    [{ x: 0, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 10 }])
  assert.deepEqual(S.offsetPath([{ x: 1, y: 1 }], 4), [{ x: 1, y: 1 }])
  assert.ok(S.offsetPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }], 2).every((p) => Number.isFinite(p.x + p.y)))
})
