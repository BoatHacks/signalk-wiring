import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_CONDUCTOR_COLORS } from '../public/cableForm.js'

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')

function theme (selector) {
  const start = css.indexOf(selector + ' {')
  const block = css.slice(start, css.indexOf('}', start))
  const out = {}
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) out[m[1]] = m[2].length === 4 ? '#' + [...m[2].slice(1)].map((c) => c + c).join('') : m[2]
  return out
}
const day = theme(':root')
const night = theme('[data-theme="dark"]')

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
function hue (h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b); const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (x * 60 + 360) % 360
}
const gap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d) }

for (const [name, t] of [['day', day], ['night', night]]) {
  test(`signal colour (${name}): amber or orange, clear of the other wire colours`, () => {
    const s = t['wire-signal']
    assert.ok(s, 'token exists')
    const h = hue(s)
    assert.ok(h >= 20 && h <= 50, `hue ${h} is amber or orange`)
    for (const k of ['wire-neutral', 'wire-earth', 'wire-positive']) assert.ok(gap(s, t[k]) >= 12, `${k} is a different hue`)
    assert.ok(contrast(s, t.surface) >= 3, 'line contrast on the surface')
    assert.ok(contrast(s, t['on-dot-light']) >= 4.5, 'symbol contrast on the dot')
  })
}

test('no default conductor colour for a signal wire clashes with the signal colour', () => {
  assert.equal(DEFAULT_CONDUCTOR_COLORS.signal, undefined)
  assert.ok(!Object.values(DEFAULT_CONDUCTOR_COLORS).some((c) => /orange|amber|yellow/i.test(c.replace('green/yellow', ''))))
})
