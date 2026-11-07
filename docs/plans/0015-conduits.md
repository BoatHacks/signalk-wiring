# Implementation Plan: 0015 - Conduits (draft)

This is a draft. Nothing is implemented. It builds on plan 0014 (cables with
conductors), so it starts after that plan's schema work.

## Overview

Cables on a boat often share a physical path: a conduit, hose, loom,
trunking or cable tray. Recording that makes fault tracing easier ("which
cables are in the conduit behind the galley panel?") and lets the floorplan
show one drawn route that many cables follow, instead of redrawing it per
cable.

## Decisions agreed with the user

- **A separate plan.** Conduits are not part of plan 0014, and they do not
  change how circuits are derived. Circuits come from the electrical
  connections; a conduit is a layer on top that says where cables run.
- **A conduit is a small record.** It has a name, a type, a size, an optional
  route on the floorplan, and cables are assigned to it. It is not just a
  label on the cable, because a conduit is a physical thing with its own
  route that several cables share.
- **A cable lists the conduits it passes through, in order.** A cable can
  pass through several conduits on its way, so it holds an ordered list.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (data model), §6.1 (API), §7 (UI), and the floorplan view.
- ARCHITECTURE.md §3 (schema and migrations).
- These change with this work.

## Approach (high level)

- **Data model.**
  - A `conduits` table: id, name, kind (conduit, hose, loom, trunking,
    cable tray, other), optional inner diameter or size, zone, notes,
    status (removed-but-kept like other records), and an optional route
    (waypoints in meters, the same shape a cable route uses).
  - A join table between cables and conduits: cable, conduit, and an
    order number, so a cable can pass through several in sequence.
  - Attachments (photos, drawings) work on conduits like on devices.
- **Floorplan.** A conduit's route is drawn and edited like a cable route,
  and cables assigned to it show along it. A cable with its own route keeps
  it; a cable with none can follow its conduits, so drawing the conduit
  draws the cable.
- **Cable length.** A cable's measured length could come from its own route
  plus the lengths of the conduits it passes through, once the question
  below about whole or part of the length is settled.
- **UI.** A Conduits tab to list, create and edit them, a conduit picker on
  the cable form, zone and kind filters, and a list of the cables in a
  conduit on its detail page.
- **Change log.** Conduits and their cable assignments go through the store
  write path so history stays consistent.

## Test Strategy

- Store: create, update and remove a conduit, assign and reorder cables,
  one change-log entry per change, migration safe to run twice.
- Pure functions: a cable's effective route from its own waypoints and its
  conduits, and the total length, with golden cases (cable wholly in one
  conduit, in two in sequence, partly in a conduit, in none).
- Manual: assigning cables and drawing a conduit on a plan, against a
  running server.

## Implementation Steps (draft)

- [ ] Settle the open questions below and update this plan.
- [ ] Schema and migration: conduits, cable assignments, conduit route.
- [ ] Store and resource provider: conduits, assignments, change log.
- [ ] Conduits tab and the conduit picker on the cable form.
- [ ] Floorplan: draw a conduit route and show cables along it.
- [ ] Effective route and length of a cable from its conduits.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG.
- [ ] CSV import: a conduit column on cables.

## Open questions

- **Whole or part of the cable.** Does a cable follow a conduit for its whole
  length or only part of it? That decides whether a cable simply lists its
  conduits (whole length) or each assignment also records where along the
  cable it starts and ends.
- **Size and fill.** Is the conduit size just a note, or should the app
  estimate fill (the cable diameters against the inner diameter) and warn
  when a conduit is full? Fill needs a cable diameter, which the model does
  not hold yet.
- **Bundling and derating.** Cables bundled together carry less current. Is
  that out of scope, or something later checks should read from the
  conduit?
- **Kinds.** A fixed list of kinds, or free text with suggestions like the
  device type?
- **Conduit ends.** Does a conduit connect two places (a start and an end
  zone, or a device such as a junction box), or is it only a route with a
  zone?
- **Unrouted cables.** What should a cable with no route and no conduit show
  on the floorplan?
