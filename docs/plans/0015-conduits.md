# Implementation Plan: 0015 - Conduits

It goes before the schema work of
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

## Implementation Steps

- [x] Settle the open design questions.
- [x] Schema and migration: conduits, cable assignments, conduit route.
- [x] Store and resource provider: conduits, assignments, change log.
- [x] Conduits tab with cable assignment on the conduit's detail page.
- [x] Floorplan: draw a conduit route and show cables along it.
- [x] Effective route and length of a cable from its conduits.
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG.
- [x] CSV import: a conduit column on cables.

## Follow-ups (not in this plan)

- Fill estimates: a diameter on every cable, and a warning when a conduit is
  too full.
- Derating for bundled cables.
- A link from the new cable form (plan 0014) to the conduit tab.
- Partly-in-a-conduit cables, if splitting at junctions proves awkward.

## Open questions

None.

## Decisions made during implementation

Where the plan left a detail open:

- **Order lives on the cable.** The join table `wire_run_conduits` has a
  `position` per cable (0, 1, 2 ...), the order the cable passes through its
  conduits. A conduit lists its cables in the order they were added; that
  order carries no meaning. The conduit page can move a conduit earlier or
  later in a cable's own list.
- **Assignments ride on the resources.** A conduit resource has `cableIds`
  and a wire run resource has `conduitIds`. A write carrying one replaces
  that side's assignments; a write without it leaves them alone. The
  floorplan strips both before writing a whole record back, so a stale list
  cannot overwrite what the conduit page saved.
- **Change log.** `assignCable` and `unassignCable` log one entry on the
  conduit ("cable assigned", "cable unassigned"). `setCableConduits` (used
  to reorder or replace the list from the cable's side) logs one entry on
  the wire run ("conduits changed"). No entry is written when nothing
  changes. Assignments have no status; removing a conduit or a cable keeps
  them, and the UI and route functions skip removed ones.
- **Size.** `innerDiameter` plus `diameterUnit` (mm or in), both optional.
  No tags on conduits, only a zone.
- **Kinds** are stored as the displayed text (Conduit, Hose, Loom, Trunking,
  Cable tray, or anything added), trimmed. The "other" kind in the plan is
  just any added kind.
- **Zones** count conduits too (usage, rename sync, merge, delete refusal).
- **Attachments** accept the owner type `conduit`, and the change log accepts
  the kind `conduit`.
- **Floorplan.** A conduit is drawn as a thick pale line under the cables.
  The Draw route tool has a Conduit selector next to the Wire run selector;
  choosing one clears the other. Selecting a conduit highlights its cables
  and their devices like selecting a circuit does (a selected circuit wins).
- **Unrouted cables** are live cables with no route points of their own and
  no live conduit that has a route. The floorplan lists them in a collapsed
  section with a Draw button for each.
- **Effective route.** A cable with its own waypoints keeps its own route
  (derived start plus waypoints), whatever conduits it is in, and its length
  is that route's. With no waypoints, it follows its live conduits that have
  at least two points, each for its whole length, in the cable's order.
  Each conduit is turned to meet the end of the one before; the first is
  turned toward the cable's start device if that is placed, else toward the
  second conduit; a single conduit with no placed start device is used as
  drawn. Where two conduits do not meet, a straight link joins them and its
  length counts. The device start itself is not added in front, since that
  would be a made-up line. Skipped conduits (removed, or fewer than two
  points) make the result incomplete, as do unset heights. A cable partly in
  a conduit is therefore still the follow-up in the plan: give it a route of
  its own, or split it at a junction.
- **CSV import.** A new mapping target, "Wire run: conduit", takes one or
  more conduit names per row, separated by `;` or `>` (not a comma, which
  can be part of a name). Names are matched ignoring case to live conduits
  already recorded, which are reused (unlike devices, which are only matched
  within a batch: reusing a conduit by name is safe and importing cables
  into conduits entered by hand is the point). Removed conduits are not
  reused. Others are created with only a name; the kind and size are set
  afterwards. Conduits are written before the wire runs so each wire run is
  written with its `conduitIds`, in the order named. The preview says how
  many conduits will be created and reused.
- **Drawing a cable that follows conduits** shows no waypoint markers; the
  points belong to the conduits. Clicking a waypoint for such a cable starts
  a route of its own and then it keeps that route.

