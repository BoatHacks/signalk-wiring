#!/usr/bin/env node
'use strict'

// Reads the schematic layout from a running SignalK server and writes it to
// demo/source/layout.json, so boxes moved by hand on a server (drag a device on
// a schematic page, move a zone block) can be captured and the demo rebuilt
// with them. The builder lays pages out by itself; this file overrides what it
// would do.
//
//   node scripts/read-layout.js [token] [baseUrl] [output.json]
//
// token: a bearer token (the resources are readable by any logged in user).
// baseUrl: defaults to http://localhost:3000.
// Per page (by name): the box position of every device (by name) and the
// position and size of every zone block (by zone name). Removed pages are left
// out. Needs Node 18 or newer (fetch).

const fs = require('fs')
const path = require('path')

const OUT_PATH = path.join(__dirname, '..', 'demo', 'source', 'layout.json')

function layoutOf (schematics, devices, zones) {
  const deviceName = new Map(Object.entries(devices).map(([id, d]) => [id, d.name]))
  const zoneName = new Map(Object.entries(zones).map(([id, z]) => [id, z.name]))
  const pages = Object.values(schematics).filter((s) => s && s.status !== 'removed')
  pages.sort((a, b) => a.name.localeCompare(b.name))
  const out = {}
  for (const page of pages) {
    const entry = { devices: {}, zones: {} }
    const placed = [...(page.devices || [])].filter((p) => deviceName.has(p.deviceId))
    placed.sort((a, b) => deviceName.get(a.deviceId).localeCompare(deviceName.get(b.deviceId)))
    for (const p of placed) entry.devices[deviceName.get(p.deviceId)] = { x: p.x, y: p.y }
    const shapes = [...(page.zoneShapes || [])].filter((s) => zoneName.has(s.zoneId) && s.kind === 'rect')
    shapes.sort((a, b) => zoneName.get(a.zoneId).localeCompare(zoneName.get(b.zoneId)))
    for (const s of shapes) entry.zones[zoneName.get(s.zoneId)] = { x: s.x, y: s.y, width: s.width, height: s.height }
    out[page.name] = entry
  }
  return out
}

function format (layout) {
  const pageLines = Object.entries(layout).map(([name, entry]) => {
    const block = (map) => Object.entries(map).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,/g, ', ').replace(/:/g, ': ')}`).join(',\n')
    const parts = []
    parts.push(`    "devices": {\n${block(entry.devices)}\n    }`)
    parts.push(`    "zones": {\n${block(entry.zones)}\n    }`)
    return `  ${JSON.stringify(name)}: {\n${parts.join(',\n')}\n  }`
  })
  return `{\n${pageLines.join(',\n')}\n}\n`
}

async function main () {
  const [token, base = 'http://localhost:3000', output] = process.argv.slice(2)
  const root = base.replace(/\/+$/, '') + '/signalk/v2/api/resources/'
  const get = async (type) => {
    const res = await fetch(root + type, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new Error(`${root + type}: ${res.status} ${res.statusText}`)
    return res.json()
  }
  const layout = layoutOf(await get('wiringSchematics'), await get('wiringDevices'), await get('wiringZones'))
  const file = output ? path.resolve(output) : OUT_PATH
  fs.writeFileSync(file, format(layout))
  const count = Object.values(layout).reduce((n, p) => n + Object.keys(p.devices).length, 0)
  console.log(`wrote the layout of ${Object.keys(layout).length} pages (${count} boxes) to ${file}`)
}

module.exports = { layoutOf, format }

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1) })
