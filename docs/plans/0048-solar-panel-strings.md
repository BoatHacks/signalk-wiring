# Implementation Plan: 0048 - Solar panel strings (issue #15)

GitHub issue: BoatHacks/signalk-wiring#15, "Solar panel strings: series and
parallel links, string voltage and controller checks".

## Overview

Solar panels wired in series or parallel are only a workaround today: the boat's
string (port, middle, starboard panel in series, the positive cable arriving at
the port panel, the negative cable leaving the starboard panel, then a PV breaker
and a MPPT charger) is stored as two series-link cables written as negative-type
conductors so that they raise no warning and make no circuit. Nothing computes
the string's voltage or checks it against the charge controller.

This plan gives solar panels what batteries already have: a series or parallel
link type on a cable between two panels, an array derived from those links (layout
such as 3S or 2S2P), per-panel electrical data, computed string values, advisory
checks against the charge controller, a Solar tab with one card per array, and a
circuit that treats the array as one supply.

## Decisions agreed with the user

- **Solar only.** The link type applies to a cable between two devices whose type
  is "Solar panel". Wind and hydro generators are not covered; the code keeps the
  series and parallel reduction shared with batteries, so widening it later is a
  small step.
- **Per-panel figures are new device columns**: Voc, Isc, Vmp, Imp and the Voc
  temperature coefficient (rated power already exists as `ratedPowerW`). They are
  shown in the device form for a Solar panel and exposed in the API. They are not
  parsed from notes.
- **Three controller checks**, all advisory in wording: the cold string Voc
  against the controller's maximum PV voltage, the array current against the
  controller's PV input current limit, and the array power against the
  controller's rating.
- **The array is one supply in circuits.** Links between panels are not circuits
  and raise no "backwards" or "unprotected" warning. The circuit from the array's
  positive cable through the PV breaker to the controller is fed by the whole
  array, with the array's Vmp as its voltage. The migration converts the boat's
  two negative-type link cables to series links.
- **A new Solar tab**, one card per array, like the Batteries tab.
- **No schematic change now.** Panel-to-panel links already draw as ordinary
  wires. Live controller values (PV voltage and power) show on the Solar card when
  the controller has SignalK paths mapped.

## Defaults, reviewed with the user

All fourteen were reviewed with the user and agreed as written (cold
temperature -10 C and assumed -0.30 %/C, 90 % note and 100 % warning, three new
controller fields, migration rewrites the cables, walk downstream for the
controller, array Vmp as circuit voltage, live paths and Dashboard warnings both in):

1. **Which controller does an array feed.** Walk the positive cables downstream of
   the array's panels, through switches, breakers, fuses and bars, to the first
   converter device. Several controllers on one array (two arrays, two MPPTs) are
   fine: each array finds its own. An array that reaches no converter gets the
   figures but no checks, and a note "no charge controller found".
2. **Controller limits are new device fields on a converter**: `pvMaxV` (maximum
   PV open-circuit voltage), `pvMaxA` (maximum PV input current, short-circuit
   rated where the maker gives that), `pvMaxW` (maximum PV input power, optional).
   They are separate from the existing DC rating fields because those describe
   switchgear. Shown in the form for a device whose type is "MPPT charger" or that
   has a terminal port named "PV in". A missing limit skips its check and the card
   says so.
3. **Cold voltage.** `Voc_cold = Voc x (1 + k/100 x (Tcold - 25))` with `k` the
   panel's Voc temperature coefficient in %/C (negative), `Tcold` a new setting
   (default -10 C, range -40 to 25). With no coefficient entered the check assumes
   -0.30 %/C and says "assumed" on the card. The string value is the sum over a
   string of the cold Voc of each panel, the array value is the highest string.
4. **Voltage check levels.** Cold Voc above `pvMaxV`: warning "may exceed".
   Between 90 % and 100 % of `pvMaxV`: note "close to". Below 90 %: ok.
5. **Current check.** Per string the current is the lowest panel Isc (the weakest
   panel limits a series string); the array Isc is the sum over parallel strings;
   Imp the same way. Array Isc above `pvMaxA` is a warning, above 90 % a note.
