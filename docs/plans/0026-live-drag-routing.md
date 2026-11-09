# Implementation Plan: 0026 - Live routing while dragging

Tracks the open item "Drag preview matches the final routing" of GitHub issue
#14.

## Overview

While a device, a tab or a wire handle is dragged, the wires are drawn with the
old cheap elbow routes, and the real router only runs on drop, so the picture
jumps to a different routing after the drop. The drag should show the real
router's result all the time.

## Decisions agreed with the user

- **All wires on the page are re-routed live.** Bundles, lanes and spacing
  depend on every wire, so only a full route makes the drag picture equal the
  picture after the drop.
- **Throttle, no fallback.** The dragged item follows the pointer at once; the
  wires catch up at whatever rate the router manages, at most about 15 updates
  per second. There is no switch to the old cheap routes for slow pages; the
  picture is always the real routing.

## Approach

- `public/schematicView.js`: on every pointer move of a device, tab or wire
  drag, the dragged item's position updates immediately; the routing is
  requested through a small throttle that runs at most one route at a time and
  at most every 66 ms, always with the latest positions (a newer request
  replaces a waiting one). The final route on drop uses the same function, so
  the result of the last drag step and the drop are identical.
- The routed wires of the last finished route stay on screen until a new one
  is ready, so wires never flash empty. The dragged wire of a handle drag is
  drawn from its own points (it is hand-routed) while all others re-route.
- A pure `createRouteThrottle(routeFn, minIntervalMs, now, schedule)` helper
  holds the throttle rule (one in flight, latest wins, trailing run), with unit
  tests.
- The cheap-route drawing during drags is removed from the drag code; `wirePath`
  stays for the places that still use it.
- Escape cancels the drag and restores the positions and the last route.

## Defaults chosen without asking

- Minimum interval 66 ms (about 15 updates per second); a route that takes
  longer than that simply delays the next one.
- The drop route is the same call as a drag step, with the final positions.

## Test Strategy

- Pure tests for the throttle (one in flight, latest wins, trailing run, the
  interval), and a test that the drag code no longer calls the cheap route.
- Headless Chromium on the boat's 48V page: drag a device and compare the wire
  geometry at the last drag step with the geometry after the drop (identical),
  drag a wire handle, Escape cancels, and measure the frame rate while dragging
  a device on the dense page.

## Implementation Steps

- [x] The throttle helper and live routing for device and tab drags, with
      tests.
- [ ] Live routing for wire handle and segment drags, Escape handling.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and tick the box in issue
      #14.

## Files to Create/Modify

- `public/schematicView.js`, `public/schematic.js`, tests, `ARCHITECTURE.md`,
  `CHANGELOG.md`.

## Open questions

None. The two design questions are settled above; the defaults list is for
review.
