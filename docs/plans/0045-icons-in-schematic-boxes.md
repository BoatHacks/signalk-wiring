# Implementation Plan: 0045 - Icons in Schematics device boxes

Tracks GitHub issue #44 (Icons in Schematics view).

## Overview

The Schematics device boxes draw only a name and a type, although the same
devices have an icon everywhere else (lists, the palette, circuit diagrams, the
Floorplan). An icon makes a schematic readable at a glance, without reading each
box. This plan draws the device's icon in every device box, above the name.

## Decisions agreed with the user

- **Placement: large, above the name** (option B in the mockup). The icon is
  centered at the top of the box, the name and type sit below it. Boxes grow
  taller to make room, which is accepted.
- **Same icon choice as everywhere else:** the device's own attached image when
  it has one, otherwise the built-in icon for its type (role fallback, then the
  generic one), by the existing `iconChoice`. Every device therefore has an icon.
- **Always on.** No toggle and no new setting.
- **Enclosures get the icon in the same place**, with the open inside mark
  staying at the top right.
- **One 28 px icon slot.** A built-in icon is drawn 28 px, an attached image is
  scaled to fit the same 28 px slot, so every box has the same header height and
  the schematic stays uniform. The header grows from 30 to 56 px (boxes about
  26 px taller).
- **Saved layouts are left alone.** Boxes keep their top left corner and grow
  downward; tight spots may touch, and Auto-arrange re-spaces them. No data
  migration. The CHANGELOG says so.
- **The icon is muted and follows the theme** (the muted text color), so the day
  and the red night theme both work. The box stroke and fill colors are
  unchanged. The live reading stays at the bottom of the box and the enclosure
  mark stays top right; the centered icon collides with neither.
- **Device boxes only.** Backbone boxes, bus stubs, off page tabs and zone labels
  stay as they are.

## Defaults, reviewed with the user

These were reviewed with the user and kept as proposed (the four reviewed items
are the icon slot, saved layouts, the look and the scope, all listed above).
The remaining details are mine, for the diff review:

- **Geometry.** `HEADER_H` 30 to 56 and `BOX_MIN_H` 46 to 72 in
  `public/schematic.js`. Terminal and port rows are all placed from `HEADER_H`,
  so wire anchors, port blocks, lanes and routing follow without other changes.
  The device name moves from y 14 to y 43 and the type from y 25 to y 54.
- **The icon** is centered horizontally at y 5 to 33 (28 px). A built-in icon is
  the same inline SVG that circuit diagrams draw (`SIMPLE_ICONS`, a 24 unit
  viewBox, stroke `currentColor`); an image is an SVG `<image>` with
  `preserveAspectRatio="xMidYMid meet"`.
- **Live reading position.** A box without bottom ports draws its reading at
  `box.h - 5`, which still fits. A box with bottom ports draws it at y 26, which
  would now sit on the icon, so it moves to y 66 (below the type line).
- **A small SVG icon component.** `DeviceIconSlot` in `public/deviceIcon.js`
  draws the built-in icon or the image in a square slot at a given position,
  from the same `SIMPLE_ICONS` the circuit diagrams use.
- **Wiring and hit areas.** The icon takes no pointer events (`pointer-events:
  none`), so dragging a box, double clicking an enclosure and the connect handle
  work as before.
- **Wording stays advisory** (nothing in the checks changes).

## Approach

### 1. Geometry (`public/schematic.js`, tested)

`HEADER_H` and `BOX_MIN_H` change; the box height formulas already derive from
them. Unit tests pin the new minimum height, that the first terminal row sits
`HEADER_H + TERMINAL_ROW_H / 2` below the top, and that a box with bottom ports
keeps its ports on the bottom edge.

### 2. The box (`public/schematicView.js`, `public/deviceIcon.js`)

`DeviceBox` draws the icon through the shared SVG component, moves the name and
type lines, and moves the live reading of boxes with bottom ports. The
enclosure line, "Enclosure, holds N", moves with the type line.

### 3. Styles (`public/style.css`)

A `.sch-device-icon` rule: muted color, no pointer events. Night theme uses the
same variable the device name already follows.

## Test Strategy

- Unit tests for the new box geometry, as in Approach 1.
- The existing schematic tests stay green; the ones that hard code a box height
  or a terminal offset are updated to the new numbers.
- A headless Chromium check against the demo data and a copy of the real boat,
  with every non-GET request blocked: icons on all device types, an enclosure,
  a device with an attached image, a box with bottom ports and a live reading,
  Auto-arrange afterwards on the 12 V and AC pages (no overlaps), at 1100 px and
  390 px, in the day and the red night theme, with screenshots that are looked at.

## Implementation Steps

- [x] Geometry change with tests.
- [x] Icon drawn in the box, name, type and reading moved, enclosures.
- [x] Style rule; fix tests that hard code the old sizes.
- [x] CHANGELOG (Added, and a note that saved layouts keep their positions and
      boxes are taller), headless checks.

## Files to Create/Modify

- `public/schematic.js`, `public/schematicView.js`, `public/deviceIcon.js`,
  `public/style.css`, `test/schematic.test.mjs` and any schematic test that
  hard codes sizes, `CHANGELOG.md`.

## Open questions

None. The decisions are above; the defaults were reviewed.
