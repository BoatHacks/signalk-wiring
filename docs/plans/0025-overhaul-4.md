# Implementation Plan: 0025 - Overhaul 4

Tracks the open items of GitHub issue #14 found while testing 0.6.5.

## Overview

Wires that belong together are routed together, Auto-arrange gets a second
stage that moves everything, and a double-click on a hand-routed wire gives it
back to the router.

## Decisions agreed with the user

- **Bundling.** Wires that run in the same conduit, or that connect directly
  between the same two devices, are routed along the same path in parallel
  lanes at the minimum pitch for as long as possible, and split apart only
  near the ports they end on. The plan 0022 rules stay: no shared stretch, two
  line widths of clear space, bridges only.
- **Auto-arrange in two stages.** The first click arranges only what is not
  hand-placed. A second click, with nothing edited in between, starts a full
  arrange that may move everything: hand-placed devices, tabs and wires (their
  bend points are cleared). After the first click the button reads "Arrange
  everything"; any edit (drag, add, delete, undo) resets it to "Auto-arrange".
  The full arrange can be undone.
- **Midpoint handles move the segment.** Dragging the midpoint handle of a
  wire moves only the horizontal or vertical segment it is drawn on,
  perpendicular to it, so the wire stays orthogonal and no point is added on a
  straight line between the ends. When two horizontal segments are separated by
  a vertical one shorter than one line width, the short vertical is dropped and
  the two horizontals merge into one; the same for two verticals with a short
  horizontal between them.
- **Double-click a hand-routed wire** (double-click or double-tap) removes all
  its bend points and lets the router route it again, undoable. A wire
  without bend points ignores the double-click.

## Approach

### 1. Bundling (`public/wireRouter.js`)

- Group wires into bundles: same conduit (a shared assignment), or the same two
  devices on both ends. Route one reference path per bundle (the cheapest of
  its members), then give the other members parallel lanes at the minimum pitch
  along that path with their own end legs, so lanes split near the ports. The
  lane order follows the port order at both ends, so the bundle does not cross
  itself; a member that cannot take its lane under the strict rules is routed
  alone as today.
- Replace the small conduit-mate cost with the bundle path. The bands, the
  labels and the plan 0022 and 0021 router tests keep passing; add boat-page
  tests that the MultiPlus DC hose wires and the cables between the same two
  devices share one path for most of their length.

### 2. Auto-arrange in two stages (`public/schematicLayout.js`, view)

- Stage one is the current behaviour. Stage two runs the layout with every
  device free, clears the page's bend points and user-placed tabs, and
  re-runs overlap resolution and routing. A small pure `arrangeStage(state)`
  helper holds the reset rule, with unit tests. The button label and the undo
  entry follow the stage.

### 3. Midpoint handles (`public/schematic.js`, `public/schematicView.js`)

- A pure `moveSegment(points, index, delta)` shifts a segment of an orthogonal
  point list perpendicular to itself, keeps the end legs at the ports, and then
  `mergeShortJogs(points, minLen)` removes any segment shorter than one line
  width (3 units) and joins the two parallel neighbours. Unit tests cover a
  middle segment, the first and last segments (which keep their port legs), a
  collapse that cascades, and verticals and horizontals alike.

### 4. Double-click to auto-route (`public/schematicView.js`)

- A `dblclick` and a double-tap (the plan 0023 `isDoubleTap` helper) on a wire
  with bend points clears them (one undoable action), and the router routes
  the wire again.

## Defaults chosen without asking

- Bundles need at least two wires; a bundle's lanes are centred on its
  reference path.
- A cable in several conduits joins the bundle of its first conduit.
- The "Arrange everything" label lasts until any edit; leaving the page also
  resets it.
- The release version is chosen by the user.

## Test Strategy

- Pure tests for bundle grouping and the lane order at both ends, the
  `arrangeStage` reset rule, and the router rules on the boat's two pages
  (no violations, bundles share a path, timings under about 500 ms).
- Headless Chromium: the button label change and reset, the full arrange and
  its undo, double-click on a hand-routed wire, day and night screenshots of
  the MultiPlus DC hose.

## Implementation Steps

- [x] Bundling in the router, with tests.
- [x] Two-stage Auto-arrange.
- [ ] Midpoint handles move the segment, with short-jog merging.
- [ ] Double-click a hand-routed wire to auto-route it.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and tick the boxes in issue
      #14.

## Files to Create/Modify

- `public/wireRouter.js`, `public/schematicLayout.js`,
  `public/schematicView.js`, `public/schematic.js`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- A bundle drawn as one thick line with a count when zoomed out.

## Open questions

None. The Auto-arrange question is settled above; the defaults list is for
review.
