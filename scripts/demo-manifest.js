'use strict'

// Writes demo/manifest.json, the list of demo files a server in demo mode
// downloads (src/demoSource.js): wiring.db and the files directly in plans/ and
// attachments/, each with its size and sha256. Run it after changing any of
// them; scripts/build-demo.js runs it after a build.
//
//   node scripts/demo-manifest.js [demoDir]

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const DEMO_DIR = path.join(__dirname, '..', 'demo')
const FOLDERS = ['plans', 'attachments']

function entry (demoDir, rel) {
  const bytes = fs.readFileSync(path.join(demoDir, ...rel.split('/')))
  return { path: rel, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
}

function buildManifest (demoDir = DEMO_DIR) {
  const files = [entry(demoDir, 'wiring.db')]
  for (const folder of FOLDERS) {
    const dir = path.join(demoDir, folder)
    if (!fs.existsSync(dir)) continue
    const names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name !== '.gitkeep')
      .map((d) => d.name)
      .sort()
    for (const name of names) files.push(entry(demoDir, `${folder}/${name}`))
  }
  return { format: 1, files }
}

function manifestText (demoDir = DEMO_DIR) {
  return JSON.stringify(buildManifest(demoDir), null, 2) + '\n'
}

function writeManifest (demoDir = DEMO_DIR) {
  const file = path.join(demoDir, 'manifest.json')
  fs.writeFileSync(file, manifestText(demoDir))
  return file
}

module.exports = { DEMO_DIR, buildManifest, manifestText, writeManifest }

if (require.main === module) {
  const file = writeManifest(process.argv[2] ? path.resolve(process.argv[2]) : DEMO_DIR)
  console.log(`wrote ${file}`)
}
