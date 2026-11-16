# Implementation Plan: 0040 - Sortable lists

## Overview

Every page with a list of entries gets sorting. The two real tables, Cables and
Load Summary, get clickable column headers. The card lists (Devices, Circuits,
Conduits, Batteries, Buses, Zones, Changes) get a "Sort by" control with an
up/down toggle next to their filters. Each list remembers its own choice in the
browser. The default order stays what it is today until someone picks a sort.

## Decisions agreed with the user

- **Tables get clickable column headers** (Cables, Load Summary).
- **Card lists get a sort control** (a dropdown of the fields that make sense
  for the list and a direction toggle) instead of being rebuilt as tables.
- **The choice is remembered per list, in this browser**, the same way "Show
  removed" is remembered. If storage is unavailable the list just opens in its
  default order.
- **Pages:** Cables, Load Summary, Devices, Circuits, Conduits, Batteries,
  Buses, Zones, Changes. (Changes was left out while building, see below.)

## Approach

### 1. A pure helper (`public/sort.js`, tested)

- `compareValues(a, b)`: numbers compare as numbers, text compares with a
  natural, case-insensitive collation (`Intl.Collator` with `numeric: true`, so
  "B10-3" sorts before "B10-12"). Empty values (null, undefined, empty string,
  NaN) always sort last, in both directions.
- `sortItems(items, columns, sort)`: `columns` maps a key to a function that
  returns the sort value of an item; `sort` is `{ key, dir }` with `dir` of
  `asc` or `desc`. The sort is stable and ties keep the list's default order. A
  missing or unknown key returns the items unchanged.
- `nextSort(sort, key)`: the header click cycle: a new column starts ascending,
  a second click on it goes descending, a third click clears the sort back to
  the default order.
- `readSort(listKey)` and `writeSort(listKey, sort)`: remembered per list in
  `localStorage` under its own key, every access wrapped in try/catch, an
  unknown saved key or direction is ignored.

### 2. Two small components (in the web app)

- A sortable column header: the header text as a button, `aria-sort`, and a
  small up or down arrow on the active column. Used in the table headers; the
  Cables select-all checkbox column and the action columns stay unsortable.
- A sort control for card lists: a "Sort by" select (first entry "Default
  order") and a button that flips ascending and descending, placed with the
  existing filters.

### 3. The columns, per list

Values are what the person sees, with unit conversion where the shown text is
not comparable:

- **Cables:** From, To (device names), Cable (label), Conduits (first name),
  Gauge (cross section in mm2, AWG converted), Length (metres, other units
  converted), Zone, Checks (worst result first), Status. Conductors, Circuits
  and the actions are not sortable.
- **Load Summary:** Circuit, Devices (count), Total W, Average W, Voltage, Amps,
  Protection (rating in A, "none" last), Status (over rating, incomplete, ok).
- **Devices:** Name, Role, Type, Zone, Status.
- **Circuits:** Name, Protection rating, Voltage, Cables (count), Status. The
  exact fields follow what the card shows today.
- **Conduits:** Name, Kind, Zone, Cables (count), Status.
- **Batteries:** Name, Voltage, Capacity, Energy.
- **Buses:** Name, Taps (count), LEN.
- **Zones:** Name, Devices, Wire runs, Conduits.
- **Changes:** not sortable (see below).

The text and number sorts apply to what the filters already show: filtering
first, then sorting.

### 4. The default order is untouched

Nothing sorts until the person picks a column. "Default order" (or the third
header click) removes the sort, so the lists go back exactly as they are today,
including any order the server provides. Expanded rows (zones, conduits,
enclosures) keep their lists; sorting only reorders the rows.

## Decisions made while building

- **The Changes list is not sortable.** It is a log, grouped by record and read
  from the server a page at a time (newest activity first). Sorting only the
  groups already loaded would give a misleading order, so it keeps newest first.
- **The sort code is split in two:** `public/sort.js` is pure (comparison,
  stable sorting, the header click cycle, the remembered choice, the length and
  gauge conversions) and `public/sortView.js` draws the header, the sort control
  and holds the `useSort` hook.
- **Buses sort by Name, Devices and Check result** (worst first); the list rows
  hold no other comparable figure. Batteries sort by Name, Voltage, Capacity and
  Energy. Circuits by Name, Protection rating, Voltage, Cables and Status.
- **Where the sort control sits:** next to the filters on Devices, Circuits,
  Conduits and Buses, and above the cards on Batteries and Zones (which have no
  filter bar).
- **The existing order is the tie break:** Circuits keeps its status then name
  order underneath, so equal values stay as they were.

## Defaults, reviewed with the user

These are my proposals, to be reviewed before the build:

- Header click cycle ascending, descending, back to default.
- Empty values always last, in both directions.
- Natural text order, so names with numbers sort the way people read them.
- One remembered sort per list, not shared between lists.
- The Changes list keeps newest first as its default; sorting by Kind or Item
  name is the only addition.

## Test Strategy

- Tests for `compareValues`, `sortItems` and `nextSort`: numbers against text,
  natural order ("B10-3" before "B10-12"), case, empty values last in both
  directions, stability and the default-order tie break, an unknown key, the
  three-step cycle.
- Tests for `readSort` and `writeSort`: round trip, a separate key per list,
  garbage in storage ignored, storage that throws.
- Tests of the per-list column definitions where they hold logic (gauge to mm2,
  length to metres, check result rank, status rank).
- A headless browser check against the demo data with all non-GET requests
  blocked: click a header on Cables and Load Summary and read the row order, use
  the control on Devices, reload and see the choice remembered, a third click
  restores the default order, and look at a screenshot in both themes and at
  phone width.

## Implementation Steps

- [x] `public/sort.js` with tests.
- [x] The header and the sort control components, with their styles.
- [x] Cables and Load Summary headers.
- [x] The sort control on Devices, Circuits, Conduits.
- [x] The sort control on Batteries, Buses, Zones, Changes.
- [x] README, CHANGELOG, headless check.

## Files to Create/Modify

- New `public/sort.js`, `test/sort.test.mjs`.
- `public/app.js`, `public/loadSummary.js`, `public/batteriesView.js`,
  `public/changesView.js`, `public/style.css`, `README.md`, `CHANGELOG.md`.

## Open questions

None. The decisions are above; the defaults are for review.
