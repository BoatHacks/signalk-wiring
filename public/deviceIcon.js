// Shared icon components (plan 0032). The one place that decides what is
// drawn before a device name: the device's own image, else the built-in icon.
import { html } from './vendor/preact-standalone.module.js'
import { simpleIconSvg } from './builtinIcons.js'
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
