# Cable checks: the table, the sources and the assumptions

This page is for review. It says what the cable checks (plan 0034, issue #10)
assume and where every number comes from. The checks are advice, not a safety
guarantee, and the app says so wherever it shows a result.

## Summary for review

**What is checked, on every cable that is not signal only**

1. The cable's derated ampacity against the rating of the fuse or breaker that
   protects its circuit. A protection rating above the derated ampacity is a
   fail ("cable too small").
2. The derated ampacity against the load current, when it is known. A load
   above the derated ampacity is a fail.
3. The voltage drop along the cable, as a percentage of the circuit voltage,
   against a limit: 3 percent when the circuit contains a device of a type the
   app treats as critical (bilge pump, refrigerator or fridge, freezer,
   autopilot, navigation light, windlass), 10 percent otherwise. Both limits are
   plugin options. Over the limit is a warning ("voltage drop high").

A cable whose conductors are all signal or data is exempt: no verdict, no badge.
A cable that mixes signal and power conductors is checked on its power
conductors only (positive, negative, AC line, AC neutral). Missing gauge,
length, voltage, a circuit, or any current to check against gives a muted
"cannot check" naming what is missing.

**Assumptions to confirm**

- Copper, stranded conductors only. There is no material field on a cable, so
  every cable is taken as copper.
- Insulation rated 105 C for every cable on the boat, one ambient temperature
  of 30 C for the whole boat. Zones with their own temperature (an engine
  space) are a follow-up.
- The table value is for a cable with up to three current-carrying conductors.
  More conductors sharing a conduit (the only bundle the app knows about) derate
  it by the factors below. Earth and signal conductors are not counted.
- A cable is checked alone. For voltage drop its return is taken as the same
  length and size (round trip is twice its length), including a cable that holds
  only the positive or only the negative conductor.
- The current: the rated power of the consumers on the circuit divided by the
  circuit voltage (on AC, watts divided by the power factor first). If any
  consumer has no rated power the sum is unknown and the fuse or breaker rating
  is used as the worst case. A measured current (an accepted calibration run's
  peak, or a live value) can only raise the figure: the larger of measured and
  rated is used, because a reading taken while a load is off would hide an
  overload.
- A cable shared by several circuits (a common return) carries all of them: the
  ratings and the currents add. The lowest circuit voltage is used.
- The conductor runs at 50 C for the resistance in the voltage drop.
- AC drop is current times resistance times the power factor (the highest of the
  consumers, 1 where none is set); reactance is ignored.
- Rating "A" means continuous current. Motor starting currents are not covered.

**The ampacity table (amps, one conductor, 105 C insulation, 30 C ambient, up to
three current-carrying conductors)**

| AWG | A | | mm2 | A |
|---|---|---|---|---|
| 18 | 15 | | 0.75 | 15 |
| 16 | 20 | | 1 | 15 |
| 14 | 30 | | 1.5 | 20 |
| 12 | 40 | | 2.5 | 25 |
| 10 | 55 | | 4 | 35 |
| 8 | 75 | | 6 | 50 |
| 6 | 95 | | 10 | 70 |
| 4 | 120 | | 16 | 100 |
| 2 | 160 | | 25 | 130 |
| 1 | 185 | | 35 | 160 |
| 1/0 | 215 | | 50 | 205 |
| 2/0 | 250 | | 70 | 255 |
| 3/0 | 285 | | 95 | 305 |
| 4/0 | 330 | | | |

**Derating for conductors sharing a conduit (current-carrying conductors in
total)**

| Conductors | 1 to 2 | 3 | 4 to 6 | 7 to 24 | 25 or more |
|---|---|---|---|---|---|
| Factor | 1.0 | 0.7 | 0.6 | 0.5 | 0.35 |

## Where the numbers come from

The table is our own and deliberately conservative. No standard's table or text
is copied. It is built from public manufacturer pages, and wherever two sources
give different figures the lower one is used.

Sources (all read on 2026-11-12):

- A: https://docs.navico.com/view/362211770/65/ (Ancor catalog 2024, ampacity
  page). Manufacturer figures for 105 C insulation at 30 C ambient, single
  conductor, and the bundling correction factors 3 conductors 0.70, 4 to 6 0.60,
  7 to 24 0.50, 25 and above 0.40.
- A2: https://www.delzer.com/oneasg/anc_cat_003/71/ (Ancor catalog 2023). The
  same correction factors, cross-checked.
- B: https://www.awcwire.com/customersupport/techinfo/ampacities-and-correction-factors
  (a wire maker's technical page). 105 C insulation, not more than three
  current-carrying conductors in a cable, 40 C ambient, plus adjustment factors
  for more than three (4 to 6: 0.80, 7 to 9: 0.70, 10 to 20: 0.50, 21 to 30:
  0.45, 31 to 40: 0.40, 41 or more: 0.35).
- C: https://cdn.shopify.com/s/files/1/0542/2173/4073/files/DS_CM1.0-10.0.pdf
  (manufacturer datasheet, tinned copper single core cable, 1 to 10 mm2).
  Nominal current ratings 16.5, 21, 29, 39, 50, 70 A for 1, 1.5, 2.5, 4, 6, 10
  mm2, and a maximum resistance of 0.00185 ohm per metre at 20 C for 10 mm2.
- C2: https://cdn.shopify.com/s/files/1/0542/2173/4073/files/DS_CM16-95.pdf (the
  same maker, 16 to 95 mm2). Nominal ratings 110, 170, 240, 345, 485, 500 A for
  16, 25, 35, 50, 70, 95 mm2. The 70 and 95 mm2 figures hardly differ, which
  looks generous, so they are not followed where our own figure is lower.