6. **Power check.** Array rated power (sum of `ratedPowerW`) above `pvMaxW` is a
   note only, never a warning: over-paneling is common and often intended.
7. **Mixed panels.** Series strings with unlike panels are legal, so no error;
   strings in parallel whose Vmp differ by more than 5 % get a note (they pull the
   voltage down to the lowest).
8. **Parallel and series validation reuses the bank rules.** A series cycle, a
   branch, or a link that is both series and parallel gives a warning and no
   totals, exactly as banks.
9. **Cable kinds.** A series link between panels is a single positive conductor
   (like a battery series link); a parallel link carries positive and negative. The
   form offers the link choice when both ends are Solar panels: like batteries, a new panel-to-panel cable is a parallel link until
   chosen (nothing is preselected as series). Existing cables are never changed except by the migration below.
10. **Migration (schema version 22 on this base; renumber on rebase).** A cable
    between two Solar panels, no link set, every conductor negative, becomes
    `link = 'series'` with a single positive conductor. Idempotent, and the real
    boat's two cables are the case it is written for. Nothing else is rewritten.
11. **Array voltage in the circuit.** The circuit fed by an array takes the array
    Vmp as its `voltage` (the sum of the panels' Vmp over the string, the lowest
    string for parallel strings), replacing the nominal voltage the user typed on
    the port panel as a workaround. A panel's own `nominalVoltage` stays the
    fallback when Vmp is missing.
12. **Live values.** The card shows the controller's PV readings: new optional device fields `pvVoltagePath` and `pvPowerPath` on the
    controller (SignalK paths, for example `electrical.solar.<id>.panelVoltage`
    and `.panelPower`), read through the existing live pipeline. Nothing shows
    when unset.
13. **The Dashboard.** Warnings from the array checks join the existing Needs
    attention list; notes stay on the Solar tab. No new tile.
14. **Wording stays advisory**: "may exceed", "close to", "no limit entered".

## Relevant SPEC/ARCHITECTURE Sections

SPEC.md: the battery bank section (link types, banks), the circuit derivation
(source nodes, backwards warning, circuit voltage), device fields. ARCHITECTURE.md:
derivation modules and the schema migrations. Each gets a short section for arrays.

## Approach

### 1. Data (`src/store.js`, `src/schema.sql`, `src/openapiSchemas.js`)

Migration 22 adds device columns `voc_v`, `isc_a`, `vmp_v`, `imp_a`,
`voc_temp_coeff`, `pv_max_v`, `pv_max_a`, `pv_max_w`, `pv_voltage_path`,
`pv_power_path`, and runs the cable conversion (default 10). `schema.sql` gets the
columns for fresh databases. The device writer validates the numbers (positive,
the coefficient between -1.5 and 0 %/C) and the paths, in the style of
`_checkBattery`. `_checkLink` also accepts `series`/`parallel` when both ends are
Solar panels (and keeps its battery rule otherwise). A new setting
`coldTemperatureC` goes through `src/settings.js`.

### 2. The derivation (`src/arrays.js`, new, pure and tested)

The series-and-parallel reduction in `src/banks.js` (chains, parallel joins,
cycle and branch detection) moves to a shared helper used by banks and arrays, so
bank behaviour does not change (the existing bank tests are the guard).
`deriveArrays({ devices, cables, settings })` returns one array per group of
linked panels, a lone panel being an array of one:
`panelIds, cableIds, strings, layout, voc, vocCold, vmp, iscA, impA, powerW,
controllerId, checks[], missing[], complete, warnings[]`. Checks have a `level`
(`ok`, `note`, `warning`), a `code` and an advisory message. `deriveAll` in the
store carries `arrays` next to `banks`.

### 3. Circuits (`src/circuits.js`)

A cable between two Solar panels with a link type is an array link: dropped from
the positive graph like bank links, so no "backwards" and no false unprotected
circuit. The panels of an array are one supply node for the trace (the array's
terminal cables are the positive cable at one end and the negative at the other,
already how the real boat is wired). The circuit voltage comes from the array
(default 11). `deriveCircuits` takes an optional map of array voltages from the
store, so it stays pure.

### 4. The API (`src/routes.js`, `src/openapi*.js`)

