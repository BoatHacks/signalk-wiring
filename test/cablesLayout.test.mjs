import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')

test('the cables table sits in a scrolling frame and the page uses the full width for it', () => {
  assert.match(app, /<div class="table-scroll">\s*<table class="cables-table">/)
  assert.match(css, /main:has\(\.cables-table\) \{ max-width: none; \}/)
  assert.match(css, /\.table-scroll \{ overflow-x: auto; max-width: 100%; \}/)
})
