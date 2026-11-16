# Implementation Plan: 0042 - Dashboard first screen

Tracks GitHub issue #31 (Dashboard: lead with findings and statistics, fold live
sections that have no data). Builds on plan 0038 (Dashboard).

## Overview

On an install with little or no live data the Dashboard's first screen says "no
live data" five times and lists every switch as unknown, while the useful parts,
Needs attention and Statistics, sit below the fold. This plan makes the first
screen follow the data: without live values the findings and statistics come
first and the live sections collapse to one line; once live values arrive the
live cards lead. It also tidies the statistics (tiles that look like links, no
orphan tile) and replaces the summed amp hours with an energy figure.

## Decisions agreed with the user

- **The order follows the data.** With no live value yet, Needs attention and
  Statistics come first and the live sections are collapsed. When a live value
  arrives, the live cards move first.
- **This work stays under #31** and gets this plan. **#24 (the original
  Dashboard issue) is closed** with a short note pointing at the released
  Dashboard and at #31.

## Defaults, reviewed with the user

These are my proposals, to be reviewed before the build:

- **What counts as live data:** at least one live value has arrived (a power in
  or out reading, a battery reading, or a known switch state). The first arrival
  settles the order and it then stays for the rest of the visit, so the cards do
  not jump while someone reads. Turning live off, or a failed stream, counts as
  no data and puts the findings first again.
- **Live power with no data:** one line, "No live power data yet.", and a closed
  "How to set it up" disclosure that says to choose the power in and out
  meters in the plugin settings (Server, Plugin Config, Wiring Documentation).
  When one side has data and the other does not, the side without data is a
  muted one-liner inside the card, not a card of its own.
- **Battery banks with no live data:** the bank shows its name and its recorded
  capacity (energy in kWh, Ah of the bank), without a "no live data" line of its
  own. One shared note at the foot of the card says there is no live reading,
  instead of one per bank.
- **Switches:** while every state is unknown the card is one line, "26 switches,
  state unknown (no live data).", with a link to the Devices tab. As soon as one
  state is known the chips are shown, as today.
- **Statistics tiles look like links:** a visible border and hover and focus
  state, a small arrow mark, a minimum height that makes them a good tap target.
  They are links already (each goes to its tab); only the look changes.
- **No orphan tile:** the tiles wrap and each grows to fill its row
  (`flex: 1 1 160px`), so the last row is never one small tile in a corner, at
  any column count and for the demo's ten and the Floorplan's eleven tiles.
- **Battery capacity:** the tile's main figure is energy in kWh (summed across
  banks, as before), and the note lists the banks with their amp hours ("house
  5120 Ah, starter 1280 Ah, bow thruster 2304 Ah", the first three, then "and N
  more"). Amp hours are never summed. A bank without capacity is still counted
  in the note as it is today.
- **The demo battery capacities need no change.** The issue asks for a look at
  them in the demo package (#20): they were set on purpose to the capacities of
  the SignalK demo server (house 5120 Ah, starter 1280 Ah, bow thruster
  2304 Ah, from its `capacity.nominal`), so they stay.
- **Wording stays advisory:** the "Advisory only" line on Needs attention does
  not move or change.

## Approach

### 1. Pure helpers (`public/dashboard.js`, tested)

- `hasLiveValue({ flows, battery, switches })`: true when any live value has
  arrived (a flow with a counted or stale entry, a battery card with a reading,
  a switch with a known state).
- `dashboardOrder({ liveOn, seen })`: `'live-first'` when live is on and a
  value has been seen this visit, otherwise `'findings-first'`.
- `batteryTotals(banks)` also returns `perBank: [{ name, ah }]` and the note
  text is built by `batteryNote(perBank, limit)`; `ah` as a sum is dropped from
  the figures shown (the field can stay for the other callers or be removed if
  none is left).
- `switchSummary(sw)`: `{ mode: 'none' | 'unknown' | 'chips', total }` so the
  card knows which of its three states to draw.

### 2. The view (`public/dashboardView.js`)

- `DashboardTab` keeps a `seenLive` state set the first time `hasLiveValue` is
  true, resets when live is turned off, and orders the cards with
  `dashboardOrder`. Both orders use the same cards; only their sequence in the
  grid differs, so there is nothing to duplicate.
- `LivePower` renders its one-line empty state with the "How to set it up"
  disclosure; `Batteries` renders compact banks and the shared note;
  `SwitchesCard` renders the three states from `switchSummary`.
- `Statistics` uses the new battery tile text and the link look.

### 3. Styles (`public/style.css`, the `.dash-*` rules)

Link-looking tiles with hover, focus and tap size, the wrapping grid with
growing tiles, the compact bank row and the one-line empty states. The red night
theme keeps to its own variables.

## Test Strategy

- Unit tests for `hasLiveValue`, `dashboardOrder`, `switchSummary`,
  `batteryTotals` (per bank, no summed Ah) and `batteryNote` (three banks, more
  than three, a bank without capacity).
- The existing Dashboard tests stay green; the ones that read the summed amp
  hours are updated.
- A headless Chromium check against the demo data with every non-GET request
  blocked: findings first with live off and with no values, live first once the
  real stream or a mock stream delivers values (the scratchpad real-stream check
  script does this), the collapsed one-liners, the three switch states, the
  tiles with no orphan at 1100 px and 390 px, in the day and the red night
  theme, with screenshots that are looked at.

## Implementation Steps

- [ ] The pure helpers with tests.
- [ ] Order by data, the collapsed live sections, battery and switch states.
- [ ] Statistics tiles: link look, no orphan, the kWh battery tile.
- [ ] CHANGELOG, README line if it describes the Dashboard, headless checks.
- [ ] Close #24 with a note.

## Files to Create/Modify

- `public/dashboard.js`, `public/dashboardView.js`, `public/style.css`,
  `test/dashboard.test.mjs`, `CHANGELOG.md`, `README.md` where it describes the
  Dashboard.

## Open questions

None. The decisions are above; the defaults are for review.
