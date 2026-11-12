import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHex, normalizeHex } from '../public/colorTone.js'
import { colorFieldState } from '../public/deviceFields.js'

test('parseHex reads #rrggbb and #rgb in any case, and nothing else', () => {
  assert.deepEqual(parseHex('#1A2b3C'), [26, 43, 60])
  assert.deepEqual(parseHex('#f80'), [255, 136, 0])
  for (const bad of ['', 'red', '#12', '#12345', '#gggggg', '112233', null, undefined]) assert.equal(parseHex(bad), null)
})

test('normalizeHex gives lower case #rrggbb or null', () => {
  assert.equal(normalizeHex(' #ABC '), '#aabbcc')
  assert.equal(normalizeHex('#112233'), '#112233')
  assert.equal(normalizeHex('nope'), null)
})

test('colorFieldState: empty is the theme color, a good hex is saved normalized, a bad one is not', () => {
  assert.deepEqual(colorFieldState(''), { valid: true, value: null, picker: '#000000', message: null })
  assert.equal(colorFieldState('#F80').value, '#ff8800')
  assert.equal(colorFieldState('#F80').picker, '#ff8800')
  const bad = colorFieldState('#12')
  assert.equal(bad.valid, false)
  assert.equal(bad.value, null)
  assert.match(bad.message, /hex color/)
})

import { boxFill, nightTone, boxColors, NIGHT_MAX_RED, DAY_SURFACE } from '../public/colorTone.js'

test('boxFill mixes 18 percent of the color into the surface', () => {
  assert.equal(boxFill('#000000', '#ffffff'), '#d1d1d1')
  assert.equal(boxFill('#ffffff', '#000000'), '#2e2e2e')
  assert.equal(boxFill('#336699', '#336699'), '#336699')
  assert.equal(boxFill('nope', '#ffffff'), null)
  assert.equal(boxFill('#ff0000'), boxFill('#ff0000', DAY_SURFACE))
})

test('nightTone: gray gives a dim red, never brighter than the cap, brighter in gives brighter out', () => {
  const gray = parseHex(nightTone('#808080'))
  assert.ok(gray[0] > gray[1] * 2 && gray[0] > gray[2] * 2, 'red dominates')
  assert.ok(gray[0] < 150)
  for (const hex of ['#ffffff', '#ffff00', '#00ffff', '#ff0000', '#000000', '#2a7fff']) {
    const rgb = parseHex(nightTone(hex))
    assert.ok(Math.max(...rgb) <= NIGHT_MAX_RED, hex)
    assert.ok(rgb[0] >= rgb[1] && rgb[0] >= rgb[2], hex)
  }
  assert.ok(parseHex(nightTone('#ffff00'))[0] > parseHex(nightTone('#0000ff'))[0])
  assert.ok(parseHex(nightTone('#ffffff'))[0] > parseHex(nightTone('#404040'))[0])
  assert.equal(nightTone('bad'), null)
})

test('boxColors gives the four colors, or null for none', () => {
  assert.equal(boxColors(null), null)
  assert.equal(boxColors(''), null)
  const c = boxColors('#2A7FFF')
  assert.equal(c.stroke, '#2a7fff')
  assert.equal(c.fill, boxFill('#2a7fff', DAY_SURFACE))
  assert.equal(c.nightStroke, nightTone('#2a7fff'))
  assert.ok(parseHex(c.nightFill))
})
