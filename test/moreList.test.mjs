import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { splitMore, moreLabel, MORE_LIMIT } from '../public/moreList.js'

test('three items or fewer are all shown, with no link', () => {
  for (const n of [0, 1, 2, 3]) {
    const items = Array.from({ length: n }, (_, i) => i)
    const s = splitMore(items)
    assert.deepEqual(s.shown, items)
    assert.equal(s.hidden, 0)
    assert.equal(moreLabel(s), '')
  }
})

test('more than three items show the first three and an "and N more ..." link', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f']
  const s = splitMore(items)
  assert.deepEqual(s.shown, ['a', 'b', 'c'])
  assert.equal(s.hidden, 3)
  assert.equal(moreLabel(s), 'and 3 more ...')
  // four items: one hidden
  assert.equal(moreLabel(splitMore(['a', 'b', 'c', 'd'])), 'and 1 more ...')
})

test('opened, everything is shown and the link offers to collapse', () => {
  const items = ['a', 'b', 'c', 'd', 'e']
  const s = splitMore(items, true)
  assert.deepEqual(s.shown, items)
  assert.equal(s.hidden, 0)
  assert.equal(moreLabel(s), 'show fewer')
  // a short list opened has nothing to collapse
  assert.equal(moreLabel(splitMore(['a'], true)), '')
})

test('the limit is three and a non-list is an empty list', () => {
  assert.equal(MORE_LIMIT, 3)
  assert.deepEqual(splitMore(null), { shown: [], hidden: 0, canCollapse: false })
  assert.equal(splitMore([1, 2, 3, 4, 5], false, 2).hidden, 3)
})

test('the cables table and the cable form cut a long circuit list', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  assert.match(app, /<\$\{MoreList\} items=\$\{here\}/)
  assert.match(app, /<\$\{CircuitLines\} here=\$\{here\}/)
  assert.doesNotMatch(app, /here\.map\(\(\{ circuit \}\) => circuit\.name\)\.join/)
})
