# Implementation Plan: 0034 - Cable safety checks

Tracks GitHub issue #10.

## Overview

Two advisory checks on every cable: is the cable big enough for the protection
that feeds it and for its load (ampacity), and is the voltage drop along it
acceptable. Results show as warning badges and as a mark on the schematic wire,
with the reasoning one click away. The checks are advice, not a safety
guarantee.

## Decisions agreed with the user

- **Ampacity: a conservative table of our own**, shown in the app with its
  source and assumptions. It is built from widely published marine ampacity
  figures for a stated insulation rating, and no standards text is copied. The
  table is reviewed by the user before the feature is released.
- **Voltage drop: two global settings**, one for critical loads and one for
  normal loads, defaulting to 3 percent and 10 percent. They are plugin options
  next to the existing ones and are readable by the webapp. Critical loads are
  circuits that contain a device of a type the app already treats as critical.
- **Load current: measured values when available.** Order of preference:
  a measured current, else rated power divided by the voltage, else the
  rating of the protecting fuse or breaker as the worst case, with the source of
  the number named in the reasoning.
- **Where results appear:** warning badges on the cable rows and a count in the
  load summary, and a warning mark on the wire in the schematic with the reason
  on hover or tap.
- **Signal cables are exempt.** A cable whose conductors are all of the type
  "Signal or data" is not checked at all, for voltage drop and for ampacity: no
  verdict and no "cannot check" badge, since nothing is missing. Antenna cables
  are recorded as "Signal or data" too (no new cable type); a cable label or
  note can say "antenna". A cable that mixes signal and power conductors is
  checked on its power conductors only.
- **Missing data:** a muted "cannot check" badge that names what is missing
  (gauge, length or voltage), like the existing incomplete badge; no false
  alarms and no silence.

## Approach

### 1. The checks (pure, `public/cableChecks.js`)

- An ampacity table (copper, stranded, a stated insulation temperature rating)
  for mm2 and AWG sizes, with derating factors for cables sharing a conduit or
  bundle (conduits are recorded) and a stated ambient temperature. The table,
  its sources and its assumptions are kept in one data file and documented in
  `docs/cable-checks.md`, and the app shows the assumptions next to a result.
- Signal-only cables return an `exempt` result before any other check, and
  the display shows nothing for them.
- Per cable: (1) the derated ampacity against the rating of the fuse or breaker
  that protects the cable's circuit (the protection must not exceed what the
  cable can carry); (2) the ampacity against the load current when known;
  (3) the voltage drop: round trip length (feed plus return), copper
  resistivity at a stated operating temperature, current from the order above,
  voltage from the circuit's nominal voltage, as a percentage with the critical
  or normal limit. AC cables use the line and neutral round trip, the power
  factor of the device where set (else 1) and the same limits.
- Each result has a verdict (ok, warning, fail, cannot check), the numbers it
  used and the source of each (measured, rated, protection rating, table value),
  so the reasoning can be shown.
- Unit tests with hand-calculated cases for DC and AC, signal-only and mixed
  cables (exempt and power-only), each source of current,
  derating, the 3 and 10 percent limits, and each missing-data case.

### 2. Settings (`src/settings.js`, plugin schema)

- Two plugin options for the critical and normal voltage drop limits, defaults
  3 and 10, validated (a number between 0.5 and 20), exposed through the
  existing settings resource. Tests.

### 3. Display (`public/app.js`, `public/schematicView.js`, `public/style.css`)

- Badges on the cable rows ("cable too small", "voltage drop high", "cannot
  check: needs length") with the reasoning in a popover; a count line in the
  load summary; a warning mark on the schematic wire (and its stub) with the
  reason on hover or tap. The wording says "advisory" and links to the table and
  assumptions. Light and night themes.
- Measured current comes from the live values the page already has when Live
  mode is on; with no live value the check uses rated power or the protection
  rating.

## Defaults, reviewed with the user

- A measured current can only raise the estimate: the check uses the larger of
  the measured and the rated value, because a snapshot taken while a load is
  off would hide an overload. (Not answered by the user; stands as drafted
  unless they say otherwise.)
- The table is for copper conductors only; other materials show "cannot check".
- One stated ambient temperature (30 C) and one conductor insulation rating for
  the whole boat, shown in the assumptions text; a zone-based temperature is a
  follow-up (confirmed).
- The release version is chosen by the user, and the table must be reviewed
  first.

## Test Strategy

- Pure tests as above, with every expected number worked out by hand in the
  test comments.
- Settings tests.
- Headless Chromium on the mock server with the boat's data: the badges, the
  popover reasoning, the load summary count, the schematic mark, day and night,
  and a case of each verdict.
- A text scan that no standards text or table is copied and the table file
  cites its sources.

## Implementation Steps

- [ ] The ampacity data file, `docs/cable-checks.md`, and `cableChecks.js` with
      tests.
- [ ] The two plugin options and their tests.
- [ ] Badges, popover, load summary count and schematic mark.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, tick the boxes in issue #10.
- [ ] The user reviews the table and assumptions before a release.

## Files to Create/Modify

- New `public/cableChecks.js`, a data file for the table, `docs/cable-checks.md`,
  `src/settings.js`, the plugin schema file, `public/app.js`,
  `public/schematicView.js`, `public/style.css`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Zone-based ambient temperature, other conductor materials, and three-phase
  circuits.
- Checking protection against the device's own rating.

## Open questions

None. The decisions and the reviewed defaults are above.
