# Implementation Plan: 0020 - Batteries

Tracks GitHub issue #6.

## Overview

Batteries are central to a boat's wiring, but the app stores almost nothing
about them: a type name (with chemistry and purpose mixed into one flat list)
and a nominal voltage. Banks are only derived from cables between batteries,
with no series or parallel information and no UI. This plan gives batteries
real details, makes banks computed and visible, and shows live values from
their monitors.

## Decisions agreed with the user

- **Bank model: a link type on the cable.** Each battery stays one device. A
  cable between two batteries gets a link type, parallel (the default) or
  series, chosen when it is drawn. The bank is still derived from those cables,
  and now has a computed voltage, layout and capacity. No new record type.
  Reducing a network is limited to series strings joined in parallel; anything
  else gets a warning.
- **Chemistry fills defaults.** A chemistry field (flooded, AGM, gel, LiFePO4,
  other lithium, other) suggests a nominal voltage per 12 V battery (12 V for
  the lead-acid kinds, 12.8 V for LiFePO4) and a usable fraction of the
  capacity (50% for the lead-acid kinds, 80% for the lithium kinds), both
  editable on the device. A bank shows both total and usable amp-hours. The
  existing chemistry type names fill the field for existing batteries.
- **Monitoring: a link, paths and live values.** A battery gets an optional
  "Monitored by" link to a shunt or battery monitor device and four optional
  SignalK path fields (voltage, current, state of charge, time remaining). With
  Live mode on, a battery shows its voltage, state of charge and time remaining
  on the Batteries tab, the circuit diagram, the schematic and its page, reusing
  the live stream that already exists. A shunt's own SignalK path keeps working as its meter.
- **Runtime: the monitor's own value, nothing computed.** The time remaining
  comes from SignalK, `electrical.batteries.<id>.capacity.timeRemaining`
  (seconds), and is shown when Live mode is on and the monitor reports one.
  Nothing is computed from the capacity and the loads in this plan: a bank with
  no monitor, or a monitor that reports no value, shows no runtime. Checked
  against the live server on 2026-11-08: the Venus battery and the N2K monitors
  publish the path, with a null value while current is about zero (nothing is
  discharging), so the null case is normal and handled. The SignalK
  specification gives `timeRemaining` in seconds and `current` as positive when
  it flows out of the battery (discharging) and negative when charging.
- **Extra details.** Make and model (free text) and install date (shown as an
  age, recorded only). Not chosen: a BMS note, and series and parallel counts
  on a single device.
- **A Batteries tab.** One card per bank: its batteries, the layout (for
  example 2S2P), total and usable amp-hours, voltage and energy, the monitor, the
  protection derived from the circuits it feeds, and live voltage and state of
  charge when Live is on. A battery that is not linked to others is a bank of
  one. A card links to the battery device.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (device fields, cables, banks), §7 (UI), the live view section.
- ARCHITECTURE.md §3 (schema and migrations), the circuits and live sections.

## Approach

### Data

- Migration 11 adds to `devices`: `chemistry` (`flooded`, `agm`, `gel`,
  `lifepo4`, `lithium`, `other`, or null), `purpose` (`house`, `starter`,
  `thruster`, `windlass`, `motor`, `other`, or null), `capacity_ah` (REAL, amp-hours of
  this battery), `usable_fraction` (REAL, 0 to 1), `make_model` (TEXT),
  `installed_on` (TEXT, an ISO date), `monitor_device_id` (TEXT, a device),
  `voltage_path`, `current_path`, `soc_path`, `time_remaining_path` (TEXT,
  SignalK paths). It adds to
  `wire_runs`: `link` (`series`, `parallel`, or null). All guarded so the
  migration is safe to run twice.
- The store validates the values (the sets above, 0 to 1, a real device id for
  the monitor, no monitor pointing at itself) and logs changes like any field.
  `link` is only accepted on a cable whose two ends are both storage devices
  (otherwise refused with a clear message), and a cable between two storage
  devices with no link is treated as parallel, as banks have always been.
