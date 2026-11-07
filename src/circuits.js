'use strict'

// Works out the circuits from the devices and cables (wire runs) of a boat.
// Pure: no database, no side effects, so it is cheap to test with small boats
// (test/circuits.test.js). Plan 0014 describes the rules; in short:
//
//   A circuit is what one fuse or breaker protects: that device, the cables
//   on both sides of it up to the nearest bus bar, and everything downstream
//   until the next fuse or breaker. Switches and splices pass a circuit
//   through. A cable that no fuse or breaker covers is still a circuit, keyed
//   by its first cable and flagged unprotected.
//
// Input
//   devices: [{ id, name, role, status, tripRatingA?, nominalVoltage?,
//               terminals?: [{ name, conductor, port?, voltage? }] }]
//   cables:  [{ id, fromDeviceId, toDeviceId, status,
//               conductors?: [{ conductor, fromDeviceId?, toDeviceId?,
//                               fromTerminal?, toTerminal? }] }]
//   From is the supply side of a cable and To the load side. A cable with no
//   conductors listed is a single positive conductor.
//
// Output
//   { circuits, banks, warnings, feeds }, everything sorted so the same data always
//   gives the same answer.

const POSITIVE_CONDUCTORS = new Set(['positive', 'line'])
const RETURN_TARGET_ROLES = new Set(['storage', 'source', 'converter'])
const MAX_RETURN_PATHS = 5000

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function deriveCircuits ({ devices = [], cables = [] }) {
  const warnings = []
  const live = new Map(devices.filter((d) => d.status !== 'removed').map((d) => [d.id, d]))

  // ---- Cables: drop the removed ones and any that point at a missing device.
  const usable = []
  for (const cable of [...cables].sort((a, b) => byString(a.id, b.id))) {
    if (cable.status === 'removed') continue
    const conductors = cable.conductors && cable.conductors.length > 0
      ? cable.conductors
      : [{ conductor: 'positive' }]
    const ends = [cable.fromDeviceId, cable.toDeviceId]
    for (const c of conductors) ends.push(c.fromDeviceId, c.toDeviceId)
    const missing = ends.find((id) => id && !live.has(id))
    if (missing !== undefined || !live.has(cable.fromDeviceId) || !live.has(cable.toDeviceId)) {
      warnings.push({
        code: 'missing-device',
        cableId: cable.id,
        message: `Cable ${cable.id} goes to a device that does not exist or has been removed.`
      })
      continue
    }
    usable.push({ ...cable, conductors })
  }

  // ---- Battery banks: storage-to-storage cables join batteries and are not circuits.
  const isBankLink = (cable) =>
    live.get(cable.fromDeviceId).role === 'storage' && live.get(cable.toDeviceId).role === 'storage'
  const bankCables = usable.filter(isBankLink)
  const banks = buildBanks(bankCables)
  const wiring = usable.filter((c) => !isBankLink(c))

  // ---- The positive graph: one edge per cable that carries a positive or line conductor.
  const nodes = new Map()
  const edges = []
  const nodeFor = (cable, deviceId, terminalName, endName) => {
    const device = live.get(deviceId)
    if (device.role !== 'converter') return registerNode(nodes, device, deviceId, null)
    const terminal = (device.terminals || []).find((t) => t.name === terminalName)
    if (!terminal) {
      warnings.push({
        code: 'converter-port-unknown',
        cableId: cable.id,
        deviceId,
        message: `Cable ${cable.id} ends on converter ${device.name || deviceId} (${endName} end) without saying which terminal, so the circuit on that side cannot be told.`
      })
      return registerNode(nodes, device, `${deviceId}#`, null)
    }
    const port = terminal.port || terminal.name
    return registerNode(nodes, device, `${deviceId}#${port}`, port)
  }

  for (const cable of wiring) {
    const conductor = cable.conductors.find((c) => POSITIVE_CONDUCTORS.has(c.conductor))
    if (!conductor) continue
    const fromId = conductor.fromDeviceId || cable.fromDeviceId
    const toId = conductor.toDeviceId || cable.toDeviceId
    const from = nodeFor(cable, fromId, conductor.fromTerminal, 'From')
    const to = nodeFor(cable, toId, conductor.toTerminal, 'To')
    if (from.role === 'consumer' || to.role === 'source') {
      warnings.push({
        code: 'backwards',
        cableId: cable.id,
        message: `Cable ${cable.id} runs from a ${from.role === 'consumer' ? 'load' : 'supply'} the wrong way round: From should be the supply side.`
      })
    }
    edges.push({ id: cable.id, from, to, conductor: conductor.conductor })
  }

  const out = new Map()
  const inn = new Map()
  for (const node of nodes.values()) { out.set(node.id, []); inn.set(node.id, []) }
  for (const e of edges) { out.get(e.from.id).push(e); inn.get(e.to.id).push(e) }

  const isTerminator = (n) => n.kind === 'terminator'
  const isProtector = (n) => n.kind === 'protector'

  // A cable "heads" a protected branch when the next device after any plain
  // series devices (switches) is a fuse or breaker.
  const protectorHeaded = (edge) => {
    const seen = new Set()
    let node = edge.to
    while (node && !seen.has(node.id)) {
      if (isProtector(node)) return true
      seen.add(node.id)
      const next = out.get(node.id)
      if (node.kind === 'pass' && next.length === 1) node = next[0].to
      else return false
    }
    return false
  }
  // A bus bar is an unrated device where at least two cables leave and at
  // least one of them starts a protected branch. A splice, where every cable
  // leaving goes straight on to loads, stays inside one circuit.
  const isBus = (node) =>
    node.kind === 'pass' && out.get(node.id).length >= 2 && out.get(node.id).some(protectorHeaded)

  // ---- Who owns each cable.
  const owner = new Map() // cable id -> protector node id
  const protectors = [...nodes.values()].filter(isProtector).sort((a, b) => byString(a.id, b.id))

  // Downstream from each fuse: its outgoing cables and whatever follows,
  // through switches and splices, until a load, another fuse, or a bus bar.
  for (const p of protectors) {
    const seen = new Set()
    const walk = (node) => {
      if (seen.has(node.id)) return
      seen.add(node.id)
      for (const e of out.get(node.id)) {
        if (!owner.has(e.id)) owner.set(e.id, p.id)
        const next = e.to
        if (!isTerminator(next) && !isProtector(next) && !isBus(next)) walk(next)
      }
    }
    walk(p)
  }
  // Upstream of each fuse: the cables feeding it, back to a source, a bus
  // bar or another fuse.
  for (const p of protectors) {
    const seen = new Set()
    const walk = (node) => {
      if (seen.has(node.id)) return
      seen.add(node.id)
      for (const e of inn.get(node.id)) {
        if (!owner.has(e.id)) owner.set(e.id, p.id)
        const prev = e.from
        if (prev.kind === 'pass' && !isBus(prev)) walk(prev)
      }
    }
    walk(p)
  }

  // Cables no fuse covers group by the switches and splices they share.
  const leftover = edges.filter((e) => !owner.has(e.id))
  const parent = new Map(leftover.map((e) => [e.id, e.id]))
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb) }
  const ownerless = new Set(leftover.map((e) => e.id))
  for (const node of nodes.values()) {
    if (node.kind !== 'pass' || isBus(node)) continue
    const touching = [...out.get(node.id), ...inn.get(node.id)].filter((e) => ownerless.has(e.id))
    for (let i = 1; i < touching.length; i++) union(touching[0].id, touching[i].id)
  }
  const groups = new Map() // group key -> { protector, edges }
  for (const e of edges) {
    const protectorId = owner.get(e.id)
    const key = protectorId ? `protector:${nodes.get(protectorId).deviceId}` : `unprotected:${find(e.id)}`
    if (!groups.has(key)) groups.set(key, { protector: protectorId ? nodes.get(protectorId) : null, edges: [] })
    groups.get(key).edges.push(e)
  }

  // ---- Return (negative) network, over devices.
  const negative = buildNegativeGraph(wiring)

  const circuits = []
  for (const group of groups.values()) {
    const cableIds = group.edges.map((e) => e.id).sort(byString)
    const key = group.protector ? `protector:${group.protector.deviceId}` : `cable:${cableIds[0]}`

    const toIds = new Set(group.edges.map((e) => e.to.id))
    const fromIds = new Set(group.edges.map((e) => e.from.id))
    const boundary = [...group.edges.map((e) => e.from)].filter((n) => !toIds.has(n.id))
    const supply = traceSupply(boundary, inn, isTerminator)
    const endNodes = group.edges.map((e) => e.to).filter((n) => isTerminator(n) && !fromIds.has(n.id))
    const endDeviceIds = unique(endNodes.map((n) => n.deviceId))
    const deviceIds = unique(group.edges.flatMap((e) => [e.from.deviceId, e.to.deviceId]))

    const returns = traceReturns(endDeviceIds, live, negative, warnings)

    circuits.push({
      key,
      protectorId: group.protector ? group.protector.deviceId : null,
      unprotected: !group.protector,
      cableIds,
      returnCableIds: returns.cableIds,
      implicitReturnDeviceIds: returns.implicitDeviceIds,
      deviceIds,
      supplyDeviceIds: unique(supply.map((n) => n.deviceId)),
      endDeviceIds,
      ratingA: group.protector ? group.protector.tripRatingA : null,
      voltage: firstNumber(supply.map((n) => n.voltage)),
      ac: group.edges.some((e) => e.conductor === 'line')
    })
  }

  circuits.sort((a, b) => byString(a.key, b.key))
  warnings.sort((a, b) => byString(`${a.code}:${a.cableId || ''}:${a.deviceId || ''}`, `${b.code}:${b.cableId || ''}:${b.deviceId || ''}`))
  // The positive feeds, by device: what the switching and metering derivation
  // (src/switchability.js) walks. From is the supply side.
  const feeds = edges
    .map((e) => ({ cableId: e.id, fromDeviceId: e.from.deviceId, toDeviceId: e.to.deviceId }))
    .sort((a, b) => byString(a.cableId, b.cableId))
  return { circuits, banks, warnings, feeds }
}

