'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Store } = require('../src/store')
const { createResourceProvider } = require('../src/resources')
const { resolveSettings } = require('../src/settings')
const query = require('../src/query')
const { buildOpenApi, collectRoutes, getOpenApi, EXCLUDED_OPERATIONS } = require('../src/openapi')
const { META, RESOURCE_TYPES } = require('../src/openapiMeta')
const { version } = require('../package.json')
const createPlugin = require('../index')

const doc = buildOpenApi(version, collectRoutes())
const METHODS = ['get', 'put', 'post', 'delete']

// ---- A small structural checker: just what this document uses -------------

function resolve (root, ref) {
  assert.ok(ref.startsWith('#/'), `only local refs: ${ref}`)
  let node = root
  for (const part of ref.slice(2).split('/')) {
    assert.ok(node && Object.prototype.hasOwnProperty.call(node, part), `$ref does not resolve: ${ref}`)
    node = node[part]
  }
  return node
}

function walk (node, visit, trail = '') {
  visit(node, trail)
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, visit, `${trail}/${i}`))
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, visit, `${trail}/${k}`)
}

// Returns a list of problems of `value` against `schema` (empty when it fits).
function validate (root, schema, value, at = '$') {
  if (schema.$ref) return validate(root, resolve(root, schema.$ref), value, at)
  if (value === null || value === undefined) return schema.nullable || value === undefined ? [] : [`${at}: null is not allowed`]
  const problems = []
  const typeOk = {
    string: typeof value === 'string',
    number: typeof value === 'number' && Number.isFinite(value),
    integer: Number.isInteger(value),
    boolean: typeof value === 'boolean',
    array: Array.isArray(value),
    object: typeof value === 'object' && !Array.isArray(value)
  }
  if (schema.type && !typeOk[schema.type]) return [`${at}: expected ${schema.type}, got ${JSON.stringify(value).slice(0, 40)}`]
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`)
  if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: below ${schema.minimum}`)
  if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at}: above ${schema.maximum}`)
  if (schema.type === 'array') value.forEach((v, i) => problems.push(...validate(root, schema.items, v, `${at}[${i}]`)))
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (!(key in value)) problems.push(`${at}: missing ${key}`)
    const props = schema.properties
    if (props) {
      for (const [k, v] of Object.entries(value)) {
        if (props[k]) problems.push(...validate(root, props[k], v, `${at}.${k}`))
        else if (schema.additionalProperties !== true && !(schema.additionalProperties && typeof schema.additionalProperties === 'object')) problems.push(`${at}: the schema has no field "${k}"`)
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') problems.push(...validate(root, schema.additionalProperties, v, `${at}.${k}`))
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const [k, v] of Object.entries(value)) problems.push(...validate(root, schema.additionalProperties, v, `${at}.${k}`))
    }
  }
  return problems
}

const expectValid = (schemaName, value, label) => {
  const problems = validate(doc, { $ref: `#/components/schemas/${schemaName}` }, JSON.parse(JSON.stringify(value)))
  assert.deepEqual(problems, [], `${label || schemaName}: ${problems.slice(0, 5).join('; ')}`)
}

// ---- Contract ---------------------------------------------------------------

test('every registered route and resource type is documented or on the exclusion list, and every entry names a route', () => {
  const routes = collectRoutes()
  const keys = new Set(routes.map((r) => r.key))
  for (const r of routes) {
    assert.ok(META[r.key] || EXCLUDED_OPERATIONS[r.key], `${r.key} has no description and is not excluded`)
    assert.ok(!(META[r.key] && EXCLUDED_OPERATIONS[r.key]), `${r.key} is both documented and excluded`)
  }
  for (const key of Object.keys(META)) assert.ok(keys.has(key), `description names no route: ${key}`)
  for (const key of Object.keys(EXCLUDED_OPERATIONS)) assert.ok(keys.has(key), `exclusion names no route: ${key}`)
  // The relay switch and the calibration routes stay out of the document.
  assert.ok(EXCLUDED_OPERATIONS['POST /switch'])
  const text = JSON.stringify(doc.paths)
  assert.ok(!/\/switch|\/calibration/.test(text))
  // Every documented operation exists in the document, and nothing else does.
  const documented = routes.filter((r) => META[r.key]).length
  const inDoc = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).filter((m) => METHODS.includes(m)).length, 0)
  assert.equal(inDoc, documented)
})

