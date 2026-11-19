#!/usr/bin/env node
// Loads a boat's wiring data file into a SignalK server running
// signalk-wiring, through the resource API.
//
//   node seed.mjs <wiring-data.mjs> --url http://localhost:3100 [--token-file f]
//   node seed.mjs <wiring-data.mjs> --check         # validate only, no server
//
// Every record's id is derived from its key, so a rerun updates the same
// records. Meant for a sandbox server: it refuses any address that is not
// local unless --allow-remote is given, because on the boat's server it would
// overwrite edits the owner made in the web app.

import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs, fail } from './lib/args.mjs'
import { createClient, loadToken, pluginReady, isLocalUrl } from './lib/client.mjs'
import { normalizeData, validateData, deriveId, deviceBody, cableBody, circuitPatch, staleNameFix } from './lib/data.mjs'

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf' }

const args = parseArgs()
const file = args._[0]
if (!file) fail('usage: node seed.mjs <wiring-data.mjs> --url <server> [--token-file <file>] [--check] [--allow-remote]')
const dataPath = path.resolve(file)
const data = normalizeData(await import(pathToFileURL(dataPath).href))
const errors = validateData(data)
if (errors.length) fail(`The data file has ${errors.length} problem(s):\n- ${errors.join('\n- ')}`)
console.log(`data ok: ${data.devices.length} devices, ${data.cables.length} cables, ${data.conduits.length} conduits`)
if (args.check) process.exit(0)

if (!args.url) fail('--url is required (the sandbox server, e.g. http://localhost:3100)')
if (!isLocalUrl(args.url) && !args.allowRemote) {
  fail(`${args.url} is not a local server. The seed is for a sandbox; on the boat's server it would overwrite ` +
    'edits made in the web app. Use transfer.mjs to install on the boat, or pass --allow-remote if you really mean it.')
}
const client = createClient({ url: args.url, token: loadToken(args) })
if (!(await pluginReady(client).catch((e) => fail(e.message)))) fail(`signalk-wiring does not answer at ${args.url}: is it installed and enabled?`)

const ns = data.namespace
const id = (kind, key) => deriveId(ns, kind, key)

// Zones first, so they get the spelling from the data file.
for (const name of data.zones) await client.put('zone', id('zone', name.toLowerCase()), { name }).catch(() => {})

// Devices: first without references, then with them, so the order does not matter.
for (const d of data.devices) await client.put('device', id('device', d.key), deviceBody(d, ns, { withRefs: false }))
for (const d of data.devices.filter((x) => x.monitor || x.parent)) {
  await client.put('device', id('device', d.key), deviceBody(d, ns))
}
console.log(`devices: ${data.devices.length}`)

for (const c of data.cables) await client.put('wireRun', id('cable', c.key), cableBody(c, ns, data.units))
console.log(`cables: ${data.cables.length}`)

for (const k of data.conduits) {
  const { key, cables, zone, ...rest } = k
  await client.put('conduit', id('conduit', key), { ...rest, ...(zone ? { zone } : {}), cableIds: (cables || []).map((c) => id('cable', c)) })
}
if (data.conduits.length) console.log(`conduits: ${data.conduits.length}`)

// Retired records: remove, then delete for good. Cables before the devices they reference.
let purged = 0
for (const [kind, resource, keys] of [['cable', 'wireRun', data.retired.cables], ['conduit', 'conduit', data.retired.conduits], ['device', 'device', data.retired.devices]]) {
  for (const key of keys) {
    const rid = id(kind, key)
    let rec
    try { rec = await client.get(resource, rid) } catch (err) { if (err.status === 404) continue; throw err }
    if (rec.status !== 'removed') await client.remove(resource, rid)
    await client.purge(kind, rid)
    purged++
  }
}
if (purged) console.log(`retired records deleted: ${purged}`)

// Photos named on devices, cables and conduits (`photos: ['photos/x.jpg']`,
// relative to the data file). A file already attached by name is skipped.
let uploaded = 0
const owners = [
  ...data.devices.map((d) => ['device', id('device', d.key), d.photos]),
  ...data.cables.map((c) => ['wireRun', id('cable', c.key), c.photos]),
  ...data.conduits.map((k) => ['conduit', id('conduit', k.key), k.photos])
]
for (const [ownerType, ownerId, photos] of owners) {
  if (!photos || !photos.length) continue
  const existing = await client.plugin('GET', `/attachments?ownerType=${ownerType}&ownerId=${ownerId}`)
  for (const p of photos) {
    const full = path.resolve(path.dirname(dataPath), p)
    const filename = path.basename(full)
    if (existing.some((a) => a.filename === filename)) continue
    const mime = MIME[path.extname(full).toLowerCase()]
    if (!mime) fail(`${p}: only JPEG, PNG, WebP, HEIC and PDF can be attached`)
    await client.plugin('POST', `/attachments?ownerType=${ownerType}&ownerId=${ownerId}&filename=${encodeURIComponent(filename)}`,
      { body: fs.readFileSync(full), raw: true, contentType: mime })
    uploaded++
  }
}
if (uploaded) console.log(`photos uploaded: ${uploaded}`)

// Circuits are worked out by the plugin; name them.
const circuits = await client.list('circuit')
const deviceName = new Map(Object.entries(await client.list('device')).map(([i, d]) => [i, d.name]))
let named = 0
const unnamed = []
for (const [cid, circuit] of Object.entries(circuits)) {
  if (circuit.status === 'removed') continue
  const patch = circuitPatch(circuit, data)
  if (patch) {
    await client.put('circuit', cid, patch)
    named++
    continue
  }
  const fresh = staleNameFix(circuit, deviceName)
  if (fresh) await client.put('circuit', cid, { name: fresh })
  unnamed.push(fresh || circuit.name)
}
const active = Object.values(await client.list('circuit')).filter((c) => c.status !== 'removed')
const warnings = active.flatMap((c) => (c.derived && c.derived.warnings) || [])
console.log(`circuits: ${active.length} (${named} named by the data${unnamed.length ? `; still default-named: ${unnamed.length}` : ''})`)
if (unnamed.length) console.log(`  default-named: ${unnamed.slice(0, 15).join(' | ')}${unnamed.length > 15 ? ' ...' : ''}`)
console.log(`circuit warnings: ${warnings.length}`)
for (const w of warnings.slice(0, 20)) console.log(`  ${w.code}: ${w.message}`)
