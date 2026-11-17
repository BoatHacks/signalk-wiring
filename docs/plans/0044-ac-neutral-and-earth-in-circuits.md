# Implementation Plan: 0044 - AC neutral and earth in circuits

No GitHub issue yet. Found while entering a real boat: the Dashboard's "Cables
in no circuit" list is full of AC cables (neutral bar to RCBO, breaker to ground
bar, and so on).

## Overview

A circuit gets its cables from two traces: the positive trace (feed cables, from
a source through protectors to the loads) and the return trace, which only walks
`negative` conductors. AC neutral and earth conductors are never traced, so a
cable that carries only neutral or only earth (a neutral bar link, a ground bar
link) is in no circuit. This plan makes the return trace work for AC: the neutral
and earth cables a circuit's loads return and ground through join that circuit,
the way negative cables already do on the DC side. The API text for
`returnCableIds` already says "Negative or neutral cables that serve the
circuit", so this finishes what that text promises.

## Decisions agreed with the user

- **Both neutral and earth are traced.** Neutral bars and ground bars stop being
  orphans.
- **A broken neutral warns, a missing earth only informs.** A consumer whose
  neutral does not reach a source or converter raises a warning, like a broken DC
  negative. A consumer with no earth path gets a note on the circuit, not a
  warning, because class II appliances have no earth.
- **Earth ends at a new "ground" device role.** Nothing models the boat's bonding
  point today, so a new role (the boat's central ground, a bonding bar, a hull
  bond) is the only target an earth path can reach. Neutral and negative keep
  their targets (storage, source, converter).
- **The "no earth path" note also shows on the Dashboard**, as a quiet list in
  Needs attention, next to the circuit page line.
- **A consumer whose feed cable carries its own neutral or earth counts as
  returning alongside its feed.** No warning for it, as with a DC consumer that
  has no negative recorded.

## Defaults, reviewed with the user

These are my proposals, to be reviewed before the build:

- **AC circuits trace neutral and earth, DC circuits trace negative and earth.**
  A circuit is AC when its feed carries a line conductor (the `ac` flag that
  exists today). An earth conductor on a DC cable joins the circuit it grounds, so
  DC earth cables stop being orphans too (reviewed with the user). The "no earth
  path" note is for AC circuits only: a DC load with no earth is normal.
- **The walk is the DC walk, with another conductor set.** From each consumer at
  the end of the circuit, walk upstream over cables that carry the wanted
  conductor, through any device that is not a consumer (switches, breakers, RCBOs,
  bars, enclosures), and stop at a storage, source or converter. A cable on a
  path that reaches one joins the circuit. A bar shared by several loads
  therefore serves each of their circuits.
- **My reading of "returns alongside its feed".** The walk still runs for every
  consumer, so the shared neutral and earth cables upstream are attached. What the
  decision changes is the warning: a failed neutral walk warns only for a consumer
  whose neutral exists as a separate cable that is not one of the circuit's feed
  cables. A consumer whose only neutral is inside its own feed cable never
  warns. A consumer with no neutral conductor anywhere is listed as "assumed
  alongside its feed", as DC does today.
- **Earth targets: the ground role.** An earth walk stops only at a device with
  role `ground`. The role is added to the device roles (stored, API enum, the
  role picker with its hint, icon fallback, floorplan legend), and it has no
  ratings or terminals of its own. Earth cables stay out of circuits until a
  ground device exists, so this feature needs the boat's bonding point modeled
  once (for example one "Central ground" device that every earth path ends on).
- **The Dashboard note stays quiet until a ground device exists.** With no ground
  device on the boat every AC consumer would read "no earth path", so the circuit
  page line and the Dashboard list appear only when at least one live ground
  device exists. The Dashboard list is not counted in the Needs attention total:
  it is a muted section, "No earth path (N)", listing the consumers.
- **A combined cable is recorded on its own circuit only (found while building).**
  A cable that carries a line conductor with its neutral and earth belongs to the
  circuit that feeds through it. The walk crosses it to reach the target, but does
  not add it to the circuits downstream, because their loads would then be counted
  on the feeder a second time (the demo boat's inverter-to-main-breaker cable read
  "too small" against the sum of every branch). Only cables with no line conductor
  (neutral bars, ground bars) are shared between circuits.
- **A transfer switch or other enclosure passes the walk through**, like any
  non-consumer device, so the earth wires I recorded on the box itself work.
- **Cable checks (reviewed with the user).** Neutral cables are checked against
  the circuit current, as the line is (single phase: the neutral carries the line
  current). Earth-only cables are exempt from the current and voltage drop checks,
  on AC and DC circuits alike. A protective conductor is not sized by the load.
  While building I found `isNonPower` in `public/cableChecks.js` already exempts
  earth-only (and signal-only) cables, so no change is needed there and no new
  "protective earth" badge was added: exempt cables show no check result, as today.
- **Wording stays advisory**, as everywhere else.

## Relevant SPEC/ARCHITECTURE Sections

