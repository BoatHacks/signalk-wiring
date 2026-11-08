# Implementation Plan: 0017 - Live view, switching and load calibration (draft)

This is a draft from a design discussion. Nothing is implemented. The design
questions are all answered; two defaults chosen without asking are marked in
the decisions so they can be changed.

## Overview

The documentation of the wiring can be made live in two ways:

- A **live, switchable view** of the boat (the floorplan) and of the diagrams:
  see which consumers are on, click one to switch it on or off, and see the
  ones that cannot be switched remotely drawn greyed out.
- **Load calibration**: switch a device on and off (or watch it run) while a
  meter on its circuit is read, and work out realistic watts and amps for it,
  instead of relying on the nameplate rating.

The calibrated numbers feed the existing load check, so circuit sizing and
breaker checks become based on what the boat actually draws.

## Decisions agreed with the user

- **Control path lives on the in-line switch or relay.** A relay, switch or
  breaker module in the wiring gets a "switch path" (for example
  `electrical.switches.bank.0.3.state`). A consumer is remotely switchable
  when such a device sits between its supply and it. Clicking a lamp operates
  the relay that feeds it, and the app says so when a relay feeds several
  consumers. A consumer with no such device in line is drawn greyed out.
- **The plugin sends the command.** The webapp asks the plugin to switch, and
  the plugin does the SignalK PUT itself, through a route that needs a
  read-write login. It can refuse, can require a confirmation, and writes each
  switch action to a log. The same code serves the live view and calibration.
- **Safety flags.** Per device (or per switch) a "confirm before switching"
  flag and a "never remote" flag. A never-remote device is drawn greyed with a
  lock.
- **What a measured circuit is.** A circuit, or a device on it (a shunt, a
  relay channel with current, a battery), gets an optional "meter path" with a
  unit (amps or watts). A consumer is measured by the nearest meter upstream
  of it. A whole-battery meter is allowed but marked low confidence, since
  everything else on the battery adds noise.
- **Delta calibration.** Record a baseline for a few seconds, switch the
  device on, wait for it to settle, record, switch it off, record the baseline
  again, and repeat three times. The result is the average difference with its
  spread, and a warning when readings are noisy or the baseline drifted.
  Timings have sensible defaults that can be changed in the dialog.
- **Watch calibration.** The user switches the device on by hand and the app
  watches the meter for a chosen time. It produces the average watts, the
  peak watts and the duty cycle (the share of the time the device actually
  drew power), for loads that cycle such as a thermostat kettle, an induction
  hob, a microwave or a blender. It works for AC devices as well as DC.
- **Hand-switched devices.** For a switch that is not digital, the dialog
  prompts ("Turn on the kettle, then press Continue") and shows the live
  reading. It also notices a clear step in the meter and offers to continue by
  itself, so the user is not racing a timer.
