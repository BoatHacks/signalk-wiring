// A small client for a SignalK server running signalk-wiring: the resource
// API and the plugin's own routes. Node.js 22 or newer (global fetch).

import fs from 'node:fs'

export const RESOURCE_TYPES = {
  device: 'wiringDevices',
  wireRun: 'wiringWireRuns',
  circuit: 'wiringCircuits',
  zone: 'wiringZones',
  conduit: 'wiringConduits',
  schematic: 'wiringSchematics',
  plan: 'wiringPlans',
  backbone: 'wiringBackbones'
}

const PLUGIN = '/plugins/signalk-wiring'

// Reads a token from --token-file, SK_TOKEN_FILE or SK_TOKEN. A server with
// security off needs none.
export function loadToken ({ tokenFile } = {}) {
  const file = tokenFile || process.env.SK_TOKEN_FILE
  if (file) return fs.readFileSync(file, 'utf8').trim()
  return process.env.SK_TOKEN || null
}

export function createClient ({ url, token }) {
  if (!url) throw new Error('a server address is needed, e.g. --url http://localhost:3100')
  const base = url.replace(/\/+$/, '')
  const headers = (extra = {}) => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra })

  async function request (method, path, { body, raw, contentType } = {}) {
    const init = { method, headers: headers() }
    if (body !== undefined) {
      if (raw) {
        init.body = body
        init.headers['Content-Type'] = contentType || 'application/octet-stream'
      } else {
        init.body = JSON.stringify(body)
        init.headers['Content-Type'] = 'application/json'
      }
    }
    const res = await fetch(base + path, init)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`)
      err.status = res.status
      throw err
    }
    return res
  }

  const json = async (method, path, opts) => {
    const res = await request(method, path, opts)
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  return {
    base,
    request,
    // Resource API: `kind` is a key of RESOURCE_TYPES.
    list: (kind) => json('GET', `/signalk/v2/api/resources/${RESOURCE_TYPES[kind]}`),
    get: (kind, id) => json('GET', `/signalk/v2/api/resources/${RESOURCE_TYPES[kind]}/${id}`),
    put: (kind, id, value) => json('PUT', `/signalk/v2/api/resources/${RESOURCE_TYPES[kind]}/${id}`, { body: value }),
    remove: (kind, id) => json('DELETE', `/signalk/v2/api/resources/${RESOURCE_TYPES[kind]}/${id}`),
    // Plugin routes, relative to /plugins/signalk-wiring.
    plugin: (method, path, opts) => json(method, PLUGIN + path, opts),
    pluginRaw: (method, path, opts) => request(method, PLUGIN + path, opts),
    // Purge a removed record for good (admin). `kind`: cable, device, conduit, schematic.
    purge: (kind, id) => json('DELETE', `${PLUGIN}/${{ cable: 'cables', device: 'devices', conduit: 'conduits', schematic: 'schematics' }[kind]}/${id}/purge`)
  }
}

// True when the server answers the wiring resource API, so the plugin is
// installed and enabled. Throws with a clear message when the server wants a
// login instead.
export async function pluginReady (client) {
  try {
    await client.list('zone')
    return true
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      throw new Error(`${client.base} has security on and refused the request (${err.status}). ` +
        'Get a token with token.mjs and pass it with --token-file (or --to-token-file / --from-token-file).')
    }
    return false
  }
}

// Plugin version, or null on versions that do not report it.
export async function pluginVersion (client) {
  try {
    const v = await client.plugin('GET', '/version')
    return (v && (v.version || v)) || null
  } catch (err) {
    return null
  }
}

export function isLocalUrl (url) {
  const host = new URL(url).hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost')
}
