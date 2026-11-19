#!/usr/bin/env node
// Crops part of a large scan or photo and enlarges it, so small print can be
// read. Uses whatever is on the computer: sips (macOS), ImageMagick, or
// Python with Pillow, in that order.
//
//   node crop.mjs <input> <output.png> <x> <y> <width> <height> [--scale 2]
//
// Coordinates are pixels of the original image. `node crop.mjs <input> --info`
// prints its size.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { parseArgs, fail } from './lib/args.mjs'

const args = parseArgs()
const [input, output, ...box] = args._
if (!input || !fs.existsSync(input)) fail('usage: node crop.mjs <input> <output.png> <x> <y> <width> <height> [--scale 2] | <input> --info')
const has = (cmd, test = ['-version']) => spawnSync(cmd, test, { stdio: 'ignore' }).status === 0
const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8' })
  if (r.status !== 0) fail(`${cmd} failed: ${r.stderr || r.stdout}`)
  return r.stdout
}
const py = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0)

if (args.info) {
  if (py) console.log(run(py, ['-c', 'import sys; from PIL import Image; print("%dx%d" % Image.open(sys.argv[1]).size)', input]).trim())
  else if (has('magick')) console.log(run('magick', ['identify', '-format', '%wx%h', input]))
  else if (process.platform === 'darwin') console.log(run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', input]))
  else fail('no image tool found: install Python with Pillow (pip install pillow) or ImageMagick')
  process.exit(0)
}

const [x, y, w, h] = box.map(Number)
if (!output || [x, y, w, h].some((n) => !Number.isFinite(n))) fail('give the output file and x y width height')
const scale = Number(args.scale || 2)

if (py) {
  run(py, ['-c', [
    'import sys',
    'from PIL import Image',
    'x, y, w, h, s = map(float, sys.argv[3:8])',
    'im = Image.open(sys.argv[1]).crop((int(x), int(y), int(x + w), int(y + h)))',
    'im = im.resize((int(w * s), int(h * s)), Image.LANCZOS)',
    'im.save(sys.argv[2])'
  ].join('\n'), input, output, x, y, w, h, scale].map(String))
} else if (has('magick')) {
  run('magick', [input, '-crop', `${w}x${h}+${x}+${y}`, '+repage', '-resize', `${scale * 100}%`, output])
} else if (process.platform === 'darwin') {
  // sips crops around offsets given as y x, then resamples by width.
  run('sips', ['-c', String(h), String(w), '--cropOffset', String(y), String(x), input, '--out', output])
  run('sips', ['--resampleWidth', String(Math.round(w * scale)), output])
} else {
  fail('no image tool found: install Python with Pillow (pip install pillow) or ImageMagick')
}
console.log(`wrote ${output}`)
