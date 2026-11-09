import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { portMark, MARK_PATHS } from '../public/portMark.js'

test('portMark: the symbol follows the conductor', () => {
  assert.equal(portMark('positive'), 'dc')
  assert.equal(portMark('negative'), 'dc')
  assert.equal(portMark('line'), 'ac')
  assert.equal(portMark('neutral'), 'ac')
  assert.equal(portMark('signal'), 'signal')
  assert.equal(portMark('earth'), 'ground')
})

test('portMark: the device current fills in an unknown conductor', () => {
  assert.equal(portMark('', 'ac'), 'ac')
  assert.equal(portMark(undefined, 'dc'), 'dc')
  assert.equal(portMark('mystery', ''), null)
  assert.equal(portMark('positive', 'ac'), 'dc')
})

test('every mark kind has a path', () => {
  for (const k of ['dc', 'ac', 'signal', 'ground']) assert.match(MARK_PATHS[k], /^M/)
})

test('the wire drawing has no markers', () => {
  const view = readFileSync(new URL('../public/schematicView.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  assert.ok(!/WireMarker|sch-wire-marker|data-marker|style\.marker/.test(view))
  assert.ok(!/sch-marker-|sch-wire-marker/.test(css))
  const wireShape = view.slice(view.indexOf('function WireShape'), view.indexOf('function ConduitBand'))
  assert.ok(!/marker|pathMidpoint/i.test(wireShape))
  const stubShape = view.slice(view.indexOf('function StubShape'), view.indexOf('function TabMenu'))
  assert.ok(!/marker|pathMidpoint/i.test(stubShape))
})
