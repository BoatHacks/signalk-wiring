'use strict'

// The OpenAPI 3.0.3 document of the plugin (plan 0036, issue #7). The SignalK
// server publishes it at /skServer/openapi/plugins/signalk-wiring when the
// plugin exports getOpenApi(), and a bridge can offer the operations to an AI
// assistant.
//
// The list of operations is generated from the routes the plugin registers
// (collectRoutes runs the registration against a recording router) and from
// the resource types, so a route cannot be missing; the descriptions come
// from the hand-written table in openapiMeta.js. Relay switching and the
// calibration routes are deliberately left out (EXCLUDED_OPERATIONS).

const { registerRoutes } = require('./routes')
const { registerLiveRoutes } = require('./liveRoutes')
const { schemas } = require('./openapiSchemas')
const { META, RESOURCE_TYPES, RESOURCE_BASE } = require('./openapiMeta')

const PLUGIN_ID = 'signalk-wiring'
const PLUGIN_BASE = `/plugins/${PLUGIN_ID}`

// Routes the plugin registers that are NOT in the document, with the reason.
// Switching a relay and steering a calibration run act on the boat; an
// assistant gets no way to do that through this API.
const EXCLUDED_OPERATIONS = {
  'POST /switch': 'switches a relay on the boat',
  'GET /calibration/status': 'part of steering a calibration run',
  'GET /calibration/runs': 'part of steering a calibration run',
  'POST /calibration/runs': 'starts a calibration run, which switches loads',
  'POST /calibration/continue': 'steers a calibration run',
  'POST /calibration/finish': 'steers a calibration run',
  'POST /calibration/cancel': 'steers a calibration run',
  'POST /calibration/runs/:id/recompute': 'steers a calibration run',
  'POST /calibration/runs/:id/accept': 'steers a calibration run',
  'POST /calibration/runs/:id/reject': 'steers a calibration run'
}

const ERRORS = {
  400: ['BadRequest', 'The request is wrong: the body says what.'],
  401: ['Unauthorized', 'No login token, or an expired one.'],
  403: ['Forbidden', 'The login does not have the access level this operation needs.'],
  404: ['NotFound', 'No record with that id.'],
  409: ['Conflict', 'The record is not in a state that allows this: the body says why.'],
  413: ['TooLarge', 'The file is larger than 15 MB.'],
  415: ['UnsupportedType', 'The content type is not one this operation accepts.'],
  503: ['NotEnabled', 'The plugin is not enabled on the server.']
}

// Runs the route registration against a recording router. Returns
// [{ method, path, level }] with the path as registered (:id for a parameter)
// and the access level the registration asked for.
function recordPluginRoutes () {
  const found = []
  const registrar = (level) => {
    const r = {}
    for (const method of ['get', 'put', 'post', 'delete']) {
      r[method] = (path) => { found.push({ method: method.toUpperCase(), path, level }); return r }
    }
    return r
  }
  const router = { ...registrar('admin'), access: (level) => registrar(level) }
  registerRoutes(router, () => null, '/nonexistent')
  registerLiveRoutes(router, () => null, { app: {} }).stopRuns().catch(() => {})
  return found
}

// Every operation of the document: the plugin routes and the resource API.
// A resource operation is { resource: true }; reads need read-only access and
// writes the admin level.
function collectRoutes () {
  const routes = recordPluginRoutes().map((r) => ({ ...r, key: `${r.method} ${r.path}`, resource: false }))
  for (const t of RESOURCE_TYPES) {
    const base = `${RESOURCE_BASE}/${t.type}`
    const add = (method, path, level) => routes.push({ method, path, level, key: `${method} ${path}`, resource: true })
    add('GET', base, 'readonly')
    add('GET', `${base}/:id`, 'readonly')
    if (t.write.includes('POST')) add('POST', base, 'admin')
    if (t.write.includes('PUT')) add('PUT', `${base}/:id`, 'admin')
    if (t.write.includes('DELETE')) add('DELETE', `${base}/:id`, 'admin')
  }
  return routes
}

const toOpenApiPath = (path, resource) => (resource ? '' : PLUGIN_BASE) + path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')

// The "level" a route asks for as the security scheme that names it.
const SECURITY = { readonly: 'bearerReadOnly', readwrite: 'bearerReadWrite', admin: 'bearerAdmin' }