function registerNode (nodes, device, id, port) {
  if (!nodes.has(id)) {
    // A device with no role counts as a consumer, the default.
    const role = device.role || 'consumer'
    let kind = 'terminator' // storage, source, consumer and converter ports end a circuit
    if (role === 'distribution') kind = device.tripRatingA > 0 ? 'protector' : 'pass'
    const portVoltage = port
      ? firstNumber((device.terminals || []).filter((t) => (t.port || t.name) === port).map((t) => t.voltage))
      : null
    nodes.set(id, {
      id,
      deviceId: device.id,
      role,
      kind,
      voltage: port ? portVoltage : numberOrNull(device.nominalVoltage),
      tripRatingA: numberOrNull(device.tripRatingA)
    })
  }
  return nodes.get(id)
}

function buildBanks (bankCables) {
  const parent = new Map()
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) x = parent.get(x); return x }
  for (const c of bankCables) {
    const a = find(c.fromDeviceId); const b = find(c.toDeviceId)
    if (a !== b) parent.set(b, a)
  }
  const banks = new Map()
  for (const c of bankCables) {
    const root = find(c.fromDeviceId)
    if (!banks.has(root)) banks.set(root, { batteryIds: new Set(), cableIds: [] })
    banks.get(root).batteryIds.add(c.fromDeviceId)
    banks.get(root).batteryIds.add(c.toDeviceId)
    banks.get(root).cableIds.push(c.id)
  }
  return [...banks.values()]
    .map((b) => ({ batteryIds: [...b.batteryIds].sort(byString), cableIds: b.cableIds.sort(byString) }))
    .sort((a, b) => byString(a.batteryIds[0], b.batteryIds[0]))
}

