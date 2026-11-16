# Implementation Plan: 0041 - UI quick fixes

Tracks GitHub issue #28 (UI quick fixes found in the review of 0.9.2).

## Overview

An overhaul plan: eighteen small, independent fixes to the web app, twelve that
touch every tab (Part A) and six on the Floorplan tab (Part B). They are built
in the order below, a few at a time, and each item is ticked in the issue when it
is done. Nothing here changes data, the API or the checks themselves; it is
wording, state display, layout and small controls.

## Decisions agreed with the user

- **A1, the list row separator is a pipe** ("Consumer | Instrument | Mast"), as
  Devices already do. Circuits, Conduits and Buses change to it.
- **A3, a quiet "ok" is a small muted tick**, with the word as its tooltip and as
  text for screen readers. Findings keep their coloured badges.
- **A11, the demo banner reads "Demo: sample boat, edits reset on restart".**
  That matches what demo mode does (the data is reset to the sample boat at every
  plugin start, so edits stay until the next start), see plan 0039.
- **A12, links are blue everywhere** (`--link`), so the many green route links
  and the back links all take the link colour.
- **A12, full width on Cables, the bus page, Schematics and Load Summary**; every
  other page uses the 1000 px column.
- **A1, what counts as a dash problem:** an en or em dash is fine as a symbol in
  the UI (a missing-value mark, for example), but not in prose: code comments,
  docs, issues and commit messages. So A1 fixes the comments in `public/*.js`
  and the dash joined meta lines (which become the pipe separator); the guard
  test checks comments only, not strings shown to the user.
- **A1, missing values:** a blank select option reads "None"; a missing amps
  figure and other missing table cells show a plain hyphen.
- **A2, load errors keep the raw text** ("failed to load wiringDevices: 500") as
  a smaller second line under the friendly sentence and the Retry button.
- **A3, an active row keeps a quiet marker:** a small muted "active" word, not a
  badge. A status that is not active keeps its badge (removed, for example), and
  an "ok" check or load result is the muted tick. (The issue suggested showing
  nothing for active; the maintainer chose the quiet word so a row never looks
  as if it failed to load.)
- **A4, the switching lines get their own block** on the device page (Current,
  Switch path, "Asks for confirmation before switching"), shown when they
  apply, separate from the NMEA 2000 bus block.
- **A9, both disclosures start closed**, the Legend on the schematic page too.
- **A11, "cable" replaces "wire run" in UI text only**; routes, resource types
  (`wiringWireRuns`) and JSON fields keep their names.
- **Spelling is "meter", not "metre"**, wherever a person reads it (Floorplan,
  UI, docs), with "meters" for the plural.
- **B1, the red strokes** at each device on the Deck plan mean "this cable
  crosses over to a different plan here" (for example a PV cable from the deck
  into the interior). They become a small thin arrow marker without text, and
  the Legend explains it.
- **A12, the new intro lines** (Devices, Schematics) are written by me and
  reviewed in the diff of the build.
- **Release:** one release when all items are done; the maintainer names the
  version, then it is installed on the live server.

## Defaults, reviewed with the user

These are my proposals, to be reviewed before the build:

- **Load errors (A2):** one shared sentence builder, "Could not load the
  devices. The server answered with an error.", a Retry button, used by the list
  tabs, Dashboard, Load Summary, Batteries, Buses and Changes.
- **Device page (A4):** the "On the bus" block shows only when the device has an
  NMEA 2000 port or is tapped onto a bus.
- **Tab bar (A5):** a fade at the clipped edge while more tabs are to the side,
  the active tab scrolled into view on load and on route change, and
  `aria-current="page"` on the active tab button. Regrouping the navigation is
  its own issue.
- **Phone width (A6):** the Load Summary table and the circuit page's cable
  table go into the existing `.table-scroll` container so only the table scrolls.
- **Sorting hints (A7):** a faint sort mark on every sortable header and a hover
  state; the card lists' direction button is properly disabled with a title that
  says why while "Default order" is chosen, and has an accessible name of
  "Ascending" or "Descending".