test('the resource types of the document are the ones the plugin registers', () => {
  const registered = []
  const app = { getDataDirPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-oa-')), registerResourceProvider: (p) => registered.push(p.type) }
  const plugin = createPlugin(app)
  plugin.start({})
  plugin.stop()
  assert.deepEqual(RESOURCE_TYPES.map((t) => t.type).sort(), registered.sort())
  for (const t of RESOURCE_TYPES) assert.ok(doc.paths[`/signalk/v2/api/resources/${t.type}`], t.type)
})

test('the access levels match the routes: GET is read-only, every write is admin', () => {
  for (const route of collectRoutes().filter((r) => !EXCLUDED_OPERATIONS[r.key])) {
    const op = doc.paths[(route.resource ? '' : '/plugins/signalk-wiring') + route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')][route.method.toLowerCase()]
    assert.deepEqual(op.security, [{ [route.method === 'GET' ? 'bearerReadOnly' : 'bearerAdmin']: [] }], route.key)
    assert.equal(op['x-access-level'], route.method === 'GET' ? 'read-only' : 'admin')
    if (route.method !== 'GET') assert.match(op.description, /admin login/, route.key)
  }
})

// ---- Structure ----------------------------------------------------------------

test('the document has the required OpenAPI fields and a plugin version', () => {
  assert.equal(doc.openapi, '3.0.3')
  assert.equal(doc.info.version, version)
  assert.ok(doc.info.title && doc.info.description)
  assert.deepEqual(doc.servers, [{ url: '/' }])
  assert.ok(Object.keys(doc.paths).length > 20)
  for (const p of Object.keys(doc.paths)) assert.ok(p.startsWith('/plugins/signalk-wiring/') || p.startsWith('/signalk/v2/api/resources/'), p)
})

test('every $ref resolves, every operation has a summary, responses and a security entry, operation ids are unique', () => {
  const ids = new Set()
  walk(doc, (node) => { if (node && node.$ref) resolve(doc, node.$ref) })
  for (const [p, item] of Object.entries(doc.paths)) {
    const declared = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    for (const [method, op] of Object.entries(item)) {
      const at = `${method.toUpperCase()} ${p}`
      assert.ok(METHODS.includes(method), at)
      assert.ok(op.summary && op.description, `${at}: summary and description`)
      assert.ok(op.responses && Object.keys(op.responses).length > 0, `${at}: responses`)
      assert.ok(Object.keys(op.responses).some((c) => /^2/.test(c)), `${at}: a success response`)
      assert.ok(op.responses[401] && op.responses[403], `${at}: 401 and 403`)
      assert.ok(Array.isArray(op.security) && op.security.length > 0, `${at}: security`)
      for (const req of op.security) for (const name of Object.keys(req)) assert.ok(doc.components.securitySchemes[name], `${at}: scheme ${name}`)
      assert.ok(op.operationId && !ids.has(op.operationId), `${at}: unique operationId ${op.operationId}`)
      ids.add(op.operationId)
      const params = op.parameters || []
      assert.deepEqual(params.filter((x) => x.in === 'path').map((x) => x.name).sort(), declared.sort(), `${at}: path parameters`)
      for (const prm of params) assert.ok(prm.description && prm.schema, `${at}: parameter ${prm.name}`)
      for (const x of params.filter((q) => q.in === 'path')) assert.equal(x.required, true)
      if (method === 'get') assert.equal(op.requestBody, undefined, `${at}: GET has no body`)
      assert.ok(op.tags.every((t) => doc.tags.some((x) => x.name === t)), `${at}: tag`)
    }
  }
})

test('the document is JSON, of sensible size, and uses no dashes the style forbids', () => {
  const text = JSON.stringify(doc)
  assert.deepEqual(JSON.parse(text), doc)
  assert.ok(text.length < 400 * 1024, `${text.length} bytes`)
  assert.ok(!/[\u2013\u2014]/.test(text))
  assert.equal(JSON.stringify(getOpenApi(version)), text)
})

test('every example in the document fits its schema', () => {
  let checked = 0
  const check = (content, at) => {
    for (const media of Object.values(content || {})) {
      if (media.example !== undefined && media.schema) {
        assert.deepEqual(validate(doc, media.schema, media.example), [], at)
        checked++
      }
    }
  }
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      check(op.requestBody && op.requestBody.content, `${method} ${p} request`)
      for (const [code, r] of Object.entries(op.responses)) check(r.content, `${method} ${p} ${code}`)
    }
  }
  assert.ok(checked > 20, `${checked} examples`)
})

// ---- Records from a built store -------------------------------------------------

