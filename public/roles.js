// What a device does with power. Mirrors DEVICE_ROLES in src/store.js.
export const ROLES = [
  { value: 'consumer', label: 'Consumer', hint: 'Uses power: lights, pumps, instruments, appliances.' },
  { value: 'source', label: 'Source', hint: 'Produces or supplies power: solar, shore power, generator, hydro, wind, alternator.' },
  { value: 'storage', label: 'Storage', hint: 'Stores power: batteries and battery banks.' },
  { value: 'distribution', label: 'Distribution', hint: 'Passes power on: switches, breakers, fuses, bus bars, panels, isolators, relays.' },
  { value: 'converter', label: 'Converter', hint: 'Changes power: inverters, chargers, DC-DC converters.' },
  { value: 'enclosure', label: 'Enclosure', hint: 'Holds other devices: a breaker box, a distribution panel, a cabinet. Cables go to what is inside it.' }
]

export function roleLabel (role) {
  return (ROLES.find((r) => r.value === role) || ROLES[0]).label
}

// A device with no role recorded counts as a consumer.
export function isConsumer (device) {
  return !device.role || device.role === 'consumer'
}
