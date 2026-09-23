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

These are admin-gated by SignalK itself (see §6), which is acceptable
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

## 3. Data Models

Mirrors SPEC.md §4 as SQLite tables:

```sql
CREATE TABLE circuits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT,            -- breaker/fuse label + rating, free text
  panel_ref TEXT,
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
  zone TEXT,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  zone TEXT,
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
    style.css
    vendor/                  # preact-standalone.module.js, dagre — vendored, no CDN (§2.4)
  test/
    store.test.js
    resources.test.js
    routes.test.js
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
- **Structured zone picklist** (SPEC.md §10.2) — the `zone` columns are
  plain `TEXT` now specifically so a future migration to a `zones` table
  + foreign key doesn't require a data model rethink, just a backfill.
- **Anonymous read access reconsideration** (§6) — if this needs to
  change, it's a resource-provider-level decision (SignalK doesn't offer
  per-resource-type read gating beyond the global `allow_readonly`), so
  it may require moving reads behind `registerWithRouter` instead —
  worth deciding before other tooling comes to depend on the current
  anonymous-read contract.
