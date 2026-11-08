# Implementation Plan: 0022 - Router fixes (issue #14, found testing 0.6.0)

Tracks the five open schematic items of GitHub issue #14. The new router
(`public/wireRouter.js`, plan 0021 section 4) stays; it is improved.

## Overview

Testing 0.6.0 on the boat's two pages showed wires and stubs that overlap,
sit closer than they should, hide a connection at a port, or run through a
tab. The router now treats these as hard rules instead of costs.

## Items

- [ ] 1. Draggable "to" stubs, saved on the page, kept by Auto-arrange and Tidy.
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
