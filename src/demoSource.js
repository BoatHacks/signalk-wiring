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
const SQLITE_MAGIC = 'SQLite format 3\0'

class DemoSourceError extends Error {}

function fail (message) {
  throw new DemoSourceError(message)
}

// A path segment that is safe to use as a file name.
function safeSegment (name) {
  return SEGMENT.test(name) && name !== '.' && name !== '..'
}

// Which of the demo files in the git tree to take: demo/wiring.db and the
// files directly in demo/plans/ and demo/attachments/. Everything else (the
// source folder, the README, a .gitkeep) is ignored. A name inside the accepted
// places that is not plain (odd characters, a link, a sub-folder) refuses the
// whole update.
function selectEntries (tree) {
  const picked = []
  for (const entry of tree) {
    if (typeof entry.path !== 'string') continue
    const parts = entry.path.split('/')
    if (parts[0] !== 'demo') continue
    const isDb = entry.path === 'demo/wiring.db'
    const isFolderFile = parts.length >= 2 && (parts[1] === 'plans' || parts[1] === 'attachments') && parts.length >= 3
    if (!isDb && !isFolderFile) continue
    if (entry.type === 'tree') continue
    if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) fail(`${entry.path} is not a plain file`)
    if (!isDb && parts.length !== 3) fail(`${entry.path} is nested`)
    if (!parts.every(safeSegment)) fail(`${entry.path} has a name that is not allowed`)
    if (!isDb && parts[2] === '.gitkeep') continue
    if (typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/.test(entry.sha)) fail(`${entry.path} has no blob sha`)
    if (!Number.isInteger(entry.size) || entry.size < 0) fail(`${entry.path} has no size`)
    const cap = isDb ? MAX_DB_BYTES : MAX_FILE_BYTES
    if (entry.size > cap) fail(`${entry.path} is larger than ${cap / 1024 / 1024} MB`)
    picked.push({ rel: parts.slice(1).join('/'), parts: parts.slice(1), sha: entry.sha, size: entry.size })
  }
  if (!picked.some((e) => e.rel === 'wiring.db')) fail('the demo has no wiring.db')
  if (picked.reduce((n, e) => n + e.size, 0) > MAX_TOTAL_BYTES) fail('the demo files are larger than 100 MB in all')
  return picked
}

function blobSha (bytes) {
  return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

// The SQLite header holds PRAGMA user_version as a big-endian 32-bit integer at
// byte offset 60.
function schemaVersionOf (bytes) {
  if (bytes.length < 100 || bytes.toString('latin1', 0, 16) !== SQLITE_MAGIC) fail('wiring.db is not a SQLite database')
  return bytes.readUInt32BE(60)
}

function readLocalCommit (demoDir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(demoDir, 'version.json'), 'utf8'))
    if (!fs.statSync(path.join(demoDir, 'wiring.db')).isFile()) return null
    return typeof v.commit === 'string' ? v.commit : null
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
// puts it in <dataDir>/demo. Never throws; every failure leaves demo/ as it was.
// Returns { status: 'unchanged' | 'updated' | 'kept', commit, reason }.
async function updateDemoFiles (dataDir, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch
  const repo = options.repo || REPO
  const branch = options.branch || BRANCH
  const requestTimeout = options.requestTimeoutMs || REQUEST_TIMEOUT_MS
  const maxSchema = options.latestSchemaVersion || LATEST_SCHEMA_VERSION
  const demoDir = path.join(dataDir, 'demo')
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), options.deadlineMs || DEADLINE_MS)
  if (timer.unref) timer.unref()

  const get = async (url, kind) => {
    const signal = AbortSignal.any([AbortSignal.timeout(requestTimeout), deadline.signal])
    const res = await fetchFn(url, { signal, headers: { 'User-Agent': 'signalk-wiring', Accept: kind === 'json' ? 'application/vnd.github+json' : '*/*' } })
    if (!res.ok) {
      fail(res.status === 403 || res.status === 429 ? 'GitHub refused the request (rate limit)' : `GitHub answered HTTP ${res.status}`)
    }
    return kind === 'json' ? res.json() : Buffer.from(await res.arrayBuffer())
  }

  try {
    recover(dataDir)
    const commits = await get(`https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=demo&per_page=1`, 'json')
    const commit = Array.isArray(commits) && commits[0] && commits[0].sha
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) fail('GitHub named no demo commit')
    if (readLocalCommit(demoDir) === commit) return { status: 'unchanged', commit, reason: null }

    const treeDoc = await get(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`, 'json')
    if (!treeDoc || treeDoc.truncated || !Array.isArray(treeDoc.tree)) fail('GitHub gave no complete file list')
    const entries = selectEntries(treeDoc.tree)

    const staging = path.join(dataDir, 'demo.new')
    fs.rmSync(staging, { recursive: true, force: true })
    try {
      fs.mkdirSync(staging, { recursive: true })
      let total = 0
      for (const e of entries) {
        const bytes = await get(`https://raw.githubusercontent.com/${repo}/${commit}/demo/${e.rel}`, 'bytes')
        if (bytes.length !== e.size) fail(`demo/${e.rel} has the wrong size`)
        total += bytes.length
        if (total > MAX_TOTAL_BYTES) fail('the demo files are larger than 100 MB in all')
        if (blobSha(bytes) !== e.sha) fail(`demo/${e.rel} does not match its checksum`)
        if (e.rel === 'wiring.db') {
          const v = schemaVersionOf(bytes)
          if (v > maxSchema) fail(`the demo database has schema version ${v}, newer than this plugin understands (${maxSchema})`)
        }
        const target = path.join(staging, ...e.parts)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, bytes)
      }
      fs.writeFileSync(path.join(staging, 'version.json'), JSON.stringify({ commit }) + '\n')
      const old = path.join(dataDir, 'demo.old')
      fs.rmSync(old, { recursive: true, force: true })
      if (fs.existsSync(demoDir)) fs.renameSync(demoDir, old)
      fs.renameSync(staging, demoDir)
      fs.rmSync(old, { recursive: true, force: true })
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true })
      throw e
    }
    return { status: 'updated', commit, reason: null }
  } catch (e) {
    let reason = e instanceof DemoSourceError ? e.message : `could not reach GitHub (${e && e.name === 'TimeoutError' ? 'timeout' : e && e.name === 'AbortError' ? 'cancelled' : (e && e.message) || 'error'})`
    if (deadline.signal.aborted) reason = 'the check took longer than 30 seconds'
    return { status: 'kept', commit: readLocalCommit(demoDir), reason }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { REPO, BRANCH, updateDemoFiles, selectEntries, blobSha, schemaVersionOf }
