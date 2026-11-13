// Where a popover goes so it stays fully on screen and clear of the finger
// (plan 0031). Pure helper, no DOM.
//
//   anchor    { x, y }: the point the popover belongs to (where the finger lifted
//             or the marker is), in the same pixels as the viewport box.
//   size      { width, height }: the popover's size (a measure or an estimate).
//   viewport  { width, height }: the box the popover must stay inside.
//   margin    the gap kept to every edge of the viewport.
//   gap       the gap kept between the anchor and the popover, so a fingertip
//             does not cover it.
//
// It opens below the anchor and flips above when it would not fit; when it
// fits on neither side it takes the side with more room and returns a smaller
// maxHeight, to scroll inside. Horizontally it is centred on the anchor and
// pushed in from the edges. Returns { left, top, maxWidth, maxHeight, side }.
export const POPOVER_GAP = 16

export function placePopover (anchor, size, viewport, margin = 8, gap = POPOVER_GAP) {
  const maxWidth = Math.max(0, viewport.width - 2 * margin)
  const width = Math.min(size.width, maxWidth)
  const left = Math.max(margin, Math.min(anchor.x - width / 2, viewport.width - margin - width))

  const roomBelow = viewport.height - margin - (anchor.y + gap)
  const roomAbove = anchor.y - gap - margin
  let side
  if (size.height <= roomBelow) side = 'below'
  else if (size.height <= roomAbove) side = 'above'
  else side = roomBelow >= roomAbove ? 'below' : 'above'

  const room = Math.max(0, side === 'below' ? roomBelow : roomAbove)
  const height = Math.min(size.height, room)
  const top = side === 'below' ? anchor.y + gap : anchor.y - gap - height
  return { left, top, maxWidth, maxHeight: room, side }
}
