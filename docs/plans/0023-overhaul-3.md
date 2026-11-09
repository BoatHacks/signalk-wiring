# Implementation Plan: 0023 - Overhaul 3

Tracks the four open items of GitHub issue #14 found while testing 0.6.2.

## Overview

Port marks instead of marks on the wires, a new signal colour, double-click on
a device to open its page, and zones as background shapes on the schematic.

## Decisions agreed with the user

- **Marks on the ports.** The small marks along the wires are removed. The
  conductor dot on a port gets a bit bigger and carries a symbol: "=" for a DC
  conductor, "~" for an AC conductor, a two-way arrow for a signal wire and
  the grounding symbol for a ground or PE (earth) conductor. The line style
  stays (AC dashed, DC solid).
- **Signal colour: amber or orange.** The user chose it after a check of the
  wiring standards. Nothing found forbids it. ABYC E-11 uses orange insulation
  for DC accessory feed, a power circuit, so the diagram colour could be
  confused with it; the user accepted that. EN 60204-1 and IEC 60446 were not
  verified. The default conductor colours for new cables are checked for the
  same clash.
- **Double-click or double-tap on a device** opens its detail page.
- **Zone shapes are visual only.** A zone can be drawn on a schematic page as
  an oval, a rectangle (circle and square are the special cases) or a polygon,
  on a background layer. A device keeps the zone set on the device; Auto-arrange,
  Tidy and the router ignore shapes. **One shape per zone per page**: adding a
  zone that already has a shape moves or selects that shape.
- **Polygons start as a triangle** and are edited with the same draggable
  midpoints as the bend points of a cable: a handle at each corner, a handle at
  the midpoint of every side, and dragging a midpoint inserts a new corner.

## Approach

### 1. Port marks

- `public/schematicView.js`: remove the on-run markers from `WireShape` and
  `StubShape`; draw the symbol inside the conductor dot of the port block and
  of a terminal. The symbol follows the conductor: positive, negative and the
  AC line and neutral conductors of the device's current mark give "=" or "~";
  signal gives the two-way arrow; earth gives the grounding symbol. The dot
  radius grows from today's size by about a third; symbols use the surface or
  text token that has contrast on the dot colour, in both themes.
- Update the legend text under the toolbar.
- A pure helper `portMark(conductor, current)` returns the symbol kind, with
  unit tests; a text scan test keeps the marker code out of the wires.

### 2. Signal colour

- `--wire-signal` in `public/style.css` for the day and night themes becomes an
  amber or orange that is clearly apart from the neutral blue, the earth green
  and the red; check the default conductor colours for a signal conductor in
  `public/conductors.js` or wherever they live and change a clashing one.
  Check contrast on the dot and on the line in both themes.

### 3. Double-click opens the device

- On a device box in the schematic editor, `dblclick` and a double-tap (two
  taps within 350 ms and 20 px) navigate to `#/devices/<id>`. A single click
  still selects, a drag still moves, the first tap of a double-tap does not
  start a drag. The floorplan gets the same if its device markers allow it
  without breaking placement.

### 4. Zone shapes

- Migration 14 adds `schematic_zones` (id, schematic id, zone id, kind
  `rect`, `oval` or `polygon`, x, y, width, height, and for a polygon `points`,
  a JSON list of corners in page units, at least three), unique on schematic and zone, with
  cascade on removal like the other page tables. The schematic resource carries
  a `zoneShapes` list, saved with the page like the stubs.
- Canvas: an "Add zone" toolbar picker (zones without a shape on this page),
  drag to move, eight resize handles for a rectangle or oval, Shift keeps a
  circle or square, Delete removes the shape only. The picker also offers a
  polygon (a triangle of about 240 units); its corners are dragged, a midpoint
  handle on each side inserts a corner when dragged (reusing the cable bend
  point handle code in `schematicView.js`), and a corner is removed by
  double-clicking it while more than three remain. Dragging the body moves the
  whole polygon. The name goes at the top left of the polygon's bounding box. The shape sits on a background layer below bands,
  wires, devices and tabs and never takes clicks except for its own outline,
  label and handles when selected. Fill is a faint tint of a theme token,
  solid outline, the zone name in the top left corner, and the router treats
  shapes as non-obstacles.
- Purging a zone or a schematic cleans its shapes.

## Defaults chosen without asking

- The mark symbols and the dot size increase (about a third).
- The double-tap window is 350 ms and 20 px.
- Zone shapes: faint fill, solid outline, name in the top left, new shape
  about 240 by 160 units placed at the centre of the view.
- Zone shapes are a schema change (migration 14); the release version is chosen
  by the user.

## Test Strategy

- `portMark` unit tests; a scan test that the wire drawing has no markers.
- Store tests for migration 14, the shapes round trip, validation (a polygon
  needs at least three finite corners), one shape per zone and cascade on
  purge. A pure `polygon.js` helper (insert a corner at a midpoint, remove a
  corner, bounding box) with unit tests.
- Headless Chromium on the boat's two pages: port symbols, the new signal
  colour in both themes, double-click and double-tap, adding, moving, resizing
  and deleting a zone shape.

## Implementation Steps

- [x] Port marks and the legend.
- [x] Signal colour.
- [x] Double-click and double-tap to open a device.
- [x] Zone shapes (rectangle, oval, polygon): migration 14, store, resource,
      canvas.
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and tick the boxes in issue
      #14.

## Files to Create/Modify

- `public/schematicView.js`, `public/style.css`, `public/schematic.js` (or a
  new `public/zoneShapes.js`), `public/portMark.js` (new).
- `src/store.js`, `src/schema.sql`, `src/resources.js` (zone shapes).
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- A device placed inside a shape setting its zone, and Auto-arrange filling
  shapes. Offered and not chosen.
- Several shapes for one zone on a page.
- Snapping polygon corners to a grid or to device edges.

## Open questions

None. The user's decisions are above; the defaults list is for review.
