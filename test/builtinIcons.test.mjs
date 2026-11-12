import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SIMPLE_ICONS, iconFor, simpleIconSvg } from '../public/builtinIcons.js'
import { TYPE_SUGGESTIONS } from '../public/deviceTypes.js'
import { ROLES } from '../public/roles.js'

const boat = JSON.parse(readFileSync(new URL('./fixtures/icon-devices.json', import.meta.url), 'utf8'))

test('every suggested type of every role gets its own simple icon, never the generic one', () => {
  for (const [role, types] of Object.entries(TYPE_SUGGESTIONS)) {
    for (const type of types) {
      const { simple } = iconFor({ type, role })
      assert.ok(SIMPLE_ICONS[simple], `${type}: no icon for ${simple}`)
      assert.notEqual(simple, 'generic', `${type} fell back to generic`)
      if (role !== 'enclosure') assert.notEqual(simple, role, `${type} fell back to the role icon`)
    }
  }
})

test('role fallbacks and the generic icon exist', () => {
  for (const { value } of ROLES) {
    assert.deepEqual(iconFor({ type: 'Something unheard of', role: value }), { simple: value, detailed: null })
  }
  assert.equal(iconFor({}).simple, 'generic')
  assert.equal(iconFor(null).simple, 'generic')
  assert.equal(iconFor({ type: '', role: 'bogus' }).simple, 'generic')
})

test('every boat device gets a simple icon that exists and, where drawn, a detailed key', () => {
  for (const d of boat.devices) {
    const { simple, detailed } = iconFor(d)
    assert.ok(SIMPLE_ICONS[simple], `${d.name}: no simple icon ${simple}`)
    assert.notEqual(simple, 'generic', `${d.name} has only the generic icon`)
    assert.equal(detailed, null, `${d.name}: no detailed set yet`)
  }
})

test('simple icon markup is a 24 by 24 currentColor svg', () => {
  const svg = simpleIconSvg('battery', 18)
  assert.match(svg, /viewBox="0 0 24 24"/)
  assert.match(svg, /stroke="currentColor"/)
  assert.match(svg, /width="18"/)
  assert.equal(simpleIconSvg('nope'), simpleIconSvg('generic'))
  for (const [key, inner] of Object.entries(SIMPLE_ICONS)) {
    assert.ok(!/<(script|image|use)\b|href|data:|<style/i.test(inner), key)
    assert.ok(!/[\u2013\u2014]/.test(inner), key)
  }
})
