'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { stampSpecifier, stampModule, stampHtml } = require('../scripts/stamp-version')

test('stampSpecifier adds the version to relative addresses only', () => {
  assert.equal(stampSpecifier('./a.js', '1.2.3'), './a.js?v=1.2.3')
  assert.equal(stampSpecifier('../b/c.js', '1.2.3'), '../b/c.js?v=1.2.3')
  assert.equal(stampSpecifier('app.js', '1.2.3'), 'app.js?v=1.2.3')
  assert.equal(stampSpecifier('./a.js?v=0.1.0', '1.2.3'), './a.js?v=1.2.3')
  assert.equal(stampSpecifier('./a.css?x=1', '1.2.3'), './a.css?x=1&v=1.2.3')
  assert.equal(stampSpecifier('/abs/a.js', '1.2.3'), '/abs/a.js')
  assert.equal(stampSpecifier('https://x.test/a.js', '1.2.3'), 'https://x.test/a.js')
  assert.equal(stampSpecifier('//cdn.test/a.js', '1.2.3'), '//cdn.test/a.js')
})

test('stampModule rewrites static, side-effect and dynamic imports and exports', () => {
  const src = [
    "import { a } from './a.js'",
    'import b from "./vendor/b.module.js"',
    "import './side.js'",
    "export { c } from '../c.js'",
    "const m = await import('./lazy.js')",
    "import x from 'bare-package'",
    "const text = `/plugins/x/icon?v=${id}`"
  ].join('\n')
  const out = stampModule(src, '0.6.0')
  assert.match(out, /from '\.\/a\.js\?v=0\.6\.0'/)
  assert.match(out, /from "\.\/vendor\/b\.module\.js\?v=0\.6\.0"/)
  assert.match(out, /import '\.\/side\.js\?v=0\.6\.0'/)
  assert.match(out, /from '\.\.\/c\.js\?v=0\.6\.0'/)
  assert.match(out, /import\('\.\/lazy\.js\?v=0\.6\.0'\)/)
  assert.match(out, /from 'bare-package'/)
  assert.match(out, /icon\?v=\$\{id\}/)
  assert.equal(stampModule(out, '0.6.0'), out, 'stamping twice changes nothing')
  assert.match(stampModule(out, '0.7.0'), /a\.js\?v=0\.7\.0'/)
})

test('stampHtml stamps the script and stylesheet addresses', () => {
  const page = '<link rel="stylesheet" href="style.css">\n<script type="module" src="app.js"></script>\n<a href="other.html">x</a>'
  const out = stampHtml(page, '0.6.0')
  assert.match(out, /href="style\.css\?v=0\.6\.0"/)
  assert.match(out, /src="app\.js\?v=0\.6\.0"/)
  assert.match(out, /<a href="other\.html">/)
})

test('every shipped module still parses after stamping and every import is stamped', () => {
  const dir = path.join(__dirname, '..', 'public')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'))
  try {
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const out = stampModule(fs.readFileSync(path.join(dir, name), 'utf8'), '9.9.9')
      assert.ok(!/(?:from|import)\s*\(?\s*['"]\.{1,2}\/[^'"?]*['"]/.test(out), `${name} has an unstamped relative import`)
      const file = path.join(tmp, name.replace(/\.js$/, '.mjs'))
      fs.writeFileSync(file, out)
      const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      assert.equal(check.status, 0, `${name}: ${check.stderr}`)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('the stamp and restore commands leave the package files as they were', () => {
  const root = path.join(__dirname, '..')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-pack-'))
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'))
    fs.cpSync(path.join(root, 'public'), path.join(tmp, 'public'), { recursive: true })
    fs.copyFileSync(path.join(root, 'scripts', 'stamp-version.js'), path.join(tmp, 'scripts', 'stamp-version.js'))
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '3.4.5' }))
    const run = (mode) => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'stamp-version.js'), mode], { encoding: 'utf8' })
    const before = fs.readFileSync(path.join(tmp, 'public', 'app.js'), 'utf8')
    assert.equal(run('stamp').status, 0)
    assert.match(fs.readFileSync(path.join(tmp, 'public', 'app.js'), 'utf8'), /\.js\?v=3\.4\.5'/)
    assert.match(fs.readFileSync(path.join(tmp, 'public', 'index.html'), 'utf8'), /src="app\.js\?v=3\.4\.5"/)
    // a second stamp (an interrupted pack) still restores the true originals first
    assert.equal(run('stamp').status, 0)
    assert.equal(run('restore').status, 0)
    assert.equal(fs.readFileSync(path.join(tmp, 'public', 'app.js'), 'utf8'), before)
    assert.ok(!fs.existsSync(path.join(tmp, '.stamp-backup')))
    assert.notEqual(run('nonsense').status, 0)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
