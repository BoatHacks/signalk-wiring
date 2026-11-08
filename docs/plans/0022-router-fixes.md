# Implementation Plan: 0022 - Router fixes (issue #14, found testing 0.6.0)

Tracks the open schematic items of GitHub issue #14 (the five of 0.6.0, then the follow-up below). The new router
(`public/wireRouter.js`, plan 0021 section 4) stays; it is improved.

## Overview

Testing 0.6.0 on the boat's two pages showed wires and stubs that overlap,
sit closer than they should, hide a connection at a port, or run through a
tab. The router now treats these as hard rules instead of costs.

## Items

- [x] 1. Draggable "to" stubs, saved on the page, kept by Auto-arrange and Tidy.
- [x] 2. At least two line widths of clear space (edge to edge) between parallel wires.
- [x] 3. Wires leave their ports straight out for a visible stub length.
- [x] 4. The line from a device to a stub never overlaps other lines, stubs or devices.
- [x] 5. No line runs on top of or hides another (separate lanes, also between the same two devices); lines cross only with a bridge.

## Approach and design choices

- **Hard rules, not costs.** Every routed line is recorded on the grid. Later
  lines may not share an edge with it, may not use an edge of a parallel line
  closer than the pitch, may not touch it at a bend or an end, and may cross it
  only straight over its middle, at least 7 units from both ends (room for the
  bridge). A wire that finds no way goes to the front of a second round; after
  that the rules are relaxed one level at a time (`level` 1 and 2 on the
  result) and the last resort is the old elbow (`fallback`). The boat's pages
  need neither.
- **Pitch 16.** The line is 3 wide, so two line widths of clear space is 6; a
  two-conductor wire draws its second line 4 beside the first, so the centre to
  centre pitch is 16 (`PITCH`). Anchors on one edge are spread by the pitch and
  keep it from the terminals of the edge and from anchors on a facing edge
  across a gap too narrow for both legs. The old nudging step is gone.
- **Visible leg.** Every wire and stub leaves its port straight out for `STUB`
  (18) before it may turn. The legs are reserved before any wire is routed.
- **Stubs are routed like wires.** A tab is a box the wires avoid, the line to
  it is a wire (routed first, since it has the least room), bridges included.
  A tab goes straight out of its device, further out when many lines fan out of
  that side, clear of devices, legs and other tabs. A tab the user placed keeps
  its position (`pos`, top left corner); the line meets the tab on the side that
  faces its device.
- **Saved position.** New table `schematic_stubs` (page, cable, x, y) and a
  `stubs` list on the schematic resource, next to `devices` and `wires`.
  Moving a tab is layout, not a logged change. Auto-arrange and Tidy treat a
  placed tab as a fixed obstacle and never move it.
- **Speed.** Greedy A* (heuristic weight 1.6), a cap on states per search and
  on the time for extra rounds. The boat's pages route in about 20 to 250 ms.

## Test Strategy

- `test/helpers/routeCheck.mjs`: a geometry checker (shared stretches, touches,
  plain crossings, separation, short legs, lines through devices and tabs).
- `test/routerBoatPages.test.mjs`: the boat's two pages (trimmed data in
  `test/fixtures/boat-pages.json`) must have no problems and be routed at
  level 0; parallel wires between the same two devices; a placed tab; input
  order independence.
- Store and resource tests for the saved stub positions; pure tests for the
  drag, Tidy and Auto-arrange behaviour; a browser check against a read-only
  copy of the live data in the light and night themes.

## Follow-up: stub lines and the MultiPlus DC in (issue #14, found testing 0.6.1)

- [x] 6. The line from a device to a tab is drawn like the cable it stands for: conductor colours (a second conductor as a thin second line), DC solid or AC dashed with the same marker, the normal line width. The tab stays the off-page marker.
- [ ] 7. The MultiPlus DC in on the 48V page:
  - [ ] a. Wires reaching a port block do not cross just before the port.
  - [ ] b. A conduit band ends clear of port blocks, and its label sits where no line passes.
  - [ ] c. A line to a tab keeps a wide gap from other wires.

Choices:

- **Item 6.** `StubShape` uses `conductorTypes`, `wireLineStyle`, `offsetPath` and
  `WireMarker` like `WireShape`; the grey dashed `.sch-stub-line` style is gone
  (the class stays for the shared width rule). The view hands each stub its
  `cable`.
- **Item 7a.** A crossing within `PORT_CLEAR` (90) of a port, along either of the
  two lines, costs `PORT_CROSS_COST` (150) extra in the search. It is a cost, not a
  ban: a few spots on the boat's pages (a wire across a fan of legs of one
  device) have no other way. At the MultiPlus the red wire now comes in above the
  black one and the crossing is moved about 100 away, with a bridge. A node
  near the end of a recorded line is marked in `zone` when the line is committed.
- **Rip-up budget.** The extra rounds were limited by time, so the result changed
  with the speed of the machine (a cold first route cut the rounds short). The
  limit is now a count of search steps (`ROUND_BUDGET`), the same on every machine.
- **Item 7b.** `conduitBands` stops a band `BAND_END` (36) short of the port where
  a stretch reaches the end of its wire, so no rounded end wraps the port blocks.
  A band too short for that keeps a short piece in the middle. The label is placed
  by `placeLabels`: above or below a horizontal stretch (up to 24 away), or beside a
  vertical one, at the first spot where its text box meets no line, device, tab,
  other band or other label (`labelPos`). The view passes these as `avoid`. The
  label has a halo in the surface colour.
- **Item 7c.** Lines to tabs are committed with `STUB_PITCH` (24) instead of 16, so
  later wires keep 24 from them, and spread anchors keep 24 from a terminal that
  has a stub. The CAN stub next to the red positive wire is now 29 away.

Tests: `test/routerBoatPages.test.mjs` (no crossing within `PORT_CLEAR` at the
MultiPlus; crossings near ports not above the present count; stubs keep
`STUB_PITCH`; bands clear of port blocks and labels clear of lines; stub line
style), helpers `crossingsNearPorts` and `portDistance` in
`test/helpers/routeCheck.mjs`, band trimming in `test/wireRouter.test.mjs`. The
boat's pages route in about 200 to 400 ms cold (the first route after loading),
about 150 to 250 ms warm.
