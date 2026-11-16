'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { updateDemoFiles, sha256, schemaVersionOf } = require('../src/demoSource')
const { buildManifest, manifestText, DEMO_DIR } = require('../scripts/demo-manifest')
const { LATEST_SCHEMA_VERSION } = require('../src/store')

// No test here may reach the real GitHub: every call goes to a fake fetch.

const RAW = 'https://raw.githubusercontent.com/BoatHacks/signalk-wiring/main/demo/'
const OLD_VERSION = 'b'.repeat(64)

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-source-'))
}

function dbBytes (version, pad = 200) {
  const b = Buffer.alloc(pad)
  b.write('SQLite format 3\0', 0, 'latin1')
  b.writeUInt32BE(version, 60)
  return b
}

function resp (body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }
  }
}

// A fake raw.githubusercontent.com holding the demo files of the main branch.
// The manifest is made from `files` unless `manifest` replaces it.
function fakeGithub (over = {}) {
  const gh = {
    files: { 'wiring.db': dbBytes(LATEST_SCHEMA_VERSION), 'plans/p1.svg': Buffer.from('<svg/>') },
    calls: [],
    tamper: {},
    manifest: null,
    ...over
  }
  gh.manifestBytes = () => Buffer.from(JSON.stringify(gh.manifest || {
    format: 1,
    files: Object.entries(gh.files).map(([p, b]) => ({ path: p, size: b.length, sha256: sha256(b) }))
  }))
  gh.fetch = async (url, init) => {
    gh.calls.push(url)
    assert.ok(url.startsWith(RAW), url)
    assert.ok(init && init.signal, 'a signal is passed')
    if (gh.offline) throw new TypeError('fetch failed')
    if (gh.status) return resp('', gh.status)
    const rel = url.slice(RAW.length)
    if (rel === 'manifest.json') return resp(gh.manifestBytes())
    const f = gh.tamper[rel] || gh.files[rel]
    return f ? resp(f) : resp('', 404)
  }
  return gh
}

function listing (dir) {
  const out = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) walk(p)
      else out.push(path.relative(dir, p))
    }
  }
  walk(dir)
  return out.sort()
}

function seedOld (dir) {
  fs.mkdirSync(path.join(dir, 'demo'))
  fs.writeFileSync(path.join(dir, 'demo/wiring.db'), 'old-db')
  fs.writeFileSync(path.join(dir, 'demo/version.json'), JSON.stringify({ manifest: OLD_VERSION }))
}

function untouched (dir) {
  assert.equal(fs.readFileSync(path.join(dir, 'demo/wiring.db'), 'utf8'), 'old-db')
  assert.deepEqual(listing(path.join(dir, 'demo')), ['version.json', 'wiring.db'])
  assert.equal(fs.existsSync(path.join(dir, 'demo.new')), false)
}

const entry = (p, size, sha = 'd'.repeat(64)) => ({ path: p, size, sha256: sha })

test('a first run reads the manifest and downloads the files it lists, without the GitHub API', async () => {
  const dir = tmp()
  const gh = fakeGithub()
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  const version = sha256(gh.manifestBytes())
  assert.deepEqual(r, { status: 'updated', version, reason: null })
  assert.deepEqual(listing(path.join(dir, 'demo')), ['plans/p1.svg', 'version.json', 'wiring.db'])
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'demo/version.json'))).manifest, version)
  assert.deepEqual(gh.calls, [RAW + 'manifest.json', RAW + 'wiring.db', RAW + 'plans/p1.svg'])
  assert.equal(fs.existsSync(path.join(dir, 'demo.new')), false)
  assert.equal(fs.existsSync(path.join(dir, 'demo.old')), false)
})

test('the same manifest means one request and nothing to download', async () => {
  const dir = tmp()
  await updateDemoFiles(dir, { fetch: fakeGithub().fetch })
  const gh = fakeGithub()
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'unchanged')
  assert.deepEqual(gh.calls, [RAW + 'manifest.json'])
})

