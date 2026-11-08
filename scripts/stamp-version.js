'use strict'

// Pack-time version stamping. The server answers every file with
// `Cache-Control: max-age=0` and a weak ETag built from the file size and its
// modification time. The files of a package all carry the same fixed time, so
// a changed file of the same size gets the same ETag and may be served stale.
// To give a new release new addresses for every file, `prepack` rewrites the
// relative imports of public/*.js and the script and stylesheet addresses of
// public/index.html to carry `?v=<version>`, and `postpack` puts the original
// files back. The repository files stay unstamped, so tests and development
// are not affected.
//
//   node scripts/stamp-version.js stamp     (prepack)
//   node scripts/stamp-version.js restore   (postpack)

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const BACKUP = path.join(ROOT, '.stamp-backup')

// Adds ?v=<version> to a relative address, replacing an existing v parameter.
// Addresses that are absolute, protocol-relative or only a hash are left alone.
function stampSpecifier (spec, version) {
  if (/^([a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(spec)) return spec
  const hash = spec.indexOf('#')
  const base = hash === -1 ? spec : spec.slice(0, hash)
  const tail = hash === -1 ? '' : spec.slice(hash)
  const [file, query = ''] = base.split('?')
  const params = query.split('&').filter((p) => p && !/^v=/.test(p))
  params.push(`v=${version}`)
  return `${file}?${params.join('&')}${tail}`
}

// A module's relative import specifiers: `from './x.js'`, `import './x.js'`
// and `import('./x.js')`. Only specifiers starting with ./ or ../ are stamped.
function stampModule (source, version) {
  const rel = '(\\.{1,2}\\/[^\'"`\\s]+)'
  const patterns = [
    new RegExp(`(\\bfrom\\s*)(['"])${rel}\\2`, 'g'),
    new RegExp(`(\\bimport\\s*)(['"])${rel}\\2`, 'g'),
    new RegExp(`(\\bimport\\s*\\(\\s*)(['"])${rel}\\2`, 'g')
  ]
  let out = source
  for (const re of patterns) {
    out = out.replace(re, (m, lead, quote, spec) => `${lead}${quote}${stampSpecifier(spec, version)}${quote}`)
  }
  return out
}

// The script and stylesheet addresses of the page.
function stampHtml (source, version) {
  return source.replace(/<(script|link)\b[^>]*>/gi, (tag) => tag.replace(/\b(src|href)=(["'])([^"']*)\2/gi,
    (m, attr, quote, value) => `${attr}=${quote}${stampSpecifier(value, version)}${quote}`))
}

function packedFiles () {
  return fs.readdirSync(PUBLIC).filter((n) => n.endsWith('.js') || n === 'index.html').sort()
}

function restore () {
  if (!fs.existsSync(BACKUP)) return 0
  let n = 0
  for (const name of fs.readdirSync(BACKUP)) {
    fs.copyFileSync(path.join(BACKUP, name), path.join(PUBLIC, name))
    n++
  }
  fs.rmSync(BACKUP, { recursive: true, force: true })
  return n
}

function stamp () {
  // A backup left by an interrupted pack holds the real originals: put them back first.
  restore()
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  fs.mkdirSync(BACKUP, { recursive: true })
  let n = 0
  for (const name of packedFiles()) {
    const file = path.join(PUBLIC, name)
    const source = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(path.join(BACKUP, name), source)
    const next = name === 'index.html' ? stampHtml(source, version) : stampModule(source, version)
    fs.writeFileSync(file, next)
    n++
  }
  return n
}

module.exports = { stampSpecifier, stampModule, stampHtml }

if (require.main === module) {
  const mode = process.argv[2]
  if (mode === 'stamp') console.log(`stamped ${stamp()} files`)
  else if (mode === 'restore') console.log(`restored ${restore()} files`)
  else {
    console.error('usage: node scripts/stamp-version.js stamp|restore')
    process.exit(1)
  }
}
