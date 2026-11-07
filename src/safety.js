'use strict'

// Device types that look critical: switching them off by mistake could hurt
// the boat or the crew. A new device of one of these types starts with
// "confirm before switching" turned on (plan 0017). The type is free text,
// so this is a hint, matched ignoring case, not a guarantee. The browser has
// the same list in public/deviceTypes.js; test/deviceTypes.test.mjs and
// test/liveStore.test.js keep both honest.
const CRITICAL_TYPE_WORDS = [
  'bilge', 'refrigerator', 'fridge', 'freezer', 'autopilot', 'navigation light', 'nav light', 'windlass'
]

function isCriticalType (type) {
  if (typeof type !== 'string') return false
  const text = type.trim().toLowerCase()
  return text !== '' && CRITICAL_TYPE_WORDS.some((word) => text.includes(word))
}

module.exports = { CRITICAL_TYPE_WORDS, isCriticalType }
