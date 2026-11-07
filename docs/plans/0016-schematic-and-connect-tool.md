# Implementation Plan: 0016 - Drawing wires: schematic canvas and floorplan connect tool

## Overview

Today cables are entered through a form, the circuit diagram is read-only and
auto-laid-out, and the floorplan only draws the physical route of a cable that
already exists. This plan adds two ways to make wiring by drawing it:

- A **schematic canvas**: free-form diagrams of the electrical system, apart
  from where things physically sit. Place devices, drag a wire from one to
  another, and the cable and its circuit exist.
- A **connect tool on the floorplan**: pick two placed devices, click the
  route on the plan, and the cable exists with its route and measured length.

Both create the same records the cable form creates (plan 0014), so circuits,
the load check and everything else follow without changes.

## Decisions agreed with the user

- **Both, not one.** A schematic canvas and a connect tool on the floorplan.
  The schematic is for the electrical picture, the floorplan tool for the
  physical one.
- **Several named schematics.** For example "12 V system", "Shore power and
  inverter", "Helm". A device can appear on more than one, and each schematic
  keeps its own layout. Small diagrams stay readable.
- **Off-page wires.** A cable that joins a device on this page to one that is
  not on it is drawn as a short stub leaving the device and ending in a
  labelled tab such as "to Anchor light". Clicking the tab jumps to a page
  that shows that device, or offers to add it to this one. Nothing is hidden,
  so a half-drawn page still shows every connection of its devices.
- **Wires are the cables.** A wire between two devices on a schematic is the
  cable record. Wires appear on a schematic automatically when both of a
  cable's devices are on it.
- **Drawing a wire.** Drag from a device, or from one of its terminals, to
  another device or terminal. As soon as the wire is dropped the cable exists,
  and a small popover asks Positive, Negative or Positive + negative (and
  optionally gauge and length). "More..." opens the full cable form for
  terminals, AC and anything else. The derived circuit appears at once.
- **New devices on the canvas.** A side palette by role (battery or source,
  consumer, fuse or switch, converter) with the popular types. Dropping one
  creates the device, and it can be named in place, so a whole system can be
  built without leaving the canvas.
- **Wire style.** Auto-routed right-angle lines, coloured by conductor (red
  positive, black negative, and so on), with gauge and cable label on hover.
  Wires also get draggable bend points, so a wire can be routed at
  non-right angles where the user wants. An Auto-arrange button lays devices
  out left to right from the supply, with the layout engine already used for
  circuit diagrams.
- **Deleting a wire** removes the cable, after a confirmation (it is marked
  removed and kept in the record and history, like everywhere else), and the
  circuit updates. Removing a device from a schematic only takes it off that
  page; it never deletes the device.
- **Floorplan connect.** Click the From device, click the To device, then click
  waypoints on the plan for the route (or finish straight away for no route).
  The same popover asks the conductors, and the cable gets the drawn route and
  its measured length.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (data model), §6.1 (API), §7 (UI), and the floorplan and cable
  sections added by plans 0009, 0014 and 0015.
- ARCHITECTURE.md §2.1 to §2.4, §3 (schema and migrations).
- These change with this work.

## Approach (high level)

- **Data model.**
  - `schematics`: id, name, status, notes. Removed-but-kept like other
    records.
  - `schematic_devices`: schematic, device, x, y. The devices on a schematic
    and where they sit.
  - `schematic_wires`: schematic, cable, optional bend points (JSON list of
    x, y). Only cables the user has bent need a row; every other wire is
    routed automatically.
  - Served as the `wiringSchematics` resource, with its devices and wires as
    lists on the record (written with the parent, like conductors).
- **Cables are created through the store.** Both tools build the same payload
  the cable form builds (`buildCablePayload` in `public/cableForm.js`), so
  validation, change log and circuit derivation are shared. A shared quick
  popover component serves both tools.
- **Layout is presentation.** Moving a device or a bend point does not write a
  change-log entry per move; adding or removing a device or wire on a
  schematic does. (Wiring facts are logged on the cable itself.)
- **Pure geometry module** (`public/schematic.js`): device box sizes and
  terminal positions, the right-angle router with lane offsets so parallel
  wires do not overlap, wires through bend points, hit testing, snapping, and
  choosing default conductors. No DOM, fully unit tested. Routing starts
  simple (elbow routes with lane offsets, no obstacle avoidance), and
  improving it is a follow-up.
- **Canvas** (`public/schematicView.js`): hand-rolled SVG with Pointer Events
  for mouse and touch, pan and zoom by the viewBox, like the floorplan. No new
  dependency. Terminals are shown as dots on devices that declare them;
  dragging from a device body makes a connection without a terminal.
- **Off-page stubs** are computed with the geometry module: for each cable
  with exactly one end on the page, a stub direction away from the device's
  box, a lane offset so several stubs on one device do not overlap, and the
  other device's name for the tab.
- **Highlighting.** Selecting a circuit (or a cable) highlights its devices
  and wires on the schematic, like on the floorplan.
- **Floorplan connect tool** (`public/floorplanView.js`): a fourth tool beside
  Select, Place device and Draw route, as a small state machine (From, To,
  waypoints, finish), reusing the existing route helpers.

## Test Strategy

- Store: schematics and their devices and wires, bend points, migration safe
  to run twice, change log entries (and none for pure layout moves).
- Pure geometry: off-page stubs, terminal anchors, elbow routing for each relative placement
  of two boxes, lane offsets for parallel wires, bend point routes, hit
  testing, default conductor choice.
- Webapp: a mock server and headless Chromium harness for dragging a device,
  drawing a wire, the popover creating a cable, deleting a wire, and the
  floorplan connect tool. Pointer interaction is not covered by unit tests,
  so the harness is the check, and a click-through on the boat is still
  needed.

## Implementation Steps (draft)

- [x] Schema, migration, store and resource: schematics, their devices and
      wires, with tests.
- [ ] `public/schematic.js`: geometry and routing, with tests.
- [ ] Schematics tab: list, create, rename, remove; canvas with pan and zoom;
      place existing devices; palette that creates devices; drag devices;
      Auto-arrange.
- [ ] Drawing wires: drag between devices or terminals, the quick popover,
      cable creation, derived circuit shown, highlighting, bend points,
      deleting a wire, removing a device from a page.
- [ ] Floorplan connect tool with the shared popover.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG.

## Follow-ups (not in this plan)

- Undo and redo on the canvas.
- Obstacle-avoiding wire routing.
- Print or export a schematic as an image or PDF.
- Touch polish (large targets, two-finger pan) once tried on the boat's
  tablets.
- Drawing conduits on a schematic.
- A snap-to-grid option and alignment helpers.

## Open questions

None. The design is settled; the next step is the schema and store work.

## Decisions made during implementation

- Migration 8 creates `schematics`, `schematic_devices` and
  `schematic_wires`. `schematic_wires` rows exist only for bent cables, and a
  wire whose bend points are emptied is dropped.
- The lists on a schematic record are `devices` (`deviceId`, `x`, `y`) and
  `wires` (`wireRunId`, `points`). A write that carries a list replaces it;
  one that omits it leaves it alone.
- Only a change in which devices are on a page is written to the change log
  (as a `devices` diff of ids). Moving a device or bending a wire is not.
  Adding a wire needs no entry because the cable itself is logged.
