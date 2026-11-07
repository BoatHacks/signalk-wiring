'use strict'

// Which consumers can be switched remotely, and which meter measures them
// (plan 0017). Pure: no database, no SignalK, so it is cheap to test with
// small boats (test/switchability.test.js). It reuses the positive feeds of
// src/circuits.js, so it agrees with the circuits about what is wired to what.
//
// A switch is any device with a switch path. A consumer is switchable when a
// switch sits between its supply and it, nearest switch first; a consumer
// that has a switch path itself switches itself. A switch shared by several
// consumers switches them all, so its flags are the strictest of the switch
// and every consumer behind it: one never-remote bilge pump behind a relay
// makes the whole relay never-remote.
//
// Input
//   devices:  [{ id, name, role, status, switchPath?, confirmSwitching?, neverRemote?,
//                meterPath?, meterUnit?, tripRatingA?, nominalVoltage?, terminals? }]
//   cables:   as for deriveCircuits
//   circuits: optional [{ id, key, status, voltage?, meterPath?, meterUnit? }], the circuit
//             records, for meters set on a circuit and for a voltage override
//
// Output
//   consumers: { [consumerId]: { switchable, switchDeviceId, switchDeviceIds, sharedWith,
//                neverRemote, confirm, reason, voltage, meters } }
//   switches:  { [switchDeviceId]: { deviceId, switchPath, consumerIds, neverRemote, confirm } }
// `reason` is null, 'no-switch' or 'never-remote'. A meter is
//   { source: 'device' | 'circuit', deviceId?, circuitId?, path, unit, distance, lowConfidence }
// nearest and most trustworthy first; a meter on a battery or source also
// carries every other load on it, so it is marked low confidence and listed last.

const { deriveCircuits } = require('./circuits')

const SUPPLY_ROLES = new Set(['storage', 'source', 'converter'])
const LOW_CONFIDENCE_ROLES = new Set(['storage', 'source'])
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const roleOf = (device) => device.role || 'consumer'

