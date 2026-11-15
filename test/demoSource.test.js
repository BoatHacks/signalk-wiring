'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { updateDemoFiles, blobSha, schemaVersionOf } = require('../src/demoSource')
const { LATEST_SCHEMA_VERSION } = require('../src/store')

// No test here may reach the real GitHub: every call goes to a fake fetch.

const COMMIT = 'a'.repeat(40)
const COMMIT2 = 'b'.repeat(40)

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
    json: async () => body,
    arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }
  }
}

// A fake GitHub holding one commit's demo files.
function fakeGithub (over = {}) {
  const gh = {
    commit: COMMIT,
    files: { 'demo/wiring.db': dbBytes(LATEST_SCHEMA_VERSION), 'demo/plans/p1.svg': Buffer.from('<svg/>'), 'demo/attachments/.gitkeep': Buffer.from(''), 'demo/README.md': Buffer.from('readme'), 'demo/source/boat.json': Buffer.from('{}') },
    calls: [],
    tamper: {},
    tree: null,
    ...over
  }
  gh.fetch = async (url, init) => {
    gh.calls.push(url)
    assert.ok(url.startsWith('https://api.github.com/') || url.startsWith('https://raw.githubusercontent.com/'), url)
    assert.ok(init && init.signal, 'a signal is passed')
    if (gh.offline) throw new TypeError('fetch failed')
    if (gh.status) return resp({}, gh.status)
    if (url.includes('/commits?')) {
      assert.match(url, /sha=main&path=demo&per_page=1/)
      return resp([{ sha: gh.commit }])
    }
    if (url.includes('/git/trees/')) {
      assert.ok(url.includes(`/git/trees/${gh.commit}?recursive=1`))
      return resp({ truncated: false, tree: gh.tree || Object.entries(gh.files).map(([p, b]) => ({ path: p, type: 'blob', mode: '100644', size: b.length, sha: blobSha(b) })) })
    }
    const m = url.match(/^https:\/\/raw\.githubusercontent\.com\/BoatHacks\/signalk-wiring\/([0-9a-f]{40})\/(.*)$/)
    assert.ok(m, url)
    assert.equal(m[1], gh.commit, 'pinned to the commit')
    const f = gh.tamper[m[2]] || gh.files[m[2]]
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
  fs.writeFileSync(path.join(dir, 'demo/version.json'), JSON.stringify({ commit: COMMIT2 }))
}

function untouched (dir) {
  assert.equal(fs.readFileSync(path.join(dir, 'demo/wiring.db'), 'utf8'), 'old-db')
  assert.deepEqual(listing(path.join(dir, 'demo')), ['version.json', 'wiring.db'])
  assert.equal(fs.existsSync(path.join(dir, 'demo.new')), false)
}

test('a first run downloads only wiring.db, plans and attachments, from one commit', async () => {
  const dir = tmp()
  const gh = fakeGithub()
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.deepEqual(r, { status: 'updated', commit: COMMIT, reason: null })
  assert.deepEqual(listing(path.join(dir, 'demo')), ['plans/p1.svg', 'version.json', 'wiring.db'])
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'demo/version.json'))).commit, COMMIT)
  assert.equal(gh.calls.length, 4)
  assert.equal(fs.existsSync(path.join(dir, 'demo.new')), false)
  assert.equal(fs.existsSync(path.join(dir, 'demo.old')), false)
})

test('the same commit means nothing to download', async () => {
  const dir = tmp()
  await updateDemoFiles(dir, { fetch: fakeGithub().fetch })
  const gh = fakeGithub()
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'unchanged')
  assert.equal(gh.calls.length, 1)
})

test('a newer commit replaces the old demo folder completely', async () => {
  const dir = tmp()
  seedOld(dir)
  fs.writeFileSync(path.join(dir, 'demo/leftover.txt'), 'x')
  const r = await updateDemoFiles(dir, { fetch: fakeGithub().fetch })
  assert.equal(r.status, 'updated')
  assert.deepEqual(listing(path.join(dir, 'demo')), ['plans/p1.svg', 'version.json', 'wiring.db'])
})

test('a folder without version.json counts as different', async () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'demo'))
  fs.writeFileSync(path.join(dir, 'demo/wiring.db'), 'old-db')
  assert.equal((await updateDemoFiles(dir, { fetch: fakeGithub().fetch })).status, 'updated')
})

test('offline keeps the old files and says why', async () => {
  const dir = tmp()
  seedOld(dir)
  const r = await updateDemoFiles(dir, { fetch: fakeGithub({ offline: true }).fetch })
  assert.equal(r.status, 'kept')
  assert.equal(r.commit, COMMIT2)
  assert.match(r.reason, /could not reach GitHub/)
  untouched(dir)
})

