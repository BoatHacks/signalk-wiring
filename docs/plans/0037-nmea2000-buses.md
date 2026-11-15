# Implementation Plan: 0037 - NMEA 2000 buses

Tracks GitHub issue #4 (the first part: NMEA 2000).

## Overview

A boat can have several NMEA 2000 backbones. Each is recorded as one record, a
backbone with its taps, instead of a tangle of point to point cables. The bus
shows on its own tab with checks, on schematics as a backbone line with drops, on
the floorplan as a drawn route, and on the page of every device that sits on
it. The bus power is counted on the circuit that feeds it. Seatalk-1, NMEA 0183
and sensor wiring get only a protocol label and standard ports for now.

## Decisions agreed with the user

- **NMEA 2000 first.** The bus model and the checks cover NMEA 2000. Other
  protocols are labels and presets only; they follow in later plans.
- **A backbone is one record with taps, and there can be several backbones.**
  The record is cable-like: a name, a cable class, a length, ends with a
  terminator flag each, an optional route on the floorplan, notes and
  attachments, and an ordered list of taps. It is not a point to point wire run.
- **Each drop lives inside its tap:** the device (and its port), the drop length
  and the place along the backbone. There is no cable record per drop. A tap can
  also be the power feed.
- **Bus power: a power tap feeds the bus and its load is counted on that
  circuit.** A tap marked as the power feed names the fuse, breaker or source it
  comes from. The load of the backbone (the sum of the devices' LEN times 50 mA,
  with the rated power as a fallback) is added to that circuit's load, so the
  circuits, the load summary and the cable checks see it.
- **Where it appears:** a Buses tab with a detail view and the checks; on
  schematics as a backbone line with drops; on the floorplan as a drawn route
  with the taps marked along it; and on the device page, which names the bus, the
  tap, the drop length and the device's LEN.

## Approach

### 1. Data (`src/schema.sql`, `src/store.js`, `src/resources.js`)

- Migration 18 adds `backbones` (id, name, cable class, length, status, notes,
  route, end terminator flags, supply rating) and `backbone_taps` (id,
  backbone id, position, device id, port name, drop length, along the backbone,
  power feed flag, fed from device id), with a unique tap per device and port,
  guarded and safe to run twice. Devices get `len` (load equivalency number,
  nullable) and the NMEA 2000 port preset (a signal port named "NMEA 2000").
  Validation, change log, removal with Undo, permanent deletion and attachments
  work like for conduits.
- A `wiringBackbones` resource type (list, read, write, delete) and the same
  record in the OpenAPI document (plan 0036, the contract test keeps it honest).

### 2. Derived data and checks (pure, `src/buses.js`, mirrored in `public/`)

- Per backbone: devices on it, backbone length, total and longest drop, device
  count, terminators, LEN total and the current it implies, the power feed and the
  circuit it joins. The feed's circuit gets the bus load in the existing
  derivation, with a flag saying the load comes from a bus.
- Advisory checks in the style of the cable checks (verdict, numbers, reasoning,
  sources, an "advisory, not a guarantee" note): backbone length for its cable
  class, each drop at most 6 m and all drops together at most 78 m, at most 50
  devices, exactly two terminators, LEN total against the supply rating, a power
  feed present, and a device with no LEN or no tap length reads "cannot check"
  and names what is missing. The limits come from a table with its sources, not
  from copied standards text, and are reviewed by the user before a release.

### 3. The app

- **Buses tab:** list, detail view (taps with device, port, drop length, position,
  the power feed, LEN and the checks with their reasoning), add and edit forms,
  duplicate, remove with Undo, history.
- **Schematic:** a backbone is drawn as one thick line with a short drop to each
  device's NMEA 2000 port, its terminators and its power feed; Auto-arrange and
  the router treat it as one wire-like object with ports.
- **Floorplan:** a backbone has a route with the same editing as a cable (drawn,
  waypoint and midpoint handles, follows moved devices), with a mark at each tap
  and its drop length.
- **Device page:** a "On the bus" section and the LEN field in the device form.
- **Other protocols:** an optional protocol label on cables (NMEA 2000 cable,
  Seatalk-1, NMEA 0183, sensor, other) with a colour and standard port presets.

## Defaults, reviewed with the user

- Cable classes Micro or Mini and Maxi, each with its own length limit; the
  numbers are researched from manufacturers' public guides, cited in the data file
  and the docs, and the lower figure is used where sources disagree.
- The full list of checks above (confirmed); every limit is one line in a table and
  can be changed in a later plugin option.
- The optional protocol label on cables and the NMEA 2000 port preset are part of
  this plan (confirmed).
- One backbone per record; two backbones are joined only by a device that sits on
  both (a gateway), not by a link between them.
- The demo boat's "NMEA 2000 backbone" device and its five cables become a real
  backbone record in a later change to the demo.
- The release version is chosen by the user; this changes the schema, so a minor
  bump is likely.

## Test Strategy

- Store tests (migration twice, validation, taps unique per device and port,
  removal and undo, purge), pure tests for the derivation and each check with
  hand-calculated cases, tests that the bus load reaches the circuit and the load
  summary, route and OpenAPI contract tests for the new resource.
- Headless Chromium on the mock server: the Buses tab, the schematic and floorplan
  drawing, the device page section, day and night themes.

## Implementation Steps

- [ ] Migration 18, the store, the resource type and the OpenAPI entry, with tests.
- [ ] The derivation, the bus load on circuits and the checks, with tests.
- [ ] The Buses tab, the device page section and the LEN field.
- [ ] The backbone on schematics and the floorplan.
- [ ] The cable protocol label and the NMEA 2000 port preset.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, a comment on issue #4, and the
      user's review of the limits table before a release.

## Files to Create/Modify

- `src/schema.sql`, `src/store.js`, `src/resources.js`, `src/routes.js`,
  `src/openapi*.js`, new `src/buses.js`, `src/circuits.js`.
- New `public/buses*.js`, `public/app.js`, `public/schematicView.js`,
  `public/floorplanView.js`, `public/deviceFields.js`, `public/style.css`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Seatalk-1 as a daisy chain with its own limits, NMEA 0183 and sensor wiring.
- Voltage drop along the backbone and the bus length by physical route.
- Linking two backbones directly, and importing the device list from the bus.

## Open questions

None. The decisions and the reviewed defaults are above.
