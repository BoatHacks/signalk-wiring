// Plan 0022: a regression check on the boat's two schematic pages. The router
// must leave no shared stretch, no plain crossing, at least two line widths of
// clear space between parallel lines, a visible straight leg out of every
// port, and no line through a device or a tab.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../public/schematic.js'
import * as R from '../public/wireRouter.js'
import { readFileSync } from 'node:fs'
import { routeBoatPage, pageNames, pageInput } from './helpers/boatPages.mjs'
import { checkPage, linesOf, MIN_CLEAR, LINE_W } from './helpers/routeCheck.mjs'

const summary = (problems) => problems.map((p) => `${p.type} ${p.ids.map((i) => String(i).slice(0, 8)).join(' ')}`).join('; ')

for (const name of pageNames) {
  test(`boat page "${name}": no overlaps, plain crossings, tight spacing, short legs`, () => {
    const { input, result, ms } = routeBoatPage(name)
    const problems = checkPage(linesOf(input, result))
    assert.equal(problems.length, 0, summary(problems))
    assert.ok(ms < 1500, `routing took ${ms.toFixed(0)} ms`)
  })

  test(`boat page "${name}": every wire and stub is routed under the strict rules`, () => {
    const { input, result } = routeBoatPage(name)
    for (const w of input.wires) {
      const r = result.wires.get(w.id)
      assert.equal(r.fallback, false, `fallback for ${w.id}`)
      assert.equal(r.level, 0, `relaxed rules for ${w.id}`)
    }
    for (const s of input.stubs) {
      const r = result.stubs.get(s.cableId)
      assert.equal(r.level, 0, `relaxed rules for stub ${s.cableId}`)
      assert.ok(r.path.length >= 2)
    }
  })
}

test('the checker finds a shared stretch, a plain crossing and a tight pair', () => {
  const line = (id, pts, extra = {}) => ({ id, points: pts.map(([x, y]) => ({ x, y })), bridges: [], paired: false, boxIds: [], ...extra })
  const bad = (lines) => checkPage({ lines, boxes: [] }).map((p) => p.type)
  assert.deepEqual(bad([line('a', [[0, 0], [100, 0]]), line('b', [[40, 0], [140, 0]])]), ['overlap'])
  assert.deepEqual(bad([line('a', [[0, 0], [100, 0]]), line('b', [[50, -50], [50, 50]])]), ['crossing'])
  assert.deepEqual(bad([line('a', [[0, 0], [100, 0]]), line('b', [[50, -50], [50, 50]], { })].map((l, i) => (i === 0 ? { ...l, bridges: [{ x: 50, y: 0 }] } : l))), [])
  assert.deepEqual(bad([line('a', [[0, 0], [100, 0]]), line('b', [[0, 6], [100, 6]])]), ['separation'])
  assert.deepEqual(bad([line('a', [[0, 0], [100, 0]]), line('b', [[0, 16], [100, 16]])]), [])
  assert.ok(MIN_CLEAR >= 2 * LINE_W)
})

// Wires joining the same two devices at both ends get their own lanes.
test('router: three wires between the same two devices run in separate lanes with bridges only where they cross', () => {
  const dev = (id, role) => ({ id, role, terminals: [] })
  const boxes = [S.deviceBox(dev('a', 'source'), { x: 0, y: 0 }), S.deviceBox(dev('b', 'consumer'), { x: 400, y: 20 })]
  const wires = []
  for (let i = 0; i < 3; i++) wires.push({ id: 'w' + i, fromId: 'a', toId: 'b', fromTerminal: null, toTerminal: null, points: [], conduitIds: [] })
  const result = R.routePage({ boxes, wires })
  const input = { boxes, wires, stubs: [] }
  const problems = checkPage(linesOf(input, result))
  assert.equal(problems.length, 0, summary(problems))
  const ys = [...result.wires.values()].map((w) => w.points[0].y).sort((p, q) => p - q)
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= R.PITCH - 0.01)
})

test('router: a stub tab the user placed stays where it is, and its line avoids everything', () => {
  const name = pageNames[0]
  const base = pageInput(name)
  const s = base.stubs[0]
  const b = base.boxes.find((x) => x.id === s.deviceId)
  const spot = { x: b.x + b.w + 400, y: b.y + 300 }
  const { input, result } = routeBoatPage(name, { stubPos: { [s.cableId]: spot } })
  const r = result.stubs.get(s.cableId)
  assert.deepEqual({ x: r.tab.x, y: r.tab.y }, spot)
  assert.equal(r.user, true)
  const problems = checkPage(linesOf(input, result))
  assert.equal(problems.length, 0, summary(problems))
  const last = r.path[r.path.length - 1]
  assert.ok(last.x >= r.tab.x - 0.01 && last.x <= r.tab.x + r.tab.w + 0.01 && last.y >= r.tab.y - 0.01 && last.y <= r.tab.y + r.tab.h + 0.01)
})

test('router: the page is routed the same way whatever the order of the input', () => {
  const a = pageInput(pageNames[1])
  const b = { boxes: [...a.boxes].reverse(), wires: [...a.wires].reverse(), stubs: [...a.stubs].reverse() }
  const ra = R.routePage(a)
  const rb = R.routePage(b)
  for (const [id, w] of ra.wires) assert.deepEqual(rb.wires.get(id).points, w.points)
  for (const [id, s] of ra.stubs) assert.deepEqual(rb.stubs.get(id).path, s.path)
})

test('a line to a tab is drawn like its cable: conductor colours, DC solid or AC dashed, normal width', () => {
  const view = readFileSync(new URL('../public/schematicView.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  const shape = view.slice(view.indexOf('function StubShape'), view.indexOf('function TabMenu'))
  assert.match(shape, /conductorTypes\(stub\.cable\)/)
  assert.match(shape, /wireLineStyle\(stub\.cable\)/)
  assert.match(shape, /sch-wire-line sch-stub-line c-/)
  assert.match(shape, /sch-wire-pair/)
  assert.match(shape, /WireMarker/)
  assert.match(shape, /class="sch-tab"/)
  // no override of the colour, dash or width for the stub line in the stylesheet
  const rules = css.split('}').filter((r) => /\.sch-stub-line\s*\{/.test(r.replace(/,\s*/g, ' ')) && !/\.sch-wire-line/.test(r))
  assert.deepEqual(rules, [])
  assert.match(css, /\.sch-wire-line, \.sch-wire-pair, \.sch-stub-line \{ fill: none; stroke-width: 3;/)
  // every cable of a stub has a style, so DC is solid and AC dashed
  const { input } = routeBoatPage('48V System')
  const data = JSON.parse(readFileSync(new URL('./fixtures/boat-pages.json', import.meta.url), 'utf8'))
  for (const s of input.stubs) {
    const c = data.cables.find((x) => x.id === s.cableId)
    const st = S.wireLineStyle(c)
    assert.equal(st.dasharray, st.current === 'ac' ? '10 6' : null)
  }
})
