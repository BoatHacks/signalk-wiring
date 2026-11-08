# Implementation Plan: 0018 - Overhaul: hash routing and small usability fixes

Tracks GitHub issue #1 (the umbrella checklist). Hash routing was issue #2,
folded in here as the first step.

## Overview

A batch of small fixes found while clicking through the web app, built
together as one plan instead of one commit per fix. Hash routing goes first
because the links between views, the undo message and the canvas keyboard
handling all open or return to specific views. Nothing here changes the data
model, except one stated exception to the removal rule (undo).

## Decisions agreed with the user

- **URL scope.** The address bar holds the tab plus whatever is open: a
  circuit, device or conduit detail page, the open schematic, the selected
  floorplan plan. Tools, open forms, selected wires and zoom stay out of the
  URL.
- **Undo restores the record.** After removing a record, an "X removed. Undo"
  message is shown for about eight seconds. Undo sets the record back to
  active and writes a change log entry saying so. This is a stated exception
  to the SPEC rule "there is no removed to active transition", and only the
  undo message uses it. It covers cables, devices and conduits removed from
  the lists, and cables removed on the canvases.
- **A cable removed on a canvas is gone for good.** On the schematic canvas
  and on the floorplan, removing a cable shows the Undo message, and when the undo window ends without a click the cable
  is deleted permanently, with its history and attachments. There is no
  separate "delete later" step. No confirm dialog: the Undo message is the
  safety net. On the schematic the Delete button or Delete key does this for
  the selected wire; on the floorplan a button does it for the selected wire
  run (see section 6).
- **A device removed on a canvas is only taken off it.** Removing a device
  from a schematic page, or clearing its placement on the floorplan, marks it
  as not placed on that page or plan and nothing else. The device is never
  removed or deleted from a canvas. Devices are removed and deleted only on
  the Devices tab or through the API.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §3.1 and §3.2 (states and transitions, the undo exception), §7
  (UI).
- ARCHITECTURE.md §2.4 (webapp structure).

## Approach

### 1. Hash routing (foundation)

- A pure module `public/router.js` with `hashForState(state)` and
  `parseHash(hash)`, like the stowage-mgmt plugin's `hash-router.js`, so it is
  unit tested without a DOM. Only `App` touches `window.location`.
- Route format: `#/` (the default tab, Circuits), `#/<tab>`,
  `#/circuits/<id>`, `#/devices/<id>`, `#/conduits/<id>`,
  `#/schematics/<id>`, `#/floorplan/<plan id>`. Ids are URL-encoded.
- App state is synced both ways: a state change writes the hash only when it
  is stale (so history is not spammed), and a `hashchange` event (back,
  forward, a pasted link) parses the hash back into state.
- Opening a detail page, a schematic or a plan pushes a history entry, so
  back returns to the list. Tabs push too.
- An unknown tab falls back to the default tab. An unknown or removed id
  opens the list with a short "not found" notice instead of an empty page.
- The schematic tab and the floorplan tab read the selected schematic or plan
  from, and write it to, the route instead of local state.

### 2. Undo for removals

- A small shared `UndoBar` (a message with an Undo button and a timer) shown
  at the top of the main area, used by the lists and both canvases. It takes
  an `onExpire` callback, so the canvases can finish the job when the window
  ends.
- A store method `restore(kind, id)` sets `status` back to `active` and logs
  "restored (undo)" with the before and after status. The resource API reaches
  it through a normal write of `status: active`, so no new route is needed;
  the store logs it as a restore.
- The existing confirm dialogs for removal stay on the lists, where removal
  still only marks the record and permanent deletion stays on the Cables tab.
  The canvases use no confirm dialog and rely on the Undo message.
- **Canvas cable removal, in order:** mark the cable removed (it disappears
  from the canvas and the circuits update), show the Undo message, and on
  expiry call the permanent delete route (`DELETE /cables/:id/purge`, admin
  only, added in 0.4.4). Undo cancels the timer and restores the cable. If the
  page is closed or reloaded while the window is open, the cable simply stays
  removed (marked, not erased) and can be restored or deleted on the Cables
  tab, so a lost timer never loses data. Leaving the view (a tab change)
  finishes the delete at once.
