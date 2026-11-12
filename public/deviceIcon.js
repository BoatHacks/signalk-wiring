// Shared icon components (plan 0032). The one place that decides what is
// drawn before a device name: the device's own image, else the built-in icon.
import { html } from './vendor/preact-standalone.module.js'
import { simpleIconSvg, SIMPLE_ICONS } from './builtinIcons.js'
import { iconChoice } from './deviceIcons.js'

// A decorative icon: inline SVG in currentColor, so it follows the text color
// of the theme. Pass a device, or a bare { type, role } for pickers and the
// palette. imageSize lets an attached image keep a larger size than the SVG.
export function DeviceIcon ({ device, bare, size = 18, imageSize, tone = 'muted' }) {
  const choice = iconChoice(device, bare)
  if (!choice) return null
  if (choice.kind === 'image') {
    const px = imageSize || size
    return html`<img class="device-icon device-icon-inline" src=${choice.url} alt="" aria-hidden="true" width=${px} height=${px} style=${`width:${px}px;height:${px}px`} />`
  }
  return html`<span class="dev-icon dev-icon-${tone}" aria-hidden="true" style=${`width:${size}px;height:${size}px`}
    dangerouslySetInnerHTML=${{ __html: simpleIconSvg(choice.key, size) }}></span>`
}

// The icon, then the name, nothing else. Without a device it draws the plain
// name (or the fallback text) and no icon.
export function DeviceLabel ({ device, name, size = 18, imageSize, tone }) {
  const text = name != null ? name : device ? device.name : ''
  return html`<span class="dev-label"><${DeviceIcon} device=${device} size=${size} imageSize=${imageSize} tone=${tone} /><span class="dev-label-text">${text}</span></span>`
}

// Room a diagram node leaves for its icon: an attached image is 36 px, a
// built-in icon 20 px.
export function iconSpace (choice) {
  if (!choice) return 0
  return choice.kind === 'image' ? 36 : 28
}

// The same choice inside a circuit diagram (an SVG, so no HTML span). With a
// header row (a node that lists ports) the icon sits beside the name.
export function DeviceIconSvg ({ choice, height, headerRow }) {
  if (!choice) return null
  if (choice.kind === 'image') {
    return html`<image href=${choice.url} x="6" y=${(height - 36) / 2} width="36" height="36" preserveAspectRatio="xMidYMid meet" />`
  }
  const inner = SIMPLE_ICONS[choice.key] || SIMPLE_ICONS.generic
  return html`<svg class="diagram-icon" x="6" y=${headerRow ? 4 : (height - 20) / 2} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
    dangerouslySetInnerHTML=${{ __html: inner }}></svg>`
}
