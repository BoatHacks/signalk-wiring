import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

// The demo boat (demo/), the scripts that build it and the docs live in the
// repository only. The npm package is what the plugin needs to run.
test('the npm package ships only the plugin, never the demo, scripts, docs or tests', () => {
  assert.deepEqual([...pkg.files].sort(), ['index.js', 'public', 'src'])
  for (const entry of pkg.files) {
    const top = entry.replace(/^\.\//, '').split('/')[0]
    assert.ok(!['demo', 'scripts', 'docs', 'test', '.claude'].includes(top), `${entry} must not be packaged`)
  }
})

test('the demo files are kept in the repository, outside the package', () => {
  for (const file of ['demo/wiring.db', 'demo/README.md', 'demo/source/boat.json', 'scripts/build-demo.js']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is in the repository`)
  }
  // nothing under the packaged folders refers to the demo folder
  for (const dir of ['src', 'public']) {
    assert.ok(!fs.existsSync(path.join(root, dir, 'demo')), `${dir}/demo must not exist`)
  }
})