- If the purge fails (not logged in as admin, server error), the cable stays
  removed and the message says so.

### 3. Lists and cables

- **Row icons side by side.** The icon cell stops wrapping (`flex-wrap:
  nowrap`, no extra padding), so a row is one line high. This also applies to
  the other row-action cells where they wrap.
- **Search box** on the devices, cables and circuits lists. It matches name,
  label, type, zone and tags, case-insensitively, and combines with the
  existing zone and tag filter. Pure matching in `public/zones.js` next to
  `matchesFilter`, tested.
- **Show removed** toggle on the same lists, off by default. The choice is
  remembered per list in `localStorage` (wrapped in try and catch, the page
  works without it).
- **Links between views.** Device names in the cables table, circuit detail
  and load summary link to `#/devices/<id>`. A load-summary row links to
  `#/circuits/<id>`. A circuit's cable rows link to the Cables tab. These are
  plain anchors on the hash routes.
- **Duplicate** a device or a cable. A device copy keeps type, role,
  ratings, terminals and paths, gets the name "<name> copy" (made unique),
  and has no position, no attachments and no icon. A cable copy keeps
  conductors, gauge, label, zone and tags, has no route and no attachments,
  and opens in the edit form so the ends can be changed before saving.
- **Phone photos.** The attachment list gets a "Take photo" button next to
  "Add file", an input with `capture="environment"`. The ordinary file input
  stays, so files can still be picked from the gallery.

### 4. Load summary

- The "incomplete" badge gets a line under it that says what is missing and
  what to do: "No voltage: set the nominal voltage on the supply" or "No
  rating: set the trip rating of the fuse or breaker", or both. The same text
  is the tooltip. Inline text rather than hover only, because the tablets on
  the boat have no hover.
- "over rating", "ok", "measured" and "estimate" get a short explanation as a
  tooltip and a legend line under the table.
- The text is built by a pure function in `public/loadSummary.js`, tested.

### 5. Schematic canvas

- The selected wire's button (labelled "Delete wire" as now) and the Delete
  key remove the cable as described in section 2: it disappears at once, the
  Undo message shows, and when the window ends the cable is deleted for good.
  No confirm dialog.
- A selected device is taken off the page by "Remove from this page" or the
  Delete key. This only takes it off this schematic ("not placed" on this
  page); the device stays in the record and on other pages. The message offers
  Undo, which puts it back where it was.
- Escape cancels a drag, a popover or the selection. Keys are ignored while an
  input, select or textarea has focus.

### 6. Floorplan

- **Arrows.** The bow and up markers get smaller and move into a fixed corner
  of the plan view (top right), instead of being drawn over the drawing at the
  origin. They do not scale with the zoom, so they stay a constant small size.
