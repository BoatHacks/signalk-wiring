// Battery details (plan 0020), the parts the browser uses. The server has the
// same table and helpers in src/batteries.js; test/batteries.test.mjs keeps
// both equal.

export const CHEMISTRIES = ['flooded', 'agm', 'gel', 'lifepo4', 'lithium', 'other']
export const PURPOSES = ['house', 'starter', 'thruster', 'windlass', 'motor', 'other']
export const LINKS = ['series', 'parallel']

export const CHEMISTRY_LABELS = {
  flooded: 'Flooded lead-acid',
  agm: 'AGM',
  gel: 'Gel',
  lifepo4: 'LiFePO4',
  lithium: 'Other lithium',
  other: 'Other'
}

export const PURPOSE_LABELS = {
  house: 'House',
  starter: 'Starter',
  thruster: 'Thruster',
  windlass: 'Windlass',
  motor: 'Motor (propulsion)',
  other: 'Other'
}

// Per chemistry: the nominal voltage of one 12 V battery and the usable
// fraction of its capacity. null means no default.
export const CHEMISTRY_DEFAULTS = {
  flooded: { nominalVoltage: 12, usableFraction: 0.5 },
  agm: { nominalVoltage: 12, usableFraction: 0.5 },
  gel: { nominalVoltage: 12, usableFraction: 0.5 },
  lifepo4: { nominalVoltage: 12.8, usableFraction: 0.8 },
  lithium: { nominalVoltage: null, usableFraction: 0.8 },
  other: { nominalVoltage: null, usableFraction: null }
}

// Type names that imply a chemistry or a purpose, matched case-insensitively
// on the whole name.
export const TYPE_CHEMISTRY = {
  'lead-acid battery': 'flooded',
  'agm battery': 'agm',
  'lifepo4 battery': 'lifepo4'
}
export const TYPE_PURPOSE = {
  'starter battery': 'starter',
  'house battery': 'house'
}

const norm = (type) => (typeof type === 'string' ? type.trim().toLowerCase() : '')

export function typeChemistry (type) {
  return TYPE_CHEMISTRY[norm(type)] || null
}

export function typePurpose (type) {
  return TYPE_PURPOSE[norm(type)] || null
}

export function chemistryDefaults (chemistry) {
  return CHEMISTRY_DEFAULTS[chemistry] || { nominalVoltage: null, usableFraction: null }
}
