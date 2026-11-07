# Implementation Plan: 0011 - Device roles

## Overview

Tell the things that use power apart from the things that supply, store,
route or convert it. A device gets a role; the specific kind stays in the
existing free-text type.

## Decisions agreed with the user

- **Model.** A role on every device, not separate record types. One list,
  one form, and circuits, routes, positions and the floorplan keep working.
- **Roles.** Consumer (the default), source (solar, shore power, generator,
  hydro, wind, alternator), storage (batteries), distribution (switches,
  breakers, fuses, bus bars, panels, isolators, relays) and converter
  (inverters, chargers, DC-DC). Distribution covers switches, which were
  raised as a gap; converters are neither a plain source nor a plain
  consumer.
- **Subtype.** Not a new column. The free-text type says "solar" or "AGM".

## Approach

- `devices.role` (`TEXT NOT NULL DEFAULT 'consumer'`), added by migration 4,
  validated in `src/store.js` on every write; clearing it resets to the
  default.
- Webapp: a Role dropdown with a hint, role shown in the device list and
  details, a role filter on the device list, a colour per role on floorplan
  markers.
- The panel load summary counts only consumers, since a source, battery,
  switch or inverter on a circuit adds no load of its own. A device with no
  role counts as a consumer.

## Test Strategy

- Store: default, validation, clearing, one change-log entry per change.
- Migration: existing devices become consumers; running it twice is safe.
- Resources: role round-trips.
- Load summary: only consumers counted; no role counts as consumer.
- Manual: the form, list, filter and markers, in the webapp.

## Implementation Steps

- [x] Schema, migration, store validation, tests
- [x] Webapp: form, list, filter, markers
- [x] Load summary counts consumers only
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG

## Follow-ups (not in this plan)

- Battery capacity and nominal voltage, and source output rating, as
  structured fields.
- CSV import of a role column.
- A role-aware overview of sources, storage and the circuits they feed.
