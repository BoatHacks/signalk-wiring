import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const view = readFileSync(new URL('../public/floorplanView.js', import.meta.url), 'utf8')

test('the route panel of a cable names the two devices it connects, with "?" for a missing end', () => {
  const at = view.indexOf('data-testid="route-panel"')
  assert.ok(at > 0)
  const panel = view.slice(at, at + 1500)
  assert.match(panel, /data-testid="route-ends">Connects: /)
  assert.match(panel, /deviceNameById\.get\(run\.fromDeviceId\)\) \|\| '\?'/)
  assert.match(panel, /deviceNameById\.get\(run\.toDeviceId\)\) \|\| '\?'/)
  // it sits with the cable name, before the measured and recorded lengths
  assert.ok(panel.indexOf('route-ends') < panel.indexOf('Measured route'))
  assert.ok(panel.indexOf('route-ends') < panel.indexOf('Recorded length'))
})