- R: https://en.wikipedia.org/wiki/International_Annealed_Copper_Standard
  (resistivity of annealed copper, 17.241 ohm mm2 per km at 20 C, and the
  usual temperature coefficient of copper, 0.00393 per kelvin).

### AWG figures

For each size the table value is the lower of A (30 C, single conductor) and B
(40 C, up to three conductors), rounded down to a multiple of 5 A. B is used at
its own 40 C, not corrected to 30 C, which keeps it conservative.

| AWG | A | B | lower | table |
|---|---|---|---|---|
| 18 | 20 | 17 | 17 | 15 |
| 16 | 25 | 22 | 22 | 20 |
| 14 | 35 | 34 | 34 | 30 |
| 12 | 45 | 43 | 43 | 40 |
| 10 | 60 | 55 | 55 | 55 |
| 8 | 80 | 76 | 76 | 75 |
| 6 | 120 | 96 | 96 | 95 |
| 4 | 160 | 120 | 120 | 120 |
| 2 | 210 | 160 | 160 | 160 |
| 1 | 245 | 186 | 186 | 185 |
| 1/0 | 285 | 215 | 215 | 215 |
| 2/0 | 330 | 251 | 251 | 250 |
| 3/0 | 385 | 288 | 288 | 285 |
| 4/0 | 445 | 332 | 332 | 330 |

Cross-section of each AWG size comes from the AWG diameter definition
(diameter in mm = 0.127 times 92 to the power (36 minus n) over 39): 18: 0.823
mm2, 16: 1.31, 14: 2.08, 12: 3.31, 10: 5.26, 8: 8.37, 6: 13.3, 4: 21.15, 2:
33.62, 1: 42.41, 1/0: 53.49, 2/0: 67.43, 3/0: 85.01, 4/0: 107.2.

### mm2 figures

The published sources give no mm2 column that suits the same basis, so the mm2
figures are derived: the lower of the AWG column of the table above, read at the
cross-section of the size (a straight line between neighbouring sizes on a
log-log scale, extended below 18 AWG), and the maker's own mm2 rating (C and
C2) where there is one. Then rounded down to a multiple of 5 A.

| mm2 | interpolated | manufacturer | lower | table |
|---|---|---|---|---|
| 0.75 | 16.1 | none | 16.1 | 15 |
| 1 | 18.9 | 16.5 | 16.5 | 15 |
| 1.5 | 25.0 | 21 | 21 | 20 |
| 2.5 | 37.3 | 29 | 29 | 25 |
| 4 | 47.6 | 39 | 39 | 35 |
| 6 | 60.3 | 50 | 50 | 50 |
| 10 | 83.1 | 70 | 70 | 70 |
| 16 | 104.9 | 110 | 104.9 | 100 |
| 25 | 133.0 | 170 | 133.0 | 130 |
| 35 | 164.3 | 240 | 164.3 | 160 |
| 50 | 206.1 | 345 | 206.1 | 205 |
| 70 | 256.7 | 485 | 256.7 | 255 |
| 95 | 308.3 | 500 | 308.3 | 305 |

### Derating

A and B both give factors; they are applied per band of our table and the lower
is used. Our table figure is already for up to three conductors, so this is
conservative where the sources' factors are relative to a single conductor in
free air.

| Conductors | A | B | used |
|---|---|---|---|
| 1 to 2 | 1.0 | 1.0 | 1.0 |
| 3 | 0.70 | 1.0 (in the table) | 0.7 |
| 4 to 6 | 0.60 | 0.80 | 0.6 |
| 7 to 24 | 0.50 | 0.70 to 0.45 | 0.5 |
| 25 or more | 0.40 | 0.45 to 0.35 | 0.35 |

### Voltage drop

Resistance per metre is rho divided by the cross-section, with
rho = 0.0185 ohm mm2 per metre at 20 C. That is the annealed copper value
(R, 0.017241) plus an allowance for stranding and tin plating, taken from the
maximum resistance of the 10 mm2 cable in C (0.00185 ohm per metre times
10 mm2). At the 50 C operating temperature
rho = 0.0185 times (1 + 0.00393 times 30) = 0.02068 ohm mm2 per metre. The drop
is current times the resistance of the round trip (twice the cable length); on
AC it is multiplied by the power factor.

## What is derived and what is assumed

Derived: the AWG and mm2 columns (lower of the cited figures, rounded down), the
interpolation by cross-section, the combined derating factors, the resistivity at
50 C.

Assumed: copper everywhere, 105 C insulation everywhere, 30 C ambient everywhere,
the 50 C conductor temperature, the 5 A rounding, that a cable alone carries its
circuit's whole current, and that bundles are conduits only.

## Not covered

Zone based ambient temperature, other conductor materials, three-phase circuits
and checking protection against the device's own rating are follow-ups.
