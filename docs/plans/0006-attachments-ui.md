# Implementation Plan: 0006 - Attachment upload/view UI

## Overview

Surface plan 0002's already-built attachment routes (upload/list/
download/delete) in the webapp: an `AttachmentList` component attached
to device detail and, per wire run, an expandable section in the wire
runs table. The backend for this has existed since plan 0002 and has
its own test coverage — this plan is UI only.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (Attachment data model), §7 (UI: "photo/file attachment
  upload and viewing per wire run or device")
- ARCHITECTURE.md §2.2 (attachment routes — admin-gated, under
  `/plugins/signalk-wiring/`), §6 (security: MIME allowlist + 15MB cap
  enforced server-side; this plan adds a client-side `accept` hint only,
  not a new validation layer)

## Design note: attachments stay behind the admin gate, unlike the diagram

Plan 0005 deliberately computed the diagram client-side specifically to
avoid the admin gate, because it was the same data the anonymous
resource API already exposes in another shape. Attachments are
different: they're not resource-API data at all, were designed as
admin-gated from plan 0002 onward (binary files, not covered by SPEC.md
§12's read-anonymity decision, which is scoped to circuits/wire runs/
devices), and there's no anonymous equivalent to fall back to. So this
plan calls the existing gated routes directly and leans on the same
401-aware error messaging pattern from plan 0004, rather than
reconsidering the gate.

## Approach

One `AttachmentList` component (list + upload + delete), parameterized
by `ownerType`/`ownerId`, reused for both devices and wire runs — same
reasoning as plan 0004's generic `Form`: one owner-agnostic component,
not two copies.

- **List**: `GET .../attachments?ownerType=&ownerId=`. Images render as
  an actual `<img src=".../attachments/:id">` thumbnail (loads fine
  logged in — same-origin `<img>` requests carry the session cookie
  automatically — and degrades to a broken-image icon when logged out,
  which is an acceptable, honest failure mode for a gated resource,
  not one this plan needs to paper over).
  Non-image files (PDF) render as a filename link opening in a new tab.
- **Upload**: a hidden `<input type="file">` behind a styled label
  (keeps the tablet-sized touch target consistent with other buttons).
  Uploads the raw `File` object as the request body with its own
  `file.type` as `Content-Type` — no `FormData`/multipart needed since
  the server route (plan 0002) reads a raw body stream, not
  multipart form fields.
- **Delete**: `DELETE .../attachments/:id` with a native `confirm()`,
  same pattern as the remove actions in plan 0004.
- **Placement**: always visible on `DeviceDetail` (it's already a full
  detail page). For wire runs, an expandable row under each wire run in
  the table — a full always-open attachments panel per row would
  overwhelm the table view, which is the primary view for scanning
  multiple wire runs at a glance.

## Test Strategy

No new server-side routes (this plan is UI-only, reusing plan 0002's
already-tested `routes.js` endpoints), so no new `node:test` coverage —
same reasoning as plans 0003-0005. Manual, in a real headless browser,
logged in: upload an image and a PDF to a device and to a wire run,
confirm the image thumbnail actually renders (not just that the upload
returned 201), open the PDF link, delete one attachment and confirm it's
gone from the list and 404s directly. Also confirm the logged-out case
shows the intended message rather than a broken/blank section.

## Implementation Steps

- [x] `public/app.js` — `AttachmentList` component (list, image/file
      rendering, upload, delete)
- [x] Wire into `DeviceDetail`
- [x] Wire into `CircuitDetail`'s wire run rows (expandable per row)
- [x] `public/style.css` — attachment thumbnail grid, upload button
- [x] Manual verification against the live server: upload/view/delete
      for both owner types, plus the logged-out case

## Implementation note: expandable wire run rows and htm's multi-root templates

Adding a second `<tr>` (the expanded attachments panel) per wire run
inside the existing `wireRuns.map(...)` meant each iteration needed to
return *two* sibling table rows, not one. Rather than lean on `htm`
returning an array from a single template with multiple top-level
elements — a pattern nothing else in this file uses, and not worth
gambling on for correctness — switched that `.map()` to `.flatMap()`
with two separate `html` calls pushed into a plain array. Explicit and
consistent with how every other list in this file is built.

## Manual Verification Results

Real uploads (a 1×1 PNG, a minimal valid PDF), not just a 201 response
checked and moved on from:

- Device: uploaded the PNG, confirmed it rendered as an actual `<img>`
  (not a broken-image placeholder — the thumbnail displayed real pixel
  data from the server, proving the download route's `Content-Type`
  and body were both correct) rather than just checking the upload
  request succeeded.
- Wire run: expanding "Attachments" on a row correctly added a second
  table row spanning all columns; uploaded the PDF, which correctly
  rendered as a filename link (not an `<img>`, since `AttachmentList`
  branches on `mimeType.startsWith('image/')`) that opens the file.
- Deleted the PDF: list correctly re-fetched to "No attachments yet.",
  same reload-after-write pattern as plan 0004.
- **Logged-out**: the attachments section — unlike everything else in
  the webapp so far — actually needs auth even to *read* the list
  (plan 0002's design, revisited and kept in this plan's design note).
  Confirmed it shows the same `apiErrorMessage()` 401 text as a failed
  write, not a crash or a silently empty list pretending there's
  nothing to see.

## Files to Create/Modify

- `public/app.js`, `public/style.css` (no server-side changes)
