import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8')
const app = read('app.js')
const schematic = read('schematicView.js')

// Plan 0032: every place that names a device draws the shared component.
test('device names go through the shared icon components', () => {
  // Devices list rows and the device page title
  assert.match(app, /<\$\{DeviceIcon\} device=\$\{device\} size=\$\{18\}/)
  assert.match(app, /<\$\{DeviceLabel\} device=\$\{device\} size=\$\{28\}/)
  // Pickers
  assert.match(app, /<\$\{DeviceIcon\} bare=\$\{value \? \{ type: value, role \} : null\}/)
  assert.match(app, /<\$\{DeviceIcon\} device=\$\{!adding && value \? known\.get\(value\)/)
  // Palette
  assert.match(schematic, /<\$\{DeviceIcon\} bare=\$\{item\} size=\$\{20\}/)
  // Circuit diagram nodes
  assert.match(app, /<\$\{DeviceIconSvg\} choice=\$\{n\.icon\}/)
  // Circuits list, circuit detail and cables tables go through DeviceLink, which uses DeviceLabel
  assert.match(app, /function DeviceLink[\s\S]{0,400}<\$\{DeviceLabel\}/)
  assert.match(app, /const labels = \(ids\) => ids\.map/)
})

test('every DeviceLink in a table or circuit page is given the device map', () => {
  const links = app.match(/<\$\{DeviceLink\} [^>]*\/>/g) || []
  const withoutDevices = links.filter((l) => !/devices=/.test(l))
  // Only the device-page lists (inside, monitor, contents) have no map to hand
  for (const l of withoutDevices) assert.match(l, /names=\$\{(deviceNames|names)\}/, l)
  assert.ok(links.length - withoutDevices.length >= 7)
})

test('the load summary table names no devices, only circuits and a device count', () => {
  const load = read('loadSummary.js')
  assert.doesNotMatch(load, /DeviceLink|deviceById\.get\([^)]*\)\.name/)
})

test('no old per-place image markup is left', () => {
  assert.doesNotMatch(app, /device-icon device-icon-large/)
  assert.doesNotMatch(app, /deviceIconById/)
})
