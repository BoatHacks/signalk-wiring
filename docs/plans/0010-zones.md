# Implementation Plan: 0010 - Zones as a managed list

## Overview

Replace the free-text `zone` field on wire runs and devices with a
managed list of named zones (salon, aft cabin, engine room), chosen from a
dropdown, plus a separate free-text tags field for non-physical groupings
such as audio zones. The point is finding and filtering ("what is in the
engine room", "which wire runs are in the port lazarette"), and the form
must say what a zone is. This is a draft from a design discussion; nothing
is implemented yet.

## Decisions agreed with the user

- **Purpose.** Find and filter first. Grouping devices by zone in lists is
  wanted too and is on the to-do list (see Follow-ups). Physical access
  hints (hatch, locker, behind a panel) belong in the existing notes field,
  not in the zone.
- **Meaning.** A zone is a named area such as "salon" or "aft cabin".
  Audio-style groupings ("audio: main") overlap physical areas, so they are
  not zones.
- **Count.** One zone per device or wire run, plus free-text **tags** (a
  list) for everything else, audio zones included.
- **Plan link.** A named list now. Drawing zone polygons on plans, with the
  height range plans already have, to compute a zone from position is a
  separate later plan. Placement (plan 0009) and zone stay independent in
  this plan.
- **Record weight.** A lightweight list: a `zones` table with an id and a
  name. Parent zones (deck > salon), a kind, notes and a removed-but-kept
  status can be added later without reworking the links.
- **Migration.** On upgrade every distinct existing zone string, trimmed
  and compared case-insensitively, becomes a zone and the items are linked
  to it. CSV import does the same: an unknown zone name creates a zone.
  Zones can be renamed or merged afterwards.
- **Form.** A dropdown of existing zones with an "Add new zone..." entry
  that creates the zone on the spot, plus a hint under the field. A small
  zones manager (rename, remove) sits in the UI.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §1 (Zone term), §2 (domain rules), §4 (data model), §7 (UI),
  §10.2 (structured zones leave the deferred list), and the §11 decision
  "zones are free text in MVP".
- ARCHITECTURE.md §3 (schema and migrations; the `zone` columns were kept
  `TEXT` so this is a backfill) and §9 (future considerations).
- These sections change with this work; update them as part of it.

## Approach

**Schema.** A `zones` table (`id`, `name`, unique case-insensitively).
`wire_runs` and `devices` get a `zone_id` referencing it and a `tags`
column (JSON array of strings). The old `zone` text columns are kept for
one release as a rollback aid, then dropped. The migration follows the
existing startup migration pattern in ARCHITECTURE.md §3.

**Names and renames.** Because items link by id, renaming a zone changes it
everywhere. Removing a zone that is in use is refused until its items are
moved or cleared (a zone with no items may be deleted). Merging two zones
repoints the items of one to the other.

**API and change log.** Zone create, rename and delete go through the
existing store write path so they appear in the change log like other
edits. The wire run and device payloads keep a readable `zone` name field
in responses so exports and other consumers do not break; writes accept
either `zoneId` or a `zone` name (the name creates the zone if new, which is
also how CSV import works).

**Form and explanation.** Under the zone dropdown: "Where it is: an area
such as salon or aft cabin. Used for filtering. Put access hints in
Notes." Under tags: "Anything else you want to group by, such as an audio
zone. Free text, several allowed." The empty option reads "No zone yet",
since an absent zone stays valid.

**Filtering.** The circuit, wire run and device lists get a zone filter and
a tag filter. The existing search keeps matching zone names.

## Test Strategy

- Unit (store): zone create, case-insensitive uniqueness, rename, merge,
  delete refusal when in use, name-to-id resolution on write.
- Migration: a database with mixed-case and padded zone strings ends up
  with merged zones and correct links; running it twice changes nothing.
- Import: unknown zone name creates a zone, differing case reuses one.
- Manual: webapp click-through for inline add, the zones manager, filters
  and the hints, against a running SignalK server.

## Implementation Steps

- [x] Update SPEC.md and ARCHITECTURE.md (zone definition, data model, the
      retired deferral and decision)
- [x] Schema, migration and backfill, with tests
- [x] Store and resource provider: zones, `zoneId`, `tags`, change log
- [x] CSV import resolves zone names
- [x] Dropdown with inline add, hints, tags input
- [x] Zones manager (rename, merge, remove)
- [x] Zone and tag filters in the lists
- [x] README status update

## Follow-ups (not in this plan)

- Group devices (and wire runs) by zone in the lists and the load summary.
- Draw zone polygons on top plans with a height range and compute the zone
  of placed devices and routes from position, with manual override. A wire
  run crossing several polygons could then list the zones it passes
  through.
- Richer zone record: parent zone (deck > room), kind, notes, removed-but-
  kept status.

## Files to Create/Modify

- `SPEC.md`, `ARCHITECTURE.md`, `README.md`
- `src/schema.sql`, `src/store.js` (and the migration code)
- `public/app.js` (forms, lists, filters, zones manager), `public/import.js`
- Tests for store, migration and import
