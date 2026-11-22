# Implementation Plan: 0047 - Terminal and port connector types

GitHub issue #17: "Terminal and port types: connector form factors (M8 bolt,
ferrule, Schuko, RJ45, USB ...)".

## Overview

A terminal on a device (and so a port, which is a group of terminals sharing a
port name) gets an optional description of its physical connector: a kind picked
from a list with "Other" as free text, an optional size, an optional gender
(socket or plug) and an optional pin count. The app can then say what fits where.
This first build stores, validates, edits and shows the type. It does not record
how a cable end is terminated and does not check a cable end against the
connector it lands on; that stays a later plan.

## Decisions agreed with the user

- **Scope: types on terminals and ports only.** No cable end termination, no
  mismatch warning, no standard device presets filling the types yet.
- **Structured, not one text field.** A connector kind plus optional size,
  gender and pin count, so a later check has something to compare.
- **Shown in two places:** the device page terminals list (and the terminals
  editor row), and the terminal dropdowns of the cable form end pickers.
  Not in the schematic port blocks or dot tooltips for now, not in CSV.
- **The suggestion list is grouped by terminal and port**, built from the issue's
  examples, with "Other" for free text.

## Defaults, reviewed with the user

Reviewed with the user and agreed as proposed (per terminal row, kind and size
with gender and pins behind a "more" toggle, text values and free-text size):

- **Four optional fields on a terminal row:** `connector` (text), `size` (text),
  `gender` (`socket` | `plug` | null), `pins` (integer 1 or more | null). All
  null on existing terminals; nothing is required.
- **Per terminal, not per port.** A port stays a name shared by terminals, so the
  connector is stored on each terminal row. A port whose terminals all carry the
  same connector shows it once on the port. (Alternative: only on the first
  terminal of a port.)
- **Kind list**, two groups, then "Other":
  - Terminal: M5 stud, M6 stud, M8 stud, M10 stud, screw terminal, ferrule, ring
    terminal, spade, push-in spring, Anderson-style plug.
  - Port: Schuko, IEC inlet, RJ45, power connector, serial (DB9), USB-A, USB-B,
    USB-C, M12, VE.Direct, CAN, NMEA 2000 micro.
  Values are stored as the text shown, so "Other" simply stores what was typed
  and an older value is never lost (same approach as the device type list in
  `public/deviceTypes.js`). Types in use on the boat are offered too.
- **Size is free text** with a hint, for example "M8", "6 mm2", "1.5 mm2". Not
  validated beyond a length limit, since sizes are written many ways.
- **Which fields show for which kind:** size always, gender and pins offered for
  every kind, hidden behind a "more" toggle so the row stays short.
- **Display format:** one compact line, for example `M8 stud`, `ferrule 1.5 mm2`,
  `RJ45 socket 8 pins`. The same function builds it for the device page and the
  cable form pickers: `B+ (M8 stud)`.
- **API:** the terminal object in the device resource gains the four fields, in
  the OpenAPI schema; writes validate them (gender in the enum, pins a positive
  integer, text trimmed, empty becomes null).
- **Wording stays advisory.**

## Relevant SPEC/ARCHITECTURE Sections

SPEC.md, the device record (`terminals` list), the device page and the cable
form. ARCHITECTURE.md, the schema and migrations section.

## Approach

### 1. Schema and store (`src/schema.sql`, `src/store.js`)

- Migration 21 (next free version; renumber on rebase if the solar strings work
  also adds one): `ALTER TABLE device_terminals ADD COLUMN` for `connector`,
  `size`, `gender`, `pins`, each guarded with a PRAGMA column check like
  migration 20.
- `CHILDREN.device`: `columns`, `fromRow`, `normalize` and `check` carry the new
  fields; `check` rejects a gender outside the enum and a pin count that is not a
  positive integer. The fresh-database `schema.sql` gets the columns too.
- Change log diffs pick the fields up with the rest of the terminal.

### 2. API (`src/openapiSchemas.js`, `src/resources.js`)

The terminal schema documents the four fields. Nothing else in the resource
changes.

### 3. Pure helpers (`public/connectors.js`, new, tested)

- `CONNECTOR_KINDS` (terminal and port groups), `connectorOptions(used, current)`
  like `typeOptions`, `describeConnector(t)` for the compact line, and
  `cleanConnector(t)` for form values.
- `describeTerminal` in `public/deviceFields.js` and `cleanTerminals` use them.

### 4. The pages

- Device form terminals editor (`public/deviceFields.js` and the editor in
  `public/app.js`): a connector dropdown with Other, size, and a "more" toggle for
  gender and pins on each row.
- Device page terminals list: the compact connector line next to each terminal.
- Cable form (`public/cableForm.js`): the end terminal dropdown option labels
  include the connector.

### 5. Docs

SPEC.md (device `terminals`, device page, cable form), ARCHITECTURE.md (schema
version), CHANGELOG. The README only if it lists terminal fields.

## Test Strategy

- `test/connectors.test.mjs`: option list with used and current values, no
  case-insensitive repeats, `describeConnector` for each field combination,
  `cleanConnector` trimming and nulls.
- Store tests: a terminal round trips all four fields; an invalid gender and a
  pin count of 0, 1.5 and "x" are rejected; a database at version 20 migrates and
  keeps its terminals with null connectors; the change log records an edit.
- Cable form test: the end picker label includes the connector.
- The whole suite stays green in the signalk-server container.
- A headless Chromium check against the live server with every non-GET request
  blocked: the device page and the terminals editor, and the cable form picker,
  at 1100 px and 390 px, in the day and the red night theme, screenshots looked
  at.

## Implementation Steps

- [x] Migration 21 and the store fields with tests.
- [x] OpenAPI schema.
- [x] `public/connectors.js` with tests.
- [x] Terminals editor, device page list, cable form picker labels.
- [x] SPEC, ARCHITECTURE, CHANGELOG, headless checks.

## Files to Create/Modify

- `src/schema.sql`, `src/store.js`, `src/openapiSchemas.js`,
  `public/connectors.js` (new), `public/deviceFields.js`, `public/app.js`,
  `public/cableForm.js`, `public/style.css`, `test/connectors.test.mjs` (new),
  store and cable form tests, `SPEC.md`, `ARCHITECTURE.md`, `CHANGELOG.md`.

## Open questions

- Later plans, out of scope here: the cable end termination and a mismatch
  warning, standard device presets filling the types (Cerbo, MultiPlus), the
  battery post and BMS terminals follow-up of plan 0020, and the data and signal
  wiring of issue #4.
