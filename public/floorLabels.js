// Pure helpers for the device names on the floorplan (plan 0027).
//
// By default a device is a dot with no name. A name is shown for the hovered
// device, the selected device, and the devices of a highlighted circuit, a
// selected conduit or a selected wire run.

// context: {
//   hoverId, selectedId,           the hovered and the selected device
//   members: { deviceIds },        devices of a highlighted circuit or conduit
//   run: { fromDeviceId, toDeviceId }   the selected wire run
// }
// Returns the Set of device ids whose name is shown.
export function visibleLabels (devices, context = {}) {
  const wanted = new Set()
  if (context.hoverId) wanted.add(context.hoverId)
  if (context.selectedId) wanted.add(context.selectedId)
  if (context.members && context.members.deviceIds) {
    for (const id of context.members.deviceIds) wanted.add(id)
  }
  if (context.run) {
    if (context.run.fromDeviceId) wanted.add(context.run.fromDeviceId)
    if (context.run.toDeviceId) wanted.add(context.run.toDeviceId)
  }
  const shown = new Set()
  for (const device of devices) if (wanted.has(device.id)) shown.add(device.id)
  return shown
}

// Rough width of a label in drawing units; the font has no fixed advance.
export function labelWidth (text, fontSize) {
  return String(text || '').length * fontSize * 0.56
}

// Which side of its marker a label goes: 'end' (to the right, the usual
// place) unless it would run past the right edge of the drawing area, then
// 'start' (to the left). When it fits on neither side the side with more
// room is used. box is the visible area { x, y, width, height }.
export function labelSide (px, width, gap, box) {
  const right = box.x + box.width
  const roomRight = right - (px[0] + gap)
  const roomLeft = px[0] - gap - box.x
  if (width <= roomRight) return 'right'
  if (width <= roomLeft) return 'left'
  return roomRight >= roomLeft ? 'right' : 'left'
}
