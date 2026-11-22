// What a device does with power. Mirrors DEVICE_ROLES in src/store.js.
export const ROLES = [
  { value: 'consumer', label: 'Consumer', hint: 'Uses power: lights, pumps, instruments, appliances.' },
  { value: 'source', label: 'Source', hint: 'Produces or supplies power: solar, shore power, generator, hydro, wind, alternator.' },
  { value: 'storage', label: 'Storage', hint: 'Stores power: batteries and battery banks.' },
  { value: 'distribution', label: 'Distribution', hint: 'Passes power on: switches, breakers, fuses, bus bars, panels, isolators, relays.' },
  { value: 'converter', label: 'Converter', hint: 'Changes power: inverters, chargers, DC-DC converters.' },
  { value: 'enclosure', label: 'Enclosure', hint: 'Holds other devices: a breaker box, a distribution panel, a cabinet. Cables go to what is inside it.' },
  { value: 'ground', label: 'Ground', hint: "The boat's ground or bonding point that earth wires end on: a central ground bar, a hull bond." }
]

export function roleLabel (role) {
  return (ROLES.find((r) => r.value === role) || ROLES[0]).label
}

// A device with no role recorded counts as a consumer.
export function isConsumer (device) {
  return !device.role || device.role === 'consumer'
}

// A shape per role, so the roles are told apart without color (plan 0050):
// consumer circle, source triangle up, storage square, distribution triangle
// down, converter diamond. Roles without a marker of their own (enclosure,
// ground) fall back to the circle.
const ROLE_SHAPES = { consumer: 'circle', source: 'triangle-up', storage: 'square', distribution: 'triangle-down', converter: 'diamond' }
export const SHAPES = ['circle', 'triangle-up', 'square', 'triangle-down', 'diamond']

export function roleShape (role) {
  return ROLE_SHAPES[role] || 'circle'
}

const f = (n) => Math.round(n * 100) / 100

// SVG path data of a shape centered on (cx, cy) with radius r. Every shape is
// about the area of the circle of the same radius, so markers look alike in size.
export function shapePath (shape, cx, cy, r) {
  switch (shape) {
    case 'triangle-up': {
      const h = r * 1.25
      const w = r * 1.2
      return `M${f(cx)} ${f(cy - h)}L${f(cx + w)} ${f(cy + h * 0.7)}L${f(cx - w)} ${f(cy + h * 0.7)}Z`
    }
    case 'triangle-down': {
      const h = r * 1.25
      const w = r * 1.2
      return `M${f(cx)} ${f(cy + h)}L${f(cx + w)} ${f(cy - h * 0.7)}L${f(cx - w)} ${f(cy - h * 0.7)}Z`
    }
    case 'square': {
      const a = r * 0.9
      return `M${f(cx - a)} ${f(cy - a)}H${f(cx + a)}V${f(cy + a)}H${f(cx - a)}Z`
    }
    case 'diamond': {
      const a = r * 1.3
      return `M${f(cx)} ${f(cy - a)}L${f(cx + a)} ${f(cy)}L${f(cx)} ${f(cy + a)}L${f(cx - a)} ${f(cy)}Z`
    }
    default:
      return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0Z`
  }
}