SPEC.md, the circuits section ("Negative conductors never join circuits ..."),
the circuit resource (`returnCableIds`, `implicitReturnDeviceIds`) and the cable
checks. All three get a line for the AC case.

## Approach

### 0. The ground role (`src/store.js`, `src/openapiSchemas.js`, `public/roles.js`)

`ground` joins `DEVICE_ROLES` with the hint "The boat's ground or bonding point
that earth wires end on: a central ground bar, a hull bond.", in the role picker,
the API enum, the icon fallback and the floorplan legend. In the circuit trace a
`ground` device is a plain device that ends no circuit (it never carries a
positive or line conductor).

### 1. The trace (`src/circuits.js`, tested)

- `buildNegativeGraph(wiring)` becomes `buildReturnGraph(wiring, conductorTypes)`.
  It builds the same adjacency over devices (using each conductor's own
  from and to device when it has one) for the given conductor types.
- `traceReturns(endDeviceIds, live, graph, warnings, opts)` takes a code and a
  label for its warning, so one function serves negative, neutral and earth.
- In `deriveCircuits`, for each circuit group: DC circuits trace `negative` and
  `earth`, AC circuits trace `neutral` and `earth`, and `returnCableIds` is the
  union (sorted, each cable once).
- New warning code `neutral-incomplete` ("The neutral wire from X does not reach
  a source or converter."), raised under the rule above. Earth never warns.
- New derived field on the circuit, `noEarthDeviceIds`: consumers at the end of
  an AC circuit that have no earth path. Informational, and empty while the boat
  has no ground device.
- `implicitReturnDeviceIds` keeps its name and now also lists AC consumers with
  no neutral anywhere.

### 2. The resource and the API (`src/resources.js`, `src/openapiSchemas.js`)

`derived` carries `noEarthDeviceIds`; the `returnCableIds` and
`implicitReturnDeviceIds` descriptions say "negative, neutral or earth". The
warnings list gets the new code.

### 3. The pages

- Circuit page (`public/app.js`): the "Negative assumed alongside the feed for"
  line becomes "Return assumed alongside the feed for"; a new muted line "No
  earth path found for: ..." from `noEarthDeviceIds`. The return cables table
  already lists `returnCableIds`.
- Cable checks: nothing to change, earth-only cables are already exempt.
- Dashboard (`public/dashboard.js`, `public/dashboardView.js`): a muted "No
  earth path (N)" list from the circuits' `noEarthDeviceIds`, outside the
  attention count, shown only when a ground device exists.
- Dashboard, Floorplan and Schematics already read `returnCableIds`, so neutral
  and earth cables appear in circuits, highlights and the "in no circuit" count
  without more changes.

### 4. Docs

SPEC.md (circuits, resource, checks), CHANGELOG, and a line in the README only if
it describes the circuit rules.

## Test Strategy

- Unit tests in `test/circuits.test.js`, small boats:
  - an inverter, a breaker, a neutral bar and an outlet chain: neutral and earth
    cables join the circuit; a bar shared by two circuits joins both;
  - a consumer whose feed cable carries line, neutral and earth: no warning, the
    upstream bar cables still attach;
  - a consumer with a separate neutral cable that dead-ends: `neutral-incomplete`;
  - a consumer with no earth path: `noEarthDeviceIds`, no warning, and nothing
    listed while the boat has no ground device;
  - an earth path that ends at a ground device joins the circuit; one that ends at
    a converter does not;
  - a consumer with no neutral anywhere: implicit;
  - an enclosure on the path, and a converter as the target;
  - a DC circuit still traces negative as before, and an earth conductor on a DC
    cable joins the circuit with no "no earth" note.
- Cable check tests: an earth-only cable is exempt with the "protective earth"
  badge; a neutral cable takes the circuit current; the exemption holds for
  earth-only cables on DC circuits as well.
- The whole suite stays green (the container test run).
- A headless Chromium check against the demo data and against a copy of the real
  boat, with every non-GET request blocked: the "Cables in no circuit" list
  without AC cables, the circuit page with its neutral and earth rows and the
  earth note, no new derived warnings on the demo data, at 1100 px and 390 px,
  in the day and the red night theme, with screenshots that are looked at.

## Implementation Steps

- [x] The `ground` role (store, API enum, picker, icon fallback, legend).
- [x] The trace in `src/circuits.js` with unit tests.
- [x] Resource and OpenAPI text, `noEarthDeviceIds`.
- [x] Cable checks: nothing to change, earth-only cables are already exempt.
- [x] The circuit page lines and the Dashboard list.
- [ ] SPEC, CHANGELOG, headless checks on the demo and the real boat copy.

## Files to Create/Modify

- `src/circuits.js`, `src/resources.js`, `src/store.js`, `src/openapiSchemas.js`,
  `public/roles.js`, `public/builtinIcons.js`, `public/floorplanLegend.js`,
  `public/dashboard.js`, `public/dashboardView.js`,
  `public/app.js`, `test/circuitsAcReturn.test.js`,
  `SPEC.md`, `CHANGELOG.md`.

## Open questions

None. The decisions are above; the defaults are for review.
