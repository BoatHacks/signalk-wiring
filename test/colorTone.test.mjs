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
