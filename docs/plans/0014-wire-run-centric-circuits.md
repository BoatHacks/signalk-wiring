# Implementation Plan: 0014 - Wire-run-centric circuits (draft)

This is a draft from a design discussion. Nothing is implemented. The design
questions are all answered below.

## Overview

Today a circuit is created first, by hand, as an empty shell with free-text
source, breaker and panel fields, and wire runs and devices are filled in
elsewhere. The fields overlap (a breaker is now a device with the
Distribution role, yet the form treats it as text), and the form cannot
build a circuit in one place.

The proposal inverts it: you record wire runs between devices, and circuits
are worked out from them. A circuit is what a fuse or breaker protects.

## Decisions agreed with the user

- **Wire-run centric.** A circuit is established automatically when wire
  runs connect, for example battery to fuse to switch to lamp. There is no
  circuit creation dialog.
- **What terminates a circuit.** Batteries (storage), consumers and sources
  (solar panel, shore power inlet, generator, alternator). Converters
  (DC-DC, inverter, charger) sit between circuits, each of their ports
  being an endpoint of the circuit on its side. A wire run between two
  batteries (series or parallel) joins a bank and is not part of any
  circuit.
- **Passing through.** Distribution devices (fuse, breaker, switch, bus
  bar, panel, isolator, relay, splice) pass a circuit through.
- **Branches.** Each protected branch is its own circuit. One battery
  feeding a bus bar with a lamp branch and a pump branch gives three
  circuits: the feeder (battery, main fuse, bus bar), the lamp branch and
  the pump branch. The fuse or breaker nearest the load gives a circuit its
  rating, and two lamps on one fuse are one circuit.
- **Return wires.** Each wire run gets a conductor type: positive or AC line
  (the default), negative, AC neutral, or protective earth. Circuits are
  worked out from the positive and line runs only, and negative bus bars
  never join circuits. A negative run need not follow its positive run: it
  can take its own path, be shared by several consumers, and end at a local
  negative bus bar (the usual arrangement with high-side switching, where
  one larger negative wire serves a remote area of the boat). A negative run
  belongs to every circuit whose consumers return through it, so circuit
  membership is many-to-many for negative runs.
- **Negative default.** The negative follows the positive unless recorded: a
  consumer with no negative runs recorded is assumed to return alongside its
  feed, so nothing extra is entered for the common case. Negative runs are
  recorded only where they differ (another path, a shared wire, a local
  negative bus bar).
- **Terminals and ports.** Any device can declare terminals: a name, a
  conductor type (positive, negative, line, neutral, earth) and optionally a
  voltage. A converter groups its terminals into ports (for example DC in,
  AC out), and the circuit on each side of it is the one meeting that port.
  Batteries declare their posts, so a series bank and a battery with several
  posts can be documented exactly. A terminal is only required where it
  removes ambiguity (converter ports, batteries with several posts, a fuse
  block); a plain two-wire connection needs none.
- **Cable model.** A wire run is a cable between two devices and lists its
  conductors. Each conductor has a type and optionally the terminal it lands
  on at each end. A cable carrying line, neutral and earth, or positive and
  negative in one jacket, is one wire run. Conductors that part company
  along the way meet at a splice device, so each stretch is its own cable.
  (The user leaned towards one wire run per cable and saw merit in one per
  conductor; the optional terminals keep the simple case simple.)
- **Protection and rating.** A distribution device with a trip rating (A)
  protects its branch; one without (switch, bus bar, splice) only passes the
  branch through. The rating is a field on the fuse or breaker, where it is
  read off the part.
- **Direction.** From is always the supply side and To the load side, and the
  form labels them that way. Derivation follows From to To, and a run
  entered backwards shows as a warning on the circuit overview.
- **Unfused circuits.** A battery wired straight to a lamp is still a
  circuit, keyed to its first wire run and flagged "no protection" in the
  overview. Adding a fuse later moves the circuit onto it and keeps its
  name and notes.
- **DC first.** Most wiring on a boat is DC, so the cable form puts two DC
  cases up front as a choice: a single conductor (positive or negative), and
  a two-conductor cable (positive and negative in one jacket). AC and
  earth conductors sit behind "More". A plain DC cable from a fuse to a
  light is then a few fields: From, To, gauge, length and colour.
- **Negative at the supply end.** In a two-conductor cable the positive
  starts at the fuse but the negative lands on a negative bus bar or a
  battery post. The form has a "negative lands on at the supply end" field
  that defaults to the last negative bus bar or battery post you used, so a
  run of cables from one panel is one pick and then nothing. If none has
  been used yet, it asks.
- **Cable properties.** Gauge, length, zone, route and cable label are on
  the cable, one gauge per cable. A cable with a thinner conductor is
  documented by splitting it or in a note. Colour is per conductor.
- **Ports.** A port is only a name for a group of a converter's terminals
  (for example DC in, AC out), not a second thing to create. You enter
  terminals; each port is one side of the converter.
