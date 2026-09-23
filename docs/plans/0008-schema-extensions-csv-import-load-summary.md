# Implementation Plan: 0008 - Schema extensions, CSV import, panel load summary

## Overview

Extend the data model with fields a real electrical worksheet needs
(cable label, switch reference, voltage, rated power, a structured
breaker rating) that surfaced from parsing a real boat's panel CSV
(`tinarasia/laserbrain`'s `Tinarasia Electrical + Network - Sheet8.csv`);
add a generic CSV import so that kind of worksheet — and others shaped
differently — can be bulk-loaded instead of re-typed; and add a panel
load summary view that uses the new fields to do automatically what the
source spreadsheet was doing by hand (summing amperage per circuit and
checking it against the breaker rating).

Three parts, referred to as A/B/C throughout, matching how they were
scoped in conversation:
- **A** — schema extensions
- **B** — CSV import (generic column-mapping)
- **C** — panel load summary page

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (Data Model — every field this plan adds), §9
  (Configuration — a new `defaultLengthUnit` setting, mirroring
  `defaultGaugeUnit`), §10.2 (CSV import was explicitly deferred here
  with "import format needs real usage data to design against" — this
  plan is that revisit, now that real data exists)
- ARCHITECTURE.md §3 (SQL schema — new columns, and the schema-migration
  mechanism this plan adds, since nothing needed one before), §2 (a new
  `LoadSummary` view, client-side CSV import — no new server routes)

**Both SPEC.md and ARCHITECTURE.md need real edits as part of this
plan**, not just this doc — new domain fields are exactly the kind of
thing that belongs in SPEC.md §4, not only in a plan's implementation
notes.

## Part A: Schema Extensions

### New/changed fields

| Table | Change |
|---|---|
| `circuits` | `source` → renamed `source_label` (same meaning, new name to make room for the next field); add `breaker_rating REAL` (numeric amps); add `voltage REAL` |
| `wire_runs` | add `cable_label TEXT`, `switch_ref TEXT`, `length_unit TEXT` |
| `devices` | add `rated_power_w REAL`, `signalk_path TEXT` |

### Design decisions

- **`device.signalk_path` is free text, not validated against the live
  SignalK data tree.** SignalK paths are heterogeneous — vendor/custom
  segments, no fixed enumerable set the plugin could check against —
  and more importantly, the wiring record should be documentable
  standalone: a device's physical wiring is worth recording before
  (or even if) its SignalK path ever exists, e.g. documenting a sensor
  that isn't wired up yet, or one this server doesn't currently have a
  source for. The webapp form gives it a placeholder example (e.g.
  `electrical.switches.anchorLight`) as a hint, not a schema constraint.
  One `signalk_path` per device (not per wire run) — the path describes
  the device's own data (a switch's state, a battery's voltage/current),
  not anything about how it's physically wired.
- **Not fetching/displaying the path's live value in this plan** — that
  would need a running SignalK connection from the webapp (a
  `/signalk/v1/api/vessels/self/<path>` fetch or a delta subscription)
  and its own error handling for a path that doesn't currently exist.
  Worth a future plan once the field itself is in use; out of scope for
  "extend the schema to reference a path."

- **`circuit.source` splits into `source_label` + `breaker_rating` now**,
  not additively. The whole point is enabling "is this circuit's load
  under its breaker's rating" as a real check (Part C) — a numeric
  field alongside an untouched free-text field would leave the free-text
  one as the "real" answer and the number as an easily-stale duplicate.
  Existing free-text values (e.g. `"Breaker 4, 15A"`) become
  `source_label` as-is on migration; `breaker_rating` starts `null`
  until edited — no attempt to regex-extract a number out of old
  free text, since a wrong auto-extracted rating silently feeding a
  safety check is worse than an honestly-empty field.
- **`voltage` lives on `circuit`, not plugin config.** A boat commonly
  has both a 12V DC panel and a 230V AC panel — a single global default
  wouldn't cover that, and SPEC.md's existing config philosophy
  (§9 — convention/gauge unit "drive labeling hints only, never
  enforced") already establishes settings as UI defaults, not
  requirements, so there's no real loss in making this a plain nullable
  field instead of a defaulted setting.
- **`length_unit` mirrors the existing `gauge_unit` pattern exactly**,
  including a new `defaultLengthUnit` plugin config setting (m | ft) —
  consistent with how `defaultGaugeUnit` already works, same reasoning.
- **Migration mechanism**: nothing has needed one before (`store.js`'s
  constructor just runs `CREATE TABLE IF NOT EXISTS` from
  `schema.sql`), and this plan needs one for the first time — a rename
  and several `ADD COLUMN`s against a table that may already exist with
  the old shape. Using SQLite's own `PRAGMA user_version` as the schema
  version: `schema.sql` is updated to the *new* shape (so fresh installs
  get everything directly), and `store.js` runs an ordered list of
  `{version, apply(db)}` migrations against any database whose
  `user_version` is behind, using `ALTER TABLE ... RENAME COLUMN` /
  `ADD COLUMN` (both supported by the SQLite bundled with
  `better-sqlite3` 13.x). Small and specific to this need — not a
  general migration framework, since there's exactly one migration to
  write today.

## Part B: CSV Import

### Design decisions

- **Entirely client-side, no new server routes.** CSV parsing and
  column mapping happen in the browser; the actual writes reuse the
  existing `putResource` calls the webapp already has (plan 0004) — an
  import is just a lot of creates, not a new API. This also means no
  new server-side dependency for CSV parsing.
- **Generic column-mapping, not a fixed importer for this one file's
  layout.** The source CSV's German headers (`Verbraucher`, `Sicherung`,
  …) won't match anyone else's export. After picking a file, each
  detected column gets a dropdown: map it to a wiring field, or skip
  it. Mapping targets:
  - Circuit: **Circuit grouping key** (optional — see below), Source
    label, Breaker rating, Voltage
  - Device: **Name** (required), Type, Zone, Rated power (W)
  - Wire run: From endpoint, To endpoint, Gauge, Gauge unit, **Gauge
    (combined, e.g. "2,5 mm²")**, Color, Length, Length unit, Zone,
    Cable label, Switch reference, Notes
- **Circuit grouping is optional, not assumed.** This CSV's `Sicherung`
  column groups multiple device-rows under one shared circuit — but a
  differently-shaped export might have one row per wire run with its
  own circuit name column instead. If a grouping column is mapped,
  distinct values become distinct circuits (multiple CSV rows → one
  circuit, several wire runs). If nothing is mapped to it, every row
  becomes its own circuit (one row → one circuit → one wire run) —
  keeps the importer useful for both shapes rather than assuming this
  file's structure generally.
- **Circuit names are synthesized when there's no explicit name
  column** (true for the source file — `Verbraucher` is per-*device*,
  there's no per-circuit name field at all): `Circuit <grouping value>`
  (e.g. "Circuit 2"), renameable afterward through the normal edit form
  like any circuit. Documented in the importer's own UI text, not just
  this plan, so it isn't a silent surprise.
- **`wireRun.fromEndpoint` defaults to the circuit's source label**
  when there's no explicit "from" column (true for the source file —
  there's a shared fuse, not a labeled terminal per row), falling back
  to `Source` if that's blank too. Every wire run needs a `fromEndpoint`
  (SPEC.md §2), and there's no better data to use.
- **The combined-gauge mapping target exists specifically for this
  file's `Querschnitt` column** (`"2,5 mm²"` — number and unit in one
  cell, German decimal comma), via a small regex extractor
  (`/^([\d,.]+)\s*(mm²|mm2|awg)/i`, comma normalized to a decimal
  point). A plain "Gauge" + "Gauge unit" mapping pair remains available
  for CSVs that already have them as separate columns.
- **Device de-duplication within one import**: multiple rows mapping to
  the same device Name (after trimming) reuse one device rather than
  creating duplicates — realistic for a device fed by more than one
  circuit. De-duplication is scoped to *this import batch* only, not
  against already-existing devices from a prior import or manual entry
  — matching existing device names against freshly-imported ones risks
  silently merging two actually-different devices that happen to share
  a name; a duplicate the user can manually merge/remove is the safer
  failure mode.
- **A preview step before committing anything**: after mapping, show
  the resulting circuit/wire-run/device counts (and the synthesized
  names) before any `putResource` call runs, so a bad mapping is
  visible before it writes 30 records.

### UI flow

`CircuitsList` gets an "Import CSV" entry point alongside "+ New
circuit". Three steps in one modal/panel: **1)** file picker → parse →
show detected columns; **2)** mapping dropdowns per column; **3)**
preview (counts + a sample of synthesized names) → confirm → run the
import via existing `putResource` calls, same reload-after-write pattern
as the rest of the webapp.

