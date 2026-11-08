# Implementation Plan: 0021 - Overhaul 2: gauge lists, ratings, routing, deletion and small fixes

Tracks GitHub issue #14.

## Overview

The second batch of fixes collected while entering the real wiring of the boat:
a gauge dropdown instead of a free field, ratings on switches and breakers,
wires that route around device boxes with bridges at crossings, a loading text
bug, permanent deletion for devices, conduits and schematics, and a way to
notice that the page is out of date after a release. They are built together in
one plan, as plan 0018 was.

## Decisions agreed with the user

- **Gauge lists.** The cable gauge becomes a dropdown wherever it is entered
  (the quick cable dialog on the schematic and floorplan, the full cable form
  and the bulk edit form).
  - Metric: 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95 mm².
  - AWG: 18, 16, 14, 12, 10, 8, 6, 4, 2, 1, 1/0, 2/0, 3/0, 4/0.
  - The sizes above 1 AWG are stored as the numbers 0, -1, -2 and -3 and shown
    as 1/0 to 4/0, so the gauge column stays numeric and existing values stay
    valid. Both lists have an "Other" entry for a non-standard value.
- **Ratings on switches, breakers and fuses.** Separate AC and DC ratings, four
  optional device fields: rated current and rated voltage for AC, and rated
  current and rated voltage for DC. A device is rated for AC or for DC by
  having those fields. The existing Current mark (AC or DC of the circuit it
  sits in) stays as it is, and the trip rating stays the only thing that makes
  a device a protector.
- **Wire routing avoids every device box.** Wires are routed on a grid of
  channels between all the device boxes with a small path search, leave on the
  side of their port, never cross any box or port block, and keep clear of
  labels. Wires with bend points placed by the user stay as drawn. Where two
  wires cross, one gets a small bridge. Off-page stubs get their own lanes so
  they stop overlapping each other and other wires.
- **Nothing overlaps on the schematic.** Devices never overlap each other, and
  no device overlaps an off-page stub, wherever they are placed (dropping,
  dragging, adding, Auto-arrange).
- **Cable length shapes the auto-layout.** Auto-arrange puts connected devices
  farther apart the longer the cable between them, on a compressed (square root)
  scale with a minimum and a maximum, so a 0.3 m wire is short, a 10 m run is
  visibly long, and a 50 m run does not blow the page up. Cables with no length
  use a default. This is always on in Auto-arrange; devices the user drags stay
  where they are put.
- **Conduits are marked on the schematic with a band.** Wires that run in the
  same conduit or hose are routed side by side through the same channel, and a
  thin outlined band (after the duct section of IEC 60617-11, with the wires
  inside) is drawn around their shared stretch, labelled with the conduit's
  kind, size and name. No standard gives a symbol for a conduit or hose in a
  wiring diagram: IEC 60617-11 (DIN EN 60617-11) has trunking and duct symbols
  for installation plans only (a straight section with one or more compartments
  for wiring systems), no ABYC or ISO symbol was found, and drafting practice puts
  physical routing on harness layout drawings with callouts rather than on
  schematics. So this is the plugin's own convention, stated as such in the SPEC.
- **Extra fixes in this plan.** Version stamps and an update hint, and
  permanent deletion for devices, conduits and schematics.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §3.2 (transitions: permanent deletion), §4 (device fields, gauge), §7
  (UI, schematic drawing).
- ARCHITECTURE.md §2 (webapp modules, routes), §3 (schema and migrations).

## Approach

### 1. Loading text

Every `&hellip;` entity in template text becomes the real ellipsis character
(`public/app.js`, `public/batteriesView.js`, `public/loadSummary.js`,
`public/import.js`, and the "Change selected" button label). The template
library does not decode entities. A test scans the template text in
`public/*.js` (not the vendored files) for HTML entities and fails if it finds
one, so the bug cannot come back.

### 2. Gauge dropdown

