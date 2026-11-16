// Pure geometry of a backbone on a schematic page (plan 0037). A backbone is
// drawn as one thick horizontal line with a short vertical drop to each tapped
// device that is on the page, a terminator mark at an end that has one, and a
// mark at the power feed. It is not routed with the cables: the line stays
// where it was put, and its drops are straight. Its placement is the left end
// of the line, { x, y }, saved with the page like a device.

export const BUS_MIN_LEN = 220
export const BUS_END_PAD = 30
export const BUS_HIT = 9
export const BUS_LABEL_H = 16
export const BUS_CLEAR = 46 // gap between the tapped boxes and the line when placed by Auto-arrange

const centreX = (box) => box.x + box.w / 2

// The taps of a backbone whose device has a box on the page. `boxById` maps
// device id to { x, y, w, h }.
export function pageTaps (backbone, boxById) {
  return (backbone.taps || []).filter((t) => boxById.has(t.deviceId))
}

// The line of a backbone at `at` = { x, y }: its ends, its drops and marks.
// The line reaches from `at.x` to the last drop plus a margin, and is at least
// BUS_MIN_LEN long. A drop is vertical at the center of the box, from the line
// to the nearest horizontal edge of the box; a box the line runs through gets
// no drop. A drop longer than the line is not drawn outside it: the drop is
// placed at the center of the box, which is always inside the line.
export function busGeometry (backbone, at, boxById) {
  const taps = pageTaps(backbone, boxById)
  const rightmost = taps.reduce((m, t) => Math.max(m, centreX(boxById.get(t.deviceId)) + BUS_END_PAD), at.x + BUS_MIN_LEN)
  const x1 = at.x
  const x2 = Math.max(x1 + BUS_MIN_LEN, rightmost)
  const y = at.y
  const drops = []
  for (const t of taps) {
    const box = boxById.get(t.deviceId)
    const x = Math.min(Math.max(centreX(box), x1), x2)
    let from = null
    let to = null
    if (box.y >= y) { from = y; to = box.y } else if (box.y + box.h <= y) { from = y; to = box.y + box.h }
    drops.push({
      deviceId: t.deviceId, port: t.port || '', x, y1: from, y2: to,
      dropLength: t.dropLength == null ? null : t.dropLength,
      along: t.along == null ? null : t.along,
      powerFeed: Boolean(t.powerFeed), fedFromDeviceId: t.fedFromDeviceId || null,
      drawn: from !== null
    })
  }
  return {
    id: backbone.id, name: backbone.name, x1, x2, y,
    termA: Boolean(backbone.terminatorA), termB: Boolean(backbone.terminatorB),
    drops,
    label: { x: x1, y: y - 8 },
    box: { x: x1, y: y - BUS_LABEL_H, w: x2 - x1, h: BUS_LABEL_H + 6 }
  }
}

// The backbone under the point (x, y): its line within `tol`, or its label.
// The last one drawn wins.
export function hitBus (geometries, x, y, tol = BUS_HIT) {
  for (let i = geometries.length - 1; i >= 0; i--) {
    const g = geometries[i]
    if (x >= g.x1 - tol && x <= g.x2 + tol && Math.abs(y - g.y) <= tol) return g
  }
  return null
}

// A free spot for a backbone that is added to a page: under the boxes it taps
// (the left edge of the leftmost one), moved down until the line crosses no
// other box. `boxes` are all boxes on the page; `center` is used when the
// backbone taps nothing on the page.
export function placeBus (backbone, boxes, center, margin = 14) {
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  const taps = pageTaps(backbone, boxById).map((t) => boxById.get(t.deviceId))
  if (taps.length === 0) return { x: Math.round(center.x - BUS_MIN_LEN / 2), y: Math.round(center.y) }
  const x = Math.min(...taps.map((b) => b.x))
  let y = Math.max(...taps.map((b) => b.y + b.h)) + BUS_CLEAR
  const g = () => busGeometry(backbone, { x, y }, boxById)
  const tapIds = new Set(taps.map((b) => b.id))
  for (let guard = 0; guard < 200; guard++) {
    const line = g()
    const clash = boxes.find((b) => !tapIds.has(b.id) &&
      b.x < line.x2 + margin && b.x + b.w > line.x1 - margin && b.y < y + margin && b.y + b.h > y - margin - BUS_LABEL_H)
    if (!clash) break
    y = clash.y + clash.h + margin + BUS_LABEL_H
  }
  return { x: Math.round(x), y: Math.round(y) }
}

// Auto-arrange: a backbone with its tapped devices is arranged as one group.
// The devices that are not hand placed (all of them for the full arrange) are
// set in a row under the line, in tap order, and the line goes above them. The
// groups are stacked below everything else on the page, one under the other.
// Only a tapped device that is not hand placed moves, and a backbone that is
// hand placed stays where it is (its free devices still line up under it).
//   backbones: the placed live backbones; boxes: the page boxes after the
//   device layout; current: { backboneId: { x, y } }; keepBus: ids of hand
//   placed backbones; keepDevice: ids of hand placed devices.
// Returns { buses: { id: { x, y } }, devices: { deviceId: { x, y } } } for what
// it moved (device spots are top left corners).
export function arrangeBuses (backbones, boxes, current, keepBus = new Set(), keepDevice = new Set(), gap = 30) {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const claimed = new Set()
  const groups = backbones.map((bb) => {
    const free = pageTaps(bb, byId).map((t) => t.deviceId)
      .filter((id, i, all) => all.indexOf(id) === i && !keepDevice.has(id) && !claimed.has(id))
    free.forEach((id) => claimed.add(id))
    return { bb, free }
  })
  const rest = boxes.filter((b) => !claimed.has(b.id))
  const minX = rest.length ? Math.min(...rest.map((b) => b.x)) : 0
  let y = rest.length ? Math.max(...rest.map((b) => b.y + b.h)) + 90 : 0
  const out = { buses: {}, devices: {} }
  for (const g of groups) {
    const fixed = keepBus.has(g.bb.id) && current[g.bb.id]
    const at = fixed ? current[g.bb.id] : { x: minX, y }
    if (!fixed) out.buses[g.bb.id] = { x: Math.round(at.x), y: Math.round(at.y) }
    let x = at.x
    let rowH = 0
    for (const id of g.free) {
      const b = byId.get(id)
      out.devices[id] = { x: Math.round(x), y: Math.round(at.y + 70) }
      x += b.w + gap
      rowH = Math.max(rowH, b.h)
    }
    if (!fixed) y = at.y + 70 + rowH + 90
  }
  return out
}

// The text of a drop on hover: the device's drop length and place along.
export function dropTitle (drop, deviceName, lengthUnit = 'm') {
  const parts = [deviceName || drop.deviceId]
  if (drop.port) parts.push(`port ${drop.port}`)
  parts.push(drop.dropLength == null ? 'drop length not set' : `drop ${Math.round(drop.dropLength * 100) / 100} m`)
  if (drop.along != null) parts.push(`${Math.round(drop.along * 100) / 100} ${lengthUnit} along`)
  if (drop.powerFeed) parts.push('power feed')
  return parts.join(', ')
}

// The backbones placed on a page that can be drawn: live and known.
export function placedBuses (boxesList, backbones) {
  const byId = new Map((backbones || []).filter((b) => b.status !== 'removed').map((b) => [b.id, b]))
  return (boxesList || []).filter((p) => byId.has(p.backboneId)).map((p) => ({ backbone: byId.get(p.backboneId), at: { x: p.x, y: p.y }, handPlaced: Boolean(p.handPlaced) }))
}
