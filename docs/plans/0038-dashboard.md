# Implementation Plan: 0038 - Dashboard

Tracks GitHub issue #24.

## Overview

A Dashboard is the first tab and the page the app opens on. It shows in one
screen how the wiring system stands (statistics), what needs attention (failed
checks) and what the boat is doing right now (live power in and out, battery
state and which switches are on, with a last-hour history). It reuses the load
summary, the cable and bus checks, the derived circuits and the Live mode. It is
the first screen for the trade fair demo.

## Decisions agreed with the user

- **Live input and output sources are configurable in the plugin admin UI.**
  Two lists, Inputs and Outputs. Each entry has a label (Shore, Solar,
  Alternator, Total load ...), a SignalK path and a unit (W or A). For A, an
  optional fixed voltage or a voltage path converts it to watts. A filled list
  replaces the automatic rule for that side; an empty list falls back to the
  device paths (battery, meter, solar and charger paths already on devices).
- **The Dashboard is the first tab and the landing page.** Circuits stays as a
  tab.
- **History is read from the server's history API** (the standard v2 history
  routes, here served by QuestDB), the last hour, as small sparklines. The
  block hides when no history provider answers.
- **First version has three blocks:** statistics, failed checks overview, live
  power in and out. The "what changed lately" strip is left for later.
- **Live is on for every visitor who can read the stream**, shown by an
  indicator with a switch to turn it off. It reuses the one existing WebSocket,
  pauses while the tab is hidden and updates at most every 5 seconds. With no
  stream or no values, cards say "no live data", never zeros.

## Approach

### 1. Pure derivation (`public/dashboard.js`, tested)

- **Statistics:** counts of devices by role, cables, circuits, conduits, zones,
  schematic pages, floorplans, backbones; total cable length (recorded, else
  measured, and how many cables have neither); protected and unprotected
  circuits; installed battery capacity (Ah and Wh at nominal voltage); rated power
  of all consumers (the load summary totals); completeness: cables lacking
  gauge, length or voltage, devices lacking ratings, share of devices placed on
  a floorplan and on a schematic.
- **Failed checks:** from the shared cable check and bus check results: counts
  per verdict (too small, high voltage drop, cannot check), the worst few cables
  and buses linked to their records, plus the findings the app already knows:
  circuits with no protection, cables in no circuit, unplaced devices, devices
  that overlap on a schematic. The block says it is advisory.
- **Configured sources (`src/settings.js`, `index.js`):** the plugin schema
  gets `dashboardInputs` and `dashboardOutputs`, arrays of `{ label, path, unit,
  voltage, voltagePath }`, at most 12 each. They are validated when the settings
  are resolved (label 1 to 40 characters, a path of dotted SignalK names, unit
  `W` or `A`, voltage 1 to 100, bad entries dropped with a warning in the plugin
  status), and are served to the web app with the other settings
  (`wiringSettings`, readable like today). An `A` entry with neither voltage nor
  voltage path is shown as "no voltage" and left out of the sum.
- **Live input and output:** when a side has configured entries, its total is the
  sum of those readings in watts (stale readings, older than a minute, are
  shown greyed and left out of the sum). Otherwise the automatic rule applies:
  input is the sum of the readings of devices with
  the source role and of converter devices that charge (solar controller,
  alternator, charger), each counted once; output is the sum of the readings of
  consumer devices that have a meter. To avoid counting a flow twice, a device
  whose meter is already inside a listed device's circuit is not added again, and
  a reading is used in watts, or amps times the device's voltage. The total shown
  next to them is the battery current from the battery monitor, so the user can
  see whether input and output explain it. Anything without a meter is listed as
  "not metered" rather than guessed.
- **Battery cards:** voltage, current, state of charge and time remaining per
  bank, from the existing battery readings, and the switchable consumers that
  are on (from the existing `GET /live` state).

### 2. Live and history plumbing (`public/live.js`, `public/dashboard*.js`)

- The existing live hook subscribes to the stream once for the whole app. The
  Dashboard adds its paths to that subscription (no second WebSocket), the
  period is 5000 ms on this page, and the subscription pauses when the page is
  hidden and resumes on return. The polling fallback is kept.
- History: one request per metric to
  `/signalk/v2/api/history/values` with a duration of one hour and a resolution
  of 60 seconds, made when the Dashboard opens and every few minutes while it is
  visible, never while hidden. The provider list is asked first; no provider
  means no sparklines and no error.

### 3. The page (`public/dashboardView.js`, `public/app.js`, `public/style.css`)

- Cards in a responsive grid that works on a phone and a tablet: Statistics,
  Failed checks, Live power (input, output, battery), Battery banks, Switches
  on. Day and night themes, the 48 px touch targets, a "Live" indicator and
  switch (remembered in the browser), "no live data" states, and links from every
  entry to its record.
- Route `#/dashboard`, first in the tab bar; the default route becomes the
  Dashboard.

### 4. Docs

- SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and a comment on issue #24.

## Defaults, reviewed with the user

These are my proposals, to be reviewed before the build:

- At most 12 entries per list; the admin UI shows them as an array of small
  forms (label, path, unit, voltage, voltage path), in the order entered, which
  is the order on the Dashboard.
- Update rate 5 seconds, history of one hour at one minute resolution,
  refreshed every 5 minutes while the page is visible.
- Cable length uses the recorded length first, then the measured one, and says
  how many cables have neither.
- "Worst few" means the five worst cables and the three worst buses.
- The Live switch is remembered per browser, on by default.
- Battery Wh uses each battery's nominal voltage, or 12 V if the device has none,
  and the card says so.
- Devices with several meter readings are counted once, by the first meter path.

## Test Strategy

- Pure tests with hand-calculated cases: each statistic, each completeness
  count, check counts and ordering, input and output sums (including a device
  inside another's circuit, amps to watts, no meter, stale readings), battery
  card values.
- Settings tests: entry validation (bad paths, units, voltages, caps), the
  schema shape, defaults and the served resource; sums with configured entries,
  stale and unvoltaged entries, and the fallback when a list is empty.
- History tests with a fake fetch: provider present, absent and failing, null
  samples, and request pacing while hidden.
- Headless Chromium on the mock server: the Dashboard with live data, with none,
  with the Live switch off and with no history provider, day and night themes,
  phone and tablet widths, links to records.
- A check against the live demo server of the history route and the numbers
  against the Load Summary tab.

## Implementation Steps

- [x] The `dashboardInputs` and `dashboardOutputs` settings (schema, validation,
      served to the web app), with tests.
- [x] The pure derivation (statistics, checks, live input and output) with tests.
- [ ] The history client and the paused, shared live subscription, with tests.
- [ ] The Dashboard page, route, landing page, styles, day and night themes.
- [ ] Browser checks, live check, docs, changelog and a comment on issue #24.

## Files to Create/Modify

- New `public/dashboard.js`, `public/dashboardView.js`, `public/history.js`;
  `public/live.js`, `public/app.js`, `public/style.css`, `index.js`,
  `src/settings.js`.
- New tests under `test/`, `SPEC.md`, `ARCHITECTURE.md`, `README.md`,
  `CHANGELOG.md`.

## Follow-ups (not in this plan)

- The "what changed lately" strip, charts beyond sparklines, per-device
  links on configured sources, and printing or exporting the overview.

## Open questions

None. The decisions are above; the defaults are for review.
