import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cablesEndingOn, blockedText, purgeConfirmText, purgeFacts, purgeRecord } from '../public/purge.js'

test('cablesEndingOn finds cable ends and conductor landings, live or removed', () => {
  const cables = [
    { id: 'a', fromDeviceId: 'x', toDeviceId: 'y' },
    { id: 'b', fromDeviceId: 'y', toDeviceId: 'x', status: 'removed' },
    { id: 'c', fromDeviceId: 'p', toDeviceId: 'q', conductors: [{ fromDeviceId: 'x' }] },
    { id: 'd', fromDeviceId: 'p', toDeviceId: 'q', conductors: [{ fromDeviceId: 'p' }] }
  ]
  assert.deepEqual(cablesEndingOn('x', cables).map((c) => c.id), ['a', 'b', 'c'])
  assert.deepEqual(cablesEndingOn('zzz', cables), [])
})

test('the confirmation says what goes and the block names the cables', () => {
  assert.match(purgeConfirmText('device', 'Lamp', { history: 3, attachments: 1 }), /3 history entries and 1 attachment are erased/)
  assert.match(purgeConfirmText('device', 'Lamp', { history: 1, attachments: 2 }), /1 history entry and 2 attachments/)
  assert.match(purgeConfirmText('conduit', 'Hose', { history: 2, attachments: 0 }), /cables stay/)
  const page = purgeConfirmText('schematic', 'Page', { history: 4 })
  assert.match(page, /4 history entries are erased/)
  assert.ok(!/attachment/.test(page))
  assert.match(blockedText('Lamp', ['feed', 'Fuse to Lamp']), /Delete these cables first: feed; Fuse to Lamp\./)
})

test('purgeFacts counts the lists and tolerates failures', async () => {
  const seen = []
  const fetchFn = async (url) => {
    seen.push(url)
    return url.includes('changelog') ? { ok: true, json: async () => [1, 2, 3] } : { ok: false }
  }
  assert.deepEqual(await purgeFacts('device', 'd 1', fetchFn), { history: 3, attachments: 0 })
  assert.ok(seen[0].endsWith('/changelog/device/d%201'))
  assert.ok(seen[1].includes('ownerType=device&ownerId=d%201'))
  assert.equal(seen.length, 2)
  await purgeFacts('schematic', 's', fetchFn)
  assert.equal(seen.length, 3)
})

test('purgeRecord resolves to null on success and to a message otherwise', async () => {
  let call
  const ok = async (url, opts) => { call = [url, opts.method]; return { ok: true } }
  assert.equal(await purgeRecord('conduit', 'k1', 'Hose', ok), null)
  assert.deepEqual(call, ['/plugins/signalk-wiring/conduits/k1/purge', 'DELETE'])
  const conflict = async () => ({ ok: false, status: 409, json: async () => ({ error: 'Delete these cables first: a' }) })
  assert.match(await purgeRecord('device', 'd', 'Lamp', conflict), /Delete these cables first: a/)
  const noAuth = async () => ({ ok: false, status: 401 })
  assert.match(await purgeRecord('schematic', 's', 'Page', noAuth), /logged into the SignalK admin UI/)
  const down = async () => { throw new Error('offline') }
  assert.match(await purgeRecord('device', 'd', 'Lamp', down), /offline/)
})