function buildNegativeGraph (wiring) {
  const adjacency = new Map()
  const add = (a, b, cableId) => {
    if (!adjacency.has(a)) adjacency.set(a, [])
    adjacency.get(a).push({ to: b, cableId })
  }
  for (const cable of wiring) {
    for (const c of cable.conductors) {
      if (c.conductor !== 'negative') continue
      const a = c.fromDeviceId || cable.fromDeviceId
      const b = c.toDeviceId || cable.toDeviceId
      add(a, b, cable.id)
      add(b, a, cable.id)
    }
  }
  return adjacency
}

// Cables that lie on a path from a load back to a supply end (a battery,
// source or converter), without passing through another consumer. A wire
// shared by several loads therefore serves each of their circuits. A
// consumer with no negative recorded at all is assumed to return alongside
// its feed.
function traceReturns (endDeviceIds, live, negative, warnings) {
  const cableIds = new Set()
  const implicit = []
  for (const startId of endDeviceIds) {
    const start = live.get(startId)
    if (!start || (start.role && start.role !== 'consumer')) continue
    if (!negative.has(startId)) { implicit.push(startId); continue }

    let found = false
    let paths = 0
    const stack = []
    const visit = (id, seen) => {
      if (paths > MAX_RETURN_PATHS) return
      for (const step of negative.get(id) || []) {
        if (seen.has(step.to)) continue
        const next = live.get(step.to)
        if (!next) continue
        stack.push(step.cableId)
        if (RETURN_TARGET_ROLES.has(next.role)) {
          paths++
          found = true
          for (const id2 of stack) cableIds.add(id2)
        } else if (next.role !== 'consumer' || next.id === startId) {
          seen.add(step.to)
          visit(step.to, seen)
          seen.delete(step.to)
        }
        stack.pop()
      }
    }
    visit(startId, new Set([startId]))
    if (!found) {
      warnings.push({
        code: 'return-incomplete',
        deviceId: startId,
        message: `The negative wire from ${start.name || startId} does not reach a battery, source or converter.`
      })
    }
  }
  return { cableIds: [...cableIds].sort(byString), implicitDeviceIds: implicit.sort(byString) }
}

// Walks upstream from the circuit's first devices to the sources, batteries
// and converter ports that feed it, through fuses, bus bars and switches.
function traceSupply (boundary, inn, isTerminator) {
  const found = new Map()
  const seen = new Set()
  const walk = (node) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    if (isTerminator(node)) { found.set(node.id, node); return }
    for (const e of inn.get(node.id)) walk(e.from)
  }
  for (const node of boundary) walk(node)
  return [...found.values()].sort((a, b) => byString(a.id, b.id))
}

const unique = (list) => [...new Set(list)].sort(byString)
const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const firstNumber = (list) => list.map(numberOrNull).find((v) => v !== null) ?? null

module.exports = { deriveCircuits }
