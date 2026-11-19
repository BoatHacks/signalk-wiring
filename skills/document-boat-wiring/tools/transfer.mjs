#!/usr/bin/env node
// Copies all wiring data from one SignalK server to another through the API:
// zones, devices, cables, conduits, NMEA 2000 backbones, floorplans with their
// drawings, schematic pages, circuit names, and every photo and file. Record
// ids are kept, so the two copies line up. Used to install the model built on
// a sandbox onto the boat's server, and to pull a boat's existing data into a
// sandbox.
//
//   node transfer.mjs --from http://localhost:3100 --to http://boat.local \
//     --to-token-file .wiring-token [--dry-run] [--merge] [--include-removed]
//
// The target must have no devices or cables yet, unless --merge is given (then
// records with the same id are overwritten). Writes need an admin token on the
// target if its security is on (see token.mjs).

import { parseArgs, fail } from './lib/args.mjs'
import { createClient, loadToken, pluginReady, pluginVersion } from './lib/client.mjs'
import { body, lateBody, pick, circuitUpdates } from './lib/transfer.mjs'

const args = parseArgs()
if (!args.from || !args.to) fail('usage: node transfer.mjs --from <server> --to <server> [--from-token-file f] [--to-token-file f] [--dry-run] [--merge] [--include-removed]')
const src = createClient({ url: args.from, token: loadToken({ tokenFile: args.fromTokenFile }) })
const dst = createClient({ url: args.to, token: loadToken({ tokenFile: args.toTokenFile }) })
for (const [label, c] of [['source', src], ['target', dst]]) {
  if (!(await pluginReady(c).catch((e) => fail(e.message)))) fail(`signalk-wiring does not answer on the ${label} (${c.base}): is it installed and enabled?`)
}
const [vFrom, vTo] = [await pluginVersion(src), await pluginVersion(dst)]
console.log(`source ${src.base} (signalk-wiring ${vFrom || '?'}) -> target ${dst.base} (signalk-wiring ${vTo || '?'})`)
if (vFrom && vTo && vFrom !== vTo) console.log('note: the plugin versions differ; fields the target does not know are ignored by it')

const opts = { includeRemoved: !!args.includeRemoved }
const read = async (kind) => src.list(kind).catch((err) => (err.status === 404 ? {} : Promise.reject(err)))
const source = {}
for (const kind of ['zone', 'device', 'wireRun', 'conduit', 'backbone', 'plan', 'schematic', 'circuit']) source[kind] = await read(kind)

const targetDevices = Object.keys(await dst.list('device')).length
const targetCables = Object.keys(await dst.list('wireRun')).length
if ((targetDevices || targetCables) && !args.merge) {
  fail(`The target already has ${targetDevices} devices and ${targetCables} cables. Copying would mix two data sets. ` +
    'Use --merge only if the target holds an earlier copy of the same data.')
}

const plan = Object.fromEntries(Object.entries(source).map(([k, m]) => [k, pick(m, k === 'zone' ? { includeRemoved: true } : opts)]))
console.log(Object.entries(plan).filter(([k]) => k !== 'circuit').map(([k, v]) => `${v.length} ${k}`).join(', '))
if (args.dryRun) process.exit(0)

const step = async (label, fn) => {
  try { return await fn() } catch (err) { throw new Error(`${label}: ${err.message}`) }
}

