import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canBeIcon, deviceIconUrl, attachmentKind } from '../public/deviceIcons.js'

test('only browser-drawable images can be icons', () => {
  assert.equal(canBeIcon('image/png'), true)
  assert.equal(canBeIcon('image/jpeg'), true)
  assert.equal(canBeIcon('image/webp'), true)
  assert.equal(canBeIcon('image/heic'), false)
  assert.equal(canBeIcon('application/pdf'), false)
})

test('deviceIconUrl is null without an icon and changes with the icon image', () => {
  assert.equal(deviceIconUrl({ id: 'd1' }), null)
  assert.equal(deviceIconUrl(null), null)
  assert.equal(deviceIconUrl({ id: 'd1', iconAttachmentId: 'a1' }), '/plugins/signalk-wiring/devices/d1/icon?v=a1')
  assert.notEqual(
    deviceIconUrl({ id: 'd1', iconAttachmentId: 'a1' }),
    deviceIconUrl({ id: 'd1', iconAttachmentId: 'a2' })
  )
})

test('attachmentKind labels PDFs, images and other files', () => {
  assert.equal(attachmentKind('application/pdf'), 'PDF')
  assert.equal(attachmentKind('image/heic'), 'Image')
  assert.equal(attachmentKind('text/plain'), 'File')
  assert.equal(attachmentKind(undefined), 'File')
})