- **Route tool ends on the To device.** While a wire run route is being
  drawn, clicking the cable's To device appends that device's position as the
  last point and finishes the route: the selected wire run is cleared and the
  tool goes back to idle. The measured length includes the last stretch. A
  click on any other device does nothing and shows a short hint ("This route
  ends at <To device>"). If the cable has no To device, the click selects the
  device as before.
- **Continuation marks.** Where a route leaves a plan (a point hidden by the
  deck range, or a run that ends at the edge of the visible points), a short
  stub with an arrow and the label "continues on <plan name>" is drawn at the
  last visible point. The label is a link that switches to that plan (a route
  change). If several plans show the next point, the first by name is used.
  Points without a height are visible everywhere, so they never produce a
  mark.
- **Remove a cable.** With a wire run chosen in the Draw route tool (or the
  cable picked in the route panel), the panel shows a "Delete wire run"
  button. It works exactly as on the schematic canvas: the cable disappears
  from every plan and the circuits update, the Undo message shows, and when
  the window ends the cable is deleted for good, with its history and
  attachments. The route panel lists the cable's name and ends in the
  button's label so it is clear which cable goes. No Delete-key shortcut for
  this, because the key already removes a selected waypoint and a wire run
  chosen from the dropdown is too easy to hit by mistake. This applies to any
  cable, with or without a drawn route.
- **Keyboard.** Escape cancels the current tool or the in-progress route, and
  Delete removes the selected waypoint or clears the selected device's
  placement (it becomes "not placed" on the plans; the device itself is never
  removed from the floorplan). Clearing a placement offers Undo.

### Defaults chosen without asking

These are open to change in review of this plan:

- Undo timeout is eight seconds; the message stays while the pointer is on it.
- Search and show-removed apply to devices, cables and circuits only, not to
  zones or conduits (their lists are short).
- A duplicate device or cable is named with "copy" and opens in the edit form
  where the name or ends can be changed.
- A "Take photo" button next to the file input, not a replacement for it.
- Cable removal on the floorplan is a button in the route panel only, with no
  keyboard shortcut.
- The continuation mark links to the first plan, by name, that shows the next
  point.
- Release as the next patch version (0.4.5), since the version rule is patch
  only until the web app review is done.

## Test Strategy

- Pure functions with unit tests (host or container): `router.js`
  (`hashForState`, `parseHash`, round trips, unknown input), the list search
  and the show-removed filter, the load summary explanations, the continuation
  mark geometry (which plan, which point) and the route-end rule (position
  appended, length includes it).
- Store: `restore` sets the status back, logs once, and leaves a removed
  record that was not undone alone; a write of `status: active` is accepted.
  The existing purge tests cover the permanent delete the canvas calls.
- Webapp against a mock server in headless Chromium: reload on a detail page
  and a schematic keeps the view; back and forward; a link between views;
  remove then Undo; the Delete key on a selected wire, and the cable being
  purged once the window ends (with a shortened timeout in the test); a
  reload during the window leaving the cable removed but kept; the route tool ending
  on the To device; the continuation mark and its link. Real touch and the
  red night theme are still a manual check on the boat.

## Implementation Steps

Each step is committed and pushed. The routing step lands before the others
because they use it.

- [x] Hash routing: `public/router.js` with tests, App and the schematic and
      floorplan tabs wired to it, not-found handling.
- [x] Undo: store `restore`, `UndoBar`, wired into the lists (the canvases follow in the steps below),
      SPEC §3.2 updated with the exception.
- [x] Lists and cables: row icons on one line, search box, show removed,
      links between views.
- [x] Duplicate device and cable, and the "Take photo" button.
- [x] Load summary explanations and legend.
- [x] Schematic canvas: delete wire with Undo and permanent deletion when the
      window ends, take a device off the page with Undo, keyboard handling.
- [ ] Floorplan: smaller corner arrows, route tool ending on the To device,
      continuation marks, cable removal with Undo, keyboard handling.
- [ ] SPEC.md (§3.2: the undo exception, and that a cable removed on the
      canvas is deleted when the undo window ends), ARCHITECTURE.md, README,
      CHANGELOG, and tick the boxes in issue #1.

## Files to Create/Modify

- New: `public/router.js`, `public/undoBar.js`, tests for the router, search,
  load summary explanations, continuation marks and `restore`.
- `public/app.js` (routing, lists, links, duplicate, photos, undo wiring),
  `public/zones.js` (search and filter), `public/loadSummary.js`,
  `public/schematicView.js`, `public/schematic.js`, `public/floorplanView.js`,
  `public/floorplan.js`, `public/style.css`.
- `src/store.js` (restore), `src/resources.js` if the write path needs the
  restore logging.
- `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Undo and redo for moves and bends on the canvases.
- Routing the open edit form (deliberately left out of the URL).
- The cross-deck cable workflow (issue #8) builds on the continuation marks.
- Touch polish (issue #12) covers two-finger pan and larger targets.

## Open questions

None. The three open design questions (URL scope, undo, canvas delete) are
settled above; the defaults list is for review.
