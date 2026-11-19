#!/usr/bin/env node
// A throwaway local SignalK server with signalk-wiring, for building and
// reviewing a boat's wiring model before it goes on the boat. Everything
// lives in one folder: the server, its config, the plugin and its database.
// Security is off, so no login is needed; it listens on this computer only.
//
//   node sandbox.mjs up     [--dir wiring-sandbox] [--port 3100] [--plugin signalk-wiring@latest] [--server signalk-server@latest]
//   node sandbox.mjs status [--dir wiring-sandbox]
//   node sandbox.mjs down   [--dir wiring-sandbox]
//
// --plugin may be an npm version spec or a path to a plugin checkout.
// Deleting the folder removes the sandbox completely.

import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs, fail } from './lib/args.mjs'

const args = parseArgs()
const cmd = args._[0]
const dir = path.resolve(args.dir || 'wiring-sandbox')
const stateFile = path.join(dir, 'sandbox.json')
const configDir = path.join(dir, 'config')
const serverDir = path.join(dir, 'server')
const serverBin = path.join(serverDir, 'node_modules', 'signalk-server', 'bin', 'signalk-server')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const readState = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null)
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } }

function checkNode () {
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj < 22 || (maj === 22 && min < 13)) fail(`Node.js ${process.versions.node} is too old: signalk-wiring needs 22.13 or newer.`)
}

function run (cwd, argv, label) {
  console.log(`${label}...`)
  const r = spawnSync(npm, argv, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) fail(`${label} failed`)
}

// A port is free when nothing answers on it and it can be bound on all
// addresses, the way signalk-server binds it. Binding 127.0.0.1 alone can
// succeed on macOS while another server holds the wildcard address.
const answers = (port) => new Promise((resolve) => {
  const sock = net.connect(port, '127.0.0.1')
  sock.once('connect', () => { sock.destroy(); resolve(true) })
  sock.once('error', () => resolve(false))
})
const bindable = (port) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)))
  s.listen(port)
})
const portFree = async (port) => !(await answers(port)) && (await bindable(port))

async function waitReady (url, seconds) {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    try {
      // 401 or 403 also means the plugin answers, on a sandbox with security on.
      const r = await fetch(`${url}/signalk/v2/api/resources/wiringZones`)
      if (r.ok || r.status === 401 || r.status === 403) return true
    } catch (e) {}
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return false
}

async function up () {
  checkNode()
  const state = readState()
  if (state && alive(state.pid)) {
    console.log(`already running: ${state.url} (pid ${state.pid})`)
    return
  }
  fs.mkdirSync(serverDir, { recursive: true })
  fs.mkdirSync(path.join(configDir, 'plugin-config-data'), { recursive: true })

  if (!fs.existsSync(serverBin)) {
    if (!fs.existsSync(path.join(serverDir, 'package.json'))) fs.writeFileSync(path.join(serverDir, 'package.json'), '{"name":"wiring-sandbox-server","private":true}\n')
    run(serverDir, ['install', '--no-audit', '--no-fund', args.server || 'signalk-server@latest'], 'Installing signalk-server (a few minutes the first time)')
  }
  const pluginInstalled = fs.existsSync(path.join(configDir, 'node_modules', 'signalk-wiring', 'package.json'))
  if (!pluginInstalled || args.plugin) {
    if (!fs.existsSync(path.join(configDir, 'package.json'))) fs.writeFileSync(path.join(configDir, 'package.json'), '{"name":"wiring-sandbox-config","private":true}\n')
    const spec = args.plugin || 'signalk-wiring@latest'
    const local = fs.existsSync(spec)
    run(configDir, ['install', '--no-audit', '--no-fund', ...(local ? ['--install-links', path.resolve(spec)] : [spec])], `Installing ${local ? 'signalk-wiring from ' + spec : spec}`)
  }
  const settings = path.join(configDir, 'settings.json')
  // mDNS and the two TCP stream servers (NMEA 0183 on 10110, Signal K on 8375)
  // are off: a sandbox needs none of them, and their fixed ports would clash
  // with another SignalK server on this computer.
  if (!fs.existsSync(settings)) {
    fs.writeFileSync(settings, JSON.stringify({ interfaces: { 'nmea-tcp': false, tcp: false }, mdns: false, pipedProviders: [] }, null, 2) + '\n')
  }
  const pluginConfig = path.join(configDir, 'plugin-config-data', 'signalk-wiring.json')
  if (!fs.existsSync(pluginConfig)) {
    const configuration = {}
    if (args.lengthUnit) configuration.defaultLengthUnit = args.lengthUnit
    if (args.gaugeUnit) configuration.defaultGaugeUnit = args.gaugeUnit
    fs.writeFileSync(pluginConfig, JSON.stringify({ enabled: true, configuration }, null, 2) + '\n')
  }

  let port = Number(args.port || 3100)
  if (!args.port) while (!(await portFree(port))) port++
  else if (!(await portFree(port))) fail(`port ${port} is in use`)

  const log = fs.openSync(path.join(dir, 'server.log'), 'a')
  const child = spawn(process.execPath, [serverBin, '-c', configDir], {
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true
  })
  child.unref()
  const url = `http://localhost:${port}`
  fs.writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port, url }, null, 2) + '\n')
  console.log(`starting signalk-server on ${url} (pid ${child.pid}, log ${path.join(dir, 'server.log')})`)
  if (!(await waitReady(url, 120))) fail(`the server did not answer in time; see ${path.join(dir, 'server.log')}`)
  console.log(`ready: web app ${url}/signalk-wiring/   admin ${url}/admin/`)
}

function status () {
  const state = readState()
  if (!state) return console.log(`no sandbox in ${dir}`)
  console.log(alive(state.pid) ? `running: ${state.url} (pid ${state.pid})` : `stopped (last address ${state.url})`)
}

function down () {
  const state = readState()
  if (!state || !alive(state.pid)) return console.log('not running')
  process.kill(state.pid, 'SIGTERM')
  console.log(`stopped pid ${state.pid}. The data stays in ${configDir}; delete ${dir} to remove the sandbox.`)
}

if (cmd === 'up') await up()
else if (cmd === 'status') status()
else if (cmd === 'down') down()
else fail('usage: node sandbox.mjs up|status|down [--dir <folder>] [--port <n>] [--plugin <spec or path>] [--server <spec>]')