function operationId (route) {
  const words = route.path.replace(RESOURCE_BASE, '').replace(/[:{}]/g, '').split(/[/-]+/).filter(Boolean)
  return route.method.toLowerCase() + words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

function buildOperation (route, meta) {
  const parameters = [...(meta.parameters || [])]
  for (const name of [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1])) {
    if (!parameters.some((p) => p.in === 'path' && p.name === name)) {
      parameters.push({ name, in: 'path', required: true, description: `The ${name} in the path.`, schema: { type: 'string' } })
    }
  }
  const content = (spec) => (spec.content
    ? spec.content
    : { 'application/json': { schema: spec.schema, ...(spec.example !== undefined ? { example: spec.example } : {}) } })
  const responses = {}
  for (const [code, spec] of Object.entries(meta.responses || {})) {
    responses[code] = { description: spec.description, ...(spec.schema || spec.content ? { content: content(spec) } : {}) }
  }
  const errorCodes = [...new Set([401, 403, ...(meta.errors || [])])].sort()
  for (const code of errorCodes) responses[code] = { $ref: `#/components/responses/${ERRORS[code][0]}` }

  const op = {
    operationId: operationId(route),
    tags: [meta.tag],
    summary: meta.summary,
    description: route.level === 'readonly' || /admin login/.test(meta.description) ? meta.description : `${meta.description} Needs the admin login.`,
    ...(parameters.length ? { parameters } : {}),
    ...(meta.requestBody
      ? {
          requestBody: {
            required: meta.requestBody.required !== false,
            description: meta.requestBody.description,
            content: meta.requestBody.content || { 'application/json': { schema: meta.requestBody.schema, ...(meta.requestBody.example !== undefined ? { example: meta.requestBody.example } : {}) } }
          }
        }
      : {}),
    responses,
    security: [{ [SECURITY[route.level === 'readwrite' ? 'admin' : route.level]]: [] }],
    'x-access-level': route.level === 'readonly' ? 'read-only' : 'admin'
  }
  return op
}

// The body of a write: the record's schema with nothing required (a write
// carries only the fields it changes) and the id left to the path or the server.
function inputSchemas () {
  const out = {}
  for (const t of RESOURCE_TYPES.filter((x) => x.write.length > 0)) {
    const { required, properties, ...rest } = schemas[t.schema]
    const { id, ...fields } = properties
    out[`${t.schema}Input`] = { ...rest, description: `${rest.description} As written: send only the fields to set. Derived and read-only fields are ignored.`, properties: { ...fields, id } }
  }
  return out
}

// routes: the list from collectRoutes(). Returns the document.
function buildOpenApi (pluginVersion, routes) {
  const paths = {}
  for (const route of routes) {
    if (EXCLUDED_OPERATIONS[route.key]) continue
    const meta = META[route.key]
    if (!meta) throw new Error(`no OpenAPI description for ${route.key}`)
    const path = toOpenApiPath(route.path, route.resource)
    paths[path] = paths[path] || {}
    paths[path][route.method.toLowerCase()] = buildOperation(route, meta)
  }
  const responses = {}
  for (const [, [name, description]] of Object.entries(ERRORS)) {
    responses[name] = { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'signalk-wiring: documentation of the boat\'s electrical wiring',
      version: pluginVersion,
      description: [
        'The wiring of one boat: devices (consumers, batteries, fuses, switches, converters, enclosures), the cables between them, the circuits that follow from the cables, conduits, zones, plans and schematic pages.',
        'Read operations are open to any logged-in SignalK user; writes need the admin login. Switching relays and steering calibration runs are not part of this API.',
        'Start with the search operation to find a device or cable by name, then trace, check or read it. The data is advisory documentation kept by the boat\'s owner; it is not a safety guarantee. Derived data (circuits, protection, voltage, loads, cable checks) is worked out from the cables and devices, so it is only as complete as the documentation.'
      ].join('\n\n')
    },
    // Absolute paths below, so the server must not prefix them with the plugin path.
    servers: [{ url: '/' }],
    tags: [
      { name: 'Query', description: 'Derived answers: search, trace, load summary and cable checks.' },
      { name: 'Resources', description: 'The records, through the SignalK resource API.' },
      { name: 'Derived data', description: 'Banks, warnings, circuit graphs and the switching table.' },
      { name: 'Change log', description: 'What changed in the documentation, and when.' },
      { name: 'Attachments', description: 'Photos and documents attached to records.' },
      { name: 'Plans', description: 'Drawings of the boat.' },
      { name: 'Devices', description: 'Device icons.' },
      { name: 'Maintenance', description: 'Merging zones and erasing removed records for good.' },
      { name: 'Plugin', description: 'The plugin itself.' }
    ],
    paths,
    components: {
      securitySchemes: {
        bearerReadOnly: { type: 'http', scheme: 'bearer', description: 'The token from the SignalK login (POST /signalk/v1/auth/login). Any logged-in user, including a read-only one, may use this operation.' },
        bearerAdmin: { type: 'http', scheme: 'bearer', description: 'The token from the SignalK login of an administrator. Plugin writes are admin only.' }
      },
      schemas: {
        ...schemas,
        ...inputSchemas(),
        ResourceWriteResult: {
          type: 'object',
          description: 'What the SignalK resource API answers to a write.',
          properties: {
            state: { type: 'string', description: 'COMPLETED when the write was accepted.' },
            statusCode: { type: 'integer', description: 'HTTP-like status of the write.' },
            id: { type: 'string', description: 'The id of the record, for a create.' },
            message: { type: 'string', description: 'The reason, when the write failed.' }
          }
        }
      },
      responses
    }
  }
}

let cached = null
// The document for this plugin version, built once.
function getOpenApi (pluginVersion) {
  if (!cached || cached.version !== pluginVersion) cached = { version: pluginVersion, doc: buildOpenApi(pluginVersion, collectRoutes()) }
  return cached.doc
}

module.exports = { buildOpenApi, collectRoutes, getOpenApi, EXCLUDED_OPERATIONS, PLUGIN_ID, PLUGIN_BASE }
