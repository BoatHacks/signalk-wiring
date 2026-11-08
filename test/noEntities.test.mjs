import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The html template library does not decode entities, so "&hellip;" in
// template text would show up literally. Use the real character instead.
const dir = fileURLToPath(new URL('../public/', import.meta.url))

function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}

test('no HTML entities in the template text of public/*.js', () => {
  const found = []
  for (const name of readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const src = stripComments(readFileSync(dir + name, 'utf8'))
    src.split('\n').forEach((line, i) => {
      const m = line.match(/&(?:[a-zA-Z][a-zA-Z0-9]*|#x?[0-9a-fA-F]+);/)
      if (m) found.push(`${name}:${i + 1} ${m[0]}`)
    })
  }
  assert.deepEqual(found, [])
})
