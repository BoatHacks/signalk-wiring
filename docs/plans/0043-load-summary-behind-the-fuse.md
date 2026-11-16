# Implementation Plan: 0043 - Load Summary: the load behind a fuse

Tracks GitHub issue #34 (Load Summary: fold circuits that feed no consumer).

## Overview

About half of the Load Summary rows on the demo data read "0 devices, 0 W,
0.00 A, ok": feed fuses and segments that protect other circuits and feed no
consumer directly. They bury the rows that matter, and a main fuse, the most
important protection on the boat, shows nothing about the load it carries. This
plan does two things: a fuse shows the summed load of everything behind it, so
those rows become useful, and circuits that still carry nothing are folded away.
It also adds a one line summary of the verdicts.

## Decisions agreed with the user

- **An upstream fuse shows the summed load of everything behind it.** This is a
  calculation change and needs the advisory wording.
- **The summed load is checked against the fuse rating like any circuit.** An
  upstream fuse can therefore read "over rating" on the sum of everything behind
  it, a cautious worst case that assumes everything runs at once.
- **A row shows its own load as today; what is behind it is on expand.** A row
  with circuits behind it has an arrow that opens the list of those circuits and
  the sum. The rating check uses the sum, and it is shown in the opened part and
  in the row's status.

- **Converters:** a circuit behind a converter is added to the sum as the power
  its consumers draw; the converter's losses are not counted and the opened part
  says so.
- **A finding is an over rating (own or with everything behind it) or an
  incomplete check.** A circuit with a finding stays visible even with no
  consumer.
- **The row badge reads "over rating with everything behind it"** when only the
  sum behind the fuse exceeds the rating.
- **The fold and the summary line:** "Show N circuits with no consumers", closed
  by default and remembered in the browser; the summary line counts all circuits,
  shown or folded.

## Defaults, reviewed with the user

These are my proposals, to be reviewed before the build:

- **What "behind" means.** Circuit B is directly behind circuit A when B's feed
  starts at a device that A's cables end at (a bus bar, a switch, a converter),
  and B is behind A when it is behind a circuit that is behind A. This is worked
  out from the cables the page already loads, so no server change is needed.
- **Voltage and rows shown.** The sum is in watts and is turned into amps at the
  voltage of the fuse itself. A circuit is shown when it has a consumer of its
  own, has circuits behind it, or has a finding.
- **How the sum is made.** The consumers and bus loads of the circuit and of
  every circuit behind it, each device once (a device fed by two circuits counts
  once in a sum), at its measured peak or its rating, exactly as the circuit's
  own total is made today, by the same function. Peaks are added as if all ran at
  once, which is the cautious figure the page already uses.
- **Sorting** keeps working on the rows that are shown. The expanded parts do not
  take part in the sort.
- **Wording stays advisory.** The expanded part carries "Advisory only: peaks
  are added as if everything ran at once, and converter losses are not counted."
  The existing page text about not being a certified calculation stays.

## Approach

### 1. Pure helpers (`public/loadCalc.js`, tested)

- `circuitsBehind(circuits, cables)`: for each circuit id, the ids of the
  circuits behind it (direct and further), from the cables of the circuits and
  the devices their feeds start and end at. A cycle is cut so it cannot loop.
- `calculateBehindLoad(circuit, behind, deviceById)`: a synthetic circuit with the
  union of the consumers and bus loads of the circuit and the circuits behind it
  (each device once), passed through `calculateCircuitLoad`, so the sum is made
  by the same function as the own total. Returns the load figures plus the
  number of circuits behind.
- `loadFindings(load, behindLoad)`: whether the row has an over rating (own or
  behind) or an incomplete finding.
- `summaryLine(rows)`: the "N circuits: x over rating, y incomplete, z ok" text.
- `shownCircuits(rows)`: the split into rows shown and folded.

### 2. The page (`public/loadSummary.js`)

- Builds `behind` and the per circuit loads once, shows the summary line, splits
  the rows into shown and folded, and renders the expand arrow, the opened part
  and the fold with the remembered choice.
- The opened part lists the circuits behind (a link and its own watts), the sum,
  its amps, the rating check and the advisory text.

### 3. Styles (`public/style.css`)

The expand arrow in the table row, the opened row, and the fold line.

## Test Strategy

- Unit tests for `circuitsBehind` (a main fuse behind which two branch fuses sit,
  a bus bar in between, a converter, a cycle, a circuit behind two fuses), for
  `calculateBehindLoad` (each device once, measured and rated figures, bus
  loads, the voltage of the fuse), `loadFindings`, `summaryLine` and the split
  into shown and folded.
- The existing Load Summary tests stay green.
- A headless Chromium check against the demo data with every non-GET request
  blocked: the summary line, the main fuse with its sum and expand, the fold
  closed and open and remembered after a reload, sorting on the shown rows, at
  1100 px and 390 px, in the day and the red night theme, with screenshots that
  are looked at.

## Implementation Steps

- [x] The pure helpers with tests.
- [x] The page: summary line, expand, status, fold.
- [x] CHANGELOG, README line if it describes the Load Summary, `docs` if the load
      rules are described there, headless checks.

## Files to Create/Modify

- `public/loadCalc.js`, `public/loadSummary.js`, `public/style.css`,
  `test/loadSummary.test.mjs`, `test/loadCalc.test.mjs` (or the existing load
  tests), `CHANGELOG.md`, `README.md`, `SPEC.md` where it describes the Load
  Summary.

## Open questions

None. The decisions are above; the defaults are for review.