- **A shared switch gives a group result.** A relay feeding two lamps measures
  their sum, so the result belongs to the switch as a group ("Cabin lights
  relay: 36 W for Lamp A and Lamp B"). The load check uses the group figure
  for the circuit, and the group can optionally be split between its
  consumers by hand afterwards. Nothing is split automatically, since that
  would present a guess as a measurement.
- **Safety defaults.** New devices of critical-looking types (bilge pump,
  refrigerator, autopilot, navigation light, windlass) start with "confirm
  before switching" turned on, matched against the device type ignoring case.
  Nothing starts as "never remote", and the flags can be changed on any
  device. Because the type is free text, a critical device can be missed, so
  the device form says what the flags do.
- **"On" threshold (default chosen, can change).** For the duty cycle a device
  counts as on when the reading is above 10 percent of the peak and clearly
  above the baseline noise. The dialog shows the threshold and lets the user
  change it before accepting the run.
- **AC readings (default chosen, can change).** Prefer a power (watts) meter.
  When only amps and a voltage are known, assume a power factor of 1 and mark
  the result as an estimate.
- **Results are kept as runs.** Each run is saved with its date, method,
  meter, average, peak, duty cycle and confidence. The device shows the latest
  accepted run beside its nameplate rating, and a run can be accepted,
  rejected or repeated. The load check uses the peak for the breaker check and
  the average for energy, and falls back to the nameplate rating where
  nothing is measured.
- **Runs execute in the plugin on the server.** The plugin subscribes to the
  meter and switch paths, runs the steps and stores the result, so a run
  continues if the tablet sleeps or the browser closes. The dialog shows live
  progress by polling.
- **One plan, floorplan and circuit diagram first.** The live view lands first
  on the floorplan and the existing circuit diagram. The schematic canvas
  (plan 0016) gets the same Live mode as a last step once it exists.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (data model), §6.1 (API), §7 (UI), the load summary, and the
  floorplan, circuit and device sections.
- ARCHITECTURE.md §2.2 (routes), §3 (schema and migrations), §6 (security).
- These change with this work.

## Approach (high level)

- **Data model.**
  - Device: `switch_path` (the SignalK state path), `confirm_switching`,
    `never_remote`, `meter_path` and `meter_unit` (amps or watts).
  - Circuit record: an optional `meter_path` and `meter_unit` too, for a meter
    that measures one derived circuit.
  - A `calibration_runs` table: device, method (delta or watch), meter, start
    and end time, parameters, the samples summary, average, peak, duty cycle,
    confidence, status (running, done, failed, cancelled), and whether it was
    accepted. Raw samples are kept short (downsampled) with the run.
  - The device's measured values are derived from its latest accepted run.
- **Switchability is derived.** A pure function over devices and cables finds,
  for each consumer, the in-line switch devices between its supply and it, and
  reports switchable, switch device, shared with N other consumers, or not
  switchable. It reuses the circuit derivation (`src/circuits.js`).
- **Switching** (`src/switching.js`): a route that takes a switch device and a
  state, checks the flags and the login, sends the PUT through the server's
  API, and returns the outcome. Each action is logged. The value format
  (number or boolean) follows what the path currently holds.
- **Calibration** (`src/calibration.js`): a run state machine over injected
  `read(path)` and `switchTo(device, state)` functions so it is testable with
  fake time. Pure functions compute the delta and the watch statistics from
  samples. One run at a time.
- **Live state in the webapp.** The browser reads switch states and meter
  values from the SignalK stream (reads need no special permission) and the
  plugin only handles commands and runs.
- **UI.**
  - A Live tool beside Select, Place device, Draw route and Connect on the
    floorplan: consumers show on or off, switchable ones toggle when clicked,
    others are greyed, never-remote ones show a lock, and live amps show where
    a meter exists.
  - The same Live mode on the circuit diagram.
  - A Calibrate load dialog on a device, with a mode choice (delta, watch), the
    prompts for hand-switched devices, the live reading, progress, and the
    result with accept, reject and repeat.
  - Device forms: switch path, safety flags, meter path.
- **Load check.** `public/loadSummary.js` uses the measured peak and average
  where a device has an accepted run, labelled as measured, and the nameplate
  rating otherwise.

## Test Strategy

- Switchability derivation: golden boats (a relay feeding one lamp, a relay
  feeding two lamps on a splice, a lamp with no switch, a never-remote lamp, a
  manual switch only).
- Delta and watch computation: synthetic sample series with known steps, noise,
  drift, a cycling load and a failed run.
- Calibration state machine with fake time and fake read and switch functions:
  happy path, cancel, a switch that does not respond, a meter that goes
  silent, a run abandoned and resumed.
- Switching route: refused for never-remote, confirmation required, login
  required, logged, value format follows the path.
- Store: new columns and the runs table, migration safe to run twice.
- Manual: mock server and headless Chromium for the live view and the dialog.
  Real switching and metering need the boat, so a click-through there is
  still needed, ideally starting with a harmless light.

## Implementation Steps (draft)

- [x] Settle the open design questions.
- [x] Schema, migration, store and resources: switch and meter fields, safety
      flags, calibration runs, with tests.
- [x] Switchability derivation and the switching route, with tests.
- [x] Calibration: pure statistics, then the run state machine, then the
      routes to start, poll, cancel, accept and reject, with tests.
- [x] Device forms: switch path, flags, meter path, measured values.
- [x] Live mode on the floorplan, then on the circuit diagram.
- [ ] Calibrate load dialog, including hand-switched prompts and step
      detection.
- [ ] Load check uses measured values.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG.
- [ ] Live mode on the schematic canvas once plan 0016 is built.

## Follow-ups (not in this plan)

- Dimmers and multi-level switches (this plan is on and off).
- Scheduling and scenes (several switches at once).
- Energy over time and history charts from the stored runs.
- Splitting a group result between its consumers automatically from their
  nameplate ratings.

## Open questions

None. The design is settled; the next step is the schema and store work.