- A pure module `public/gauge.js`: the two lists, `gaugeLabel(value, unit)`
  ("1/0" for 0 in AWG, "2.5" for 2.5 mm²), `gaugeOptions(unit, current)` (the
  list, the current value when it is not in the list, and "Other"),
  `parseGauge(text, unit)` (accepts "1/0", "2/0", "3/0", "4/0", "000" and
  plain numbers, used by the CSV import), and `formatGauge(value, unit)` used by
  every table, card and page that shows a gauge.
- The unit select (AWG or mm²) swaps the list. Changing the unit keeps the value
  when it is in the new list and clears it otherwise. The default unit still
  comes from the `defaultGaugeUnit` setting.
- **Zero is a gauge.** 1/0 is stored as 0, so every place that treats a falsy
  gauge as "none" must test for null instead (the Cables table has `cable.gauge
  ? ... : '-'`, and there may be others). The store accepts a gauge of 0 or
  below only for AWG, and only down to -3, and still rejects non-numbers.
- The dropdown replaces the free field in the quick popover, the full cable form
  and the bulk edit form. "Other" shows a number field, so the existing free
  values stay editable.
- The CSV import reads "1/0" style values through `parseGauge`.

### 3. Ratings

- Migration 12 adds `rated_ac_a`, `rated_ac_v`, `rated_dc_a`, `rated_dc_v`
  (REAL, null) to `devices`, guarded and safe to run twice. They are exposed as
  `ratedAcA`, `ratedAcV`, `ratedDcA` and `ratedDcV`. The store validates them
  (positive numbers) and logs changes like any field. They never change how
  circuits are derived: only `tripRatingA` does that.
- The device form shows a "Ratings" group for devices with the distribution
  role (switches, breakers, fuses, bus bars, panels): AC rated current and
  voltage, DC rated current and voltage. The device page shows them as one line
  ("Rated: DC 300 A, 58 V" or "Rated: AC 16 A, 230 V; DC 16 A, 48 V").
- The existing boat data is not migrated: the 300 A on the DC main switch lives
  in its notes and stays there until entered in the new fields.
