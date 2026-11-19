#!/usr/bin/env node
// Lists what is still missing or uncertain in a server's wiring data, so the
// agent knows what to ask the owner next. Read-only; works on any server.
//
//   node gaps.mjs --url http://localhost:3100 [--token-file f] [--json]

import { parseArgs, fail } from './lib/args.mjs'
import { createClient, loadToken, pluginReady, pluginVersion } from './lib/client.mjs'
import { summarizeGaps } from './lib/gaps.mjs'

const args = parseArgs()
if (!args.url) fail('usage: node gaps.mjs --url <server> [--token-file <file>] [--json]')
const client = createClient({ url: args.url, token: loadToken(args) })
if (!(await pluginReady(client).catch((e) => fail(e.message)))) fail(`signalk-wiring does not answer at ${args.url}`)

const [devices, cables, circuits] = await Promise.all([client.list('device'), client.list('wireRun'), client.list('circuit')])
// The plugin's own derivation warnings and cable checks (0.9 and later).
const derived = await client.plugin('GET', '/derived').catch(() => null)
const checks = await client.plugin('GET', '/checks').catch(() => null)
const report = summarizeGaps({ devices, cables, circuits, derived, checks })
report.pluginVersion = await pluginVersion(client)

if (args.json) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const list = (title, items, fmt = (x) => x) => {
  console.log(`\n${title}: ${items.length}`)
  for (const x of items.slice(0, 40)) console.log(`  - ${fmt(x)}`)
  if (items.length > 40) console.log(`  ... and ${items.length - 40} more`)
}
console.log(`signalk-wiring ${report.pluginVersion || '(version unknown)'} at ${args.url}`)
console.log(`active: ${report.counts.devices} devices, ${report.counts.cables} cables, ${report.counts.circuits} circuits`)
list('Records tagged unverified', report.unverified, (x) => `${x.kind} ${x.name}`)
list('Fuses and breakers with no rating (they protect nothing until rated)', report.unratedProtectors)
list('Devices with no cable', report.unconnected)
list('Power cables with no gauge', report.noGauge)
list('Circuits with no protection', report.unprotected)
list('Circuit warnings', report.warnings, (w) => `${w.code}: ${w.message}`)
if (report.checks) {
  console.log(`\nCable checks: ${Object.entries(report.checks).map(([k, v]) => `${v} ${k}`).join(', ')}`)
  list('Cables failing a check', report.failingCables)
}