async function demoStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-demo-'))
  const copy = path.join(dir, 'wiring.db')
  fs.copyFileSync(path.join(__dirname, '..', 'demo', 'wiring.db'), copy)
  return { store: new Store(copy), dir }
}

test('every record of the demo database fits its schema', async () => {
  const { store, dir } = await demoStore()
  const kinds = { wiringDevices: 'device', wiringWireRuns: 'wireRun', wiringCircuits: 'circuit', wiringConduits: 'conduit', wiringZones: 'zone', wiringPlans: 'plan', wiringSchematics: 'schematic' }
  for (const t of RESOURCE_TYPES.filter((x) => kinds[x.type])) {
    const provider = createResourceProvider(store, kinds[t.type], t.type)
    const all = Object.values(await provider.methods.listResources())
    assert.ok(all.length > 0, t.type)
    for (const record of all) expectValid(t.schema, record, `${t.type} ${record.id}`)
    // The one-record read has the same shape as the list entry.
    expectValid(t.schema, await provider.methods.getResource(all[0].id), `${t.type} get`)
  }
  expectValid('Settings', resolveSettings({}))
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('derived data, the change log, attachments and the query answers fit their schemas, on the demo and a small boat', async () => {
  const { store, dir } = await demoStore()
  const dev = store.list('device').find((d) => d.role === 'consumer')
  const att = store.createAttachment({ owner_type: 'device', owner_id: dev.id, filename: 'a.jpg', mime_type: 'image/jpeg', uploaded_at: new Date().toISOString() })
  const { rowToResource } = require('../src/resources')
  expectValid('Attachment', rowToResource(att))
  const { banks, warnings } = store.deriveAll()
  expectValid('Derived', { banks, warnings })
  const { buildCircuitDiagram } = require('../src/routes')
  expectValid('CircuitDiagram', buildCircuitDiagram(store, store.list('circuit')[0].id))
  const groups = store.changeGroups({ limit: 20, entries: 5 })
  const toEntry = (row) => { const r = rowToResource(row); r.diff = JSON.parse(r.diffJson); delete r.diffJson; return r }
  expectValid('ChangeLogPage', { groups: groups.groups.map((g) => ({ ...g, entries: g.entries.map(toEntry) })), nextCursor: groups.nextCursor })
  expectValid('Switching', store.deriveSwitching())

  for (const source of [store]) {
    const resources = await query.loadResources(source)
    resources.limits = { critical: 3, normal: 10 }
    expectValid('SearchResponse', query.search(resources, { q: 'pump' }))
    expectValid('SearchResponse', query.search(resources, { role: 'storage' }))
    for (const d of resources.devices.slice(0, 40)) expectValid('TraceResponse', query.trace(resources, d.id, 'both'))
    expectValid('LoadSummaryResponse', await query.loadSummary(source, resources))
    expectValid('ChecksResponse', await query.cableChecks(resources))
  }
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })

  const small = new Store(':memory:')
  const a = small.create('device', { name: 'Battery', role: 'storage' })
  const b = small.create('device', { name: 'Light', role: 'consumer', rated_power_w: 10 })
  small.create('wireRun', { from_device_id: a.id, to_device_id: b.id })
  const resources = await query.loadResources(small)
  resources.limits = { critical: 3, normal: 10 }
  expectValid('LoadSummaryResponse', await query.loadSummary(small, resources))
  expectValid('ChecksResponse', await query.cableChecks(resources))
  expectValid('TraceResponse', query.trace(resources, b.id))
  small.close()
})

// ---- The plugin hands the document to the server ----------------------------------

test('starting the plugin as the server does registers the document with setPluginOpenApi', () => {
  const published = {}
  const app = {
    getDataDirPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'sk-wiring-oa-')),
    registerResourceProvider: () => {},
    setPluginOpenApi: (id, openApi) => { published[id] = openApi }
  }
  const plugin = createPlugin(app)
  assert.equal(typeof plugin.getOpenApi, 'function')
  // What the server does for a plugin that has registerWithRouter.
  const registrar = () => { const r = {}; for (const m of METHODS) r[m] = () => r; return r }
  plugin.registerWithRouter({ ...registrar(), access: registrar })
  app.setPluginOpenApi(plugin.id, plugin.getOpenApi())
  plugin.start({})
  assert.equal(plugin.id, 'signalk-wiring')
  const served = published['signalk-wiring']
  assert.equal(served.openapi, '3.0.3')
  assert.equal(served.info.version, version)
  assert.deepEqual(served.servers, [{ url: '/' }])
  plugin.stop()
})