test('a rate limit keeps the old files', async () => {
  const dir = tmp()
  seedOld(dir)
  const r = await updateDemoFiles(dir, { fetch: fakeGithub({ status: 403 }).fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /rate limit/)
  untouched(dir)
})

test('a server error keeps the old files', async () => {
  const dir = tmp()
  seedOld(dir)
  const r = await updateDemoFiles(dir, { fetch: fakeGithub({ status: 500 }).fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /HTTP 500/)
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

test('a file that does not match its blob sha refuses the update', async () => {
  const dir = tmp()
  seedOld(dir)
  const gh = fakeGithub({ tamper: { 'demo/plans/p1.svg': Buffer.from('<svg!>') } })
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /checksum|wrong size/)
  untouched(dir)
})

test('a file whose size differs from the tree is refused', async () => {
  const dir = tmp()
  seedOld(dir)
  const gh = fakeGithub({ tamper: { 'demo/plans/p1.svg': Buffer.from('<svg/>extra') } })
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /wrong size/)
  untouched(dir)
})

for (const [name, p] of [['a parent path', 'demo/plans/..'], ['an odd character', 'demo/plans/a b.svg'], ['a semicolon', 'demo/attachments/a;b'], ['a nested folder', 'demo/plans/x/y.svg'], ['a dotdot segment', 'demo/plans/../wiring.db']]) {
  test(`${name} in an accepted place refuses the update`, async () => {
    const dir = tmp()
    seedOld(dir)
    const gh = fakeGithub()
    gh.files[p] = Buffer.from('x')
    const r = await updateDemoFiles(dir, { fetch: gh.fetch })
    assert.equal(r.status, 'kept', p)
    assert.match(r.reason, /not allowed|nested/)
    untouched(dir)
  })
}

test('paths outside the three accepted places are ignored, even odd ones', async () => {
  const dir = tmp()
  const gh = fakeGithub()
  gh.files['demo/source/../../etc'] = Buffer.from('x')
  gh.files['/abs'] = Buffer.from('x')
  gh.files['other/file'] = Buffer.from('x')
  gh.files['demo/README.md'] = Buffer.from('x')
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'updated')
  assert.deepEqual(listing(path.join(dir, 'demo')), ['plans/p1.svg', 'version.json', 'wiring.db'])
})

test('a link in an accepted place refuses the update', async () => {
  const dir = tmp()
  seedOld(dir)
  const gh = fakeGithub()
  gh.tree = [{ path: 'demo/wiring.db', type: 'blob', mode: '100644', size: 200, sha: blobSha(gh.files['demo/wiring.db']) }, { path: 'demo/plans/l.svg', type: 'blob', mode: '120000', size: 1, sha: 'c'.repeat(40) }]
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /not a plain file/)
})

test('size caps: database 50 MB, other files 20 MB, 100 MB in all', async () => {
  const sha = 'd'.repeat(40)
  const mk = (...entries) => entries.map(([p, size]) => ({ path: p, type: 'blob', mode: '100644', size, sha }))
  const mb = 1024 * 1024
  for (const [tree, re] of [
    [mk(['demo/wiring.db', 50 * mb + 1]), /larger than 50 MB/],
    [mk(['demo/wiring.db', 10], ['demo/plans/a.svg', 20 * mb + 1]), /larger than 20 MB/],
    [mk(['demo/wiring.db', 50 * mb], ['demo/plans/a.svg', 20 * mb], ['demo/plans/b.svg', 20 * mb], ['demo/attachments/c', 20 * mb]), /100 MB in all/]
  ]) {
    const dir = tmp()
    seedOld(dir)
    const gh = fakeGithub({ tree })
    const r = await updateDemoFiles(dir, { fetch: gh.fetch })
    assert.equal(r.status, 'kept')
    assert.match(r.reason, re)
    assert.equal(gh.calls.length, 2, 'nothing was downloaded')
    untouched(dir)
  }
})

test('a database with a newer schema than the plugin is refused', async () => {
  const dir = tmp()
  seedOld(dir)
  const gh = fakeGithub()
  gh.files['demo/wiring.db'] = dbBytes(LATEST_SCHEMA_VERSION + 1)
  const r = await updateDemoFiles(dir, { fetch: gh.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /newer than this plugin/)
  untouched(dir)
})

test('an older schema is accepted, and a file that is no database is refused', async () => {
  const dir = tmp()
  const gh = fakeGithub()
  gh.files['demo/wiring.db'] = dbBytes(3)
  assert.equal((await updateDemoFiles(dir, { fetch: gh.fetch })).status, 'updated')
  const dir2 = tmp()
  const gh2 = fakeGithub()
  gh2.files['demo/wiring.db'] = Buffer.alloc(300)
  const r = await updateDemoFiles(dir2, { fetch: gh2.fetch })
  assert.equal(r.status, 'kept')
  assert.match(r.reason, /not a SQLite database/)
})

test('a tree without wiring.db, or a truncated tree, is refused', async () => {
  const dir = tmp()
  const gh = fakeGithub()
  delete gh.files['demo/wiring.db']
  assert.match((await updateDemoFiles(dir, { fetch: gh.fetch })).reason, /no wiring\.db/)
  const f = fakeGithub().fetch
  const trunc = async (url, init) => (url.includes('/git/trees/') ? resp({ truncated: true, tree: [] }) : f(url, init))
  assert.match((await updateDemoFiles(dir, { fetch: trunc })).reason, /complete file list/)
})

test('an interrupted update leaves the old files and no staging folder', async () => {
  const dir = tmp()
  seedOld(dir)
  const gh = fakeGithub()
  const f = gh.fetch
  const dying = async (url, init) => {
    if (url.includes('plans/p1.svg')) throw new TypeError('connection reset')
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

test('blobSha matches git and schemaVersionOf reads byte 60', () => {
  const b = Buffer.from('hello\n')
  assert.equal(blobSha(b), crypto.createHash('sha1').update('blob 6\0hello\n').digest('hex'))
  assert.equal(blobSha(b), 'ce013625030ba8dba906f756967f9e9ca394464a')
  assert.equal(schemaVersionOf(dbBytes(17)), 17)
})
