import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setFloorplanShown, floorplanShown } from '../public/floorplanSwitch.js'
import { DEFAULT_SETTINGS } from '../public/settings.js'

test('the Floorplan tab is shown by default and only an explicit false hides it', () => {
  assert.equal(DEFAULT_SETTINGS.showFloorplan, true)
  setFloorplanShown(undefined)
  assert.equal(floorplanShown(), true)
  setFloorplanShown(false)
  assert.equal(floorplanShown(), false)
  setFloorplanShown(true)
  assert.equal(floorplanShown(), true)
  setFloorplanShown('no')
  assert.equal(floorplanShown(), true)
})
