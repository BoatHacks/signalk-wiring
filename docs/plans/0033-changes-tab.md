# Implementation Plan: 0033 - Changes tab

Tracks GitHub issue #13.

## Overview

A new "Changes" tab shows what changed lately across the whole system, grouped
by record, newest activity first, with filters. Today the change log can only
be read one record at a time.

## Decisions agreed with the user

- **A new "Changes" tab** beside Circuits, Cables and Devices.
- **Grouped by record.** Each group is one device, cable, conduit, zone, plan,
  circuit or schematic, with its entries listed under it. Groups are ordered by
  their most recent change, newest first.
- **Readable entries.** Each entry says what changed in words ("gauge: 6 to
  10 mm2"), with the time, instead of raw before and after values. The group
  header links to the record.
- **Permanent deletion leaves a one-line entry.** When a removed record is
  purged, its history is still erased as today, but one short entry stays in the
  log naming the record and the date, so the Changes tab can show what
  disappeared.

## Approach

### 1. Server (`src/store.js`, `src/routes.js`)

- On every purge path that now deletes a record's `change_log` rows (cables at
  `store.js` line 1734, the generic purge at line 1754), first read the
  record's display name, then delete the history and insert one entry
  (`summary` "permanently deleted", `diff_json` with the name and the kind).
  Tested for each kind that can be purged.
- A new read route `GET /changelog` across kinds with `kind`, `since`, `until`,
  `q` (text over names and summaries), `limit` and a cursor, served the same
  way as the existing per-record route so the webapp can read it with its
  login. It returns groups: the record's kind, id, current name or label
  (looked up now), status (active, removed, purged), the time of its latest
  entry, and its entries (newest first, capped per group with a count of the
  rest). Paging is by group, using the latest entry's time and id as the
  cursor.
- Automatic circuit bookkeeping (circuits derived from cables) is left out of
  the default result and returned only when the `circuit` kind is asked for, so
  the log shows what the user did.

### 2. Webapp (`public/changes.js`, `public/app.js`)

- Pure `describeEntry(kind, entry)` turns a stored diff into words: a label per
  field and kind (name, type, gauge, length, zone, terminals added and removed,
  status changes "removed" and "restored", created), value formatting for
  units, lists and empty values, and a plain fallback ("field changed") for
  fields it does not know. Unit tests for each kind.
- The Changes tab: filters for date range (today, 7 days, 30 days, custom), kind
  (several), and text; the groups as cards (device groups show the icon and name
  through the shared device label); a link to the record, or "permanently
  deleted" with no link; "Show more" for more entries in a group and for the
  next page of groups. Light and night themes, phone width works.

## Defaults, reviewed with the user

- The default date range is the last 30 days, a group shows its latest 5
  entries with "Show N more", and circuit entries are hidden unless the circuit
  kind is selected (confirmed).
- The time is shown in the browser's local time (the app's existing rule).
- The release version is chosen by the user.

## Test Strategy

- Store tests for the tombstone on every purge path, the cross-kind read,
  filters, paging cursor and the circuit exclusion.
- Pure tests for `describeEntry` and the group ordering.
- Headless Chromium on the mock server: the tab, filters, grouping, links, the
  deleted entry, show more, day and night.

## Implementation Steps

- [x] The tombstone entry on purge, with tests.
- [x] The `GET /changelog` route and the group query, with tests.
- [x] `describeEntry` and the Changes tab.
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, tick the boxes in issue #13.

## Files to Create/Modify

- `src/store.js`, `src/routes.js`, new `public/changes.js`, `public/app.js`,
  `public/style.css`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Showing the history of one record from its own page with the same wording.
- Positions and layout changes on schematics and plans (not logged today).
- Export of the log.

## Open questions

None. The decisions and the reviewed defaults are above.
