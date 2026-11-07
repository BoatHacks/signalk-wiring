# Implementation Plan: 0009 - Floorplan view (top-down and side)

## Overview

Let the user upload their boat's top-down and side plans (SVG), calibrate
them to real-world units, pin devices on them and draw wire run routes
over them. Devices get one 3D position (x/y/z in meters) that shows in
both views, and a drawn route gives a measured cable length. This turns
"where is it and how does it run" from free-text zones into something
you can see, which is the point of documenting the wiring for the next
person.

Decided with the user: draw devices and wire routes (not zones); one 3D
position shown as two projections; plans arrive as SVG or CAD exports;
the boat has several deck plans; the drawing needs at least
authenticated read access (not necessarily admin); route editing is
click to add and drag to adjust.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §2 (zones stay free text), §3 (removed-but-kept lifecycle),
  §4 (data model), §6.1 (API), §7 (UI), §10.2 (this moves out of any
  deferred scope).
- ARCHITECTURE.md §2.1 (resource provider), §2.2 (admin routes), §3
  (schema and migrations), §4 (client-side SVG rendering, no new
  dependencies), §6 (security, relevant to uploading SVG).
- These sections change with this work; update them as part of it.

## Approach

**Coordinates.** The boat has one coordinate system in meters: `x` along
the boat, `y` athwartships (0 on the centerline), `z` height (0 at a
user-chosen reference such as the waterline). The top view shows x/y, the
side view shows x/z. Both views must use the same x origin (the UI
suggests "the transom centerline"). A click in a view sets the two axes
that view shows and leaves the third alone, so moving a device in the
side view also moves its x in the top view. Any axis may be unset, so a
device can be half-placed and finished in the other view.

**Plans.** A `plans` table holds one row per uploaded drawing: `id`,
`name`, `view` (`top` | `side`), the stored SVG filename, `calibration`
(see below), `status`. Several plans per view are allowed. A top-view plan
carries an optional height range (`z_min`, `z_max`, meters), and shows
only devices and route segments inside it, so each deck plan shows its own
deck. A plan with no range shows everything. The side view needs no
range.

**Calibration.** SVG user units have no real-world meaning, so each plan
is calibrated once: click an origin, click a second point on an axis,
enter the real distance. This stores `originPx`, `pxPerMeter` and the
axis orientation. Uniform scale and axis-aligned plans are assumed; a
warped drawing is not corrected.

