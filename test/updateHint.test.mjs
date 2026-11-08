import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stampOfUrl, runningVersion, shouldShowHint, reloadUrl } from '../public/updateHint.js'

test('stampOfUrl reads the version from the module address', () => {
  assert.equal(stampOfUrl('https://boat.local/plugins/signalk-wiring/updateHint.js?v=0.5.2'), '0.5.2')
  assert.equal(stampOfUrl('https://boat.local/plugins/signalk-wiring/updateHint.js'), null)
  assert.equal(stampOfUrl('not a url'), null)
})

test('the running version is the stamp, else the first answer of the version route', () => {
  assert.equal(runningVersion('0.5.1', '0.5.2'), '0.5.1')
  assert.equal(runningVersion(null, '0.5.2'), '0.5.2')
  assert.equal(runningVersion(null, null), null)
})

test('the hint shows for a different version and stays away once dismissed', () => {
  assert.equal(shouldShowHint('0.5.1', '0.5.1', null), false)
  assert.equal(shouldShowHint('0.5.1', '0.5.2', null), true)
  assert.equal(shouldShowHint('0.5.1', '0.5.2', '0.5.2'), false)
  assert.equal(shouldShowHint('0.5.1', '0.5.3', '0.5.2'), true, 'a newer change shows it again')
  assert.equal(shouldShowHint(null, '0.5.2', null), false)
  assert.equal(shouldShowHint('0.5.1', null, null), false)
})

test('the reload goes to a fresh address and keeps the route', () => {
  assert.equal(reloadUrl({ pathname: '/wiring/', search: '', hash: '#/devices/d1' }, '0.5.2'), '/wiring/?v=0.5.2#/devices/d1')
  assert.equal(reloadUrl({ pathname: '/wiring/', search: '?v=0.5.1&x=1', hash: '' }, '0.5.2'), '/wiring/?v=0.5.2&x=1')
})
