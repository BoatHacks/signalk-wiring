# Implementation Plan: 0027 - Floorplan declutter

Tracks GitHub issue #21.

## Overview

The floorplan always draws every device with its full name, so on a real boat
the names overlap and hide the drawing. Device names appear only where they are
needed, nearby markers collapse into numbered clusters, layers can be switched
off, and a selection fades everything else.

## Decisions agreed with the user

- **Labels on demand.** By default a device is a coloured dot with no name. A
  name shows for the hovered device, the selected device, and the devices of a
  highlighted circuit, a selected conduit or a selected wire run.
- **Choices are remembered per browser.** Layer switches and the role filter
  are kept in the browser's local storage like the theme, not on the server,
  with no schema change. The page works with storage blocked.
- **Numbered clusters.** Markers that would overlap collapse into one marker
  with a count. Clicking it lists the devices, and zooming in splits it.
- **Also in this plan:** layer toggles and a role filter, focus on selection
  (everything outside the selection is faded), and bundled routes drawn as one
  thicker line with a count where several cables run the same way.
- **Not in this plan:** showing one plan at a time (top-down or side). It stays
  as a follow-up.

## Approach

### 1. Labels (`public/floorplanView.js`, `public/style.css`)

- Replace the always-drawn name with the rule above. Label text gets a thin
  halo in the surface colour (paint-order stroke) so it reads over the drawing,
  and a smaller size than today, in both themes.
- Keep a label inside the drawing area: when it would run past the edge it is
  placed on the other side of its marker.
- A pure helper `visibleLabels(devices, context)` returns the ids whose name
  is shown, with unit tests for hover, selection, circuit highlight, conduit and
  wire run.

### 2. Clusters (pure `public/floorCluster.js`)

- `clusterMarkers(markers, radiusPx)` groups markers whose centres are closer
  than the marker diameter plus a gap, measured in screen pixels so the result
  follows the zoom. Stable result for the same input, a single marker is never
  a cluster, and a selected or highlighted device stays out of its cluster so it
  is always visible.
- A cluster draws as a marker with the count, in the style of the enclosure
  count. Click opens a small list with links to the devices, using the existing
  enclosure popover pattern.

### 3. Layers, filter and focus

- A "Show" menu with Names, Devices, Cables and Conduits, and a role filter
  (all roles by default). All values live in one small pure module with load and
  save to local storage wrapped in try/catch.
- Focus on selection: when a circuit, wire run, conduit or device is selected,
  everything outside it is drawn at about 20 percent opacity. Nothing fades with
  no selection.

### 4. Bundled routes (`public/floorplanView.js`)

- Where several wire runs or conduit routes run along the same segment, draw
  one thicker line with a count at its midpoint instead of overlapping lines.
  A pure `bundleRoutes(routes, tolerancePx)` finds segments shared within the
  tolerance. Selecting a bundle highlights its members and lists them.

## Defaults, reviewed with the user

- Label size about 75 percent of today's, halo width about a fifth of the font
  size (confirmed).
- Cluster gap of 4 px beyond the marker diameter (confirmed).
- Faded elements stay clickable so a click on one changes the selection
  (confirmed).
- The role filter lists the roles that exist on the plan.
- The release version is chosen by the user.

## Test Strategy

- Pure tests: `visibleLabels`, `clusterMarkers` (overlap, zoom change, selected
  device kept out, stability), `bundleRoutes`, and the layer settings module
  (defaults, round trip, storage that throws).
- Headless Chromium against the live server read-only and the mock server:
  screenshots of the Interior and Side plans before and after in both themes,
  hover and selection labels, a cluster list, layer switches, focus fading.

## Implementation Steps

- [x] Label rule, halo and edge placement, with tests.
- [x] Marker clusters and the cluster list, with tests.
- [x] Layer menu, role filter and focus on selection, with tests.
- [x] Bundled routes with a count, with tests.
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and tick the boxes in issue
      #21.

## Files to Create/Modify

- `public/floorplanView.js`, `public/style.css`, new `public/floorCluster.js`,
  new `public/floorLayers.js`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Showing one plan at a time (top-down, side or both).
- Per plan label and layer choices saved on the server.

## Open questions

None. The decisions and the reviewed defaults are above.