**SVG handling.** The SVG is never inlined into the page. The overlay
draws it as an `<image>` element, where scripts do not run. The file is
stored under the data directory by id (never by the client's filename),
capped at 15MB like attachments, and served with
`Content-Type: image/svg+xml`, `X-Content-Type-Options: nosniff` and a
restrictive `Content-Security-Policy` in case someone opens the URL
directly. The size of the drawing comes from the `viewBox` read on the
client.

**Raster drawings.** Plans may also be PNG, JPEG or WebP (a scan or a
photo of a drawing, for example the boat's side profile). The upload
route checks the file's own bytes against its declared type, stores it as
`<id>.<ext>`, and replaces the old file when the format changes. The
viewer reads a raster's pixel size from the decoded image. The routes are
`POST` and `GET /plans/:id/image`.

**CAD files.** DXF and DWG cannot be shown in a browser without a
converter library. v1 accepts SVG and raster images only and the UI says
to export SVG from the CAD tool (Inkscape, LibreCAD and QCAD all can). Direct DXF
import is a possible later step.

**Routes.** A wire run gets an optional `route` (JSON array of
`{x, y, z}` waypoints in meters). A route starts at the position of
its from-endpoint when that is a device, otherwise at the circuit's
panel (see below), otherwise at the first waypoint clicked. A waypoint
clicked in one view takes the other axis from the previous waypoint (or
from the start position for the first one) and can be dragged in the other
view to correct it. The measured length is the 3D polyline length. It is
shown next to the run's `length` as a suggestion with a "use this"
button; it never overwrites the stored length by itself.

**Panels.** A fuse or breaker label such as "F12" is text with no
position. Rather than a new record type, a panel (or battery, bus bar)
is an ordinary device with a position, and a circuit gets an optional
`panelDeviceId` pointing at it. Pin the panel once and every run on its
circuits starts from there, so measured lengths are complete. Circuits
without one fall back to the first clicked waypoint. The existing
`panelRef` text field stays as it is.

**Storage and access.** Positions are columns on `devices`
(`pos_x`, `pos_y`, `pos_z`); the route is a column on `wire_runs`; the
panel link is a column on `circuits` (`panel_device_id`). Both
change through `store.js`, so edits land in the change log as usual (a
route edit logs one `route` diff, not one entry per point). Plan metadata
is served like the other resources (`wiringPlans`). The SVG file needs
at least authenticated read access, not admin. Plugin routes registered
with `registerWithRouter` are admin-only on this server (a read-only or
read-write user gets 401), so step 1 starts with a spike to find how to
serve the file to any logged-in user, for example through the
server's own security middleware on a route registered outside the
plugin router. Writes (upload, calibrate) stay admin-only. If no clean
way exists, fall back to admin-only reads and say so.

**Rendering.** Hand-rolled SVG with Pointer Events (touch and mouse),
pan and zoom via the viewBox, no new dependency. Modes: Select, Place
device, Draw route, Calibrate. Selecting a circuit highlights its
devices and routes in both views. Wide screens show the two views side
by side, narrow ones stack them (same single-column rule as the forms).

**Alternative rejected:** independent drawings per view with no shared
coordinates. Simpler, but nothing would link a device in the top view to
the same device in the side view, and routes could not be measured.

## Open Questions

- ~~How to serve the SVG to any authenticated user.~~ Answered by the
  step 1 spike: signalk-server 2.36.0 gives the plugin router an
  `access(level)` registrar (`router.access('readonly').get(...)`), which
  registers the route's permission with the security strategy. The
  download route uses it when present and falls back to the admin-only
  default on older servers.

## Test Strategy

- **Pure logic (`public/floorplan.js`, `test/floorplan.test.mjs`):**
  calibration math (px to meters and back, both views), applying a click
  to a position without disturbing the third axis, waypoint axis
  inheritance, 3D polyline length, a route with unset axes, a one-point
  and an empty route.
- **Store/migration (`test/store.test.js`):** migration adds the new
  columns and table to an existing 0.2.0 database and is a no-op twice;
  a position or route change writes one change-log entry.
- **Routes (`test/routes.test.js`):** SVG upload accepts SVG and rejects
  other types and oversized files, download sets the safe headers, a
  stored file is named by id, 503 when the plugin is disabled.
- **Manual:** click through in headless Chromium against a real
  SignalK server with a real plan: calibrate, place a device in the top
  view and see it appear in the side view, draw a route, read the
  length. Unit tests do not cover pointer interaction.

Also test: a route resolves its start from the from-device, then the
circuit's panel device, then the first waypoint; a panel device that is
removed or unplaced falls back cleanly.

Edge cases to check: a removed device or wire run (hidden or dimmed, as
in the diagram), a device with only x/y set, a plan uploaded without a
`viewBox`, very large SVGs, two plans for the same view.

## Implementation Steps

Delivered as separate slices, each its own commit with tests:

- [x] 1. Schema migration, `plans` store kind, `wiringPlans` provider,
      SVG upload/download routes with the safe headers (backend only).
- [x] 2. `floorplan.js` pure logic with tests (calibration, projection,
      route length), written before the UI.
- [x] 3. Floorplan tab: upload, view with pan/zoom, calibrate.
- [ ] 4. Device placement in both views, with cross-highlighting.
- [ ] 5. Panel link on circuits, route drawing (click to add, drag to
      adjust, delete a point) and measured length.
- [ ] 6. Docs: SPEC.md, ARCHITECTURE.md, README, CHANGELOG; CSV import is
      unaffected.

## Files to Create/Modify

- Create: `src/plans.js` (provider, file handling), `public/floorplan.js`
  (pure logic), `public/floorplanView.js` (UI), `test/floorplan.test.mjs`.
- Modify: `src/schema.sql`, `src/store.js` (migration, plan kind,
  position and route fields), `src/resources.js`, `src/routes.js`,
  `index.js`, `public/app.js` (tab, device and wire run forms),
  `public/style.css`, `SPEC.md`, `ARCHITECTURE.md`, `README.md`,
  `CHANGELOG.md`.