function deriveSwitchability ({ devices = [], cables = [], circuits = [] }) {
  const derived = deriveCircuits({ devices, cables })
  const live = new Map(devices.filter((d) => d.status !== 'removed').map((d) => [d.id, d]))

  const upstream = new Map()
  const downstream = new Map()
  for (const feed of derived.feeds) {
    if (!live.has(feed.fromDeviceId) || !live.has(feed.toDeviceId)) continue
    if (!upstream.has(feed.toDeviceId)) upstream.set(feed.toDeviceId, [])
    if (!downstream.has(feed.fromDeviceId)) downstream.set(feed.fromDeviceId, [])
    upstream.get(feed.toDeviceId).push(feed.fromDeviceId)
    downstream.get(feed.fromDeviceId).push(feed.toDeviceId)
  }

  const consumerIds = [...live.values()].filter((d) => roleOf(d) === 'consumer').map((d) => d.id).sort(byString)
  const isSwitch = (d) => Boolean(d.switchPath)

  // ---- Every switch, with the consumers behind it.
  const switches = {}
  for (const device of [...live.values()].filter(isSwitch).sort((a, b) => byString(a.id, b.id))) {
    const behind = new Set(roleOf(device) === 'consumer' ? [device.id] : [])
    const seen = new Set([device.id])
    const queue = [device.id]
    while (queue.length > 0) {
      const id = queue.shift()
      for (const next of downstream.get(id) || []) {
        if (seen.has(next)) continue
        seen.add(next)
        if (roleOf(live.get(next)) === 'consumer') behind.add(next)
        queue.push(next)
      }
    }
    const ids = [...behind].sort(byString)
    switches[device.id] = {
      deviceId: device.id,
      switchPath: device.switchPath,
      consumerIds: ids,
      neverRemote: Boolean(device.neverRemote) || ids.some((id) => live.get(id).neverRemote),
      confirm: Boolean(device.confirmSwitching) || ids.some((id) => live.get(id).confirmSwitching)
    }
  }

  // ---- Circuit records by key, and the derived circuits a consumer ends.
  const recordByKey = new Map(circuits.filter((c) => c.status !== 'removed' && c.key).map((c) => [c.key, c]))
  const circuitsOfConsumer = (id) => derived.circuits.filter((c) => c.endDeviceIds.includes(id))

  const out = {}
  for (const id of consumerIds) {
    const consumer = live.get(id)

    // Walk upstream, nearest first. A switch is recorded only until another
    // switch has been passed on that branch (the nearest one is operated);
    // meters keep being collected all the way to the supply.
    const found = []
    const meters = new Map() // device id -> meter
    const distance = new Map() // device id -> distance
    const seen = new Set()
    const queue = [{ id, dist: 0, passed: false }]
    while (queue.length > 0) {
      const { id: at, dist, passed } = queue.shift()
      const stateKey = `${at}|${passed}`
      if (seen.has(stateKey)) continue
      seen.add(stateKey)
      const device = live.get(at)
      if (!distance.has(at) || distance.get(at) > dist) distance.set(at, dist)
      let nowPassed = passed
      if (isSwitch(device) && !passed) {
        found.push({ id: at, dist })
        nowPassed = true
      }
      if (device.meterPath && !meters.has(at)) {
        meters.set(at, {
          source: 'device',
          deviceId: at,
          path: device.meterPath,
          unit: device.meterUnit || 'A',
          distance: dist,
          lowConfidence: LOW_CONFIDENCE_ROLES.has(roleOf(device))
        })
      }
      if (at !== id && SUPPLY_ROLES.has(roleOf(device))) continue
      for (const prev of upstream.get(at) || []) queue.push({ id: prev, dist: dist + 1, passed: nowPassed })
    }

    const ordered = found
      .filter((f, i) => found.findIndex((g) => g.id === f.id) === i)
      .sort((a, b) => a.dist - b.dist || byString(a.id, b.id))
    const switchDeviceIds = ordered.map((f) => f.id)
    const switchDeviceId = switchDeviceIds[0] || null

    // Circuit-level meters and the circuit voltage.
    const owned = circuitsOfConsumer(id)
    let voltage = null
    const circuitMeters = []
    for (const circuit of owned) {
      const record = recordByKey.get(circuit.key)
      const v = record && record.voltage != null ? record.voltage : circuit.voltage
      if (voltage === null && v != null) voltage = v
      if (record && record.meterPath) {
        circuitMeters.push({
          source: 'circuit',
          circuitId: record.id,
          path: record.meterPath,
          unit: record.meterUnit || 'A',
          distance: circuit.protectorId && distance.has(circuit.protectorId) ? distance.get(circuit.protectorId) : 0.5,
          lowConfidence: false
        })
      }
    }
    const allMeters = [...meters.values(), ...circuitMeters].sort((a, b) =>
      Number(a.lowConfidence) - Number(b.lowConfidence) || a.distance - b.distance ||
      byString(a.deviceId || a.circuitId, b.deviceId || b.circuitId))

    const group = switchDeviceId ? switches[switchDeviceId] : null
    const sharedWith = group ? group.consumerIds.filter((c) => c !== id) : []
    const neverRemote = group ? group.neverRemote || Boolean(consumer.neverRemote) : Boolean(consumer.neverRemote)
    const confirm = group ? group.confirm || Boolean(consumer.confirmSwitching) : Boolean(consumer.confirmSwitching)
    out[id] = {
      switchable: Boolean(switchDeviceId),
      switchDeviceId,
      switchDeviceIds,
      sharedWith,
      neverRemote,
      confirm,
      reason: !switchDeviceId ? 'no-switch' : neverRemote ? 'never-remote' : null,
      voltage,
      meters: allMeters
    }
  }
  return { consumers: out, switches }
}

module.exports = { deriveSwitchability }
