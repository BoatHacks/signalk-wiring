# Implementation Plan: 0007 - Change log view

## Overview

Surface plan 0002's `GET .../changelog/:kind/:id` endpoint in the
webapp: a collapsible history section on `CircuitDetail` and
`DeviceDetail`, and a per-row toggle for wire runs (same expandable-row
pattern as plan 0006's attachments). This is the last item from SPEC.md
§10.1's MVP feature list.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §3.2 (what gets logged: creation, field-level diffs on
  update, `removed` transitions), §7 ("a change log view per record")
- ARCHITECTURE.md §2.2 (the changelog route — admin-gated, same
  `/plugins/signalk-wiring/` prefix as attachments)

## Approach

Same admin-gated pattern as plan 0006's `AttachmentList` — one
`ChangeLog` component parameterized by `kind`/`id`, reused for all three
record types, with the same `apiErrorMessage()` 401 handling.

**Diff field names need prettifying.** `store.js`'s diff entries are
keyed by the SQL column names (`panel_ref`, `gauge_unit`,
`from_endpoint`, …), not the camelCase the rest of the UI uses (that
conversion — `resources.js`'s `rowToResource` — only runs on the
change-log row's own top-level fields, not the JSON blob inside
`diff`). A small `prettifyFieldName` (underscores → spaces, capitalize)
covers this without needing to duplicate `resources.js`'s camelCase
mapping just for display.

**Creation entries look different from update/remove entries.**
`store.create()` logs `{ after: <full row> }` — one key, not a
per-field `{before, after}` pair — while updates/removes log one
`{before, after}` pair per changed column (`store.js`'s `update()`).
Rendering both through the same per-field diff loop would either crash
(iterating `entry.diff.after`'s *own* keys as if they were column
names with `{before,after}` shapes, which they aren't) or print
nonsense. Creation entries just show "created", no diff detail — the
diff *is* "everything is new," which isn't informative to enumerate.

**Most recent first.** `store.js`'s `changeLog()` returns ascending by
timestamp (natural for the DB layer); the UI reverses it, since reading
newest-first is the convention for anything called a "log" or
"history."

## Test Strategy

Same reasoning as plans 0003-0006: no new server-side code, so no new
`node:test` coverage. Manual, in a real headless browser, logged in:
create a record (creation entry, no diff shown), edit it twice (two
update entries, each with the correct changed field(s) and before/after
values), remove it (a `removed`-summary entry with the status
transition), confirm ordering is newest-first, and confirm the
logged-out 401 case.

## Implementation Steps

- [x] `public/app.js` — `ChangeLog` component (fetch, loading/error,
      newest-first render, creation-vs-diff branching,
      `prettifyFieldName`, timestamp formatting)
- [x] Collapsible "History" section on `CircuitDetail`
- [x] Collapsible "History" section on `DeviceDetail`
- [x] Per-row "History" toggle on wire runs, same expandable-row
      pattern as plan 0006's attachments toggle
- [x] `public/style.css` — change log list styling
- [x] Manual verification against the live server

## Manual Verification Results

Seeded directly through the store (create → 2 updates, for a circuit;
create → 1 update touching `from_endpoint`/`gauge`/`gauge_unit`, for a
wire run) rather than clicking through forms repeatedly — faster, and
lets the diff content be checked precisely rather than approximately
remembered from UI actions.

- **Ordering**: extracted the rendered `.changelog-summary` text and
  confirmed `[updated, updated, created]` programmatically, not just by
  eyeballing the screenshot.
- **Diff content**: circuit history showed `Name` and `Notes` correctly
  for the rename+notes update, `Source` correctly for the rate-change
  update, with real before/after values — not just that some diff
  object existed.
- **Underscore field prettifying**: the circuit's own changed fields
  (`name`, `source`, `notes`) don't have underscores, so a second check
  was needed — the wire run case (`from_endpoint`, `gauge_unit`)
  rendered as "From endpoint" / "Gauge unit", confirming
  `prettifyFieldName` actually does something rather than being
  untested dead code for the only fields the first check happened to
  cover.
- **Creation entries**: rendered as "Created" with no diff list below,
  as designed — confirmed visually, not just that it didn't throw.
- **Logged-out**: same `apiErrorMessage()` 401 text as plans 0004/0006,
  confirmed for the changelog route specifically (it's a separate route
  from attachments, sharing only the `/plugins/*` prefix, not code that
  guarantees the same behavior without checking).

## Files to Create/Modify

- `public/app.js`, `public/style.css` (no server-side changes)
