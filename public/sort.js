// Sorting of lists (plan 0040). Pure helpers, plus the remembered choice of one
// list. A sort is { key, dir } with dir 'asc' or 'desc'; no sort (null) means
// the list's own default order.

import { normalizeUnit } from './gauge.js'
import { awgAreaMm2 } from './cableAmpacity.js'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function isEmpty (v) {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))
}

// Numbers compare as numbers, everything else as natural text ("B10-3" before
// "B10-12", case ignored). Empty values are not handled here: see sortItems.
export function compareValues (a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

// columns: { key: (item) => sort value }. Stable: items that tie keep their
// order in the list. Empty values go last in both directions. An unknown or
// missing sort returns the items unchanged (a copy).
export function sortItems (items, columns, sort) {
  const pick = sort && columns && columns[sort.key]
  if (!pick || (sort.dir !== 'asc' && sort.dir !== 'desc')) return [...items]
  const sign = sort.dir === 'desc' ? -1 : 1
  return items
    .map((item, index) => ({ item, index, value: pick(item) }))
    .sort((x, y) => {
      const xe = isEmpty(x.value)
      const ye = isEmpty(y.value)
      if (xe || ye) return xe && ye ? x.index - y.index : xe ? 1 : -1
      return sign * compareValues(x.value, y.value) || x.index - y.index
    })
    .map((entry) => entry.item)
}

// The header click cycle: a new column starts ascending, the same column goes
// descending, then the sort is cleared (null).
export function nextSort (sort, key) {
  if (!sort || sort.key !== key) return { key, dir: 'asc' }
  if (sort.dir === 'asc') return { key, dir: 'desc' }
  return null
}

// Flips the direction of the sort control's toggle button.
export function flipSort (sort) {
  return sort ? { key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : sort
}

// ---- Remembered choice of one list. Storage may be missing or throw, so every
// access is guarded and the default is no sort.

const storageKey = (listKey) => `wiring.sort.${listKey}`

export function readSort (listKey, columns, storage) {
  try {
    const parsed = JSON.parse((storage || globalThis.localStorage).getItem(storageKey(listKey)))
    if (!parsed || typeof parsed.key !== 'string') return null
    if (parsed.dir !== 'asc' && parsed.dir !== 'desc') return null
    if (columns && !Object.prototype.hasOwnProperty.call(columns, parsed.key)) return null
    return { key: parsed.key, dir: parsed.dir }
  } catch (err) {
    return null
  }
}

export function writeSort (listKey, sort, storage) {
  try {
    const store = storage || globalThis.localStorage
    if (sort) store.setItem(storageKey(listKey), JSON.stringify({ key: sort.key, dir: sort.dir }))
    else store.removeItem(storageKey(listKey))
  } catch (err) {
    // the choice just is not remembered
  }
}

// ---- Values for columns whose shown text is not comparable.

const FT_TO_M = 0.3048

// A cable length in metres; feet are converted, a missing unit counts as metres.
export function lengthMetres (length, unit) {
  const n = Number(length)
  if (length === null || length === undefined || length === '' || !Number.isFinite(n)) return null
  return String(unit || '').trim().toLowerCase() === 'ft' ? n * FT_TO_M : n
}

// A cable gauge as a cross section in mm2, so AWG and mm2 sizes sort together;
// null for no gauge or a unit that is not AWG or mm2.
export function cableAreaMm2 (gauge, unit) {
  const n = Number(gauge)
  if (gauge === null || gauge === undefined || gauge === '' || !Number.isFinite(n)) return null
  const u = normalizeUnit(unit)
  if (u === 'mm2') return n
  if (u === 'AWG') return awgAreaMm2(n)
  return null
}
