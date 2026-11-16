import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The project keeps em dashes and en dashes out of prose, which includes code
// comments (plan 0041). A dash as a symbol in a string shown to the user is
// allowed, so only comment text is checked.
const DASH = /[–—]/
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

function commentTextOf (line, state) {
  let text = ''
  let rest = line
  if (state.inBlock) {
    const end = rest.indexOf('*/')
    text += end === -1 ? rest : rest.slice(0, end)
    if (end === -1) return text
    state.inBlock = false
    rest = rest.slice(end + 2)
  }
  const block = rest.search(/\/\*/)
  const lineComment = rest.search(/(^|\s)\/\//)
  if (block !== -1 && (lineComment === -1 || block < lineComment)) {
    const end = rest.indexOf('*/', block + 2)
    if (end === -1) { state.inBlock = true; return text + rest.slice(block + 2) }
    return text + rest.slice(block + 2, end)
  }
  if (lineComment !== -1) text += rest.slice(lineComment)
  return text
}

test('no code comment in public/*.js contains an em dash or an en dash', () => {
  const found = []
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const state = { inBlock: false }
    fs.readFileSync(path.join(dir, file), 'utf8').split('\n').forEach((line, i) => {
      if (DASH.test(commentTextOf(line, state))) found.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(found, [])
})

test('the comment scanner finds a dash in a comment but not in a string', () => {
  const state = { inBlock: false }
  assert.equal(DASH.test(commentTextOf("const a = 'x — y'", state)), false)
  assert.equal(DASH.test(commentTextOf("const a = 1 // note — here", state)), true)
  assert.equal(DASH.test(commentTextOf('/* start', state)), false)
  assert.equal(DASH.test(commentTextOf('still – inside */ code', state)), true)
  assert.equal(DASH.test(commentTextOf('code – not a comment', state)), false)
})