- **Selects (A8):** the schematic toolbar selects and the Devices bulk bar select
  get the look of the filter selects.
- **Long explanations (A9):** one short sentence stays, the rest sits in a
  closed "How this is worked out" disclosure (Load Summary) and "Legend"
  disclosure (schematic page). The advisory sentence stays visible.
- **History (A10):** the detail page History block uses the Changes tab wording
  and formatter from `public/changes.js` ("Changed", "rated power: 45 to 60 W"),
  and the Changes tab prints the timestamp of a one-change card once.
- **Plurals and words (A11):** a small `plural(count, one, many)` helper, so
  "1 device", "1 conduit", "1 cable".
- **One page frame (A12):** intro text first, then the actions, then the
  filters, on every tab (Batteries moves its intro up; Devices and Schematics get
  a one-line intro).
- **Floorplan (Part B):** B1 a "Legend" disclosure always available near the
  plans, which also explains the cross-over arrow marker; B2 the two
  plan pickers are labelled "Top view" and "Side view"; B3 "Recalibrate",
  "Remove plan" and the scale text move into a per plan "Plan settings"
  disclosure; B4 the "not drawn" list shows from and to per cable inside a box
  with a maximum height and its own scrolling; B5 "Cable" in the filter,
  "meter" (never "metre") everywhere, and the "Show" control at the size of the
  buttons beside it; B6 the "Add a plan" form is collapsed behind a button once a
  plan exists, with the spacing of the other forms.
- **Order of work:** wording and plurals first (A1, A11), then badges and
  errors (A3, A2), the device page and history (A4, A10), then layout (A5, A6,
  A12, A7, A8, A9), then the Floorplan tab (B1 to B6) last, since the tab is hidden
  in demo mode. Touch target sizes belong to #12, not here.
- **CHANGELOG:** entries under Unreleased as items land.

## Approach

Plain edits in `public/*.js` and `public/style.css`. Three small pure helpers
get unit tests: the load error sentence builder (A2), `plural` (A11) and the
status marker rule (A3). A tab-scroll helper (A5) is only DOM and is
checked in the browser. A guard test fails when an em dash or an en dash appears
in a code comment of `public/*.js` (outside `public/vendor/`), so the rule is not
broken again; dashes in strings shown to the user are allowed.

## Test Strategy

- Unit tests for the three helpers and the dash guard.
- The existing suite stays green (`npm test` in the container).
- A headless Chromium check against the demo data, serving the repo's `public/`
  over the live server with every non-GET request blocked: each changed screen
  at 1100 px and 390 px, in the day and the night theme, with screenshots that
  are looked at. A test for no page-wide sideways scroll at 390 px on Load Summary
  and the circuit page.

## Implementation Steps

- [x] A1 dashes in comments and the pipe separator, with the comment guard test.
- [x] "meter" spelling (UI, docs, comments I touch).
- [x] A11 wording, plurals, the demo banner.
- [x] A3 quiet badges, A2 load errors with Retry.
- [x] A4 the device page bus block, A10 history wording and the one timestamp.
- [x] A5 tab bar, A6 table scroll on phones.
- [x] A12 one page frame and one link colour, A7 sorting hints, A8 selects, A9
      folded explanations.
- [x] B1 to B6 on the Floorplan tab.
- [x] CHANGELOG and README, tick the issue items, headless checks.

## Files to Create/Modify

- `public/app.js`, `public/loadSummary.js`, `public/import.js`,
  `public/dashboardView.js`, `public/batteriesView.js`, `public/changesView.js`,
  `public/changes.js`, `public/history.js`, `public/cableCheckView.js`,
  `public/sortView.js`, `public/schematicView.js`, `public/floorplanView.js`,
  `public/style.css`, a new small helper module for the error sentence, `plural`
  and the badge rule, `test/` for the helpers and the dash guard, `CHANGELOG.md`,
  `README.md` where it describes the UI.

## Open questions

None. The decisions are above; the defaults are for review.
