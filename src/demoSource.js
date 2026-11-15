'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { LATEST_SCHEMA_VERSION } = require('./store')

const REPO = 'BoatHacks/signalk-wiring'
const BRANCH = 'main'
const REQUEST_TIMEOUT_MS = 5000
const DEADLINE_MS = 30000
const MAX_DB_BYTES = 50 * 1024 * 1024
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const SEGMENT = /^[A-Za-z0-9._-]+$/
const MAX_MANIFEST_BYTES = 1024 * 1024
const SQLITE_MAGIC = 'SQLite format 3\0'

class DemoSourceError extends Error {}

function fail (message) {
  throw new DemoSourceError(message)
}

// A path segment that is safe to use as a file name.
function safeSegment (name) {
  return SEGMENT.test(name) && name !== '.' && name !== '..'
}

// Checks the file list of demo/manifest.json (scripts/demo-manifest.js): only
// wiring.db and plain names directly in plans/ and attachments/ are accepted,
// each with its size and sha256. Anything else refuses the whole update.
function selectEntries (manifest) {
  if (!manifest || manifest.format !== 1 || !Array.isArray(manifest.files)) fail('the demo manifest is not one this plugin understands')
  const picked = []
  const seen = new Set()
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string') fail('the demo manifest has an entry without a path')
    const parts = entry.path.split('/')
    const isDb = entry.path === 'wiring.db'
    if (!isDb && !(parts.length === 2 && (parts[0] === 'plans' || parts[0] === 'attachments'))) fail(`${entry.path} is not an accepted demo file`)
    if (!parts.every(safeSegment)) fail(`${entry.path} has a name that is not allowed`)
    if (seen.has(entry.path)) fail(`${entry.path} is listed twice`)
    seen.add(entry.path)
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) fail(`${entry.path} has no sha256`)
    if (!Number.isInteger(entry.size) || entry.size < 0) fail(`${entry.path} has no size`)
    const cap = isDb ? MAX_DB_BYTES : MAX_FILE_BYTES
    if (entry.size > cap) fail(`${entry.path} is larger than ${cap / 1024 / 1024} MB`)
    picked.push({ rel: entry.path, parts, sha256: entry.sha256, size: entry.size })
  }
  if (!seen.has('wiring.db')) fail('the demo has no wiring.db')
  if (picked.reduce((n, e) => n + e.size, 0) > MAX_TOTAL_BYTES) fail('the demo files are larger than 100 MB in all')
  return picked
}

function sha256 (bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

// The SQLite header holds PRAGMA user_version as a big-endian 32-bit integer at
// byte offset 60.
function schemaVersionOf (bytes) {
  if (bytes.length < 100 || bytes.toString('latin1', 0, 16) !== SQLITE_MAGIC) fail('wiring.db is not a SQLite database')
  return bytes.readUInt32BE(60)
}

// The version of the demo files in demo/ is the sha256 of the manifest they
// were downloaded with.
function readLocalVersion (demoDir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(demoDir, 'version.json'), 'utf8'))
    if (!fs.statSync(path.join(demoDir, 'wiring.db')).isFile()) return null
    return typeof v.manifest === 'string' ? v.manifest : null
  } catch (e) {
    return null
  }
}

// An interrupted swap can leave demo.old without demo; put the old files back.
function recover (dataDir) {
  const demo = path.join(dataDir, 'demo')
  const old = path.join(dataDir, 'demo.old')
  if (!fs.existsSync(demo) && fs.existsSync(old)) fs.renameSync(old, demo)
  fs.rmSync(old, { recursive: true, force: true })
  fs.rmSync(path.join(dataDir, 'demo.new'), { recursive: true, force: true })
}

// Looks on GitHub for a newer version of the demo files and, when there is one,
// puts it in <dataDir>/demo. Everything comes from raw.githubusercontent.com,
// not the GitHub API, whose 60 requests an hour per address a shared address
// (a cloud host) runs out of: demo/manifest.json on the branch names the files
// with their size and sha256, and an unchanged manifest means one request per
// start. Never throws; every failure leaves demo/ as it was.
// Returns { status: 'unchanged' | 'updated' | 'kept', version, reason }.
async function updateDemoFiles (dataDir, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch
  const repo = options.repo || REPO
  const branch = options.branch || BRANCH
  const requestTimeout = options.requestTimeoutMs || REQUEST_TIMEOUT_MS
  const maxSchema = options.latestSchemaVersion || LATEST_SCHEMA_VERSION
  const demoDir = path.join(dataDir, 'demo')
  const base = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/demo/`
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), options.deadlineMs || DEADLINE_MS)
  if (timer.unref) timer.unref()

  const get = async (rel, cap) => {
    const signal = AbortSignal.any([AbortSignal.timeout(requestTimeout), deadline.signal])
    const res = await fetchFn(base + rel, { signal, headers: { 'User-Agent': 'signalk-wiring' } })
    if (!res.ok) {
      fail(res.status === 403 || res.status === 429 ? 'GitHub refused the request (rate limit)' : `GitHub answered HTTP ${res.status} for demo/${rel}`)
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > cap) fail(`demo/${rel} is larger than expected`)
    return bytes
  }

  try {
    recover(dataDir)
    const manifestBytes = await get('manifest.json', MAX_MANIFEST_BYTES)
    const version = sha256(manifestBytes)
    if (readLocalVersion(demoDir) === version) return { status: 'unchanged', version, reason: null }
    let manifest
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'))
    } catch (e) {
      fail('the demo manifest is not valid JSON')
    }
    const entries = selectEntries(manifest)

    const staging = path.join(dataDir, 'demo.new')
    fs.rmSync(staging, { recursive: true, force: true })
    try {
      fs.mkdirSync(staging, { recursive: true })
      for (const e of entries) {
        const bytes = await get(e.parts.map(encodeURIComponent).join('/'), e.size)
        if (bytes.length !== e.size) fail(`demo/${e.rel} has the wrong size`)
        // The files are read from the branch, not a fixed commit, so a push
        // between the manifest and a file shows up here and the next start retries.
        if (sha256(bytes) !== e.sha256) fail(`demo/${e.rel} does not match its checksum`)
        if (e.rel === 'wiring.db') {
          const v = schemaVersionOf(bytes)
          if (v > maxSchema) fail(`the demo database has schema version ${v}, newer than this plugin understands (${maxSchema})`)
        }
        const target = path.join(staging, ...e.parts)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, bytes)
      }
      fs.writeFileSync(path.join(staging, 'version.json'), JSON.stringify({ manifest: version }) + '\n')
      const old = path.join(dataDir, 'demo.old')
      fs.rmSync(old, { recursive: true, force: true })
      if (fs.existsSync(demoDir)) fs.renameSync(demoDir, old)
      fs.renameSync(staging, demoDir)
      fs.rmSync(old, { recursive: true, force: true })
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true })
      throw e
    }
    return { status: 'updated', version, reason: null }
  } catch (e) {
    let reason = e instanceof DemoSourceError ? e.message : `could not reach GitHub (${e && e.name === 'TimeoutError' ? 'timeout' : e && e.name === 'AbortError' ? 'cancelled' : (e && e.message) || 'error'})`
    if (deadline.signal.aborted) reason = 'the check took longer than 30 seconds'
    return { status: 'kept', version: readLocalVersion(demoDir), reason }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { REPO, BRANCH, updateDemoFiles, selectEntries, sha256, schemaVersionOf }
