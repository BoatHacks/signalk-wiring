'use strict'

// Geometry shared by the demo scripts and tests (plan 0035): the hull outline
// of a drawing as a polygon, and the demo plans' calibration. No dependencies.
// Boat coordinates are meters: x from the stern toward the bow, y athwartships
// with 0 on the centerline and positive toward the top of a top view (port,
// with the bow to the right), z height above the waterline.

const fs = require('fs')

// The calibration object the app stores, for a drawing whose hull outline runs
// from originPx (the stern end, on the centerline or waterline) to bowPx, with
// the bow to the right. Same numbers calibrationFromClicks gives for those two
// clicks and the real hull length.
function calibrationFor (originPx, bowPx, lengthM) {
  const dx = bowPx[0] - originPx[0]
  const dy = bowPx[1] - originPx[1]
  const len = Math.hypot(dx, dy)
  return {
    originPx: [originPx[0], originPx[1]],
    pxPerMeter: Math.round((len / lengthM) * 1e6) / 1e6,
    dir: [dx / len, dy / len],
    flip: false
  }
}

// The path data of the hull outline: the first path whose class is "hull" or
// "hull-outline". Only absolute M, L, C and Z commands are expected.
function hullPathData (svgText) {
  const m = /<path\b[^>]*class="hull(?:-outline)?"[^>]*\sd="([^"]+)"/.exec(svgText) ||
    /<path\b[^>]*\sd="([^"]+)"[^>]*class="hull(?:-outline)?"/.exec(svgText)
  if (!m) throw new Error('no hull path in the drawing')
  return m[1]
}

// The hull outline as a list of [x, y] drawing points, curves sampled.
function hullPolygon (svgText, steps = 24) {
  const tokens = hullPathData(svgText).match(/[MLCZ]|-?[\d.]+/g)
  const pts = []
  let i = 0
  let cur = null
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M' || cmd === 'L') { cur = [num(), num()]; pts.push(cur) } else if (cmd === 'C') {
      while (i < tokens.length && !/[A-Z]/.test(tokens[i])) {
        const c1 = [num(), num()]
        const c2 = [num(), num()]
        const e = [num(), num()]
        for (let s = 1; s <= steps; s++) {
          const t = s / steps
          const u = 1 - t
          pts.push([0, 1].map((k) => u * u * u * cur[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * e[k]))
        }
        cur = e
      }
    } else if (cmd !== 'Z') throw new Error(`unsupported path command ${cmd}`)
  }
  return pts
}

function pointInPolygon (poly, [px, py]) {
  let inside = false
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [ax, ay] = poly[a]
    const [bx, by] = poly[b]
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

function readHull (file) { return hullPolygon(fs.readFileSync(file, 'utf8')) }

module.exports = { calibrationFor, hullPolygon, pointInPolygon, readHull }
