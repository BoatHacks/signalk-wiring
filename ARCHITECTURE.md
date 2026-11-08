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

Registers the resource types via
`app.registerResourceProvider({ type, methods })`:
`wiringCircuits`, `wiringWireRuns`, `wiringDevices`, `wiringPlans`,
`wiringZones`, `wiringConduits` and `wiringSchematics`. Owns CRUD against the SQLite store for
those tables. A circuit resource is its record plus a `derived` object
from the derivation (`src/circuits.js`, see §2.5); setting one accepts only
its name, notes, voltage override and convention, and creating or deleting
one by hand is refused. A wire run carries its `conductors` and a device its
`terminals`, written and logged as part of the parent. Conduit assignments ride along on the two resources they
connect: a conduit lists `cableIds` and a wire run lists `conduitIds` (in
the cable's order), both read from the join table. A write that carries one
of them replaces that side's assignments through the store; a write without
it leaves them alone, so a client writing a whole wire run back does not
have to know them. Served at
`/signalk/v2/api/resources/<type>`, per SignalK's standard resource API
(see SPEC.md §6.1 for the contract, §2 of the `signalk-plugin` skill for
why this pattern over a raw router).

A schematic resource carries its `devices` (`deviceId`, `x`, `y`) and its
bent `wires` (`wireRunId`, `points`) as lists on the record, written with the
parent like conductors: a write that carries a list replaces it, one without
it leaves it alone. Deleting soft-deletes the page.

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
  denormalized read (derived circuit + its cables, feed and negative return,
  + their devices) shaped for a diagram renderer.
- Derivation leftovers (`GET /plugins/signalk-wiring/derived`, readonly
  access): the battery banks and the warnings that belong to no circuit.
- Change log reads (`GET /plugins/signalk-wiring/changelog/:type/:id`).
- Live view, switching and calibration routes live in `src/liveRoutes.js`
  (see §2.2.1), registered from `index.js` beside these.
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

### 2.2.1 Live view, switching and calibration (plan 0017)

- `src/switchability.js` is pure: `deriveSwitchability({ devices, cables,
  circuits })` reuses the positive `feeds` of `deriveCircuits` and walks
  upstream from each consumer to the nearest in-line devices with a switch
  path (a consumer with its own switch path switches itself), and
  downstream from each switch to the consumers it feeds. The flags of a
  shared switch are the strictest of the switch and every consumer behind it,
  so a lamp that shares a relay with a never-remote bilge pump is locked too.
  It also lists the meters upstream of a consumer, nearest first, with
  meters on a battery or source last and marked low confidence, plus meters
  set on the circuit record, and the circuit voltage.
- `src/switching.js` is the command side: it plans a switch (404, 409 not
  switchable, 403 never remote, 409 confirmation), sends the PUT with
  `app.putSelfPath` (a 200 is done, a 202 pending, anything else or a
  10 s timeout a failure) in the format the path holds now, and logs every
  action on the switch device's change log. The browser never sends the PUT.
- `src/calibrationStats.js` is pure: the delta statistics (step per cycle
  against the baselines either side, average, spread, noise, drift and
  warnings, with the sign of the step normalised so a negative discharge
  current still gives a positive load), the watch statistics (average, peak,
  duty cycle and "on" threshold), step detection, downsampling and the
  amps-to-watts conversion.
- `src/calibration.js` is the run state machine, over injected `read`,
  `readSwitch`, `switchTo` and clock functions, so it is tested with fake
  time. One run at a time; it fails a run whose meter goes silent, whose
  switch does not respond or whose command is refused, switches the device
  back to how it found it, and keeps going when the browser closes.
- `src/liveRoutes.js` registers the routes with `router.access('readonly')`
  for reads and `router.access('readwrite')` for switching and calibration.
  On servers without `router.access` the admin-only default applies, which
  is stricter and so safe. `index.js` marks a run still running at start as
  failed and cancels the run when the plugin stops.
- The webapp side is `public/live.js` (pure state helpers, plus a hook that
  loads `/live` and subscribes to the switch and meter paths over the SignalK
  stream), `public/liveMarks.js` (lock, reading, legend), `public/calibrate.js`
  (the dialog) and `public/measured.js` (measured values beside the rating,
  and the figures the load check uses).

### 2.3 Storage layer (`src/store.js`)

Wraps `better-sqlite3`. Owns all reads/writes to `circuits`, `wire_runs`, `wire_run_conductors`,
`devices`, `device_terminals`, `conduits`, `wire_run_conduits`,
`calibration_runs`,
`attachments`, and `change_log`
tables, and appends a
`change_log` row on every mutating write to an active record (SPEC.md
§3.2). Both the resource provider and the admin routes call into this
layer rather than touching SQLite directly.

### 2.3.1 Circuit derivation (`src/circuits.js`) and record sync

`deriveCircuits({ devices, cables })` is a pure function: no database, no
side effects. It builds a graph from the positive and line conductors
(devices are nodes, cables edges), splits it at devices with a trip rating,
ends circuits at batteries, consumers, sources and converter ports, and
traces the negative network separately. It returns the circuits (key, feed
cables, return cables, devices, supply and end devices, rating, voltage, AC
flag), the battery banks and warnings. The webapp never derives on its own.

`Store.syncCircuits()` runs after every create or update of a device or a
cable, inside the store so the change log stays consistent. It matches the
derived circuits to the thin records in `circuits` by `key`
(`protector:<device id>` or `cable:<first cable id>`); a key that is new but
whose cables overlap a record whose key vanished takes that record over
(a fuse added to an unprotected circuit keeps its name and notes); a record
with no circuit becomes `removed` and is reactivated if its key returns.
Each change is a normal change-log entry. `cable_ids` on the record keeps
the cables it had at the last sync to make that overlap match possible.

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

**Routing** (plan 0018). The address bar holds the tab and whatever is open:
`#/`, `#/<tab>`, `#/circuits/<id>`, `#/devices/<id>`, `#/conduits/<id>`,
`#/schematics/<id>`, `#/floorplan/<plan id>`. `public/router.js` has the pure
`hashForState` and `parseHash`; only `App` touches `window.location`. A state
change writes the hash only when it differs from the current one, and a
`hashchange` parses it back. An unknown tab falls back to Circuits; an unknown
id opens the list with a short notice. Tools, forms, selected wires and zoom
are not in the URL.

**Undo** (plan 0018). `public/undoBar.js` has `UndoProvider` (wrapped around
the main area by `App`, renders the message at its top), the `UndoBar`
component (message, Undo button, about eight second timer that pauses while
the pointer is on it) and the `useUndo()` hook with `offer({ message, onUndo,
onExpire })` and `flush()`. The store's `restore(kind, id)` sets a removed
record back to active and logs "restored (undo)"; a plain write of `status:
active` over a removed record is logged the same way, so the resource API
needs no new route.

**Schematic canvas** (plan 0016). `public/schematic.js` is pure geometry
(device boxes and terminal anchors, right-angle routing with lane offsets,
wires through bend points, off-page stubs, hit testing, default conductors,
the dagre-based auto layout taking dagre as an argument) and is tested
directly. `schematicView.js` is hand-rolled SVG with Pointer Events, panned
and zoomed through the viewBox like the floorplan; it computes hits itself
from the geometry module rather than from DOM targets, so moving a device,
drawing a wire and bending a wire share one pointer handler. Cables are
created through `buildCablePayload` (`cableForm.js`) by the quick popover
(`quickCable.js`, `cablePopover.js`), which the floorplan connect tool
(`connectTool.js`, a state machine of From, To, waypoints, finish) shares.
The full cable form is passed in as a render prop from `app.js` for "More...".

**`public/import.js` and `public/loadSummary.js`** (plan 0008) are
separate modules from `app.js` rather than more code inside it, each
self-contained (their own tiny `fetch`/resource-list helpers rather than
importing `app.js`'s, to avoid a circular ES module dependency and keep
each independently loadable by `node:test` — `app.js` itself can't be,
since its top-level code calls `render()` against `document`, which
doesn't exist outside a browser). `import.js`'s CSV parsing and
column-mapping logic, `loadSummary.js`'s per-circuit load
calculation, `cableForm.js` (conductor kinds, form values to cable payload,
the default negative landing) and `deviceFields.js` (which device fields
apply to which role) are plain exported functions, tested directly; the
import and load summary also sit ahead of a Preact component.

## 3. Data Models

Mirrors SPEC.md §4 as SQLite tables. Changed by a real migration as of
plan 0008 (§3.1 below) — `circuits.source` renamed to `source_label`, the
rest of the fields marked `-- 0008` are additions:

```sql
CREATE TABLE circuits (   -- plan 0014: a thin record kept in step with the cables
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT,                -- protector:<device id> | cable:<first cable id>, unique when set
  cable_ids TEXT,          -- JSON list of the cables at the last sync
  voltage REAL,            -- optional override of the derived voltage
  convention TEXT,         -- override; NULL = use installation default
  meter_path TEXT,         -- a meter on the whole derived circuit -- 0017
  meter_unit TEXT,         -- 'A' | 'W' -- 0017
  status TEXT NOT NULL,    -- 'active' | 'removed'
  notes TEXT
);

CREATE TABLE wire_runs (   -- a cable
  id TEXT PRIMARY KEY,
  from_device_id TEXT REFERENCES devices(id),  -- supply side -- 0014
  to_device_id TEXT REFERENCES devices(id),    -- load side -- 0014
  gauge REAL,
  gauge_unit TEXT,          -- 'AWG' | 'mm2'
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

CREATE TABLE wire_run_conductors (  -- 0014: the conductors inside a cable
  id TEXT PRIMARY KEY,
  wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
  position INTEGER NOT NULL,
  conductor TEXT NOT NULL,   -- positive | negative | line | neutral | earth
  color TEXT,
  from_device_id TEXT REFERENCES devices(id),  -- where it lands when not the cable's end
  to_device_id TEXT REFERENCES devices(id),
  from_terminal TEXT,         -- a terminal name on that device
  to_terminal TEXT
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
  trip_rating_a REAL,     -- fuse or breaker rating: it protects its branch -- 0014
  nominal_voltage REAL,   -- batteries and sources -- 0014
  power_factor REAL,      -- consumers on AC circuits, optional -- 0014
  switch_path TEXT,       -- SignalK state path this device switches by -- 0017
  confirm_switching INTEGER NOT NULL DEFAULT 0,  -- ask before switching -- 0017
  never_remote INTEGER NOT NULL DEFAULT 0,       -- refuse remote switching -- 0017
  meter_path TEXT,        -- SignalK path of a current or power meter -- 0017
  meter_unit TEXT,        -- 'A' | 'W' -- 0017
  pos_x REAL,             -- meters, any axis may be NULL -- 0009
  pos_y REAL,
  pos_z REAL,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE device_terminals (  -- 0014
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  conductor TEXT NOT NULL,   -- positive | negative | line | neutral | earth
  voltage REAL,
  port TEXT                  -- a converter's side, for example 'DC in'
);

CREATE TABLE zones (      -- 0010
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE conduits (    -- 0015
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT,                -- free text: Conduit, Hose, Loom, Trunking, Cable tray, ...
  inner_diameter REAL,      -- optional, a note
  diameter_unit TEXT,       -- 'mm' | 'in'
  zone TEXT,                -- the zone's name, kept in step with zone_id
  zone_id TEXT REFERENCES zones(id),
  route TEXT,               -- JSON list of {x,y,z} points in meters
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE wire_run_conduits (  -- 0015: the conduits a cable passes through
  wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
  conduit_id TEXT NOT NULL REFERENCES conduits(id),
  position INTEGER NOT NULL,       -- order within the cable, from 0
  PRIMARY KEY (wire_run_id, conduit_id)
);

CREATE TABLE schematics (  -- 0016: named diagrams of the electrical system
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE schematic_devices (  -- 0016: the devices on a page and where they sit
  id TEXT PRIMARY KEY,
  schematic_id TEXT NOT NULL REFERENCES schematics(id),
  position INTEGER NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  x REAL NOT NULL,
  y REAL NOT NULL
);

CREATE TABLE schematic_wires (    -- 0016: only cables the user bent
  id TEXT PRIMARY KEY,
  schematic_id TEXT NOT NULL REFERENCES schematics(id),
  position INTEGER NOT NULL,
  wire_run_id TEXT NOT NULL REFERENCES wire_runs(id),
  points TEXT                     -- JSON list of {x, y} bend points
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
  owner_type TEXT NOT NULL,  -- 'wireRun' | 'device' | 'conduit'
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
every subsequent restart. There are nine migrations (the third to ninth are described below): plan 0008's field
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

Plan 0015's migration (version 6) adds the `conduits` and
`wire_run_conduits` tables. They come from `schema.sql` on every open, so
the migration only guards the version for databases that somehow lack them.
Conduits take part in zones like devices and wire runs (zone resolution,
rename sync, usage count, merge). Assignments are not records of their own
and have no status: `assignCable` and `unassignCable` write one change-log
entry on the conduit, and `setCableConduits` (a replaced or reordered list)
one on the wire run. Removing a conduit or a cable keeps its assignments, so
history stays intact; the webapp and the route functions skip removed ones.

Plan 0014's migration (version 7) adds the trip rating, nominal voltage and
power factor columns, the `wire_run_conductors` and `device_terminals`
tables, and rebuilds `wire_runs` (SQLite cannot drop a NOT NULL column) with
`from_device_id` and `to_device_id` instead of `circuit_id`, `from_endpoint`,
`to_endpoint` and `color`, with foreign keys switched off for the rebuild
and the conduit assignments left intact. Each free-text end is matched to a
device by id, else by name ignoring case and padding; an end that matches
nothing is kept as a line in the cable's notes. The old colour becomes the
colour of a positive conductor. On `circuits` it adds `key` and `cable_ids`
and drops the retired `source_label`, `breaker_rating`, `panel_ref` and
`panel_device_id`; a circuit made by hand has no key, so the first sync
marks it removed (name and notes kept). Every step guards itself, and the
rebuild only runs while `wire_runs.circuit_id` still exists, so the
migration is safe to run twice.

Plan 0016's migration (version 8) adds `schematics`, `schematic_devices`
(device, x, y, position) and `schematic_wires` (cable, bend points as JSON,
position). They come from `schema.sql` on every open; the migration guards the
version. A wire row exists only for a bent cable, and a wire whose bend points
are emptied is dropped. `store.js` writes the two lists with the parent in one
transaction. Only a change in which devices are on a page is logged (a
`devices` diff of ids); moving a device or a bend point is layout and adds no
entry, and a cable carries its own wiring history.

Plan 0017's migration (version 9) adds `switch_path`, `confirm_switching`,
`never_remote`, `meter_path` and `meter_unit` to `devices`, `meter_path` and
`meter_unit` to `circuits`, and the `calibration_runs` table (from
`schema.sql`; the migration guards the version):

```sql
CREATE TABLE calibration_runs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),  -- who the result is about
  switch_device_id TEXT REFERENCES devices(id),    -- the switch operated, if any
  consumer_ids TEXT,        -- JSON list: the consumers a group result covers
  method TEXT NOT NULL,     -- 'delta' | 'watch'
  status TEXT NOT NULL,     -- 'running' | 'done' | 'failed' | 'cancelled'
  review TEXT NOT NULL,     -- 'pending' | 'accepted' | 'rejected'
  meter_path TEXT, meter_unit TEXT, voltage REAL,
  estimate INTEGER NOT NULL DEFAULT 0,   -- amps times volts, power factor 1
  started_at TEXT NOT NULL, ended_at TEXT,
  params TEXT, samples TEXT, details TEXT,  -- JSON; samples are downsampled
  avg_w REAL, peak_w REAL, duty_cycle REAL, confidence TEXT, error TEXT
);
```

Existing devices are not flagged: the flags default to 0 and only a new
device of a critical-looking type starts with `confirm_switching` on (`src/safety.js`,
mirrored in `public/deviceTypes.js`). The flags are 0/1 in SQLite and
booleans in resources. Runs are written often while they execute, so they
are not in the change log; accepting or rejecting one, and every switch
action, is logged on the device. `latestAcceptedRun` finds a device's own run
or a group run listing it, and the device resource carries it as `measured`.

Conductors and terminals live in child tables but are written, validated
and change-logged as part of their parent: a write that carries the list
replaces it, one without it leaves it alone, and an unchanged list adds no
change-log entry.

The cable's effective route and length (`effectiveCableRoute` in
`public/floorplan.js`, pure and tested) are derived on the client and never
stored: a cable with waypoints of its own keeps them, otherwise it follows
its live, drawn conduits in order.

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
- Switching and calibration (plan 0017) change the real boat, so they sit
  behind the read-write access level, not the anonymous read. The plugin, not
  the browser, sends the PUT, so it can refuse a never-remote device, demand a
  confirmation, and log every action (refusals too) on the switch device. A
  calibration run switches a device with the same checks, and puts it back
  as it found it however the run ends. Which devices ask for confirmation is
  a free-text type match plus the flags the user sets, so the device form
  says what the flags do and a critical device with an unusual type can be
  missed; nothing starts as never remote.
- No user input is ever interpolated into SQL — all queries go through
  `better-sqlite3`'s parameterized statement API.

## 7. File Structure

```
signalk-wiring/
  index.js                 # plugin entry: registers resource provider + routes
  src/
    resources.js            # ResourceProvider implementation
    routes.js                # attachments, diagram data, changelog routes
    liveRoutes.js            # live view, switching, calibration routes
    switchability.js         # pure: what can be switched, which meter measures it
    switching.js             # sending the switch command, flags, logging
    calibrationStats.js      # pure: delta and watch statistics
    calibration.js           # calibration run state machine
    safety.js                # critical-looking device types
    store.js                 # SQLite access layer
    schema.sql                # table definitions (§3)
  public/                   # name required by the signalk-webapp keyword (§2.4)
    index.html
    app.js                   # UI: browse/search, forms, diagram, changelog view
    router.js                # pure: hash routes (tab and open item) <-> state
    undoBar.js               # the Undo message, shared by lists and canvases
    import.js                 # CSV import: parsing, column mapping, UI
    loadSummary.js             # panel load summary: calculation, UI
    deviceTypes.js             # popular device types per role, dropdown options
    deviceIcons.js             # icon url, which images can be icons
    conduits.js                # conduit kinds, cable names, list helpers
    theme.js                   # light and red night theme, optional auto switching
    roles.js                   # device roles: labels and hints
    zones.js                   # tags parsing, zone and tag filters
    floorplan.js               # pure geometry: calibration, projection, routes
    live.js                    # Live mode: states, switching, stream subscription
    liveMarks.js               # Live mode: lock, reading, legend
    calibrate.js               # the Calibrate load dialog
    measured.js                # measured values beside the rating, load figures
    schematic.js               # pure geometry: boxes, terminals, routing, stubs, hit tests
    schematicView.js           # schematics tab: pages, canvas, palette, wires, bends
    quickCable.js              # pure: values for the quick cable popover
    cablePopover.js            # the quick cable popover shared by both tools
    connectTool.js             # pure state machine of the floorplan connect tool
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
    deviceTypes.test.mjs
    conduits.test.mjs
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