- **Battery banks.** No bank record. Batteries are devices, and
  battery-to-battery cables join them into a bank, which is derived the same
  way circuits are.
- **AC and DC.** The load check stays watts divided by volts. A circuit is AC
  when it is fed by line and neutral conductors, otherwise DC, and consumers
  get an optional power factor that is applied on AC circuits when set
  (left blank it counts as 1). The field is only shown on a consumer once
  its circuit is AC, so DC devices never see it.
- **CSV import.** Imports devices and cables: map columns to From device, To
  device, conductor, gauge, length and so on. Devices are matched by name
  (case-insensitive) and created when missing, and circuits follow. The old
  circuit column can name the derived circuits.
- **Voltage.** A circuit takes the voltage of the supply end it is fed from:
  batteries and sources get a nominal voltage, and terminals and converter
  ports declare theirs. It can be overridden on the circuit record.
- **Circuit data.** A circuit record still exists, but is never created by
  hand. It is keyed to the fuse or breaker that protects the branch,
  created and updated automatically as wire runs change, and can be given a
  name and notes. Rating and voltage come from the protecting device and the
  source. History and removed-but-kept work as they do now.
- **Wire run ends.** Both ends are devices. A splice or junction is a device
  (role Distribution, type Splice), so it can be drawn, placed on a plan and
  given a zone. Free-text From and To go away, and a missing device is
  created on the spot from the wire run form.
- **Creating wiring.** A wire run form with device pickers first (each with
  "New device..."), with the circuit appearing automatically. A diagram
  where devices are connected by drawing wires follows, and the data model
  must support both.
- **Existing data.** The live server has no circuits or wire runs, so
  migration only needs to be safe, not clever.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §1.3 (Circuit, Wire run terms), §2 (domain rules: "a circuit has
  exactly one source"), §4 (data model), §6.1 (API), §7 (UI), §12 (design
  decisions).
- ARCHITECTURE.md §2.1 to §2.4, §3 (schema and migrations).
- These change with this work.

## Approach (high level)

- **Derivation in one place.** A pure function over devices and wire runs,
  in the server (`src/circuits.js`), returning circuits with their wire runs
  (positive, and the negative runs that serve them), devices, protecting
  device, rating and voltage. A record per circuit is kept in step on every
  wire run or device write, through `store.js`, so the change log stays
  consistent. The webapp reads the result and never derives on its own.
- **Graph.** Nodes are devices (or their terminals and ports), edges are
  the conductors of live cables. Positive and line conductors form one
  graph, negative conductors another, so the same device and even the same
  cable can be in both. Devices with a trip rating split the positive graph
  into branches, and each branch is bounded by terminators and by further
  protective devices. A cable belongs to the circuit its positive conductor
  is in, and also to every circuit whose consumers return through its
  negative conductor.
- **Data model.**
  - `wire_runs`: `from_device_id` and `to_device_id` (replacing the free-text
    endpoints). Gauge, length, zone, cable label and route stay on the cable.
  - A `wire_run_conductors` table: the cable, a conductor type, an optional
    colour, and optional from and to terminals.
  - A `device_terminals` table: device, name, conductor type, optional
    voltage, optional port group (for converters).
  - Devices: a trip rating (A) on fuses and breakers, which moves
    `breakerRating` off the circuit, and a nominal voltage on batteries and
    sources.
  - `circuits`: keyed by the protecting device, or by the first wire run when
    unprotected. The free-text source, panel reference and panel device
    fields are retired in favour of what is derived.
- **UI.** The wire run form with pickers and inline new device replaces the
  circuit dialog. Circuits become a read-only overview of what the wire runs
  imply, where you name them and add notes, with the existing diagram and
  load summary reading the derived circuits. The floorplan's panel link goes
  away, since the protecting device and its position say it.

## Test Strategy

- Derivation is a pure function, so it gets golden tests built from small
  boats: battery, fuse, switch, lamp; a bus bar with two branches; two
  batteries in parallel; a solar panel through a controller to a battery; an
  inverter with two sides; a shared negative bus bar with high-side
  switching; a negative run on its own path; no negative recorded.
- Store: records created, updated and kept (not deleted) as wire runs
  change, one change-log entry per change.
- Migration: a database from the current version opens cleanly, twice.
- Manual: the wire run form with inline device creation, against a running
  server.

## Implementation Steps (draft)

- [x] Settle the open design questions.
- [x] `src/circuits.js` derivation with golden tests, no UI.
- [x] Schema and migration: wire run ends as devices, conductors and
      terminals, trip rating and nominal voltage on devices.
- [x] Keep circuit records in step with wire runs (store write path).
- [x] Cable form with device pickers, inline new device, conductors and
      optional terminals.
- [x] Circuits overview (name, notes), diagram and load summary on derived
      circuits, floorplan panel link removed.
- [ ] CSV import updated for device-based ends.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG.
- [ ] Follow-up: draw wires between devices on a diagram.

## Open questions

None. The design is settled; the next step is to turn this into the
implementation steps above and start with the derivation (step 2).
