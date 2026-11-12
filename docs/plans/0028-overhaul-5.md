# Implementation Plan: 0028 - Overhaul 5

Tracks the three open items of GitHub issue #14 found while testing 0.6.7 and
0.6.8.

## Overview

The schematic editor gets a snap-to-grid, crossings of stub lines get bridges
like cables, and the first Auto-arrange click leaves hand-placed devices alone.

## Decisions agreed with the user

- **Grid size 16 units.** It is the router's lane pitch, so snapped devices,
  ports, tabs and lanes line up.
- **A faint grid, one toggle.** A faint dot grid is drawn while snapping is on
  and disappears when it is off. One toolbar toggle controls both.
- **Alt flips the snap while dragging.** With snap on, Alt gives free movement;
  with snap off, Alt snaps. Touch has no override, only the toggle.
- **What snaps:** devices, off-page tabs, wire bend points and midpoint
  segments, and zone shapes (moving, resizing, polygon corners).
- **Hand-placed devices.** A device is hand-placed when the user drags it or
  drops it at a chosen spot (palette or list drop). Devices added without a
  position and devices placed by Auto-arrange stay free. The first Auto-arrange
  click arranges only free devices; the full arrange (second click) moves
  everything and clears the marks.
- **Old pages: all devices free.** Placements saved before this change carry no
  mark, so the first click moves them as today; only drags from now on are
  protected.
- **Stub bridges:** reproduce the missing hop on the boat's pages, fix it, and
  add a regression check.

## Approach

### 1. Snap to grid (`public/schematic.js`, `public/schematicView.js`)

- A pure `snapValue(v, grid)` and `snapPoint(p, grid)` plus a settings helper in
  a new `public/snapGrid.js`: grid 16, the on or off choice saved per browser in
  local storage (try/catch, works when blocked), default on.
- Drag handlers apply the snap through one function that checks the Alt key
  state at each move, so a mid-drag key press changes the result live.
- Device boxes snap by their top-left corner. Tabs, bend points and segment
  handles snap their coordinates; a segment drag snaps its perpendicular
  coordinate, so the wire stays orthogonal and on a lane. Zone rectangles and
  ovals snap position and size, polygon corners snap their coordinates. Shift
  for a circle or square keeps working; the snapped size follows the shorter
  side.
- Live routing during drags (plan 0026) uses the snapped positions.
- The toolbar gets a "Snap" toggle button. The grid is a faint dot pattern in
  an SVG pattern fill below the zone shapes, in a theme token, both themes, and
  does not scale the dots when zooming.

### 2. Bridges on stub lines (`public/wireRouter.js`, `public/schematicView.js`)

- Reproduce on the boat's 48 V and AC pages: list the crossings between stub
  lines and wires or other stubs that have no bridge. Plan 0022 says stub lines
  get bridges, and `findBridges` is given the paths, so check whether the stub
  paths are in the set, whether a hop is skipped on vertical segments, and
  whether `pathToDWithBridges` draws the hop for stubs.
- Fix at the cause and add a regression check on the boat's pages: no crossing
  of a stub line with a wire or another stub is a plain intersection.

### 3. Hand-placed mark (`src/store.js`, `src/schema.sql`, `public/`)

- Migration 16 adds `schematic_devices.hand_placed INTEGER NOT NULL DEFAULT 0`,
  guarded and safe to run twice. The schematic resource carries `handPlaced` per
  device placement and saves it with the page.
- A drag or a drop sets the mark; Undo restores the previous mark with the
  position. Auto-arrange stage one passes the marked devices as fixed to the
  layout (the layout already supports fixed devices); stage two clears every
  mark of the page together with the bend points and user-placed tabs, as part of
  the same undoable action.
- `arrangeStage` keeps its rule; the label text is unchanged.

## Defaults reviewed with the user

- Snapping is on by default (confirmed).
- A device snaps by its top-left corner (confirmed).
- The stub bridge item is a reproduce, fix and regression-check job (confirmed).
- The release version is chosen by the user.

## Test Strategy

- Pure tests: `snapValue`, `snapPoint`, the settings helper (defaults, round
  trip, storage that throws), snapped segment moves stay orthogonal, the stage
  one layout keeps marked devices fixed.
- Store tests: migration 16 twice, the field round trip, old rows read as free.
- Router tests on the boat's two pages: stub crossings have bridges; no
  violations; timings still under about 500 ms.
- Headless Chromium on the mock server: the grid and the Snap toggle in both
  themes, drag with and without Alt, polygon and zone resize snapping, the first
  and second Auto-arrange click with a hand-placed device, Undo.

## Implementation Steps

- [ ] Snap to grid: helpers, drag integration, toggle and grid drawing, with
      tests.
- [ ] Stub bridges: reproduce, fix, regression check.
- [ ] Hand-placed mark: migration 16, store, drag and drop marking, stage one
      and two behaviour, with tests.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and tick the three boxes in
      issue #14.

## Files to Create/Modify

- `public/snapGrid.js` (new), `public/schematic.js`, `public/schematicView.js`,
  `public/schematicLayout.js`, `public/wireRouter.js`, `public/style.css`.
- `src/store.js`, `src/schema.sql`, `src/resources.js`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- A visible mark on hand-placed devices, or a "release to auto" action per
  device.
- Snapping on the floorplan.
- A configurable grid size.

## Open questions

None. The decisions and the reviewed defaults are above.
