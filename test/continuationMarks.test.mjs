import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const view = readFileSync(new URL('../public/floorplanView.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')

test('the continuation arrow is the link, with a tooltip, and the label is a second line of text', () => {
  const at = view.indexOf('${continuations.map((m) => {')
  assert.ok(at > 0)
  const block = view.slice(at, at + 2600)
  assert.match(block, /<title>\$\{label\}<\/title>/)
  assert.match(block, /data-testid="continuation-link"[\s\S]*\$\{drawing\}/)
  assert.match(block, /class="continuation \$\{chosen \? 'chosen' : ''\}"/)
  assert.match(block, /m\.owner === ctx\.runId \|\| m\.owner === ctx\.conduitId/)
})

test('the label is hidden and takes no clicks until the arrow is hovered or its cable is chosen', () => {
  assert.match(css, /\.continuation-label \{[^}]*opacity: 0; pointer-events: none;/)
  assert.match(css, /\.continuation:hover \.continuation-label, \.continuation\.chosen \.continuation-label \{ opacity: 1; pointer-events: auto; \}/)
  assert.match(css, /\.continuation \{ opacity: 0\.55; \}/)
})
