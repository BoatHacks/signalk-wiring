// The boat's two schematic pages (a trimmed copy of the real data in
// test/fixtures/boat-pages.json), turned into router input the way the
// schematic view does it.
import { readFileSync } from 'node:fs'
import * as S from '../../public/schematic.js'
import * as R from '../../public/wireRouter.js'

const data = JSON.parse(readFileSync(new URL('../fixtures/boat-pages.json', import.meta.url), 'utf8'))

export const pageNames = data.schematics.map((s) => s.name)

export function pageInput (name, { stubPos = {} } = {}) {
  const sch = data.schematics.find((s) => s.name === name)
  const devs = new Map(data.devices.map((d) => [d.id, d]))
  const boxes = sch.devices.map((p) => S.deviceBox(devs.get(p.deviceId), { x: p.x, y: p.y }))
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  const cables = data.cables.filter((c) => c.status !== 'removed')
  const onPage = cables.filter((c) => boxById.has(c.fromDeviceId) && boxById.has(c.toDeviceId))
  const stubs = S.offPageStubs({ boxes: boxById, cables, deviceName: (id) => (devs.get(id) || {}).name }).map((s) => ({ ...s, paired: S.conductorTypes(cables.find((c) => c.id === s.cableId)).length > 1, ...(stubPos[s.cableId] ? { pos: stubPos[s.cableId] } : {}) }))
  const wires = onPage.map((c) => {
    const t = S.endTerminals(c)
    return { id: c.id, fromId: c.fromDeviceId, toId: c.toDeviceId, fromTerminal: t.from, toTerminal: t.to, points: [], conduitIds: c.conduitIds || [], paired: S.conductorTypes(c).length > 1 }
  })
  return { boxes, wires, stubs }
}

export function routeBoatPage (name, opts) {
  const input = pageInput(name, opts)
  const t0 = performance.now()
  const result = R.routePage(input)
  return { input, result, ms: performance.now() - t0 }
}
