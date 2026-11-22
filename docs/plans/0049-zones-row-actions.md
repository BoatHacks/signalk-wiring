# Implementation Plan: 0049 - Zones: Rename, Merge and Remove in the opened row

Tracks GitHub issue #36 (Zones: move Rename, Merge and Remove into the opened row).

## Overview

Every zone row in the Zones tab shows a Rename button, a "Merge into" select and
a Remove button. On a phone they stack into cards about 140 px tall, and Remove
is disabled on every zone in use without saying why. This plan makes the rows
calm: a closed row shows the name and the counts only, and the actions appear in
the opened row, together with what the zone holds.

## Decisions agreed with the user

- **Rename edits the name in place.** In the opened row, Rename turns the zone
  name into an input with Save and Cancel. Enter saves, Escape cancels.
- **Every zone can be opened**, also an empty one, because the actions now live
  in the opened row. An empty zone shows "Nothing in this zone yet." above the
  actions.

## Defaults, reviewed with the user

- **Whole header is the expander.** The name and counts line is one button-like
  header (`role="button"`, `tabindex 0`, Enter and Space toggle, `aria-expanded`),
  with the triangle kept as a visual cue at the left. While a rename is in
  progress the header does not toggle.
- **Opened row content.** Three short lists with headings, shown only when not
  empty: Devices (links, as today), Cables (links to the Cables tab, titled by
  `cableTitle`), Conduits (links to the Conduits tab, by name). Long lists keep
  the existing plain list look.
- **Actions.** One row below the lists: Rename, Merge into select, Remove. The
  Merge select is shown only when another zone exists, as today.
- **Disabled Remove says why**, in a muted line next to it, and in the button
  title: "In use by 48 devices. Merge it into another zone first." The sentence
  names what is in use ("In use by 2 devices and 3 cables.", "In use by 1
  conduit."). With no other zone to merge into: "In use by 3 devices. Move them
  to another zone first."
- **Several rows may be open at once**, as today. Opened state is not remembered.
- **Counts line** stays as today ("48 devices, 12 cables, 2 conduits").
- **Confirm dialogs** for Merge and Remove stay unchanged.
- **Wording stays advisory**, nothing in the checks changes.

## Approach

### 1. Pure helpers (`public/zones.js`, tested)

- `zoneContents(zoneId, { devices, wireRuns, conduits })`: the non removed items
  in the zone, devices sorted by name.
- `removeBlockedReason(counts, canMerge)`: the sentence above, or `null` when
  the zone is empty and Remove is allowed.

### 2. The Zones tab (`public/app.js`)

`ZonesManager` renders the header as the expander, and the opened body with the
lists, the in-place rename and the actions. The `zone-toggle` class is also used
by the load summary, so it stays; new `zone-*` rules are added instead.

### 3. Styles (`public/style.css`)

Small, local `.zone-*` rules next to the existing ones: header hit area, body
indent, action row, reason line. Colors use the existing variables so the red
night theme works.

## Test Strategy

- Unit tests for both helpers (counts, sorting, removed items excluded, other
  zones ignored, singular and plural, with and without a merge target).
- Existing tests stay green.
- A headless Chromium check against the live server's GET data, every non-GET
  request blocked: closed rows, an opened row with devices, cables and conduits,
  an empty zone, the disabled Remove reason, in-place rename input (not saved),
  at 1100 px and 390 px, day and red night theme, with screenshots that are
  looked at.

## Implementation Steps

- [x] Helpers with tests.
- [x] Zones tab markup and behavior.
- [x] Style rules.
- [x] CHANGELOG (Changed), headless checks.

## Files to Create/Modify

- `public/zones.js`, `public/app.js`, `public/style.css`,
  `test/zones.test.mjs`, `CHANGELOG.md`.

## Open questions

None. The decisions are above; the defaults were reviewed and kept as proposed.
