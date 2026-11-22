# Implementation Plan: 0050 - Night theme: status marks that do not rely on color

Tracks GitHub issue #35 (Night theme: tell a passed check from a failed one
without color).

## Overview

The red night theme is one hue on purpose, so "ok", "too small", "high voltage
drop", "incomplete" and "active" all read as red outlines, and the device role
colors and live state dots on the Floorplan collapse into shades of the same
red. This plan gives every status its own form, so color is never the only
signal: passed is quiet outline text with a small check, a warning is an outline
with a warning mark, a failure is a filled badge with a mark. The same forms are
used in the day theme. The floorplan role colors get a shape per role. The
faint night muted text is brought to a readable contrast.

## Decisions agreed with the user

- **Marks are inline SVG**, not text glyphs: a check, a triangle with a bang and
  a filled octagon with a cross. The look is the same on every browser and
  font, including the older browsers some chart plotters ship, and the three
  silhouettes differ without color.
- **Role colors also get shapes**, in the floorplan markers, the small dots and
  the legend: consumer circle, source triangle pointing up, storage square,
  distribution triangle pointing down, converter diamond.

## Defaults, reviewed with the user

The pass form, the cannot form, the live dot forms and night only muted text
were reviewed and kept as proposed. The rest are mine, for the diff review.

- **Four forms, one per level** (a pure map in `public/statusMarks.js`):

  | Level | Form | Mark | Used for |
  | ----- | ---- | ---- | -------- |
  | pass | quiet text, no border or fill, muted color | check | `ok`, a cable that passed |
  | cannot | dashed outline, muted color | dash | `cannot check`, `incomplete` |
  | warning | solid 1.5 px outline, no fill | triangle with bang | `warning`, `high voltage drop` |
  | fail | filled badge, light text on the danger color | octagon with cross | `too small`, `fail`, `over rating`, `no protection` |

  Outline weight and fill, not hue, separate the levels, so the forms also work
  in the day theme. The word is always shown next to the mark (the mark is
  `aria-hidden`; the word is the accessible name).
- **A pass in a table is the check alone** (a quiet 14 px check with
  `aria-label="ok"`, as the Load Summary and the cable rows draw it now), not a
  word badge, so a row full of passes stays calm. The popover and the bus
  section show the word as well: "ok" with the check.
- **One component and one set of CSS classes.** `StatusBadge` in
  `public/statusBadge.js` draws the mark and the word from the level; the
  `.badge.over-rating`, `.badge.ok` and `.check-badge.check-*` rules become
  `.status-pass|cannot|warning|fail` rules in one grouped block of `style.css`.
  The verdict class names (`check-fail`, `check-warning`, `check-ok`,
  `check-cannot`) stay on the elements, because tests and other rules use them.
- **Dashboard** worst cable and bus rows use the same badge; the per bus reason
  lines ("Voltage: fail") get the small mark in front of the word.
- **Where the forms apply:** cable check badges and their popover headings, the
  Load Summary status cell, the bus verdict badge and the bus check headings, the
  Dashboard findings, the circuit list "no protection" and "N warnings" badges,
  and the solar array check level badges.
- **The schematic wire check mark** (the triangle on a wire) already has its own
  shape; it gets the octagon for a failure so it matches the badge.
- **Role shapes.** A pure `roleShape(role)` in `public/roles.js` returns the
  shape name, and `shapePath(shape, cx, cy, r)` returns an SVG path; the
  floorplan marker draws that path in place of the circle (same center and
  radius, so clustering, hit areas and dragging stay as they are). The legend
  dot and the schematic box get the same shape: the box keeps its rectangle and
  draws a small role shape in its top left corner.
- **Live state dots** get a form as well: on is a filled shape, off a hollow
  outline, unknown a dashed outline. The legend swatches and the Dashboard live
  indicator follow.
