#!/usr/bin/env node
// Gets an access token for a SignalK server without anyone typing a password
// into the agent: it files a SignalK access request, the owner approves it in
// the server's Admin UI (Security > Access Requests) and picks the permission,
// and the token is saved to a file only the owner can read.
//
//   node token.mjs --url http://boat.local --out .wiring-token [--name "Wiring documentation"]
//
// Writing wiring data needs the "Admin" permission. A server with security
// off needs no token at all; this tool says so and exits.

import fs from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { parseArgs, fail } from './lib/args.mjs'

const args = parseArgs()
if (!args.url || !args.out) fail('usage: node token.mjs --url <server> --out <token file> [--name <description>] [--timeout-min 15]')
const base = args.url.replace(/\/+$/, '')
const description = args.name || `Wiring documentation (${os.hostname()})`
const clientId = randomUUID()

const res = await fetch(`${base}/signalk/v1/access/requests`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId, description, permissions: 'admin' })
})
if (res.status === 404) {
  console.log(`${base} has security turned off, so no token is needed. Run the other tools without --token-file.`)
  process.exit(0)
}
if (!res.ok && res.status !== 202) fail(`access request refused: ${res.status} ${await res.text()}`)
const body = await res.json()
const href = body.href || (body.requestId && `/signalk/v1/requests/${body.requestId}`)
if (!href) fail(`unexpected answer from the server: ${JSON.stringify(body)}`)

console.log(`Access request sent as "${description}".`)
console.log(`Approve it now: open ${base}/admin/, go to Security > Access Requests, choose permission "Admin", and approve.`)
console.log('Waiting for approval...')

const deadline = Date.now() + Number(args.timeoutMin || 15) * 60_000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const poll = await fetch(base + href).then((r) => r.json()).catch(() => null)
  if (!poll || poll.state !== 'COMPLETED') continue
  const result = poll.accessRequest || {}
  if (result.permission !== 'APPROVED' || !result.token) fail('The access request was denied.')
  fs.writeFileSync(args.out, result.token + '\n', { mode: 0o600 })
  console.log(`Approved. Token saved to ${args.out} (readable by you only). Keep it out of any repository.`)
  process.exit(0)
}
fail('No approval within the time limit. Run the tool again when you are at the Admin UI.')
