import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../public/schematic.js'
import { purgeCable, purgeFailureMessage, offerCableUndo } from '../public/canvasRemoval.js'

const idle = { typing: false, drag: false, popover: false, tabMenu: false, moreForm: false, selection: null }

test('keyCommand: Escape cancels in order drag, popover, tab menu, selection', () => {
  const sel = { type: 'wire', id: 'w' }
  assert.deepEqual(S.keyCommand('Escape', { ...idle, drag: true, popover: true, selection: sel }), { kind: 'cancel-drag' })
  assert.deepEqual(S.keyCommand('Escape', { ...idle, popover: true, tabMenu: true, selection: sel }), { kind: 'close-popover' })
  assert.deepEqual(S.keyCommand('Escape', { ...idle, tabMenu: true, selection: sel }), { kind: 'close-tabmenu' })
  assert.deepEqual(S.keyCommand('Escape', { ...idle, selection: sel }), { kind: 'clear-selection' })
  assert.equal(S.keyCommand('Escape', idle), null)
})

test('keyCommand: Delete and Backspace remove the selected wire or take the device off the page', () => {
  for (const key of ['Delete', 'Backspace']) {
    assert.deepEqual(S.keyCommand(key, { ...idle, selection: { type: 'wire', id: 'w1' } }), { kind: 'delete-wire', id: 'w1' })
    assert.deepEqual(S.keyCommand(key, { ...idle, selection: { type: 'device', id: 'd1' } }), { kind: 'remove-device', id: 'd1' })
    assert.equal(S.keyCommand(key, idle), null)
    assert.equal(S.keyCommand(key, { ...idle, drag: true, selection: { type: 'wire', id: 'w1' } }), null)
  }
})

test('keyCommand: ignored while typing or while the cable form is open', () => {
  const selection = { type: 'wire', id: 'w1' }
  assert.equal(S.keyCommand('Delete', { ...idle, typing: true, selection }), null)
  assert.equal(S.keyCommand('Escape', { ...idle, typing: true, selection }), null)
  assert.equal(S.keyCommand('Delete', { ...idle, moreForm: true, selection }), null)
  assert.equal(S.keyCommand('a', { ...idle, selection }), null)
})

test('isTypingTarget: inputs, selects, textareas and editable content', () => {
  assert.equal(S.isTypingTarget({ tagName: 'INPUT' }), true)
  assert.equal(S.isTypingTarget({ tagName: 'select' }), true)
  assert.equal(S.isTypingTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(S.isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(S.isTypingTarget({ tagName: 'BUTTON' }), false)
  assert.equal(S.isTypingTarget(null), false)
})

test('withDevicePlaced: puts a device back at its old index without duplicating', () => {
  const list = [{ deviceId: 'a', x: 0, y: 0 }, { deviceId: 'c', x: 2, y: 2 }]
  const out = S.withDevicePlaced(list, { deviceId: 'b', x: 1, y: 1 }, 1)
  assert.deepEqual(out.map((d) => d.deviceId), ['a', 'b', 'c'])
  const again = S.withDevicePlaced(out, { deviceId: 'b', x: 9, y: 9 }, 99)
  assert.deepEqual(again.map((d) => d.deviceId), ['a', 'c', 'b'])
  assert.equal(again[2].x, 9)
})

test('withWireBends: replaces the bend points of one wire', () => {
  const out = S.withWireBends([{ wireRunId: 'w1', points: [{ x: 1, y: 1 }] }, { wireRunId: 'w2', points: [] }], 'w1', [{ x: 5, y: 5 }])
  assert.deepEqual(out.find((w) => w.wireRunId === 'w1').points, [{ x: 5, y: 5 }])
  assert.equal(out.length, 2)
})

test('purgeCable: null on success, a message on 401, other errors and network failure', async () => {
  const calls = []
  const fake = (status) => async (url, opts) => { calls.push([url, opts.method]); return { ok: status < 300, status } }
  assert.equal(await purgeCable('c 1', 'A to B', fake(204)), null)
  assert.deepEqual(calls[0], ['/plugins/signalk-wiring/cables/c%201/purge', 'DELETE'])
  assert.match(await purgeCable('c1', 'A to B', fake(401)), /logged into the SignalK admin UI/)
  assert.match(await purgeCable('c1', 'A to B', fake(409)), /responded 409/)
  assert.match(await purgeCable('c1', 'A to B', async () => { throw new Error('offline') }), /offline/)
  assert.match(purgeFailureMessage(401, 'X'), /stays removed/)
})

test('offerCableUndo: onExpire purges and reports a failure through notice; onUndo is the restore', async () => {
  let offer
  const undo = { offer: (o) => { offer = o } }
  const notices = []
  let restored = false
  offerCableUndo({
    undo, cable: { id: 'c1' }, title: 'A to B', timeout: 50,
    restore: async () => { restored = true },
    notice: (m) => { notices.push(m); return true },
    fetchFn: async () => ({ ok: false, status: 401 })
  })
  assert.equal(offer.message, 'Cable "A to B" removed.')
  assert.equal(offer.timeout, 50)
  await offer.onUndo()
  assert.equal(restored, true)
  await offer.onExpire()
  assert.equal(notices.length, 1)
  assert.match(notices[0], /permanently/)
})
