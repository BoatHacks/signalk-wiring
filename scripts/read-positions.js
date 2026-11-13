#!/usr/bin/env node
'use strict'

// Reads the device positions from a running SignalK server and writes them to
// demo/source/positions.json, so adjustments made by hand on a live server
// (dragging devices on the floorplan) can be captured and the demo rebuilt
// with them.
//
//   node scripts/read-positions.js [token] [baseUrl] [output.json]
//
// token: a bearer token (the resources are readable by any logged in user;
//        leave it out or pass "" on a server without security).
// baseUrl: defaults to http://localhost:3000.
// Only devices with a position are written, by name, with the axes that are
// set. Removed devices and devices inside an enclosure (which are not placed)
// are left out. Needs Node 18 or newer (fetch).

const fs = require('fs')
const path = require('path')

const OUT_PATH = path.join(__dirname, '..', 'demo', 'source', 'positions.json')

function positionsOf (devices) {
  const out = {}
  const list = Object.values(devices).filter((d) => d && d.status !== 'removed' && !d.parentId)
  list.sort((a, b) => a.name.localeCompare(b.name))
  for (const d of list) {
    const at = {}
    for (const axis of ['x', 'y', 'z']) {
      const value = d[`pos${axis.toUpperCase()}`]
      if (typeof value === 'number') at[axis] = value
    }
    if (Object.keys(at).length > 0) out[d.name] = at
  }
  return out
}

async function main () {
  const [token, base = 'http://localhost:3000', output] = process.argv.slice(2)
  const url = `${base.replace(/\/+$/, '')}/signalk/v2/api/resources/wiringDevices`
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  const positions = positionsOf(await res.json())
  const lines = Object.entries(positions).map(([name, p]) => ` ${JSON.stringify(name)}: ${JSON.stringify(p).replace(/,/g, ', ').replace(/:/g, ': ')}`)
  const file = output ? path.resolve(output) : OUT_PATH
  fs.writeFileSync(file, `{\n${lines.join(',\n')}\n}\n`)
  console.log(`wrote ${Object.keys(positions).length} positions to ${file}`)
}

module.exports = { positionsOf }

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1) })
