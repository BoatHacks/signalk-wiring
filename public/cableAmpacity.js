// The ampacity table of the cable checks (plan 0034, issue #10), kept in one
// data file so it can be reviewed on its own. docs/cable-checks.md explains
// how every number was reached. This is the plugin's own conservative table,
// built from public manufacturer figures; it is not a copy of any standard,
// and it is advice only.
//
// What a figure means: continuous current of one stranded copper conductor
// with 105 C rated insulation, in a boat at an ambient temperature of 30 C,
// carried by a cable with up to three current-carrying conductors. The rating
// is conservative by construction: each figure is the LOWER of the sources
// below, rounded DOWN to a multiple of 5 A.

export const ASSUMPTIONS = {
  material: 'copper, stranded',
  insulationC: 105,
  ambientC: 30,
  operatingC: 50, // conductor temperature used for the resistance in the voltage drop
  rho20OhmMm2PerM: 0.0185, // stranded, tinned copper at 20 C
  tempCoefficientPerK: 0.00393, // copper
  roundDownToA: 5
}

// Cross-section in mm2 of each AWG size, from the AWG diameter definition
// (diameter in mm = 0.127 * 92^((36 - n) / 39)). Keys are the stored gauge
// numbers: 1/0 to 4/0 are stored as 0, -1, -2 and -3 (public/gauge.js).
export const AWG_AREA_MM2 = {
  18: 0.823, 16: 1.31, 14: 2.08, 12: 3.31, 10: 5.26, 8: 8.37, 6: 13.3, 4: 21.15, 2: 33.62, 1: 42.41,
  0: 53.49, '-1': 67.43, '-2': 85.01, '-3': 107.2
}

// Amps per size. Derivation of each AWG figure (see docs/cable-checks.md):
//   A = a manufacturer's single conductor figure, 105 C insulation, 30 C
//   B = a wire maker's figure for up to three conductors in a cable, 105 C, 40 C
//   table = floor5(min(A, B))
// The mm2 figures are the AWG figures interpolated by cross-section (straight
// line on a log-log scale), then limited by a manufacturer's own mm2 rating
// (C) where that is lower: table = floor5(min(interpolated, C)).
export const AMPACITY_A = {
  AWG: {
    18: 15, 16: 20, 14: 30, 12: 40, 10: 55, 8: 75, 6: 95, 4: 120, 2: 160, 1: 185,
    0: 215, '-1': 250, '-2': 285, '-3': 330
  },
  mm2: {
    0.75: 15, 1: 15, 1.5: 20, 2.5: 25, 4: 35, 6: 50, 10: 70, 16: 100, 25: 130, 35: 160,
    50: 205, 70: 255, 95: 305
  }
}

// Several current-carrying conductors sharing a conduit, loom or bundle heat
// each other. The factor multiplies the table figure; where the sources give
// different factors the lower is used. Earth and signal conductors are not
// counted. [from count, factor], the first row whose count is not above n.
export const DERATING = [
  { upTo: 2, factor: 1 },
  { upTo: 3, factor: 0.7 },
  { upTo: 6, factor: 0.6 },
  { upTo: 24, factor: 0.5 },
  { upTo: Infinity, factor: 0.35 }
]
// Rows above are the lower of: manufacturer A (3: 0.70, 4 to 6: 0.60,
// 7 to 24: 0.50, 25 and more: 0.40) and wire maker B (4 to 6: 0.80, 7 to 9: 0.70,
// 10 to 20: 0.50, 21 to 30: 0.45, 31 to 40: 0.40, 41 and more: 0.35), applied
// per band of this table. Details in docs/cable-checks.md.

export const SOURCES = [
  {
    id: 'A',
    what: 'Boat cable ampacity, 105 C insulation, single conductor, 30 C ambient, and the bundling correction factors',
    url: 'https://docs.navico.com/view/362211770/65/',
    note: 'Ancor catalog 2024, ampacity page. A manufacturer page; it states the factors 3: 0.70, 4 to 6: 0.60, 7 to 24: 0.50, 25 and above: 0.40.'
  },
  {
    id: 'A2',
    what: 'The same correction factors and the 30 C basis of the 105 C table, cross-checked',
    url: 'https://www.delzer.com/oneasg/anc_cat_003/71/',
    note: 'Ancor catalog 2023, correction factor page.'
  },
  {
    id: 'B',
    what: 'Insulated copper conductors, 105 C, not more than three current-carrying conductors, 40 C ambient, and the adjustment factors for more than three',
    url: 'https://www.awcwire.com/customersupport/techinfo/ampacities-and-correction-factors',
    note: 'A wire maker\'s technical page. It is stated for 40 C and used here without correction to 30 C, which keeps it conservative.'
  },
  {
    id: 'C',
    what: 'Tinned copper single core cable, nominal current rating per mm2 and maximum resistance per metre',
    url: 'https://cdn.shopify.com/s/files/1/0542/2173/4073/files/DS_CM1.0-10.0.pdf',
    note: 'Manufacturer datasheet for 1 to 10 mm2 (nominal ratings 16.5, 21, 29, 39, 50, 70 A).'
  },
  {
    id: 'C2',
    what: 'The same maker\'s datasheet for 16 to 95 mm2',
    url: 'https://cdn.shopify.com/s/files/1/0542/2173/4073/files/DS_CM16-95.pdf',
    note: 'Nominal ratings 110, 170, 240, 345, 485 and 500 A; the last two disagree in trend, which is why the table follows the lower interpolated figure.'
  },
  {
    id: 'R',
    what: 'Resistivity of annealed copper (17.241 ohm mm2 per km at 20 C) and its temperature coefficient',
    url: 'https://en.wikipedia.org/wiki/International_Annealed_Copper_Standard',
    note: 'Used with an allowance for stranding and tin plating taken from the maximum resistance in source C (10 mm2: 0.00185 ohm per metre, which is 0.0185 ohm mm2 per metre).'
  }
]

export function awgAreaMm2 (value) {
  return AWG_AREA_MM2[String(value)] ?? null
}
