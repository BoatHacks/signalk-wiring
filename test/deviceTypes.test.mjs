import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TYPE_SUGGESTIONS, typeOptions } from '../public/deviceTypes.js'
import { ROLES } from '../public/roles.js'

test('every role has suggestions, with no duplicates inside a role', () => {
  for (const role of ROLES) {
    const list = TYPE_SUGGESTIONS[role.value]
    assert.ok(list && list.length >= (role.value === 'storage' ? 2 : 5), `${role.value} needs suggestions`)
    const keys = list.map((t) => t.toLowerCase())
    assert.equal(new Set(keys).size, keys.length, `${role.value} has duplicates`)
  }
})

test('suggestions follow the role, and an unknown role falls back to consumer', () => {
  assert.ok(typeOptions('source', [], '').suggested.includes('Solar panel'))
  assert.ok(typeOptions('storage', [], '').suggested.includes('Battery'))
  assert.ok(typeOptions('distribution', [], '').suggested.includes('Fuse'))
  assert.deepEqual(typeOptions('weird', [], '').suggested, TYPE_SUGGESTIONS.consumer)
  assert.deepEqual(typeOptions(undefined, [], '').suggested, TYPE_SUGGESTIONS.consumer)
})

test('types already used on devices are offered, once, ignoring case and blanks', () => {
  const used = ['Bilge pump', 'bilge pump', '  ', null, undefined, 'Anchor windlass', 'Sonar']
  const { suggested, used: extra } = typeOptions('consumer', used, '')
  assert.ok(!extra.some((t) => suggested.map((s) => s.toLowerCase()).includes(t.toLowerCase())))
  assert.ok(extra.includes('Sonar'))
  assert.equal(extra.filter((t) => t.toLowerCase() === 'bilge pump').length <= 1, true)
  assert.deepEqual([...extra].sort(), extra) // sorted
})

test('the current value stays selectable even when it is in neither list', () => {
  const { used } = typeOptions('consumer', [], 'Home-made gizmo')
  assert.deepEqual(used, ['Home-made gizmo'])
  // ...but is not repeated when it is already a suggestion, whatever the case.
  const again = typeOptions('consumer', [], 'solar PANEL'.replace('solar PANEL', TYPE_SUGGESTIONS.consumer[0].toUpperCase()))
  assert.deepEqual(again.used, [])
})

test('the current presets match the server table', async () => {
  const { createRequire } = await import('node:module')
  const server = createRequire(import.meta.url)('../src/current.js')
  const web = await import('../public/deviceTypes.js')
  assert.deepEqual(web.AC_TYPES, server.AC_TYPES)
  assert.deepEqual(web.DC_TYPES, server.DC_TYPES)
  assert.equal(web.typeCurrent(' generator '), 'ac')
  assert.equal(web.typeCurrent('AGM battery'), 'dc')
  assert.equal(web.typeCurrent('Inverter'), null)
  assert.equal(web.typeCurrent(undefined), null)
})

test('the battery table and helpers match the server copy', async () => {
  const { createRequire } = await import('node:module')
  const server = createRequire(import.meta.url)('../src/batteries.js')
  const web = await import('../public/batteries.js')
  for (const key of ['CHEMISTRIES', 'PURPOSES', 'LINKS', 'CHEMISTRY_LABELS', 'PURPOSE_LABELS', 'CHEMISTRY_DEFAULTS', 'TYPE_CHEMISTRY', 'TYPE_PURPOSE']) {
    assert.deepEqual(web[key], server[key], key)
  }
  assert.equal(web.PURPOSE_LABELS.motor, 'Motor (propulsion)')
  assert.equal(web.CHEMISTRY_LABELS.lithium, 'Other lithium')
  for (const t of ['Lead-acid battery', 'agm battery', 'Battery']) assert.equal(web.typeChemistry(t), server.typeChemistry(t))
  for (const t of ['Starter battery', 'house battery', 'Battery']) assert.equal(web.typePurpose(t), server.typePurpose(t))
  for (const c of [...server.CHEMISTRIES, null]) assert.deepEqual(web.chemistryDefaults(c), server.chemistryDefaults(c))
})