for (const [id, z] of plan.zone) await step(`zone ${z.name}`, () => dst.put('zone', id, body('zone', z)))
for (const [id, d] of plan.device) await step(`device ${d.name}`, () => dst.put('device', id, body('device', d)))
// Parent enclosures and battery monitors, once every device exists.
const deviceIds = new Set(plan.device.map(([id]) => id))
for (const [id, d] of plan.device) {
  const refs = lateBody('device', d)
  delete refs.iconAttachmentId
  if (refs.parentId && !deviceIds.has(refs.parentId)) delete refs.parentId
  if (refs.monitorDeviceId && !deviceIds.has(refs.monitorDeviceId)) delete refs.monitorDeviceId
  if (Object.keys(refs).length) await step(`device ${d.name}`, () => dst.put('device', id, refs))
}
for (const [id, c] of plan.wireRun) await step(`cable ${id}`, () => dst.put('wireRun', id, body('wireRun', c)))
const cableIds = new Set(plan.wireRun.map(([id]) => id))
for (const [id, k] of plan.conduit) {
  const b = body('conduit', k)
  b.cableIds = (k.cableIds || []).filter((c) => cableIds.has(c))
  await step(`conduit ${k.name}`, () => dst.put('conduit', id, b))
}
for (const [id, b] of plan.backbone) await step(`backbone ${b.name}`, () => dst.put('backbone', id, body('backbone', b)))
let drawings = 0
for (const [id, p] of plan.plan) {
  await step(`plan ${p.name}`, () => dst.put('plan', id, body('plan', p)))
  if (!p.filename) continue
  const res = await src.pluginRaw('GET', `/plans/${id}/image`)
  const type = (res.headers.get('content-type') || '').split(';')[0]
  await step(`plan drawing ${p.name}`, async () => dst.plugin('POST', `/plans/${id}/image`, { body: Buffer.from(await res.arrayBuffer()), raw: true, contentType: type }))
  drawings++
}
for (const [id, s] of plan.schematic) await step(`schematic ${s.name}`, () => dst.put('schematic', id, body('schematic', s)))

// Photos and files, then device icons that point at them.
const owners = [
  ...plan.device.map(([id]) => ['device', id]),
  ...plan.wireRun.map(([id]) => ['wireRun', id]),
  ...plan.conduit.map(([id]) => ['conduit', id]),
  ...plan.backbone.map(([id]) => ['backbone', id])
]
const idMap = {}
let files = 0
for (const [ownerType, ownerId] of owners) {
  const list = await src.plugin('GET', `/attachments?ownerType=${ownerType}&ownerId=${ownerId}`).catch(() => [])
  const already = args.merge ? await dst.plugin('GET', `/attachments?ownerType=${ownerType}&ownerId=${ownerId}`).catch(() => []) : []
  for (const a of list) {
    const same = already.find((x) => x.filename === a.filename)
    if (same) { idMap[a.id] = same.id; continue }
    const res = await src.pluginRaw('GET', `/attachments/${a.id}`)
    const created = await step(`file ${a.filename}`, async () => dst.plugin('POST',
      `/attachments?ownerType=${ownerType}&ownerId=${ownerId}&filename=${encodeURIComponent(a.filename)}`,
      { body: Buffer.from(await res.arrayBuffer()), raw: true, contentType: a.mimeType }))
    idMap[a.id] = created.id
    files++
  }
}
for (const [id, d] of plan.device) {
  if (d.iconAttachmentId && idMap[d.iconAttachmentId]) {
    await step(`icon of ${d.name}`, () => dst.put('device', id, { iconAttachmentId: idMap[d.iconAttachmentId] }))
  }
}

// Circuit names and notes: the target worked the circuits out itself.
const updates = circuitUpdates(source.circuit, await dst.list('circuit'))
for (const u of updates) await step(`circuit ${u.patch.name || u.id}`, () => dst.put('circuit', u.id, u.patch))

// Check the counts.
const count = async (c, kind) => Object.values(await c.list(kind).catch(() => ({}))).filter((r) => opts.includeRemoved || r.status !== 'removed').length
let mismatch = false
for (const kind of ['device', 'wireRun', 'conduit', 'backbone', 'plan', 'schematic', 'circuit']) {
  const [a, b] = [await count(src, kind), await count(dst, kind)]
  if (a !== b) mismatch = true
  console.log(`${kind}: source ${a}, target ${b}${a === b ? '' : '  <-- differs'}`)
}
console.log(`files copied: ${files}, plan drawings: ${drawings}, circuit names set: ${updates.length}`)
if (mismatch) fail('Counts differ: check the lines marked above before relying on the copy.')
console.log('Copy complete.')