- The one-time fill in the migration sets `chemistry` and `purpose` for
  existing devices from their type names where they are still null: "Lead-acid
  battery" gives flooded, "AGM battery" agm, "LiFePO4 battery" lifepo4, "Starter
  battery" starter, "House battery" house (case-insensitive). The type text is
  not rewritten and a mark set by hand is never overridden.
- The storage type suggestions shrink to Battery and Battery bank, since
  chemistry and purpose are fields now; devices that already use the other type
  names keep them (the type dropdown keeps types in use).
- Chemistry defaults live in one table, in `src/batteries.js` (CommonJS) and
  mirrored in `public/batteries.js` (ESM), with a parity test.

### Banks (pure, `src/banks.js`)

`deriveBanks({ devices, cables })` replaces the current `buildBanks` output
(the field names `batteryIds` and `cableIds` stay, so existing readers keep
working) with:

- `batteryIds`, `cableIds`, and a `strings` list: batteries joined by series
  links form a string in order; strings are joined by parallel links.
- `layout`: `{ series, parallel }` and its label ("2S2P"), when all strings
  have the same number of batteries; otherwise `layout: null` and a warning
  "uneven strings".
- `voltage`: the sum of nominal voltages along a string (the lowest string when
  they differ, with a warning "strings differ in voltage"); `capacityAh`: the sum
  over strings of the smallest capacity in each string (a series string is only
  as big as its weakest battery); `usableAh`: capacity times the lowest usable
  fraction in the bank; `energyWh`: voltage times capacity (and usable energy).
  Missing capacity or voltage on a member gives `complete: false` and totals of
  what is known, never a made-up number.
- Warnings, each with a code and a message: uneven strings, strings that differ
  in voltage, mixed chemistries in one bank, a parallel link between batteries
  of different nominal voltage, and a network that cannot be reduced to series
  strings in parallel (a cycle or a branch), in which case the totals are left
  out.
- A battery with no links is a bank of one. A "Battery bank" device with no
  links is also a bank of one; its capacity and voltage are those of the device.
- `protectedBy`: for each bank, the protectors of the circuits whose supply is
  one of its batteries (derived from `deriveCircuits`, no stored field).

The `/derived` route and the resource layer serve the richer banks, and the
store's `deriveAll` calls `deriveBanks`.

### UI

- **Device form and page** (storage role, and the monitor fields on shunt and
  battery monitor types): Chemistry, Purpose, Capacity (Ah), Usable (%),
  Nominal voltage (already there), Make and model, Installed on, Monitored by
  (a device picker), and the four path fields (with the existing SignalK path
  search; the time remaining path is suggested from the state of charge path by
  replacing its tail `stateOfCharge` with `timeRemaining` when it has the
  standard form, and stays editable). Chemistry fills the voltage and usable defaults while those fields
  are untouched, as the type fills the Current field. The page shows the details,
  the age ("installed 3 years ago"), and the bank the battery belongs to.
- **Cables.** When both ends of a new cable are storage devices, the quick
  popover and the full form offer "Parallel link" (the default, positive and
  negative) and "Series link" (a single positive conductor), and the link type
  shows in the cables table. Editing keeps the stored link.
- **Batteries tab** (`#/batteries`, added to the router): bank cards as above,
  with the warnings of the bank under the card, an "incomplete" note naming the
  missing capacity or voltage, and links to the battery devices.
