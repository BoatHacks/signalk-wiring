import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVELS, levelOf, markFor, LIVE_FORMS } from '../public/statusMarks.js'
import { roleShape, shapePath, SHAPES, ROLES } from '../public/roles.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

test('every kind the app uses maps to a level', () => {
  assert.equal(levelOf('ok'), 'pass')
  assert.equal(levelOf('cannot'), 'cannot')
  assert.equal(levelOf('incomplete'), 'cannot')
  assert.equal(levelOf('note'), 'cannot')
  assert.equal(levelOf('warning'), 'warning')
  assert.equal(levelOf('fail'), 'fail')
  assert.equal(levelOf('over rating'), 'fail')
  assert.equal(levelOf('active'), null)
  assert.equal(levelOf('toString'), null)
  assert.equal(levelOf(undefined), null)
})

test('each level has its own form and its own mark, so color is never the only signal', () => {
  const marks = LEVELS.map((l) => markFor(l))
  assert.equal(new Set(marks.map((m) => m.form)).size, LEVELS.length)
  assert.equal(new Set(marks.map((m) => m.mark)).size, LEVELS.length)
  assert.deepEqual(marks.map((m) => m.form), ['quiet', 'dashed', 'outline', 'filled'])
  for (const m of marks) {
    assert.ok(m.parts.length > 0)
    for (const p of m.parts) assert.match(p.d, /^M[-\d.\sMLHVZzlhvc]+$/)
  }
  assert.equal(markFor('nonsense'), null)
})

test('the failure mark has a cut out cross so it shows on the filled badge', () => {
  const roles = markFor('fail').parts.map((p) => p.role)
  assert.deepEqual(roles, ['fill', 'cut'])
})

test('live states differ in form: solid, hollow, dashed', () => {
  assert.equal(new Set(Object.values(LIVE_FORMS)).size, 3)
})

test('role shapes are distinct for the five power roles', () => {
  const power = ['consumer', 'source', 'storage', 'distribution', 'converter']
  assert.equal(new Set(power.map(roleShape)).size, 5)
  assert.deepEqual(power.map(roleShape).sort(), [...SHAPES].sort())
  assert.equal(roleShape('enclosure'), 'circle')
  assert.equal(roleShape(undefined), 'circle')
  assert.ok(ROLES.length >= 5)
})

test('shape paths are finite, closed and centered on the given point', () => {
  for (const shape of SHAPES) {
    const d = shapePath(shape, 10, 20, 4)
    assert.ok(d.endsWith('Z'), shape)
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number)
    assert.ok(nums.every(Number.isFinite), shape)
  }
  assert.equal(shapePath('square', 10, 20, 10), 'M1 11H19V29H1Z')
  assert.notEqual(shapePath('triangle-up', 0, 0, 5), shapePath('triangle-down', 0, 0, 5))
})

test('the views draw status through the shared badge, not hand built color only badges', () => {
  for (const f of ['public/cableCheckView.js', 'public/loadSummary.js', 'public/busesView.js', 'public/dashboardView.js', 'public/solarView.js']) {
    const src = read(f)
    assert.match(src, /statusBadge\.js/, f)
    assert.doesNotMatch(src, /class="badge over-rating"|class=\$\{'badge check-badge|class=\$\{`badge check-badge/, f)
  }
  assert.doesNotMatch(read('public/app.js'), /badge over-rating/)
})

// ---- Night theme contrast of the muted text ----

function night () {
  const css = read('public/style.css')
  const block = css.match(/\[data-theme="dark"\] \{([^}]*)\}/)[1]
  const v = {}
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) v[m[1]] = m[2]
  return v
}
function lum (hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function ratio (a, b) {
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test('night muted text is readable on the page, card and alternate surfaces', () => {
  const t = night()
  for (const [name, min] of [['bg', 4.5], ['surface', 4.5], ['surface-alt', 4.0]]) {
    assert.ok(ratio(t['text-muted'], t[name]) >= min, `muted on ${name}: ${ratio(t['text-muted'], t[name]).toFixed(2)}`)
    assert.ok(ratio(t['text-muted-strong'], t[name]) >= min + 1, `muted-strong on ${name}`)
    assert.ok(ratio(t.text, t[name]) >= 7, `text on ${name}`)
  }
  assert.ok(lum(t.text) > lum(t['text-muted-strong']) && lum(t['text-muted-strong']) > lum(t['text-muted']))
})

test('night status colors keep their text readable', () => {
  const t = night()
  assert.ok(ratio(t['fail-on'], t['fail-fill']) >= 4.5, 'text on the filled failure badge')
  assert.ok(ratio(t.warn, t.surface) >= 4.0, 'warning outline on the card')
})