- No new checks in this plan. A check of the ratings against the circuit
  voltage and load belongs to the cable safety checks issue (#10).

### 4. Wire routing and bridges

- A pure module `public/wireRouter.js`: given the device boxes (with their port
  blocks), the wires (each with its two anchors and sides, and any bend points)
  and the off-page stubs, it returns for every wire its list of points and its
  bridges, and for every stub its tab position. `public/schematic.js` keeps
  `wirePath` as the entry point and calls the router, so the callers do not
  change.
- Routing: a grid over the page's bounding box with a margin, cells blocked
  where a device box (grown by a margin) or a port block lies, except the short
  corridor in which a wire leaves its own port. A path search with costs for
  length, bends, crossing an already routed wire and passing close to a box.
  Wires are routed in a fixed order (by id), so the result is stable, and
  parallel wires between the same two devices keep their lane offsets.
- Bend points: a wire with bend points the user placed is drawn through them as
  today; only its two end legs are routed. Moving a bend point or a device
  re-routes the wires of that page.
- Bridges: after routing, every crossing of a horizontal segment of one wire
  with a vertical segment of another wire (not at a shared terminal or a
  junction of the same net) gets a small semicircular hop on the horizontal
  segment, about four canvas units in radius. `WireShape` draws the hops from
  the router's list. Selection and hit testing use the points as before and
  ignore the hops.
- Stubs: tab positions are chosen after the wires are routed so that tabs do
  not overlap each other, any device box or any wire, using extra lanes along
  the stub's side (see also 4b and 4c).
- Cost: routing runs when a page's devices, wires or layout change, not on
  every pointer move; the result is cached per page. The budget is a page of
  about 40 devices and 100 wires in well under half a second.
- The floorplan route lines are not affected.

### 4b. Layout: no overlaps, cable length

- A pure module `public/schematicLayout.js` (the layout functions move out of
  `public/schematic.js`, which keeps re-exporting them).
- **No overlaps.** `resolveOverlaps(boxes, stubs, margin)` moves a box to the
  nearest free position (at least a margin of 24 units from every other box and
  every stub tab, including the port blocks and labels that belong to a box).
  It is used when a device is dropped from the palette, when one is added from
  the "Add existing device" list (it lands on a free spot), after a drag ends,
  and by Auto-arrange. Stub tabs are placed by the router (section 4) so they
  never overlap a box, another tab or a wire. A page saved with overlaps by an
  older version is not moved silently: opening it shows a small notice "Some
  devices overlap" with a "Tidy" button that resolves them.
- **Cable length.** Auto-arrange keeps using dagre for the ranks and the order,
  then sets the gap between neighbouring ranks from the cables that run between
  them: `gap(L) = clamp(60 + 60 * sqrt(L), 80, 420)` canvas units with L the
  median cable length in metres between those two ranks, and a default length
  of 1 m when a cable has none. The constants are named and easy to tune. The
  vertical spacing is not length based. The same function gives the page its
  layout in tests.

### 4c. Conduit bands

- The router (section 4) gets a cost bonus for a wire that shares a channel
  with another wire of the same conduit, so those wires run side by side in
  adjacent lanes.
- A band is drawn around every stretch where two or more wires of one conduit
  run side by side, and around the whole wire when a conduit has only one wire
  on the page: a thin rounded outline in a neutral token colour with a faint
  fill, and a label at its start such as "Hose 16 mm, MPPT DC hose" (kind, size
  when known, name). A wire that is in several conduits shows the bands of all
  of them along its length, stacked, since the conduit list records the order
  but not where along the wire each one lies.
- The legend line under the toolbar says a band is a conduit or hose. The
  toolbar's "Highlight a circuit" list also offers the conduits, which light up
  their wires.
- The floorplan already draws conduits as thick lines and is not changed.

### 5. Version stamps and update hint

- Finding: the server sends `Cache-Control: public, max-age=0` with a weak ETag
  built from the file size and modification time. The packed files all carry the
  same fixed modification time, so a changed file of the same size gets the same
  ETag and could be served stale. An already open tab also keeps running the old
  code until it is reloaded.
- Stamps: a `prepack` script (`scripts/stamp-version.js`, restored by
  `postpack`) rewrites the relative import specifiers in the packed `public/*.js`
  files and the script tag in `index.html` to carry `?v=<version>`, so a new
  release has new URLs for every file whatever the ETags say. The repository
  files stay unstamped, so the tests and the development workflow do not change.
  The rewrite is a pure function with unit tests.
- Hint: a new read-only route `GET /plugins/signalk-wiring/version` returns the
  plugin version. The page asks for it at load (that is the version it runs),
  again when the tab becomes visible and every ten minutes, and when it differs
  shows a note at the top: "A new version is available. Reload". The note has a
  Reload button and can be dismissed until the next change.

### 6. Permanent deletion for devices, conduits and schematics

- Store methods `purgeDevice`, `purgeConduit` and `purgeSchematic`, each only
  for a record already marked removed, in one transaction, like `purgeCable`:
  - **Device:** refused with a message naming the cables while a live or
    removed cable still ends on it ("Delete these cables first"). Otherwise it
    removes the terminals, the schematic placements, the attachments (rows and
    files) and the change log, clears the monitor link on any battery it
    monitored (logged on that battery), and deletes the row (placements on the
    plans go with the row).
  - **Conduit:** removes the cable assignments, attachments and change log.
  - **Schematic:** removes its devices, wires and change log.
- Routes `DELETE /devices/:id/purge`, `DELETE /conduits/:id/purge` and
  `DELETE /schematics/:id/purge` (admin only, 204; 409 when the record is not
  removed or is blocked, 404 when unknown).
- UI: a removed device, conduit or schematic shows a "Delete permanently" action
  with a confirmation that says what goes (the number of history entries and
  attachments, the cables that block it). The conduits and schematics lists get
  the "Show removed" toggle the other lists have, so removed records can be
  reached.
- SPEC §3.2: the "removed → gone" transition now covers cables, devices,
  conduits and schematics.

### Defaults chosen without asking

These are open to change in review:

- The overlap margin is 24 units, and Tidy is offered, not applied, for pages
  that already have overlaps.
- The length gap formula and its constants (60, 60, 80 and 420) are starting
  values, tuned on the boat's two pages.
- A band is drawn per conduit, stacked, for a wire in several conduits.
- The bridge hops horizontal over vertical, radius about four units, and only at
  crossings of different wires.
- The update hint checks every ten minutes and when the tab becomes visible.
- The "Ratings" fields show for the distribution role only.
- Changing the gauge unit keeps the value only when it is in the new list.
- A device cannot be deleted permanently while any cable (even a removed one)
  still ends on it.
- The release version for this plan is decided by the user at the end.

## Test Strategy

- Pure: `gauge.js` (lists, labels, parsing, options with a non-standard value,
  zero and negative AWG), the entity scan, `resolveOverlaps` (a box dropped on
  another, on a stub tab, several at once, the nearest free spot), the length
  layout (a 0.3 m and a 10 m cable give ordered gaps, the clamp, the default for
  no length, no overlaps in the result), the conduit bands (stretches of shared
  channels, a conduit with one wire, a wire in two conduits, the label text), the router (two boxes facing each
  other, a box in the way, a wire from a bottom port, ports on the same side,
  parallel wires, a user bend point, determinism, no segment inside a
  non-endpoint box, bridges at the crossings of known layouts, stub tabs that
  do not overlap) and the stamping function.
- Store (container): migration 12 twice, rating validation, the gauge range
  rule, the three purge methods with their blocks and cascades, the route status
  codes, the version route.
- Webapp in headless Chromium against a mock server: the gauge dropdown in the
  three forms and the unit switch, the Ratings group and line, the loading text,
  the update hint appearing after a mocked version change, the Delete permanently
  flows, and screenshots of a busy schematic (the 48V and AC pages of the boat as
  fixtures) before and after routing, in the light and the night theme.

## Implementation Steps

- [ ] Loading text: the entities and the scan test.
- [ ] Gauge: `gauge.js`, the three forms, display everywhere, the zero gauge
      audit, store rule, CSV import.
- [ ] Ratings: migration 12, store, resource, device form and page.
- [ ] Permanent deletion: the three purge methods, routes, UI, show removed on
      conduits and schematics.
- [ ] Version: the version route, the update hint, the pack-time stamping.
- [ ] Wire routing: `wireRouter.js`, bridges, stub lanes, tests on the boat's
      pages.
- [ ] Layout: `schematicLayout.js` with no overlaps (and the Tidy notice) and the
      cable length gaps in Auto-arrange.
- [ ] Conduit bands on the schematic: shared channels, the band and label, the
      legend and the highlight.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and tick the boxes in issue
      #14.

## Files to Create/Modify

- New: `public/gauge.js`, `public/wireRouter.js`, `public/schematicLayout.js`,
  `scripts/stamp-version.js`,
  the tests for each.
- `public/app.js`, `public/quickCable.js`, `public/cablePopover.js`,
  `public/cableForm.js`, `public/import.js`, `public/batteriesView.js`,
  `public/loadSummary.js`, `public/schematic.js`, `public/schematicView.js`,
  `public/conduits.js`, `public/style.css`, `public/index.html`.
- `src/store.js`, `src/schema.sql`, `src/resources.js`, `src/routes.js`,
  `package.json` (prepack and postpack).
- `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Checks of the ratings against the circuit voltage and load (issue #10).
- Ratings on batteries, converters and other roles, and a CSV import column for
  the ratings.
- Obstacle-avoiding routes on the floorplan.
- A true-to-scale layout option (offered and not chosen).
- Showing which stretch of a wire lies in which conduit, when a wire passes
  through several.

## Open questions

None. The design questions (AWG range and storage, the rating model, how far the
router goes, the extra fixes) are settled above; the defaults list is for
review.
