# Implementation Plan: 0035 - Demo content package

Tracks GitHub issue #20.

## Overview

A fictional demo boat for the live demo instance at the trade fair and after
it: a 12 V yacht with a house, a starter and a bow thruster battery, shore power
and an inverter, solar, and the relay banks and meters the demo's SignalK boat
already publishes, so the live view and the cable checks light up. It ships as a
`demo/` folder in the repository (outside the npm `files` list) that the demo
build downloads and copies into the plugin's data directory. The plugin also
gets read access for read-only visitors, which the demo needs first.

## Decisions agreed with the user

- **Format: a drop-in data directory in the repository.** `demo/wiring.db`,
  `demo/plans/` and `demo/attachments/`, committed to main, never part of the
  npm package. The demo's deploy downloads the files and copies them into the
  plugin's data directory; updating the demo content is a commit. The plugin
  stays an ordinary npm package.
- **A fictional boat built from scratch.** No data from the real boat; no real
  names, serial numbers or installation ids.
- **Drawings and positions come from the user.** The user supplies three
  drawings (deck view, interior layout, side view) and the positions of the
  fictional devices named in the demo builder's comment on issue #20.
- **Read access for visitors, always.** The plugin's GET routes are registered
  so that read-only users can read them, and every write stays admin-only. No
  plugin option. Servers without `router.access` keep the admin-only behaviour,
  as the plan image route already does.
- **The demo boat matches the demo's SignalK paths** (from the demo builder's
  comment on #20):
  - Relay switches `electrical.switches.bank.<bank>.<channel>.state`:
    bank 10: 1 Navigation lights, 2 Stern light, 3 Steaming light, 4 Tricolour,
    5 Anchor light, 6 Deck light. Bank 11: 1 Black water valve, 2 Cockpit alarm,
    3 Ambilight TV, 4 Fuel transfer, 5 Tender remote, 6 Deck wash pump. Bank 12:
    1 Radio galley, 2 Nav instruments, 3 AIS power, 4 VHF power, 5 Radio saloon,
    6 AIS silent. Bank 13: 1 Bow thruster, 2 Fresh water pump, 3 Bilge pump,
    4 Fridge, 5 Freezer, 6 Saloon lights, 7 Cabin lights, 8 Instruments.
  - Batteries `electrical.batteries.house`, `.starter`, `.bowThruster`
    (voltage, current, state of charge).
  - Solar `electrical.solar.bimini`, `.deckPort`, `.deckStarboard`, chargers
    under `electrical.chargers.*`.
- **Pages:** a 12 V DC schematic page and an AC page (shore power, inverter),
  not 48 V.

## Approach

### 1. Read access for visitors (`src/routes.js`)

- Register every GET route through `router.access('readonly')` when the server
  offers it, like the plan image route; writes (PUT, POST, DELETE, purge,
  switch) stay on the admin router. Each GET route is reviewed and any that
  should stay admin-only is listed with its reason (none expected). Tests with a
  fake router that records the access level of every route: all GET routes are
  read-only, all others admin, and a server without `access` still registers
  everything.
- ARCHITECTURE.md and SPEC.md say who can read what.

### 2. The demo boat as data (`demo/source/`, `scripts/build-demo.js`)

- A human-readable spec of the boat in `demo/source/boat.json` (zones,
  devices with roles, ratings, terminals and switch and meter paths, cables
  with gauge, length and conductors, conduits, circuits' protection, enclosures
  with their contents, schematic pages, device colors) and a builder
  `scripts/build-demo.js` that creates `demo/wiring.db` through the plugin's own
  Store, so the schema, migrations and validation are the real ones. It needs
  Node 22.13 or newer (the host has 20, so it runs in the container like the
  tests) and is deterministic: fixed ids derived from names, fixed timestamps.
- The boat: the three batteries (with their meter and voltage paths) and their
  protection, a battery switch, bus bars and a distribution panel (an enclosure
  with an inside page), shore power with an inlet, breaker and an AC panel,
  inverter and charger, three solar arrays with their charge controllers, the
  four relay banks with a cable and a switch path for each channel listed above,
  the consumers behind them, alternator and engine start circuit, bow thruster
  feed, instruments and a data bus (signal cables), and cable runs through
  conduits.
- Deliberately included so the checks have something to show: a small number of
  believable findings (one long thin cable with a high voltage drop on a
  critical circuit, one cable under the fuse rating), alongside many cables
  that pass. Several devices use box colors and the new icons.
- A believable short change history (a handful of edits spread over the
  previous weeks) instead of hundreds of creation entries, so the Changes tab
  looks lived in.
- A test regenerates the database from the spec and compares it with the
  committed `demo/wiring.db` (table contents), and checks every switch path,
  meter path and battery path above exists on the boat.

### 3. Floorplans and positions (needs the user's drawings)

- The three drawings go into `demo/plans/` (each calibrated), and the device
  positions the user supplies are applied by the builder. Until the drawings and
  positions arrive this step waits; steps 1 and 2 do not depend on it. The
  format of the positions (a CSV of device name, plan, x, y and z in meters, or
  clicks on the drawing) is settled when they arrive.

### 4. Package checks and docs

- A test that `npm pack --dry-run` lists nothing from `demo/` and that
  `package.json` `files` is unchanged.
- `demo/README.md`: what the folder is, how to copy it into the plugin's data
  directory (stop the server, copy `wiring.db`, `plans/` and `attachments/`,
  remove the `-wal` and `-shm` files, start), the schema version it needs (the
  demo must run a plugin at least as new as the database), and how to rebuild it.
- SPEC.md, ARCHITECTURE.md, README, CHANGELOG, a comment on issue #20.

## Defaults, reviewed with the user

- The boat is called "Demo yacht"; names, zones and devices are made up.
- Two or three cable check findings are included on purpose, and the change
  history is a short believable one (both confirmed).
- `demo/attachments/` exists but is empty (a `.gitkeep`): no photos or manuals.
- The relay channels are modelled so the live view works with the app's
  existing switch handling (a cable's switch reference or a switch device,
  whichever the code supports; the builder follows the SPEC).
- The demo database is regenerated, not edited by hand; the user can still
  change the spec and positions and rebuild.
- The release version is chosen by the user; the demo folder needs no npm
  release, but the read access change does.

## Test Strategy

- Route tests for the access levels; builder determinism and spec checks;
  contents checks (every path above, the findings, the enclosure and its inside
  page); the `npm pack` exclusion test.
- Headless Chromium on a mock server run from the built database: the lists,
  both schematic pages, the floorplan with the supplied drawings, the load
  summary, the Changes tab, the cable checks, day and night.

## Implementation Steps

- [x] Read access for visitors, with tests.
- [x] The boat spec and the builder, with tests.
- [x] The floorplans and positions (four drawings, calibrations, first-pass positions).
- [ ] The package checks, `demo/README.md`, docs, and a comment on issue #20.

## Files to Create/Modify

- `src/routes.js`, new `scripts/build-demo.js`, `demo/` (spec, README,
  `wiring.db`, `plans/`, `attachments/.gitkeep`).
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- A button or route that loads a demo from a seed file on any server.
- A second demo boat (48 V catamaran).
- Photos and manuals as attachments.

## Open questions

The format of the device positions and the calibration of the three drawings,
settled when the user delivers them. Everything else is decided above; the
defaults list is for review.