- **Night muted text.** `--text-muted` (now 2.98:1 on the card color) and
  `--text-muted-strong` (3.91:1) are raised to at least 4.5:1 on the page and
  card colors and at least 4.0:1 on the alternate surface, keeping `--text`
  brighter than both. The exact values are picked in the build and listed in the
  plan's results. The day theme muted grey (`#888` on white, about 3.5:1) is the
  same problem; it is noted in the CHANGELOG and darkened only if it stays
  within the look of the day theme.
- **Wording stays advisory.** No check text changes.
- **No data migration, no setting.** Always on.

## Approach

### 1. Pure helpers (tested)

`public/statusMarks.js`: `levelOf(kind)` maps the kinds the app already uses
(`ok`, `warning`, `fail`, `cannot`, `incomplete`, `over rating`, `active`,
`removed`) to a level, `markFor(level)` names the mark and form,
`MARK_PATHS` holds the SVG path data. `public/roles.js` gains `roleShape` and
`shapePath`. Unit tests pin every kind to a level, every level to a distinct
form and mark, that no two role shapes are equal, and that every path string is
non empty and finite.

### 2. The badge (`public/statusBadge.js`)

`StatusBadge({ level, text, ... })` renders a `span` (or the existing `button`
for clickable cable badges) with the inline SVG mark and the word. Callers keep
their test ids and data attributes.

### 3. The views

`cableCheckView.js`, `loadSummary.js`, `busesView.js`, `dashboardView.js`,
`solarView.js` and the two badges in `app.js` use the component. The Floorplan
marker, legend and schematic role corner use the shape helpers.

### 4. Styles (`public/style.css`)

One grouped block holds the status badge rules and the role shape rules, and the
old color-only badge rules are removed, so a rebase against the Zones work only
touches the badge and check area. The night token change is in the
`[data-theme="dark"]` block.

## Test Strategy

- Unit tests for the helpers in Approach 1, a source check that every view above
  uses the component and no longer hand builds `badge check-badge` or
  `badge over-rating` markup, and the existing check and dashboard tests kept
  green (class names and test ids are unchanged).
- A contrast test over the night tokens: parse the `[data-theme="dark"]` block
  of `style.css`, assert the ratios of muted text on the card, page and
  alternate surface.
- A headless Chromium check against the live server's GET data with every
  non-GET request blocked, at 1100 px and 390 px, in the day theme and the red
  night theme: Cables with every verdict, the popover, Load Summary, Buses,
  Dashboard, the Floorplan with Live on and its legend, with screenshots that are
  looked at. What was not looked at is stated in the report.

## Implementation Steps

- [x] `statusMarks.js`, role shape helpers, tests.
- [x] `StatusBadge` and the CSS block.
- [x] Cable checks, Load Summary, bus checks, Dashboard, solar, circuit list.
- [x] Floorplan marker and legend shapes, live state forms, schematic corner.
- [x] Night muted contrast and its test.
- [x] CHANGELOG under Unreleased, README and docs wording, headless checks.

## Files to Create/Modify

- New: `public/statusMarks.js`, `public/statusBadge.js`,
  `test/statusMarks.test.mjs`.
- Modify: `public/style.css`, `public/roles.js`, `public/cableCheckView.js`,
  `public/loadSummary.js`, `public/busesView.js`, `public/dashboardView.js`,
  `public/solarView.js`, `public/app.js`, `public/floorplanView.js`,
  `public/floorplanLegend.js`, `public/schematicView.js`, `CHANGELOG.md`, the
  docs that show the badges.

## Results

Night tokens: `--text` #f2a094, `--text-muted-strong` #dd8576, `--text-muted` #c8766b
(4.64 to 1 on the card, 4.29 on the alternate surface). New tokens `--fail-fill`
and `--fail-on` hold the filled failure badge. In `app.js` the new component is
imported as `MarkBadge`, because `app.js` already has its own `StatusBadge` for
an item's status word.

## Open questions

None. The decisions are above; the defaults were reviewed.