`derived` gets `arrays`; device schema gets the new fields; cable `link`
description says "batteries or solar panels". The settings schema gets
`coldTemperatureC`.

### 5. The pages (`public/`)

- `public/solar.js` (pure helpers, mirrors `public/batteries.js`): array titles
  and layout text, number formatting, check display, single-panel arrays for
  panels the server sent none for.
- `public/solarView.js`: the Solar tab, one card per array: name line (layout and
  controller), the panels in order, Voc, cold Voc with the temperature, Vmp, Isc,
  Imp, power, the controller limits with an ok / note / warning mark each, live
  PV voltage and power, a "missing data" line naming panels without figures.
  Tab added to `public/router.js` and `public/tabBar.js`.
- Device form (`public/deviceFields.js`, `public/app.js`): the panel figures for
  type Solar panel, the controller limits and paths for an MPPT charger.
- Cable form (`public/cableForm.js`): `linkApplies` also true for two Solar
  panels, series and parallel choices as for batteries, badge in the cable table
  (already shown for any `cable.link`).
- Settings page: the cold temperature field.
- Dashboard (`public/dashboard.js`): array warnings in Needs attention.

### 6. Docs

SPEC.md, ARCHITECTURE.md, CHANGELOG (unreleased), README status.

## Test Strategy

- `test/arrays.test.js` (pure): one panel; 3S (the real boat's data: 3 x 44.11 V
  Voc gives 132.33 V, Vmp 113.67 V, Isc 6.5 A); 2S2P; parallel link as default for
  a plain cable; mixed panels (lowest Isc wins in a string, sums across strings);
  missing figures give `complete: false` and name the panel; cycle, branch and a
  mixed link give a warning and no totals; the controller found through a PV
  breaker; no controller; cold Voc maths with a coefficient and with the assumed
  one; each check's level at, under and over the 90 % and 100 % lines; no limit
  entered skips the check; power check is a note only.
- `test/banks.test.js` stays green unchanged (the shared reduction).
- `test/circuits.test.js`: a 3S string with a PV breaker and a controller gives one
  circuit, no backwards, no unprotected, voltage from the array; the old
  workaround data (negative links) also gives no false circuit after the
  migration.
- `test/store.test.js`: migration 22 converts the two negative cables and nothing
  else, and is idempotent; the link validation (solar panels accepted, a panel to
  a battery rejected); the numeric field validation; the setting range.
- Browser-side tests (`.mjs`): solar helpers, the Solar view render, the cable form
  link choice for two panels, the device form fields.
- The whole suite stays green in the container.
- A headless Chromium check against the live server (GET only, `public/` served by
  route interception): the Solar tab with the real boat's string, the panel and
  controller forms, at 1100 px and 390 px, in day and red night theme, screenshots
  looked at.

## Implementation Steps

- [x] Migration, schema, device and cable validation, settings, with tests.
- [x] Shared series/parallel reduction, `src/arrays.js` with tests.
- [x] Circuits: array links and array voltage, with tests.
- [x] Store `deriveAll`, routes and OpenAPI text.
- [x] `public/solar.js`, Solar tab, device and cable forms, Dashboard. (The cold temperature is a plugin option set in the SignalK admin config form, not a field on the settings page.)
- [x] SPEC, ARCHITECTURE, CHANGELOG, README; container test run; headless checks.

## Files to Create/Modify

- New: `src/arrays.js`, a shared reduction helper (`src/seriesParallel.js`),
  `public/solar.js`, `public/solarView.js`, `test/arrays.test.js`, browser tests.
- Modified: `src/banks.js`, `src/circuits.js`, `src/store.js`, `src/schema.sql`,
  `src/settings.js`, `src/routes.js`, `src/openapiSchemas.js`, `src/openapiMeta.js`,
  `public/router.js`, `public/tabBar.js`, `public/app.js`, `public/deviceFields.js`,
  `public/cableForm.js`, `public/dashboard.js`, `public/style.css`, `SPEC.md`,
  `ARCHITECTURE.md`, `CHANGELOG.md`, `README.md`.

## Open questions

None left from the first rounds. The defaults above are for review. One thing to
confirm during review: the schema version, which depends on whether the connector
types plan (0047) lands first.
