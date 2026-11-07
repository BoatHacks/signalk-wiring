# Implementation Plan: 0015 - Conduits (draft)

This is a draft. Nothing is implemented. It goes before the schema work of
plan 0014 (cables with conductors): a cable is a wire run, 0014 keeps the
wire run records and their ids, and conduits only need an id to refer to.

## Overview

Cables on a boat often share a physical path: a conduit, hose, loom,
trunking or cable tray. Recording that makes fault tracing easier ("which
cables are in the conduit behind the galley panel?") and lets the floorplan
show one drawn route that many cables follow, instead of redrawing it per
cable.

## Decisions agreed with the user

- **A separate plan, done first.** Conduits are not part of plan 0014, and
  they do not change how circuits are derived. They are smaller and reuse
  what exists (wire run routes, floorplan drawing, zones, attachments, the
  change log), so they go before the 0014 schema step.
- **Assignment lives on the conduit.** Cables are added to a conduit from the
  conduit's own detail page, not from a picker on the wire run form, because
  plan 0014 replaces that form and a picker there would be built twice. The
  new cable form can link to it later. Circuits come from the electrical
  connections; a conduit is a layer on top that says where cables run.
- **A conduit is a small record.** It has a name, a type, a size, an optional
  route on the floorplan, and cables are assigned to it. It is not just a
  label on the cable, because a conduit is a physical thing with its own
  route that several cables share.
- **A cable lists the conduits it passes through, in order.** A cable can
  pass through several conduits on its way, so it holds an ordered list, and
  follows each conduit for its whole length. A cable that is only partly in
  a conduit is described by splitting it at a splice or junction box, or by a
  note.
- **Kinds.** A dropdown with suggestions (conduit, hose, loom, trunking, cable
  tray), then kinds already used, and an "Add kind" entry, like the device
  Type field. The kind is free text underneath.
- **Ends.** A conduit is a route with an optional zone. Its ends are the
  first and last route points; there is no separate start and end record.
- **Size.** An optional inner diameter with a unit, as a note. Fill
  estimates are a good idea for later and are a follow-up (they need a
  diameter on every cable).
- **Derating.** Out of scope for now. A later check could read the number of
  cables in a conduit.
- **Unrouted cables.** A cable with no route and no conduit shows nothing on
  the floorplan. A small list says how many cables are unrouted and lets you
  pick one to draw. No made-up lines between devices.

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
  below about whole or part of the length is settled. It uses the existing
  wire run length and route, and is revisited when 0014 lands.
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

- [x] Settle the open design questions.
- [ ] Schema and migration: conduits, cable assignments, conduit route.
- [ ] Store and resource provider: conduits, assignments, change log.
- [ ] Conduits tab with cable assignment on the conduit's detail page.
- [ ] Floorplan: draw a conduit route and show cables along it.
- [ ] Effective route and length of a cable from its conduits.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG.
- [ ] CSV import: a conduit column on cables.

## Follow-ups (not in this plan)

- Fill estimates: a diameter on every cable, and a warning when a conduit is
  too full.
- Derating for bundled cables.
- A link from the new cable form (plan 0014) to the conduit tab.
- Partly-in-a-conduit cables, if splitting at junctions proves awkward.

## Open questions

None. The design is settled; the next step is the schema and migration.
