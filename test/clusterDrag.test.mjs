import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const view = readFileSync(new URL('../public/floorplanView.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')

test('each device in an open cluster list has a grip to drag it out onto the plan', () => {
  assert.match(view, /data-testid="cluster-drag"/)
  assert.match(view, /onPointerDown=\$\{\(e\) => startListDrag\(e, id\)\}/)
  // the drag saves through the same move action as dragging a marker, and only when released over the plan
  assert.match(view, /actions\.moveDevice\(id, plan\.view, a, b\)/)
  assert.match(view, /ev\.clientX < r\.left \|\| ev\.clientX > r\.right/)
  // the dragged device follows the pointer as a ghost, which keeps it out of its cluster
  assert.match(view, /setGhost\(\{ kind: 'device', key: id, px: toDrawing\(ev\)/)
  // released anywhere else, or cancelled, nothing is saved
  assert.match(view, /window\.addEventListener\('pointercancel', cancel\)/)
})

test('the list fades while a device is dragged out of it, and the grip is a touch handle', () => {
  assert.match(css, /\.cluster-list\.dragging \{ opacity: 0\.25; pointer-events: none; \}/)
  assert.match(css, /\.drag-grip \{[^}]*touch-action: none/)
})