test('a changed manifest replaces the old demo folder completely', async () => {
  const dir = tmp()
  seedOld(dir)
  fs.writeFileSync(path.join(dir, 'demo/leftover.txt'), 'x')
  const r = await updateDemoFiles(dir, { fetch: fakeGithub().fetch })
  assert.equal(r.status, 'updated')
  assert.deepEqual(listing(path.join(dir, 'demo')), ['plans/p1.svg', 'version.json', 'wiring.db'])
})

test('a folder without version.json, or one written by an older plugin, counts as different', async () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'demo'))
  fs.writeFileSync(path.join(dir, 'demo/wiring.db'), 'old-db')
  assert.equal((await updateDemoFiles(dir, { fetch: fakeGithub().fetch })).status, 'updated')
  const dir2 = tmp()
  seedOld(dir2)
  fs.writeFileSync(path.join(dir2, 'demo/version.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
  assert.equal((await updateDemoFiles(dir2, { fetch: fakeGithub().fetch })).status, 'updated')
})

test('offline keeps the old files and says why', async () => {
  const dir = tmp()
  seedOld(dir)
  const r = await updateDemoFiles(dir, { fetch: fakeGithub({ offline: true }).fetch })
  assert.equal(r.status, 'kept')
  assert.equal(r.version, OLD_VERSION)
  assert.match(r.reason, /could not reach GitHub/)
  untouched(dir)
})

test('a rate limit keeps the old files', async () => {
  for (const status of [403, 429]) {
    const dir = tmp()
    seedOld(dir)
    const r = await updateDemoFiles(dir, { fetch: fakeGithub({ status }).fetch })
    assert.equal(r.status, 'kept')
    assert.match(r.reason, /rate limit/)
    untouched(dir)
  }
})

test('a server error, or no manifest on the branch, keeps the old files', async () => {
  const dir = tmp()
  seedOld(dir)
  const r = await updateDemoFiles(dir, { fetch: fakeGithub({ status: 500 }).fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /HTTP 500/)
  const missing = async () => resp('', 404)
  assert.match((await updateDemoFiles(dir, { fetch: missing })).reason, /HTTP 404 for demo\/manifest\.json/)
  untouched(dir)
})

test('a request that never answers times out', async () => {
  const dir = tmp()
  seedOld(dir)
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  const r = await updateDemoFiles(dir, { fetch: hang, requestTimeoutMs: 30 })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /timeout/)
  untouched(dir)
})

test('the whole check has a deadline', async () => {
  const dir = tmp()
  seedOld(dir)
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  const r = await updateDemoFiles(dir, { fetch: hang, requestTimeoutMs: 5000, deadlineMs: 30 })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /longer than 30 seconds/)
})

test('a file that does not match its sha256 refuses the update', async () => {
  const dir = tmp()
  seedOld(dir)
  const gh = fakeGithub({ tamper: { 'plans/p1.svg': Buffer.from('<svg!>') } })
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /checksum/)
  untouched(dir)
})

test('a file whose size differs from the manifest is refused', async () => {
  for (const body of ['<svg/>extra', '<sv']) {
    const dir = tmp()
    seedOld(dir)
    const gh = fakeGithub({ tamper: { 'plans/p1.svg': Buffer.from(body) } })
    const r = await updateDemoFiles(dir, { fetch: gh.fetch })
    assert.equal(r.status, 'kept')
    assert.match(r.reason, /wrong size|larger than expected/)
    untouched(dir)
  }
})

