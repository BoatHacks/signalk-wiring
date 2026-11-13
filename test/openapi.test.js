'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const createPlugin = require('../index')
const { getOpenApi } = require('../src/openapi')
const { registerRoutes, CHANGE_LOG_KINDS } = require('../src/routes')
const { registerLiveRoutes } = require('../src/liveRoutes')
const { DEFAULT_TIMINGS } = require('../src/calibration')
const { version } = require('../package.json')

const binaryRoutes = new Set([
  'post /attachments',
  'get /attachments/{id}',
  'post /plans/{id}/image',
  'get /plans/{id}/image',
  'get /devices/{id}/icon'
])

function registeredRoutes (withAccess) {
  const routes = new Map()
  const makeRouter = (access) => Object.fromEntries(['get', 'post', 'delete'].map((method) => [
    method, (path) => routes.set(method + ' ' + path.replace(/:([A-Za-z]+)/g, '{$1}'), access)
  ]))
  const router = makeRouter('admin')
  if (withAccess) router.access = makeRouter
  const unusedStore = () => { throw new Error('discovery must not access the store') }
  registerRoutes(router, unusedStore, '/unused')
  registerLiveRoutes(router, unusedStore, { app: {} })
  return routes
}

function operations (document) {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({ path, method, operation })))
}

function resolve (document, reference) {
  assert.ok(reference.startsWith('#/components/'), 'only local component references')
  return reference.slice(2).split('/').reduce((value, key) => {
    assert.ok(value && Object.hasOwn(value, key), 'missing reference: ' + reference)
    return value[key]
  }, document)
}

test('native discovery is available before start and returns independent JSON documents', () => {
  const plugin = createPlugin({})
  const document = plugin.getOpenApi()
  assert.equal(document.openapi, '3.0.3')
  assert.equal(document.info.version, version)
  assert.deepEqual(document.servers, [{ url: '/plugins/signalk-wiring' }])
  assert.deepEqual(document.security, [{ bearerAuth: [] }])
  assert.deepEqual(JSON.parse(JSON.stringify(document)), document)
  document.paths['/version'].get.operationId = 'changed'
  document.components.schemas.CalibrationRequest.properties.timings.properties.baselineS.default = -1
  assert.equal(plugin.getOpenApi().paths['/version'].get.operationId, 'getWiringVersion')
  assert.equal(getOpenApi().components.schemas.CalibrationRequest.properties.timings.properties.baselineS.default, DEFAULT_TIMINGS.baselineS)
})

test('the document covers every registered JSON/no-content route and excludes all binary routes', () => {
  const document = getOpenApi()
  const registered = registeredRoutes(true)
  const documented = operations(document)
  assert.equal(documented.length, 22)
  assert.deepEqual(documented.map(({ path, method }) => method + ' ' + path).sort(),
    [...registered.keys()].filter((key) => !binaryRoutes.has(key)).sort())
  const ids = documented.map(({ operation }) => operation.operationId)
  assert.equal(new Set(ids).size, ids.length)
  for (const { path, method, operation } of documented) {
    assert.match(operation.operationId, /^[A-Za-z][A-Za-z0-9]+$/)
    assert.equal(operation['x-signalk-access'], registered.get(method + ' ' + path))
    assert.ok(operation.responses['401'])
    assert.ok(operation.responses['403'])
    assert.equal(Boolean(operation.responses['503']), path !== '/version')
    assert.ok(!path.startsWith('/signalk/'), 'native Resources are a separate API')
  }
})

test('path parameters, local references, media types and legacy access are explicit', () => {
  const document = getOpenApi()
  const legacy = registeredRoutes(false)
  function visit (value) {
    if (!value || typeof value !== 'object') return
    if (value.$ref) resolve(document, value.$ref)
    Object.values(value).forEach(visit)
  }
  visit(document)
  for (const { path, method, operation } of operations(document)) {
    const parameters = operation.parameters || []
    const inPath = parameters.filter((p) => p.in === 'path')
    assert.deepEqual(inPath.map((p) => p.name).sort(),
      [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort())
    assert.ok(inPath.every((p) => p.required))
    assert.equal(legacy.get(method + ' ' + path), 'admin')
    if (operation['x-signalk-access'] !== 'admin') assert.match(operation.description, /older servers require admin/)
    if (operation.requestBody) {
      assert.equal(operation.requestBody.required, true)
      assert.deepEqual(Object.keys(operation.requestBody.content), ['application/json'])
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      if (status === '204') assert.equal(response.content, undefined)
      else if (response.content) assert.deepEqual(Object.keys(response.content), ['application/json'])
    }
  }
})

test('shared runtime kinds and timing defaults keep their documented values', () => {
  const document = getOpenApi()
  const kinds = document.paths['/changelog/{kind}/{id}'].get.parameters.find((p) => p.name === 'kind')
  assert.deepEqual(kinds.schema.enum, [...CHANGE_LOG_KINDS])
  const timings = document.components.schemas.CalibrationRequest.properties.timings
  assert.deepEqual(Object.fromEntries(Object.entries(timings.properties).map(([key, value]) => [key, value.default])), DEFAULT_TIMINGS)
  assert.deepEqual(document.paths['/zones/{id}/merge'].post.parameters.map((p) => [p.name, p.in, p.required]),
    [['id', 'path', true], ['into', 'query', true]])
  assert.equal(document.paths['/calibration/runs'].get.parameters[0].required, false)
})

test('destructive, switching and background calibration effects are visible to clients', () => {
  const document = getOpenApi()
  for (const path of ['/cables/{id}/purge', '/devices/{id}/purge', '/conduits/{id}/purge', '/schematics/{id}/purge']) {
    assert.match(document.paths[path].delete.description, /cannot be undone/)
    assert.ok(document.paths[path].delete.responses['204'])
    assert.ok(document.paths[path].delete.responses['409'])
  }
  const switching = document.paths['/switch'].post
  assert.match(switching.description, /real hardware/)
  assert.match(switching.description, /sharing/)
  assert.match(switching.description, /never-remote/)
  assert.match(switching.description, /confirmed=true/)
  assert.match(switching.description, /do not automatically retry/)
  assert.ok(switching.responses['504'])
  const start = document.paths['/calibration/runs'].post
  assert.match(start.description, /background/)
  assert.match(start.description, /hand=true/)
  assert.match(start.description, /disconnects/)
  assert.match(document.paths['/calibration/cancel'].post.description, /does not undo/)
})
