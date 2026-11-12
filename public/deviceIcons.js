// Device icons: one of a device's own images, shown on lists, circuit
// drawings and the floorplan. Mirrors ICON_MIME_TYPES in src/store.js.
import { iconFor } from './builtinIcons.js'

const ICON_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function canBeIcon (mimeType) {
  return ICON_MIME_TYPES.includes(mimeType)
}

// Served by a read-only route, so it works for anyone who can see the drawing.
// The attachment id in the query string makes the browser fetch a new image
// when the icon is changed.
export function deviceIconUrl (device) {
  if (!device || !device.iconAttachmentId) return null
  return `/plugins/signalk-wiring/devices/${device.id}/icon?v=${device.iconAttachmentId}`
}

// What kind of file an attachment is, for the label on its tile.
export function attachmentKind (mimeType) {
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType && mimeType.startsWith('image/')) return 'Image'
  return 'File'
}

// What to draw before a device name (plan 0032). A device's own attached image
// wins; otherwise the built-in simple icon for its type (an unknown type falls
// back to the role icon, then the generic one). A missing device draws nothing,
// unless a bare type (and role) is given, as the pickers and the palette do.
export function iconChoice (device, bare) {
  if (device) {
    const url = deviceIconUrl(device)
    if (url) return { kind: 'image', url }
    return { kind: 'builtin', key: iconFor(device).simple }
  }
  if (bare && (bare.type || bare.role)) return { kind: 'builtin', key: iconFor(bare).simple }
  return null
}