test('a manifest that is too large, not JSON, or of another format is refused', async () => {
  for (const [bytes, re] of [
    [Buffer.alloc(1024 * 1024 + 1, 0x20), /larger than expected/],
    [Buffer.from('{ not json'), /not valid JSON/],
    [Buffer.from(JSON.stringify({ format: 2, files: [] })), /not one this plugin understands/],
    [Buffer.from(JSON.stringify({ format: 1 })), /not one this plugin understands/]
  ]) {
    const dir = tmp()
    seedOld(dir)
    const gh = fakeGithub()
    gh.manifestBytes = () => bytes
    const r = await updateDemoFiles(dir, { fetch: gh.fetch })
    assert.equal(r.status, 'kept')
    assert.match(r.reason, re)
    assert.equal(gh.calls.length, 1, 'nothing was downloaded')
    untouched(dir)
  }
})

for (const [name, p, re] of [
  ['a parent path', 'plans/..', /not allowed/],
  ['an odd character', 'plans/a b.svg', /not allowed/],
  ['a semicolon', 'attachments/a;b', /not allowed/],
  ['a nested folder', 'plans/x/y.svg', /not an accepted/],
  ['a dotdot segment', 'plans/../wiring.db', /not an accepted|not allowed/],
  ['an absolute path', '/etc/passwd', /not an accepted/],
  ['a backslash', 'plans/..\\..\\x', /not allowed/],
  ['a file outside the accepted places', 'source/boat.json', /not an accepted/],
  ['a file at the top', 'README.md', /not an accepted/]
]) {
  test(`${name} in the manifest refuses the update`, async () => {
    const dir = tmp()
    seedOld(dir)
    const gh = fakeGithub()
    gh.files[p] = Buffer.from('x')
    const r = await updateDemoFiles(dir, { fetch: gh.fetch })
    assert.equal(r.status, 'kept', p)
    assert.match(r.reason, re)
    assert.equal(gh.calls.length, 1, 'nothing was downloaded')
    untouched(dir)
  })
}

test('a file listed twice, or an entry without a sha256, is refused', async () => {
  const db = dbBytes(LATEST_SCHEMA_VERSION)
  const ok = entry('wiring.db', db.length, sha256(db))
  for (const [files, re] of [
    [[ok, ok], /listed twice/],
    [[ok, { path: 'plans/a.svg', size: 1 }], /no sha256/],
    [[ok, { path: 'plans/a.svg', size: -1, sha256: 'd'.repeat(64) }], /no size/],
    [[ok, null], /without a path/]
  ]) {
    const dir = tmp()
    seedOld(dir)
    const gh = fakeGithub({ manifest: { format: 1, files } })
    const r = await updateDemoFiles(dir, { fetch: gh.fetch })
    assert.equal(r.status, 'kept')
    assert.match(r.reason, re)
    untouched(dir)
  }
})

test('size caps: database 50 MB, other files 20 MB, 100 MB in all', async () => {
  const mb = 1024 * 1024
  for (const [files, re] of [
    [[entry('wiring.db', 50 * mb + 1)], /larger than 50 MB/],
    [[entry('wiring.db', 10), entry('plans/a.svg', 20 * mb + 1)], /larger than 20 MB/],
    [[entry('wiring.db', 50 * mb), entry('plans/a.svg', 20 * mb), entry('plans/b.svg', 20 * mb), entry('attachments/c', 20 * mb)], /100 MB in all/]
  ]) {
    const dir = tmp()
    seedOld(dir)
    const gh = fakeGithub({ manifest: { format: 1, files } })
    const r = await updateDemoFiles(dir, { fetch: gh.fetch })
    assert.equal(r.status, 'kept')
    assert.match(r.reason, re)
    assert.equal(gh.calls.length, 1, 'nothing was downloaded')
    untouched(dir)
  }
})

test('a database with a newer schema than the plugin is refused', async () => {
  const dir = tmp()
  seedOld(dir)
  const gh = fakeGithub()
  gh.files['wiring.db'] = dbBytes(LATEST_SCHEMA_VERSION + 1)
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /newer than this plugin/)
  untouched(dir)
})