## Part C: Panel Load Summary

A third nav tab, "Load Summary", alongside Circuits/Devices.

For each **active** circuit: sum `rated_power_w` across the **distinct**
devices reachable via its **active** wire runs (a device wired in twice
within the same circuit isn't double-counted); divide by `voltage` for
total amps (shown as "voltage not set" if null, not a wrong number from
assuming one); compare against `breaker_rating` (shown as "rating not
set" if null) and flag the row if amps exceed it.

**Design decision — known simplification, stated rather than hidden**:
a device's full rated wattage is attributed to *every* circuit it's
wired into, even though in reality it draws from at most one at a time
in most cases (e.g. a primary/backup-fed device). This overstates load
on a circuit that's genuinely a backup path. Correct handling would need
per-wire-run power rather than power tied to the device, which isn't
data this plan collects — flagged here as a known limitation for the
summary to state in its own UI copy, not something to quietly get
wrong.

## Test Strategy

- **Part A**: `node:test` coverage for the migration — a fixture DB
  built against the *old* schema (no `source_label`/`breaker_rating`/
  `voltage`/etc.), run through `store.js`'s migration path, assert the
  new shape and that old `source` data landed in `source_label`
  unchanged.
- **Part B**: unit tests for the pure parsing helpers (CSV parsing
  itself, the combined-gauge regex extractor, German decimal-comma
  handling) — these don't need a browser. The import UI flow itself is
  verified manually in a real browser (established pattern from plans
  0003-0007), specifically re-importing the actual source CSV from
  `tinarasia/laserbrain` as the real-world test case this plan exists
  for.
- **Part C**: unit-testable load-calculation logic (sum/divide/compare)
  factored out of the rendering, tested directly; rendering verified
  manually.

## Implementation Steps

### A — done

- [x] `src/schema.sql` — new shape (fresh installs)
- [x] `src/store.js` — migration runner (`PRAGMA user_version`-gated),
      the one rename + several `ADD COLUMN` migrations
- [x] `public/app.js` — `CIRCUIT_FIELDS`/`WIRE_RUN_FIELDS`/
      `DEVICE_FIELDS` updated for the new fields (including
      `device.signalkPath`, added to this plan after the CSV-parsing
      discussion surfaced it as a related, genuinely useful field —
      "associate `electrical.switches.xyz` with a digital switch, or a
      voltage/current sensor with a battery"); `CircuitDetail`'s display
      of `circuit.source` → `sourceLabel` + `breakerRating` + `voltage`;
      wire run table gained Cable and Length columns (Length wasn't
      shown in the table at all before this, only in the edit form —
      fixed in passing since the table was already being touched)
- [x] Plugin config schema (`index.js`) — `defaultLengthUnit`
- [x] SPEC.md §4/§9/§12, ARCHITECTURE.md §3 (+ new §3.1 documenting the
      migration mechanism itself) updated
- [x] `test/store.test.js` additions for the migration — including a
      "run it twice" test, since the migration runs on every restart,
      not just the first one after upgrading

## Bug found in verification: number inputs silently rejected decimals

Editing the migrated circuit's new fields in a real browser (not just
curl/API checks) surfaced a real, pre-existing bug: `<input
type="number">` defaults to `step="1"` unless told otherwise, so typing
`3.5` into Length got a native browser validation tooltip
("the two nearest valid values are 3 and 4") and silently blocked form
submission. This affected every numeric field `Form` has ever rendered
— gauge, length, and now breaker rating/voltage/rated power — and had
gone unnoticed since plan 0004 because no prior manual test happened to
type a fractional value into a number field. Fixed with `step="any"` on
all number inputs; re-verified with an actual `3.5` value round-tripping
correctly.

## Manual Verification Results

Beyond the usual browser check, this plan's migration needed verifying
against something closer to a real upgrade than the unit test fixture:
built an old-shape database (pre-0008 schema, real `circuits`/
`wire_runs`/`devices` tables via a raw `better-sqlite3` connection) at
the actual live plugin data path, then started the real `signalk-server`
against it — confirmed via the resource API that `source` correctly
became `sourceLabel` with the old value intact and the new fields
present as `null`, no crash, and then edited that same migrated circuit,
its wire run, and a device through the real webapp forms (screenshots
sent), including the `device.signalkPath` field this addition was
specifically about — `electrical.switches.navLights.state` round-tripped
and displays on `DeviceDetail` as designed.

### B — done

- [x] `public/import.js` (new) — CSV parser, column-mapping UI, preview,
      import execution
- [x] Entry point on `CircuitsList`
- [x] `test/import.test.mjs` (new) — turned out `node --test` discovers
      `.mjs` files natively (verified empirically before committing to
      this approach), so the pure functions (`parseCsv`,
      `parseGermanNumber`, `parseCombinedGauge`, `groupImportRows`) are
      tested directly via ES module `import`, no extra tooling needed.
      13 tests, including a full real-world fixture test against
      `test/fixtures/tinarasia-electrical.csv` — the actual source file,
      committed as a regression fixture rather than only tested by hand
- [x] Manual verification: imported the actual source CSV end to end
      through the real UI (not just the pure functions) in a real
      browser

## Manual Verification Results (Part B)

Full flow through the actual webapp, logged in: Import CSV → uploaded
the real `tinarasia-electrical.csv` → mapping step correctly showed
`Sicherung` and the uniquified `Sicherung (2)` as distinct columns (the
duplicate-header handling from `parseCsv`, visible in the real UI, not
just asserted in a unit test) → mapped 6 columns → preview showed
**12 circuits, 27 devices, 27 wire runs** exactly matching the
hand-derived expectation from Part A's design discussion → import
completed, all 66 records actually written (confirmed via the resulting
circuits list, not just a "success" toast) → opened "Circuit 2" and
confirmed the diagram and wire-run table matched the source spreadsheet
precisely: 3 devices (Ankerlaterne, Decklampe, Toplicht (Motor)), gauge
2.5mm² on all three (from the combined "2,5 mm²" cell), lengths 10/10/15
(from `Kabellänge`), breaker rating 25A (from `LS-Größe` on the group's
first row), and `fromEndpoint` correctly falling back to the literal
`"Source"` label since neither an explicit From column nor a circuit
source-label column was mapped for this run.

### C
- [ ] `public/app.js` — `LoadSummary` component + nav tab
- [ ] Manual verification against the live server

## Files to Create/Modify

- `src/schema.sql`, `src/store.js`, `index.js` (Part A)
- `public/app.js`, `public/import.js` (new, Part B), `public/style.css`
- `test/store.test.js` additions, new parser tests
- `SPEC.md`, `ARCHITECTURE.md`