- **Live values.** `public/live.js` also subscribes to the voltage, current,
  state-of-charge and time remaining paths of storage devices (a battery with no
  path of its own uses its monitor's), and `info(id)` for a storage device gives
  a short reading such as "12.8 V, 87 %, 6 h 20 min". The Batteries tab, the
  circuit diagram, the schematic and the battery page show it when Live is on,
  with the same look as the existing readings (theme tokens, night theme).
- **Time remaining display.** `timeRemaining` is seconds, shown as hours and
  minutes ("6 h 20 min", "45 min", or days for long values). A null value is
  normal (the monitors here publish null while nothing discharges): when the
  current path is known and shows no discharge (zero or negative, since the
  specification makes outflow positive) the reading says "not discharging",
  otherwise it shows nothing. A stale value (no update for a while) is shown as
  stale, as the other live readings are. The path is never computed over: when
  there is no value there is no runtime.

### Defaults chosen without asking

These are open to change in review:

- Chemistry list: Flooded lead-acid, AGM, Gel, LiFePO4, Other lithium, Other.
  Usable fractions 0.5 for flooded, AGM and gel; 0.8 for LiFePO4 and other
  lithium; none for other.
- Nominal voltage default: 12 V for the lead-acid kinds, 12.8 V for LiFePO4,
  none for the others (it is per battery, for a 12 V unit).
- Purpose list: House, Starter, Thruster, Windlass, Motor (propulsion), Other.
- A series link is a single positive conductor; a parallel link carries
  positive and negative, as bank links have been.
- The bank's capacity is the sum of the weakest battery of each string, and the
  bank's usable fraction is the lowest in the bank.
- The monitor's paths are used for a battery that has none of its own; a bank's
  live reading takes the first battery in the bank that has a value.
- Time remaining is only the SignalK value; there is no computed estimate (the
  user chose this over a live computed or a planned estimate).
- The CSV import has no columns for the new fields in this plan.

## Test Strategy

- Pure `banks.js` golden cases: one battery; two in parallel; two in series; 2S2P
  and 4P; uneven strings; mixed voltages; a missing capacity (incomplete); mixed
  chemistries; a cycle (unreducible, totals omitted); protectors from circuits;
  the chemistry defaults table and its parity with the webapp copy.
- Store: migration 11 safe to run twice, the one-time chemistry and purpose fill
  by type name never overriding a set value, validation of every new field,
  `link` refused on a cable that is not between two storage devices, monitor
  validation, change log entries.
- Webapp in headless Chromium against a mock server: the device form defaults
  from chemistry, drawing a parallel and a series link, the Batteries tab with a
  2S2P bank, a bank with a missing capacity, and live readings with a mock
  stream on the tab, the diagram and the schematic, in the light and the night
  theme; time remaining as a value, as null while not discharging, and absent.
  The duration formatting and the "not discharging" rule are pure functions with
  unit tests (null, zero current, negative current, stale, minutes, hours, days).

## Implementation Steps

- [x] Migration 11, the new device and cable fields, validation, the one-time
      fill, the storage type suggestions, with tests.
- [x] `src/banks.js` and the richer `/derived` banks, with tests.
- [x] Device form and page fields with the chemistry defaults; the link type in
      the popover, the full cable form and the cables table.
- [x] The Batteries tab and its route.
- [x] Live values for batteries on the tab, the circuit diagram, the schematic
      and the battery page.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and a comment on issue #6.

## Files to Create/Modify

- `src/store.js`, `src/schema.sql`, `src/resources.js`, `src/routes.js` (the
  fields, migration 11, the banks in `/derived`), new `src/banks.js` and
  `src/batteries.js`.
- `public/batteries.js` (new, defaults and the tab), `public/router.js`,
  `public/deviceTypes.js`, `public/quickCable.js`, `public/cablePopover.js`,
  `public/live.js`, `public/liveMarks.js`, `public/schematicView.js`,
  `public/app.js`, `public/style.css`.
- Tests for banks, the store, the defaults parity, the router tab and the
  webapp helpers.
- `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Charge voltages per chemistry and a check against chargers.
- A computed runtime estimate (from the live state of charge and current, or a
  planned one from the usable capacity and the load summary) for banks whose
  monitor reports no time remaining. Offered and not chosen for now.
- A BMS note, and series and parallel counts on a single device record.
- CSV import columns for the battery fields.
- Standard terminals for battery posts and a BMS.

## Open questions

None. The design questions (bank model, what chemistry does, monitoring, extra
fields, where banks are shown) are settled above; the defaults list is for
review.
