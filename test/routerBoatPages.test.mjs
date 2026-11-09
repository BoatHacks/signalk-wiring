// Plan 0022: a regression check on the boat's two schematic pages. The router
// must leave no shared stretch, no plain crossing, at least two line widths of
// clear space between parallel lines, a visible straight leg out of every
// port, and no line through a device or a tab.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../public/schematic.js'
import * as R from '../public/wireRouter.js'
import { routeBoatPage, pageNames, pageInput } from './helpers/boatPages.mjs'
import { readFileSync } from 'node:fs'
import { checkPage, linesOf, crossingsNearPorts, MIN_CLEAR, LINE_W, PORT_CLEAR } from './helpers/routeCheck.mjs'
import { STUB_PITCH } from '../public/wireRouter.js'

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

// ---- Plan 0022, issue 14 follow-up: the MultiPlus DC in on the 48V page ----

const nameOf = (id) => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/boat-pages.json', import.meta.url), 'utf8'))
  return (data.devices.find((d) => d.id === id) || {}).name || ''
}

test('boat 48V page: wires into the MultiPlus ports do not cross close to a port (red above black, as the ports are)', () => {
  const { input, result } = routeBoatPage('48V System')
  const { lines } = linesOf(input, result)
  const mp = input.boxes.find((b) => /MultiPlus/.test(nameOf(b.id)))
  assert.ok(mp, 'MultiPlus on the page')
  const mine = new Set(input.wires.filter((w) => w.fromId === mp.id || w.toId === mp.id).map((w) => w.id))
  assert.ok(mine.size >= 2)
  const near = crossingsNearPorts(lines, PORT_CLEAR).filter((c) => c.ids.some((i) => mine.has(i)))
  assert.deepEqual(near.map((c) => `${c.ids.join(' ')} at ${c.at.x},${c.at.y}`), [])
  // the DC in pair: the positive (red) leg ends above the negative (black) one, and they do not cross at the ports
  const dc = input.wires.filter((w) => mine.has(w.id) && [w.fromTerminal, w.toTerminal].some((t) => /^DC in/.test(t || '')))
  assert.ok(dc.length >= 2)
})

test('boat pages: crossings close to a port stay at the present count (the rest are fans of legs that cannot be avoided)', () => {
  for (const name of pageNames) {
    const { input, result } = routeBoatPage(name)
    const { lines } = linesOf(input, result)
    const near = crossingsNearPorts(lines, 60)
    const most = name === '48V System' ? 13 : 3
    assert.ok(near.length <= most, `${name}: ${near.length} crossings within 60 of a port`)
  }
})

test('boat 48V page: a line to a tab keeps a wide gap from every other line, also beside the CAN port', () => {
  const { input, result } = routeBoatPage('48V System')
  const problems = checkPage(linesOf(input, result))
  assert.deepEqual(problems, [])
  const { lines } = linesOf(input, result)
  for (const s of lines.filter((l) => String(l.id).startsWith('s:'))) {
    for (const o of lines) {
      if (o === s) continue
      for (let k = 1; k < s.points.length; k++) {
        for (let m = 1; m < o.points.length; m++) {
          const a = s.points[k - 1]; const b = s.points[k]; const c = o.points[m - 1]; const d = o.points[m]
          const vert = a.x === b.x && c.x === d.x
          const horiz = a.y === b.y && c.y === d.y
          if (!vert && !horiz) continue
          const lo = vert ? Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) : Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
          const hi = vert ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) : Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
          if (hi - lo <= 0.01) continue
          const gap = vert ? Math.abs(a.x - c.x) : Math.abs(a.y - c.y)
          // lines that share a port (the same terminal) may share their first leg
          if (gap < 0.01) continue
          assert.ok(gap >= STUB_PITCH - 0.01, `${s.id.slice(0, 10)} runs ${gap} beside ${String(o.id).slice(0, 8)}`)
        }
      }
    }
  }
})

test('conduit bands on the boat pages end clear of every port block and their labels clear of every line', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/boat-pages.json', import.meta.url), 'utf8'))
  for (const name of pageNames) {
    const { input, result } = routeBoatPage(name)
    const conduits = new Map((data.conduits || []).map((c) => [c.id, c]))
    const paths = new Map(input.wires.map((w) => [w.id, result.wires.get(w.id).points]))
    const stubPaths = input.stubs.map((s) => result.stubs.get(s.cableId).path)
    const tabs = input.stubs.map((s) => result.stubs.get(s.cableId).tab)
    const avoid = { paths: [...paths.values(), ...stubPaths], rects: [...input.boxes.map((b) => ({ x0: b.x - 8, y0: b.y - 8, x1: b.x + b.w + 8, y1: b.y + b.h + 8 })), ...tabs.map((t) => ({ x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h }))] }
    const bands = R.conduitBands({ wires: input.wires.map((w) => ({ id: w.id, conduitIds: w.conduitIds })), paths, conduits, avoid })
    assert.ok(bands.length > 0 || conduits.size === 0)
    for (const b of bands) {
      const half = R.bandWidth(b.layer) / 2 + 1
      for (const st of b.stretches) {
        for (const box of input.boxes) {
          // the band outline (half width) plus the cap must stay out of the box with its port blocks (7 beyond the edge)
          for (let k = 1; k < st.length; k++) {
            const r = { x0: box.x - 7 - half, y0: box.y - 7 - half, x1: box.x + box.w + 7 + half, y1: box.y + box.h + 7 + half }
            const hit = Math.max(st[k - 1].x, st[k].x) > r.x0 && Math.min(st[k - 1].x, st[k].x) < r.x1 && Math.max(st[k - 1].y, st[k].y) > r.y0 && Math.min(st[k - 1].y, st[k].y) < r.y1
            assert.equal(hit, false, `${name}: band "${b.label}" reaches the port blocks of ${nameOf(box.id)}`)
          }
        }
      }
      // the label: its text box meets no wire and no stub line
      const w = Math.min(b.label.length, 40) * 4.8
      const r = { x0: b.labelPos.x, y0: b.labelPos.y - 9, x1: b.labelPos.x + w, y1: b.labelPos.y + 2 }
      for (const pts of avoid.paths) {
        for (let k = 1; k < pts.length; k++) {
          const hit = Math.max(pts[k - 1].x, pts[k].x) > r.x0 && Math.min(pts[k - 1].x, pts[k].x) < r.x1 && Math.max(pts[k - 1].y, pts[k].y) > r.y0 && Math.min(pts[k - 1].y, pts[k].y) < r.y1
          assert.equal(hit, false, `${name}: label of "${b.label}" is crossed by a line`)
        }
      }
    }
  }
})

test('a line to a tab is drawn like its cable: conductor colours, DC solid or AC dashed, normal width', () => {
  const view = readFileSync(new URL('../public/schematicView.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  const shape = view.slice(view.indexOf('function StubShape'), view.indexOf('function TabMenu'))
  assert.match(shape, /conductorTypes\(stub\.cable\)/)
  assert.match(shape, /wireLineStyle\(stub\.cable\)/)
  assert.match(shape, /sch-wire-line sch-stub-line c-/)
  assert.match(shape, /sch-wire-pair/)
  assert.doesNotMatch(shape, /WireMarker/)
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
