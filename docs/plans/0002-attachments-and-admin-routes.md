# Implementation Plan: 0002 - Attachments and admin routes

## Overview

Add the second API surface from ARCHITECTURE.md §2.2: admin-gated routes
(`registerWithRouter`) for photo/file attachment upload, download, and
deletion; a per-circuit diagram-data endpoint; and a change-log read
endpoint. This is the last backend slice before the webapp (plan 0003+),
which will consume both this and plan 0001's resource provider.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (Data Model — Attachment), §6.1 (attachments/diagram/
  changelog served under `/plugins/signalk-wiring/...`), §7 (UI:
  attachment upload/view, diagram view, change log view)
- ARCHITECTURE.md §2.2 (Admin routes), §3 (`attachments` table), §6
  (Security: MIME/size validation, UUID-derived filenames, no path
  traversal)

## Approach

`plugin.registerWithRouter(router)` is called once at server boot for
every installed plugin regardless of its enabled state (per the
`signalk-plugin` skill), while `store` only exists between `start()` and
`stop()`. So route handlers read the store through a getter closure
rather than capturing it directly, and return 503 if the plugin isn't
currently enabled — otherwise a route registered at boot would crash on
a `null` store after a user disables the plugin without restarting.

Attachments don't fit the circuit/wireRun/device generic CRUD in
`store.js` (no `status` column, not part of the removed-but-kept
lifecycle — SPEC.md §3.1 is explicit that rule is about wiring records,
not their photos), so they get their own small set of store methods
instead of being forced through the existing `TABLES`-driven CRUD.

File upload is handled as a raw request-body stream (no `multer`/no new
runtime dependency, per the `signalk-plugin` skill's "avoid an express
runtime dependency" guidance) — the client PUTs/POSTs the raw file bytes
with `Content-Type` set to the file's MIME type and `ownerType`/
`ownerId`/`filename` as query params. Stored on disk under
`<pluginDataDir>/attachments/<attachment-id><ext>` — the id (a UUID) is
the filename, never the client-supplied name, per ARCHITECTURE.md §6.

## Test Strategy

- Unit test the new `store.js` attachment methods directly (create,
  list-by-owner, get, delete), same pattern as plan 0001.
- Unit test `routes.js` handlers against a fake router (records
  registered handlers) and fake req/res objects — a fake req is an
  `EventEmitter` with `.emit('data', chunk)` / `.emit('end')` for the
  upload path, so no real HTTP server or SignalK `app` is needed.
- Manual: re-run against the live `signalk-server` container the same
  way as plan 0001 — upload a real photo, confirm it's retrievable and
  survives a restart, and confirm the plugin's routes 503 (not crash)
  when disabled after having been started.

## Implementation Steps

- [x] `src/store.js` — add `createAttachment`, `listAttachmentsByOwner`,
      `getAttachment`, `deleteAttachment` (hard delete: attachments are
      not part of the removed-but-kept lifecycle)
- [x] `src/routes.js` — `registerRoutes(router, getStore, dataDir)`:
      - `POST /attachments?ownerType=&ownerId=&filename=` (raw body,
        MIME allowlist, size cap)
      - `GET /attachments?ownerType=&ownerId=` (list)
      - `GET /attachments/:id` (download, correct `Content-Type` +
        `Content-Disposition`)
      - `DELETE /attachments/:id` (removes row + file)
      - `GET /circuits/:id/diagram` (nodes/edges shaped for the future
        `dagre`-based renderer, per ARCHITECTURE.md §4)
      - `GET /changelog/:kind/:id` (`kind` one of circuit/wireRun/device)
- [x] `index.js` — wire up `plugin.registerWithRouter`, resolve
      `dataDir` once at plugin load, pass a `() => store` getter (not
      the value directly) since `registerWithRouter` runs once at boot
      for every installed plugin regardless of enabled state
- [x] `test/store.test.js` additions, `test/routes.test.js` (13 new
      tests: upload/list/download/delete, oversized/disallowed-type
      rejection, diagram nodes+edges, changelog, and the 503-when-
      disabled path — 25 total across the plugin now)
- [x] Manual verification against the live `signalk-server`:
      - Loaded via a mock `app`/router: routes register correctly
        *before* `start()` runs (confirms the getter pattern), resource
        providers register on `start()`.
      - Live HTTP: confirmed the new `/plugins/signalk-wiring/...`
        routes are admin-gated (401 unauthenticated), same as any other
        plugin route, while `/signalk/v2/api/resources/wiringCircuits`
        stays anonymous — matches the SPEC.md §12/ARCHITECTURE.md §6
        security design. Couldn't exercise the write paths over real
        HTTP without admin credentials, which weren't available/
        appropriate to obtain here — the write-path logic itself is
        covered by `routes.test.js` instead.
      - 3 more full live-server restart cycles with the plugin enabled
        (routes registered) — clean each time, matching plan 0001's
        `better-sqlite3@13.x` fix holding under the same conditions.
      - Left the plugin disabled and the DB empty afterward, same as
        after plan 0001.

## Files to Create/Modify

- `src/store.js` (add attachment methods)
- `src/routes.js` (new)
- `index.js` (register routes)
- `test/store.test.js` (add attachment cases), `test/routes.test.js` (new)