test('an older schema is accepted, and a file that is no database is refused', async () => {
  const dir = tmp()
  const gh = fakeGithub()
  gh.files['wiring.db'] = dbBytes(3)
  assert.equal((await updateDemoFiles(dir, { fetch: gh.fetch })).status, 'updated')
  const dir2 = tmp()
  const gh2 = fakeGithub()
  gh2.files['wiring.db'] = Buffer.alloc(300)
  const r = await updateDemoFiles(dir2, { fetch: gh2.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /not a SQLite database/)
})

test('a manifest without wiring.db is refused', async () => {
  const dir = tmp()
  const gh = fakeGithub()
  delete gh.files['wiring.db']
  assert.match((await updateDemoFiles(dir, { fetch: gh.fetch })).reason, /no wiring\.db/)
})

test('an interrupted update leaves the old files and no staging folder', async () => {
  const dir = tmp()
  seedOld(dir)
  const f = fakeGithub().fetch
  const dying = async (url, init) => {
    if (url.endsWith('plans/p1.svg')) throw new TypeError('connection reset')
    return f(url, init)
  }
  const r = await updateDemoFiles(dir, { fetch: dying })
  assert.equal(r.status, 'kept')
  untouched(dir)
  assert.equal(fs.existsSync(path.join(dir, 'demo.old')), false)
})

test('a swap interrupted after the old folder was moved away is recovered on the next run', async () => {
  const dir = tmp()
  seedOld(dir)
  fs.renameSync(path.join(dir, 'demo'), path.join(dir, 'demo.old'))
  fs.mkdirSync(path.join(dir, 'demo.new'))
  const r = await updateDemoFiles(dir, { fetch: fakeGithub({ offline: true }).fetch })
  assert.equal(r.status, 'kept')
  untouched(dir)
  assert.equal(fs.existsSync(path.join(dir, 'demo.old')), false)
})

test('the committed demo/manifest.json lists the committed demo files', () => {
  const committed = fs.readFileSync(path.join(DEMO_DIR, 'manifest.json'), 'utf8')
  assert.equal(committed, manifestText(), 'demo/manifest.json is stale: run node scripts/demo-manifest.js')
})

test('the manifest builder leaves out .gitkeep and anything that is not a file', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'plans/sub'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'attachments'))
  fs.writeFileSync(path.join(dir, 'wiring.db'), 'db')
  fs.writeFileSync(path.join(dir, 'plans/.gitkeep'), '')
  fs.writeFileSync(path.join(dir, 'plans/b.svg'), 'b')
  fs.writeFileSync(path.join(dir, 'plans/a.svg'), 'a')
  fs.writeFileSync(path.join(dir, 'attachments/.gitkeep'), '')
  const m = buildManifest(dir)
  assert.deepEqual(m.files.map((f) => f.path), ['wiring.db', 'plans/a.svg', 'plans/b.svg'])
  assert.deepEqual(m.files[1], { path: 'plans/a.svg', size: 1, sha256: crypto.createHash('sha256').update('a').digest('hex') })
})

test('a manifest the builder writes is accepted by the update', async () => {
  const src = tmp()
  fs.mkdirSync(path.join(src, 'plans'))
  fs.writeFileSync(path.join(src, 'wiring.db'), dbBytes(LATEST_SCHEMA_VERSION))
  fs.writeFileSync(path.join(src, 'plans/a.svg'), '<svg/>')
  const files = { 'wiring.db': fs.readFileSync(path.join(src, 'wiring.db')), 'plans/a.svg': fs.readFileSync(path.join(src, 'plans/a.svg')) }
  const gh = fakeGithub({ files })
  gh.manifestBytes = () => Buffer.from(manifestText(src))
  const dir = tmp()
  assert.equal((await updateDemoFiles(dir, { fetch: gh.fetch })).status, 'updated')
  assert.deepEqual(listing(path.join(dir, 'demo')), ['plans/a.svg', 'version.json', 'wiring.db'])
})

test('sha256 and schemaVersionOf', () => {
  assert.equal(sha256(Buffer.from('hello\n')), '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03')
  assert.equal(schemaVersionOf(dbBytes(17)), 17)
})
