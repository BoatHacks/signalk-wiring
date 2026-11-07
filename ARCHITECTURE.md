# signalk-wiring Architecture

## 1. Overview

`signalk-wiring` is a standard SignalK Node server plugin: a Node package
installed into `~/.signalk`, loaded by `signalk-server` at startup. It has
three parts — a **resource provider** for the core wiring data, a small
set of **admin-gated routes** for attachments and diagram data, and a
**webapp** for authoring/browsing, mounted by SignalK core itself (not by
this plugin's own code — see §2.4).

```
 Browser
        |
        v  GET /signalk-wiring/          (mounted by SignalK core from
        |                                 public/, via the signalk-webapp
        |                                 keyword — not admin-gated)
 [ signalk-wiring webapp ]
        |
        v  fetch()
 +----------------------------------------------------------------+
 |                      signalk-wiring plugin                      |
 |                                                                  |
 |  ResourceProvider                    Router routes               |
 |  (wiringCircuits,                    (attachments, diagram data, |
 |   wiringWireRuns,                     change log — admin-gated,  |
 |   wiringDevices)                      under /plugins/<id>/)      |
 |  reads: anonymous, writes: admin-gated                           |
 |        |                                    |                    |
 |        v                                    v                    |
 |                 SQLite (better-sqlite3), data dir                 |
 +----------------------------------------------------------------+
```

## 2. System Components

### 2.1 Resource provider (`src/resources.js`)

Registers three resource types via
`app.registerResourceProvider({ type, methods })`:
`wiringCircuits`, `wiringWireRuns`, `wiringDevices`. Owns CRUD against the
SQLite store for those three tables. Served at
`/signalk/v2/api/resources/<type>`, per SignalK's standard resource API
(see SPEC.md §6.1 for the contract, §2 of the `signalk-plugin` skill for
why this pattern over a raw router).

A fourth, read-only type, `wiringSettings` (`src/settings.js`), serves
the plugin configuration as a single `config` resource. The webapp loads
anonymously and the plugin's routes are admin-gated, so the resource API
is the only way for it to read the settings (convention and default
units). Writes and deletes are rejected; changing a setting means
editing the plugin configuration.

### 2.2 Admin routes (`src/routes.js`)

Registered via `registerWithRouter(router)`. Owns:

- Attachment upload/download (`POST /plugins/signalk-wiring/attachments`,
  `GET /plugins/signalk-wiring/attachments/:id`) — binary files don't fit
  the JSON resource API, so they're handled separately and stored on disk
  with metadata in SQLite.
- Diagram data (`GET /plugins/signalk-wiring/circuits/:id/diagram`) — a
  denormalized read (circuit + its wire runs + their devices) shaped for
  the client-side diagram renderer, to avoid N+1 fetches from the webapp.
- Change log reads (`GET /plugins/signalk-wiring/changelog/:type/:id`).
- Device icons (`GET /plugins/signalk-wiring/devices/:id/icon`), registered
  with `router.access('readonly')` like the plan download so drawings can
  show them to any logged-in user. It serves only the one image marked as
  the icon, with `nosniff` and a restrictive Content-Security-Policy; the
  device's other attachments stay behind the admin-only routes above.
- Plan drawings (`POST` and `GET /plugins/signalk-wiring/plans/:id/image`).
  Upload accepts SVG, PNG, JPEG and WebP, caps size at 15MB, checks the
  bytes against the declared type, and stores the file as `<id>.<ext>`
  under `plans/` in the data directory (a new format replaces the old
  file). Download sets the type from the extension, `nosniff` and a
  restrictive Content-Security-Policy. It is registered with
  `router.access('readonly')` when the router offers it, so any
  logged-in user can read a plan; everything else stays admin-only.

Except for that download, these are admin-gated by SignalK itself (see §6), which is acceptable
since they're only ever called by this plugin's own authoring UI. The
webapp's static assets are *not* served from here — see §2.4.

### 2.3 Storage layer (`src/store.js`)

Wraps `better-sqlite3`. Owns all reads/writes to `circuits`, `wire_runs`,
`devices`, `attachments`, and `change_log` tables, and appends a
`change_log` row on every mutating write to an active record (SPEC.md
§3.2). Both the resource provider and the admin routes call into this
layer rather than touching SQLite directly.

### 2.4 Webapp (`public/`)

A small single-page app built on Preact + `htm` (JSX-like templates
without a JSX compiler — plain `<script>` tags, no build step). Chosen
over vanilla JS because the view-state surface is real (3 entity types ×
CRUD, search/filter, attachments, diagram, change log) and over a
build-tooled framework because a build pipeline is unnecessary
complexity for this scope.

**Mounted by SignalK core, not by this plugin.** `signalk-server` scans
installed packages for the `signalk-webapp` keyword and, if a `public/`
directory exists, mounts it directly on the main Express app at
`/<package-name>/` — here, `/signalk-wiring/` — via
`app.use('/signalk-wiring', serveStaticFiles('.../public/'))`. This is
a *different* mount point from the admin routes in §2.2
(`/plugins/signalk-wiring/...`) and, critically, **is not wrapped in the
admin-auth gate** those routes get — `signalk-server`'s security layer
only applies `addAdminMiddleware`/`addWriteMiddleware` to specific
prefixes (`/plugins`, the resource API's write verbs, etc.), and
`/signalk-wiring` isn't one of them. In practice this is fine, not a
gap: it just means the read-only shell is reachable the same way the
resource API's reads already are (SPEC.md §12's anonymous-read
decision) — actual writes still go through the resource API's `PUT`/
`POST`/`DELETE`, which *is* auth-gated, so an unauthenticated visitor
can browse but not edit. First discovered by testing against the live
server and getting SignalK's own plugin-metadata JSON back instead of
the page — `/plugins/<id>/` is already a built-in core route.

**Everything the webapp needs at runtime is vendored into
`public/vendor/` and shipped inside the npm package — no CDN script
tags.** This is a hard requirement, not a preference: the plugin has to
work with no internet connectivity, since the boat may be at sea. This
also applies to `dagre` (diagram layout, §4) and any fonts/icons.

Design target is an iPad-sized tablet (~768–1024px), not a phone — the
core use case (SPEC.md §1.1) is troubleshooting mid-repair, but on a
tablet rather than a phone screen. Layout still needs to not break on a
phone, just isn't optimized for one.

Create/edit forms expand inline on the list/detail view rather than
routing to a separate page — fewer navigation states, and it keeps a
short interaction loop for the mid-repair use case (find record → expand
→ edit → collapse) rather than round-tripping through page loads.

Talks only to the two API surfaces in §2.1/§2.2 over `fetch`. Owns all UI
described in SPEC.md §7, including the diagram rendering (client-side,
via `dagre` for layout + hand-rolled SVG, per §4).

**`public/import.js` and `public/loadSummary.js`** (plan 0008) are
separate modules from `app.js` rather than more code inside it, each
self-contained (their own tiny `fetch`/resource-list helpers rather than
importing `app.js`'s, to avoid a circular ES module dependency and keep
each independently loadable by `node:test` — `app.js` itself can't be,
since its top-level code calls `render()` against `document`, which
doesn't exist outside a browser). `import.js`'s CSV parsing and
column-mapping logic, and `loadSummary.js`'s per-circuit load
calculation, are both plain exported functions ahead of their Preact
component, tested directly.

## 3. Data Models

Mirrors SPEC.md §4 as SQLite tables. Changed by a real migration as of
plan 0008 (§3.1 below) — `circuits.source` renamed to `source_label`, the
rest of the fields marked `-- 0008` are additions:

```sql
CREATE TABLE circuits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_label TEXT,      -- breaker/fuse label, free text (was `source`)
  breaker_rating REAL,    -- numeric amps, optional -- 0008
  voltage REAL,           -- optional, per-circuit not installation-wide -- 0008
  panel_ref TEXT,
  panel_device_id TEXT,    -- panel/battery/bus bar device, optional -- 0009
  convention TEXT,         -- override; NULL = use installation default
  status TEXT NOT NULL,    -- 'active' | 'removed'
  notes TEXT
);

CREATE TABLE wire_runs (
  id TEXT PRIMARY KEY,
  circuit_id TEXT NOT NULL REFERENCES circuits(id),
  from_endpoint TEXT,      -- device id, source label, or splice ref
  to_endpoint TEXT,
  gauge REAL,
  gauge_unit TEXT,          -- 'AWG' | 'mm2'
  color TEXT,
  length REAL,
  length_unit TEXT,        -- 'm' | 'ft' -- 0008
  zone TEXT,              -- the zone's name, kept in step with zone_id
  zone_id TEXT REFERENCES zones(id),  -- 0010
  tags TEXT,              -- JSON array of strings -- 0010
  cable_label TEXT,        -- physical tag/number on the wire -- 0008
  switch_ref TEXT,         -- panel switch position, distinct from the fuse -- 0008
  route TEXT,              -- JSON list of {x,y,z} waypoints in meters -- 0009
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  role TEXT NOT NULL DEFAULT 'consumer',  -- consumer | source | storage | distribution | converter -- 0011
  icon_attachment_id TEXT, -- one of this device's own images -- 0013
  zone TEXT,              -- the zone's name, kept in step with zone_id
  zone_id TEXT REFERENCES zones(id),  -- 0010
  tags TEXT,              -- JSON array of strings -- 0010
  rated_power_w REAL,     -- nameplate/rated draw, optional -- 0008
  signalk_path TEXT,      -- e.g. electrical.switches.anchorLight -- 0008
  pos_x REAL,             -- meters, any axis may be NULL -- 0009
  pos_y REAL,
  pos_z REAL,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE zones (      -- 0010
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE plans (       -- 0009
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  view TEXT NOT NULL,       -- 'top' | 'side'
  filename TEXT,            -- <id>.<ext> of the uploaded drawing
  z_min REAL,               -- optional height range for top-view plans
  z_max REAL,
  calibration TEXT,         -- JSON: originPx, pxPerMeter, dir, flip
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,  -- 'wire_run' | 'device'
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE change_log (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  summary TEXT NOT NULL,
  diff_json TEXT
);
```

### 3.1 Schema Migrations

`schema.sql` (`CREATE TABLE IF NOT EXISTS`) only gets an existing
installation as far as whatever shape it already had — it can't rename
or add columns on a database that already exists. `store.js` tracks the
schema version in SQLite's own `PRAGMA user_version` and runs an
ordered list of migrations (`{version, apply(db)}`) past whatever
version the database is currently at, each step guarding itself with a
`PRAGMA table_info()` check rather than assuming it's needed — safe to
run against a fresh install (schema.sql already has the new shape, so
every guard is a no-op) or an existing one, and safe to run again on
every subsequent restart. There are five migrations (the third to fifth are described below): plan 0008's field
additions and rename, and plan 0009's position, route and panel-link
columns (the `plans` table itself comes from `schema.sql`). Structured
columns (`route`, `calibration`) are JSON text in SQLite so a route edit
is a single `route` entry in the change log, and `resources.js` converts
them to real arrays and objects at the resource boundary.

Plan 0010's migration adds `zone_id` and `tags` and turns every distinct
existing `zone` string into a row in `zones` (strings differing only in
case or padding become one zone, named by the first spelling met) and links
the items to it. The old `zone` text column stays, now holding the zone's
name: `store.js` keeps it in step on every write and on rename, so responses
keep a readable `zone` and an older version can still read the data. Writes
accept `zone_id` or a zone name; `zone_id` wins when both are given.
Zones are a plain list rather than removed-but-kept records: an unused zone
is deleted (and the deletion logged), a zone in use is refused, and a merge
moves its items, each move logged.

Plan 0011's migration adds `devices.role` with the default `consumer`, so
every existing device is a consumer. `store.js` validates the role on every
write (a cleared role returns to the default), and `public/roles.js` holds
the labels and hints the webapp shows.

Plan 0013's migration adds `devices.icon_attachment_id`. `store.js` accepts
it only for a JPEG, PNG or WebP attachment of the same device, and
`deleteAttachment` clears it (with a change-log entry) when its image is
deleted.

## 4. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (matches `signalk-server` host) | required by SignalK plugin model |
| Language | JavaScript (or TS compiled to `dist/`, per `signalk-plugin` skill scaffold) | plugin scaffold default |
| Storage | `better-sqlite3` (^13.x — not 11.x or 12.x) | single-file embedded DB, synchronous API (fits the mostly-synchronous SignalK plugin lifecycle), no external DB server to run on a boat's Pi. Must stay on 13.x specifically: 11.x has no `engines` constraint at all, and 12.x (despite declaring Node 20–26 support) still uses `node::ObjectWrap` and can abort with a native V8 assertion on Node ≥24.19 due to a GC-finalization/environment-teardown race — only 13.x's N-API rewrite avoids it. Both crashed the live `signalk-server` container in testing; see `docs/plans/0001-scaffold-and-core-data-model.md`. |
| Attachment files | filesystem, under the plugin's SignalK data dir | binary blobs don't belong in SQLite rows at this scale; simpler backup story (it's just files) |
| Webapp | Preact + `htm`, vendored under `public/vendor/`, no build step | real component structure for a real CRUD/search/attachment/diagram/changelog surface, without a build pipeline. Vendored (not CDN) because the plugin must work with no internet connectivity — see §2.4 |
| Diagram rendering | `dagre` (layout only, vendored) + hand-rolled SVG rendering | circuits are small, mostly-linear/tree-shaped graphs — a full force-directed layout lib is overkill; computing positions with `dagre` and rendering SVG ourselves keeps the bundle light and gives full control over styling (color by gauge, dim/strike removed records, etc.) |
| Testing | `node:test` | per `signalk-plugin` skill convention |

## 5. Integration Points

- **SignalK Resource API** — `app.registerResourceProvider(...)` for
  `wiringCircuits` / `wiringWireRuns` / `wiringDevices`. Contract:
  standard `listResources`/`getResource`/`setResource`/`deleteResource`,
  served at `/signalk/v2/api/resources/<type>`.
- **SignalK plugin router** — `registerWithRouter(router)` for
  attachments and diagram/changelog reads, mounted under
  `/plugins/signalk-wiring/`, admin-gated.
- **SignalK webapp mounting** — the `signalk-webapp` package.json keyword
  + `public/` directory convention; `signalk-server` mounts it at
  `/signalk-wiring/` itself (§2.4), not admin-gated, and lists it in the
  admin UI's Webapps launcher (filtered by the plugin's enabled state).
- No integration with live SignalK deltas/paths — wiring documentation is
  static reference data, not a telemetry source (SPEC.md §6.2).

## 6. Security Considerations

- All write paths (resource provider `setResource`/`deleteResource`,
  attachment upload) are only reachable through routes SignalK gates
  behind admin auth — there is no separate authn/authz layer in this
  plugin; it inherits the host server's.
- The webapp shell itself (`public/`, §2.4) is **not** admin-gated —
  it's mounted the same unauthenticated way as any other SignalK
  webapp (freeboard-sk, etc.). This is consistent with, not additional
  to, the read-anonymity decision below: an unauthenticated visitor can
  load the page and browse (same reads the resource API already allows
  anonymously) but can't edit anything, since editing still calls the
  auth-gated write endpoints above. The webapp's own UI needs to handle
  a 401 from a write attempt gracefully (plan 0004+), not assume it's
  always logged in just because the page loaded.
- Resource *reads* (`listResources`/`getResource`) are, per the
  `signalk-plugin` skill, anonymously readable under the server's
  `allow_readonly` setting — same as SignalK's built-in `notes`/`routes`
  resources. This is a deliberate choice (SPEC.md §12), not a gap: the
  README must call it out explicitly so an operator who exposes their
  SignalK instance beyond their own network can make an informed call
  via the global `allow_readonly` setting.
- Attachment uploads: validate MIME type and cap file size server-side
  before writing to disk; store files under a UUID-derived filename
  (never the client-supplied name) to avoid path traversal.
- Plan drawings are never inlined into the page. The webapp draws them
  through an `<image>` element, where scripts in an SVG do not run, and
  the download route adds a restrictive Content-Security-Policy and
  `nosniff` in case the URL is opened directly. Files are named by plan
  id, checked against their own bytes, and capped at 15MB.
- No user input is ever interpolated into SQL — all queries go through
  `better-sqlite3`'s parameterized statement API.

## 7. File Structure

```
signalk-wiring/
  index.js                 # plugin entry: registers resource provider + routes
  src/
    resources.js            # ResourceProvider implementation
    routes.js                # attachments, diagram data, changelog routes
    store.js                 # SQLite access layer
    schema.sql                # table definitions (§3)
  public/                   # name required by the signalk-webapp keyword (§2.4)
    index.html
    app.js                   # UI: browse/search, forms, diagram, changelog view
    import.js                 # CSV import: parsing, column mapping, UI
    loadSummary.js             # panel load summary: calculation, UI
    deviceIcons.js             # icon url, which images can be icons
    theme.js                   # light and red night theme, optional auto switching
    roles.js                   # device roles: labels and hints
    zones.js                   # tags parsing, zone and tag filters
    floorplan.js               # pure geometry: calibration, projection, routes
    floorplanView.js           # floorplan tab: upload, viewer, placement, routes
    style.css
    vendor/                  # preact-standalone.module.js, dagre — vendored, no CDN (§2.4)
  test/
    store.test.js
    resources.test.js
    routes.test.js
    import.test.mjs
    loadSummary.test.mjs
    floorplan.test.mjs
    zones.test.mjs
    roles.test.mjs
    theme.test.mjs
    deviceIcons.test.mjs
    fixtures/                # real-world CSVs used as import regression fixtures
  package.json
  README.md
  LICENSE
  .github/workflows/
    test.yml
    publish.yml
```

## 8. Deployment

Installed like any SignalK plugin: via the admin UI Appstore, or
`npm install signalk-wiring` inside `~/.signalk`, then a server restart —
there's no hot-reload, updates to the plugin only take effect after a
restart.

Persisted data (SQLite file + attachment files) lives under the SignalK
plugin data directory (`app.getDataDirPath()` at plugin init), so it's
included in whatever backup strategy already covers `~/.signalk`.
No external services or network dependencies at runtime.

## 9. Future Considerations

- **Spreadsheet/CSV import** (SPEC.md §10.2) — if added later, it should
  reuse the storage layer's existing write path (`src/store.js`) rather
  than a separate bulk-write path, so change-log behavior stays
  consistent between manual and imported edits.
- **Zone polygons on plans** (SPEC.md §10.2): zones are a managed list
  now (plan 0010). Drawing polygons on top plans, with the height range
  plans already have, would let a zone be computed from position, and a
  route could list the zones it crosses. The `zones` table can grow a
  parent, a kind and notes without reworking the links.
- **Anonymous read access reconsideration** (§6) — if this needs to
  change, it's a resource-provider-level decision (SignalK doesn't offer
  per-resource-type read gating beyond the global `allow_readonly`), so
  it may require moving reads behind `registerWithRouter` instead —
  worth deciding before other tooling comes to depend on the current
  anonymous-read contract.
