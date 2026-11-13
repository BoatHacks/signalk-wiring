#!/usr/bin/env node
'use strict'

// First-pass positions for the demo yacht's devices (plan 0035 step 3):
// writes demo/source/positions.json (device name to x, y, z in meters) from
// the zone boxes below and the device list of demo/source/boat.json.
//
//   node scripts/place-demo.js
//
// Boat coordinates: x from the stern toward the bow (the hull outline is
// 10.9 m long), y athwartships with 0 on the centerline and positive to port
// (the top of a top view, bow to the right), z above the waterline (the deck
// is about 1.0 m, the coachroof top about 1.6 m). A zone's devices are spread
// in an even grid over its box in the order of the spec; a few devices have
// a fixed place or height instead. The result is deterministic. Devices
// inside an enclosure are not placed (the enclosure is). Rerun after changing
// the spec; read-positions.js brings manual adjustments back from a server.

const fs = require('fs')
const path = require('path')
const { calibrationFor, pointInPolygon, readHull } = require('./demo-geometry')

const ROOT = path.join(__dirname, '..')
const SPEC_PATH = path.join(ROOT, 'demo', 'source', 'boat.json')
const OUT_PATH = path.join(ROOT, 'demo', 'source', 'positions.json')

const DECK_Z = 1.0

// Zone boxes from the interior drawing: x range, y range (positive to port)
// and the usual height of what sits there. Bulkheads of the drawing at 3.24
// (main), 3.9 and 5.6 (galley and nav station) and 7.6 and 8.1 (saloon) m.
const ZONES = {
  Lazarette: { x: [1.5, 3.0], y: [-0.4, 0.4], z: 0.55 },
  'Aft cabin': { x: [2.2, 3.0], y: [0.6, 1.1], z: 0.5 },
  'Engine room': { x: [3.35, 4.85], y: [-0.45, 0.45], z: 0.2 },
  Galley: { x: [4.0, 5.5], y: [0.55, 1.3], z: 0.7 },
  'Nav station': { x: [4.0, 5.5], y: [-1.3, -0.55], z: 0.8 },
  Saloon: { x: [5.75, 7.45], y: [-1.2, 1.2], z: 0.75 },
  'Forward cabin': { x: [8.3, 9.2], y: [-0.5, 0.5], z: 0.7 },
  Forepeak: { x: [9.3, 10.3], y: [-0.2, 0.2], z: 0.2 },
  // Above deck: fixed places only.
  Cockpit: null,
  Deck: null,
  Mast: null
}

// Heights that differ from the zone's usual one.
const Z = {
  'House battery': 0.05,
  'Starter battery': 0.05,
  'Bow thruster battery': 0.1,
  'Bow thruster': 0.1,
  'Depth sensor': 0.1,
  'Bilge pump': 0.2,
  'Starter motor': 0.05,
  'Engine alternator': 0.1,
  'Saloon lights': 0.95,
  'Cabin lights': 0.95,
  'Ambilight TV': 0.8,
  'Radio saloon': 0.9,
  'Radio galley': 0.95,
  Chartplotter: 0.95,
  'AIS power': 0.9,
  'VHF power': 0.95
}

// Fixed places above the deck and aloft; the mast is at 6.75 m, a little ahead
// of amidships, and about 13.9 m tall.
const FIXED = {
  'Bimini solar array': [1.9, 0, 2.3],
  'Bimini PV fuse': [1.9, 0.5, 1.9],
  'Stern light': [0.55, 0, 1.45],
  'Cockpit alarm': [2.7, 0.6, 1.15],
  Instruments: [2.9, 0, 1.3],
  'Shore power inlet': [1.3, -1.0, 1.2],
  'Deck port solar array': [5.4, 0.9, 1.65],
  'Deck port PV fuse': [4.9, 0.9, 1.62],
  'Deck starboard solar array': [5.4, -0.9, 1.65],
  'Deck starboard PV fuse': [4.9, -0.9, 1.62],
  'Navigation lights': [10.45, 0, 1.35],
  'Deck light': [9.2, 0, 1.45],
  'Wind sensor': [6.65, 0, 13.7],
  Tricolour: [6.75, 0, 13.3],
  'Anchor light': [6.85, 0, 12.9],
  'Steaming light': [6.85, 0, 6.5]
}

const round2 = (v) => Math.round(v * 100) / 100

function place (spec) {
  const out = {}
  const byZone = new Map()
  for (const d of spec.devices) {
    if (d.parent) continue // inside an enclosure: not placed
    if (FIXED[d.name]) { out[d.name] = FIXED[d.name].map(round2); continue }
    if (!byZone.has(d.zone)) byZone.set(d.zone, [])
    byZone.get(d.zone).push(d)
  }
  for (const [zone, list] of byZone) {
    const box = ZONES[zone]
    if (!box) throw new Error(`zone ${zone} has no box and device ${list[0].name} no fixed place`)
    const [x0, x1] = box.x
    const [y0, y1] = box.y
    const n = list.length
    const rows = Math.max(1, Math.round(Math.sqrt((n * (y1 - y0)) / (x1 - x0))))
    const cols = Math.ceil(n / rows)
    list.forEach((d, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      out[d.name] = [
        round2(x0 + ((col + 0.5) * (x1 - x0)) / cols),
        round2(y1 - ((row + 0.5) * (y1 - y0)) / rows), // port first
        round2(Z[d.name] ?? box.z)
      ]
    })
  }
  for (const name of Object.keys(FIXED)) if (!out[name]) throw new Error(`fixed device ${name} is not in the spec`)
  for (const name of Object.keys(Z)) if (!out[name]) throw new Error(`height for ${name}, which is not placed`)
  return out
}

// A drawing point for a position on a top view.
function topPx (cal, x, y) { return [cal.originPx[0] + x * cal.pxPerMeter, cal.originPx[1] - y * cal.pxPerMeter] }

function verify (spec, positions) {
  const [deck, inside] = ['Deck', 'Interior'].map((name) => {
    const plan = spec.plans.find((p) => p.name === name)
    const file = path.join(ROOT, 'demo', 'source', 'drawings', plan.drawing)
    return { cal: calibrationFor(plan.originPx, plan.bowPx, spec.hullLengthM), hull: readHull(file) }
  })
  const seen = new Map()
  for (const [name, [x, y, z]] of Object.entries(positions)) {
    const plan = z >= DECK_Z ? deck : inside
    if (!pointInPolygon(plan.hull, topPx(plan.cal, x, y))) throw new Error(`${name} at ${x}, ${y} is outside the hull`)
    const key = `${x},${y},${z}`
    if (seen.has(key)) throw new Error(`${name} and ${seen.get(key)} share a position`)
    seen.set(key, name)
  }
}

// One device per line: stable, readable and easy to diff.
function formatPositions (positions) {
  const lines = Object.entries(positions).map(([name, p]) => ` ${JSON.stringify(name)}: ${JSON.stringify(p).replace(/,/g, ', ').replace(/:/g, ': ')}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

function main () {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'))
  const out = place(spec)
  verify(spec, out)
  const positions = Object.fromEntries(Object.entries(out).map(([name, [x, y, z]]) => [name, { x, y, z }]))
  fs.writeFileSync(OUT_PATH, formatPositions(positions))
  console.log(`placed ${Object.keys(positions).length} devices in ${OUT_PATH}`)
}

module.exports = { place, ZONES, FIXED, DECK_Z }

if (require.main === module) main()
