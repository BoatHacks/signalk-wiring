# Implementation Plan: 0031 - Touch polish

Tracks part of GitHub issue #12.

## Overview

The demo at the trade fair will run on a large touch screen or tablet. The
schematic canvas and the floorplan get two-finger pan and pinch zoom, small
touch targets get a larger invisible hit area, the quick cable popover stays on
screen, and the browser's own gestures stop interfering with the canvases.

## Decisions agreed with the user

- **Target device: a large touch screen or tablet.** Phone layouts, the red
  night theme review and other items of issue #12 are not in this plan.
- **Gestures: pinch zooms, two fingers drag to pan.** One finger keeps its
  current meaning (drag a device, a wire handle, a tab or the empty canvas), so
  there is no clash. Two fingers on the canvas always pan and zoom the view.
- **Touch targets: a larger invisible hit area on touch.** The drawing stays as
  it is. When the input is a finger, terminal dots, bend handles, the connect
  handle, off-page tabs and floorplan markers get a larger invisible hit area
  of about 44 px on screen, so nothing looks different with a mouse.
- **Also in this plan:** the quick cable popover placement on small screens,
  and guards against the browser's own pinch zoom, pull-to-refresh and text
  selection on the canvases.

## Approach

### 1. Pinch and two-finger pan (`public/touchGestures.js`, both canvases)

- A pure `pinchStep(prev, next)` gets the two touch points before and after a
  move and returns the scale factor and the pan offset (the midpoint's move),
  with tests: spread zooms in, a pure drag only pans, a rotation changes
  nothing, tiny jitter below a dead zone is ignored.
- The schematic canvas and the floorplan keep the pointers that are down
  (pointer events with `pointerId`). A second finger on the canvas starts a
  gesture: any running one-finger drag is cancelled the way Escape cancels it
  (positions and routes restored, nothing saved), then scale and pan are applied
  around the midpoint, within the same zoom limits as the buttons. Lifting one
  finger ends the gesture and the remaining finger does nothing until it is
  lifted.
- The wheel and the zoom buttons keep working as before.

### 2. Touch target hit areas

- A pure `hitRadius(kind, pointerType, zoom)` returns the radius in drawing
  units that gives about 44 px on screen for a finger and the current size for
  a mouse or pen, with tests for several zoom levels.
- An invisible circle (or rectangle) with the larger radius is drawn under or
  over each target (terminal dots, bend and midpoint handles, the connect
  handle, tabs, floorplan device and waypoint markers, cluster markers) and
  takes the press. The pointer type of the press decides, so a mouse sees no
  change and a finger on the same page gets the large areas. Hit areas of
  neighbouring targets must not cover each other's centres: where two would
  overlap, the nearer target wins.

### 3. Popover placement and browser guards

- A pure `placePopover(anchor, size, viewport, margin)` keeps the quick cable
  popover and the cluster list fully on screen, opens it clear of the finger,
  and flips above or below as needed; tests for each screen edge and a small
  viewport.
- On the canvases: `touch-action: none`, `overscroll-behavior: contain` and
  `user-select: none` (and the callout and tap highlight off), so the browser
  does not zoom, scroll or select while the canvas handles the gesture. The rest
  of the page gets `touch-action: manipulation` so buttons react without the
  double-tap delay, and the double-tap that opens a device keeps working.

## Defaults, reviewed with the user

- A 44 px target size, the common minimum for touch (confirmed).
- A cancelled one-finger drag when a second finger arrives restores the
  starting state and does not save (confirmed).
- A dead zone of 6 px of finger movement before a two-finger gesture starts.
- The input type is read per press (`pointerType`), not once per page, so a
  hybrid device with both mouse and touch behaves right.
- The release version is chosen by the user.

## Test Strategy

- Pure tests: `pinchStep`, `hitRadius`, `placePopover`.
- Headless Chromium with touch emulation (CDP `Input.dispatchTouchEvent` for
  two-finger gestures and `hasTouch` for taps and drags) on the mock server:
  pinch and two-finger pan on the schematic and the floorplan, a one-finger drag
  of a device and of a bend handle, a second finger cancelling a drag, taps on
  small targets with a finger (hit areas) and with a mouse (no change), the
  popover near each screen edge, no page zoom or scroll during a gesture.
- Real hardware is not available to the agent: the plan ends with a checklist
  for a pass on a real touch screen by the user.

## Implementation Steps

- [x] Pinch and two-finger pan on both canvases, with tests.
- [x] Touch target hit areas, with tests.
- [x] Popover placement and the browser guards, with tests.
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, a real-touch checklist, and a
      comment on issue #12 listing what is done and what remains.

## Files to Create/Modify

- New `public/touchGestures.js`, `public/schematicView.js`,
  `public/floorplanView.js`, `public/app.js`, `public/style.css`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Phone layouts: narrow tables, forms and canvas toolbars.
- A review of the red night theme on the newer screens.
- Long-press as a context action.

## Open questions

None. The decisions and the reviewed defaults are above.

## Real-touch checklist (for a pass on the real touch screen)

Tried only in headless Chromium with emulated touch, so please check these on
the real screen:

1. Schematic: pinch out and in with two fingers; the view zooms around the
   fingers. Drag two fingers together; the view pans. Rotating the fingers
   changes nothing.
2. Start dragging a device with one finger, then put a second finger down: the
   device jumps back and nothing is saved. Lift one finger: the view stays
   still until both are up.
3. Floorplan: the same pinch and pan; drag a marker with one finger, then add
   a second finger and see it return.
4. Tap and drag a terminal dot, the small connect handle, a bend handle and a
   midpoint handle with a fingertip about 1 cm off target; they should still
   take the press. Densely packed terminals should pick the nearer one.
5. Tap a tiny off-page tab and a floorplan marker or cluster number just
   outside the drawn shape.
6. Draw a wire near each screen edge: the quick cable popover stays fully on
   screen, clear of the fingertip, and scrolls inside when the screen is small.
   Open a cluster list near the right and bottom edges.
7. While on a canvas, the page does not zoom, scroll, pull to refresh or select
   text. Buttons react at once, without the double-tap delay.
8. Double-tap a device on the schematic and on the floorplan: its page opens.
9. With a mouse (on a hybrid device if you have one): nothing about handle
   sizes or panning has changed.
