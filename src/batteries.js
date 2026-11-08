'use strict'

// Battery details (plan 0020), the parts the server needs. The browser has the
// same table and helpers in public/batteries.js; test/batteries.test.mjs keeps
// both equal.

const CHEMISTRIES = ['flooded', 'agm', 'gel', 'lifepo4', 'lithium', 'other']
const PURPOSES = ['house', 'starter', 'thruster', 'windlass', 'motor', 'other']
const LINKS = ['series', 'parallel']

const CHEMISTRY_LABELS = {
  flooded: 'Flooded lead-acid',
  agm: 'AGM',
  gel: 'Gel',
  lifepo4: 'LiFePO4',
  lithium: 'Other lithium',
  other: 'Other'
}

const PURPOSE_LABELS = {
  house: 'House',
  starter: 'Starter',
  thruster: 'Thruster',
  windlass: 'Windlass',
  motor: 'Motor (propulsion)',
  other: 'Other'
}

// Per chemistry: the nominal voltage of one 12 V battery and the usable
// fraction of its capacity. null means no default.
const CHEMISTRY_DEFAULTS = {
  flooded: { nominalVoltage: 12, usableFraction: 0.5 },
  agm: { nominalVoltage: 12, usableFraction: 0.5 },
  gel: { nominalVoltage: 12, usableFraction: 0.5 },
  lifepo4: { nominalVoltage: 12.8, usableFraction: 0.8 },
  lithium: { nominalVoltage: null, usableFraction: 0.8 },
  other: { nominalVoltage: null, usableFraction: null }
}

// Type names that imply a chemistry or a purpose, matched case-insensitively
// on the whole name.
const TYPE_CHEMISTRY = {
  'lead-acid battery': 'flooded',
  'agm battery': 'agm',
  'lifepo4 battery': 'lifepo4'
}
const TYPE_PURPOSE = {
  'starter battery': 'starter',
  'house battery': 'house'
}

const norm = (type) => (typeof type === 'string' ? type.trim().toLowerCase() : '')

function typeChemistry (type) {
  return TYPE_CHEMISTRY[norm(type)] || null
}

function typePurpose (type) {
  return TYPE_PURPOSE[norm(type)] || null
}

function chemistryDefaults (chemistry) {
  return CHEMISTRY_DEFAULTS[chemistry] || { nominalVoltage: null, usableFraction: null }
}

module.exports = {
  CHEMISTRIES,
  PURPOSES,
  LINKS,
  CHEMISTRY_LABELS,
  PURPOSE_LABELS,
  CHEMISTRY_DEFAULTS,
  TYPE_CHEMISTRY,
  TYPE_PURPOSE,
  typeChemistry,
  typePurpose,
  chemistryDefaults
}
