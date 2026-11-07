# signalk-wiring Specification

## 1. Introduction

### 1.1 Purpose

`signalk-wiring` is a SignalK server plugin for documenting the physical
electrical wiring aboard a boat: every circuit, wire run, and connected
device, where it physically routes, and how it's changed over time.

It exists to make three things easy:

- **Lookup during troubleshooting** — "which breaker feeds this pump, what
  gauge is the wire, where does it run?" without tracing cable by hand.
- **Documentation for others** — a surveyor, a mechanic, a future owner, or
  other crew should be able to open the boat and understand its electrical
  system without the current owner present.
- **Change tracking** — as wiring is added, modified, or removed over the
  boat's life, there's a record of what changed and when.

### 1.2 Background

There is no single wiring documentation standard universally used on
recreational boats. Two relevant conventions exist:

- **ABYC E-11** (US) — conductor color-coding and general wiring practice.
- **DIN EN ISO 13297** (EU) — small craft electrical systems standard.

Neither is treated as authoritative by this plugin. Boats built to either
convention (or neither) need to be documentable, so the convention is a
per-installation **setting** that drives labeling hints in the UI, not a
constraint enforced on the data model.

### 1.3 Terminology

- **Circuit** — a source (breaker, fuse, or bus tap) plus the wire run(s)
  and device(s) it feeds. The top-level unit of organization.
- **Wire run** — a physical point-to-point conductor between two
  terminations (e.g. breaker terminal → device terminal, or a splice in
  between). A circuit is made of one or more wire runs when it passes
  through junctions/splices.
- **Device** — anything a wire run terminates at that isn't another wire
  run: a pump, light, instrument, battery, bus bar, etc.
- **Zone**: a named area a wire run or device is in (e.g. "salon", "aft
  cabin", "port lazarette"), chosen from a managed list. Used to find and
  filter. Access hints (behind a panel, under a hatch) belong in notes.
- **Role**: what a device does with power: consumer (uses it), source
  (supplies it: solar, shore power, generator, hydro, wind, alternator),
  storage (batteries), distribution (switches, breakers, fuses, bus bars,
  panels, isolators, relays) or converter (inverters, chargers, DC-DC).
- **Tag**: a free-text label for any other grouping, such as an audio
  zone, which overlaps physical areas. An item can have several.
- **Convention** — the labeling/color standard selected for the
  installation (ABYC E-11, DIN EN ISO 13297, or freestyle/none).

## 2. Domain Rules

- A **circuit** has exactly one source (a breaker, fuse, or direct bus
  tap) and one or more **wire runs**.
- A **wire run** connects exactly two endpoints. An endpoint is either a
  **device**, a **source**, or a junction/splice point that continues to
  another wire run. Multi-hop circuits (source → splice → two devices)
  are modeled as multiple wire runs sharing a circuit.
- A **device** can be fed by more than one circuit (e.g. a device with a
  primary and backup supply) — devices are not owned by a single circuit.
- Wire gauge is recorded with an explicit unit (AWG or mm²) per wire run,
  since a single boat may mix US and EU-sourced equipment and runs.
- Every wire run and device may optionally carry one **zone** from the
  managed list, and any number of free-text **tags**.
  Absence of a zone is valid — not everything needs a location yet.

## 3. State / Lifecycle Model

Wiring changes over a boat's life, and the record needs to reflect that
without losing history.

### 3.1 State Definitions

A wire run or device is either:

- **active** — currently installed as documented.
- **removed** — documented as having existed, now taken out. Kept in the
  record rather than deleted, so history isn't lost.

### 3.2 Transitions

- `active → removed`: user marks a wire run/device as removed (e.g.
  during a refit). The record is retained, not deleted.
- Editing an active record's attributes (gauge, color, routing, etc.)
  appends a **change log entry** rather than silently overwriting history.
- There is no `removed → active` transition; if something is reinstalled,
  it's a new record (possibly referencing the old one as prior art).

## 4. Data Model

- **Circuit**
  - `id`, `name`, `sourceLabel` (breaker/fuse label, free text),
    `breakerRating` (numeric amps, optional), `voltage` (numeric,
    optional — a boat can have more than one voltage domain, e.g. a 12V
    DC panel and a 230V AC panel, so this is per-circuit rather than a
    single installation-wide value), `panelRef`, `convention` override
    (optional, defaults to installation setting), `panelDeviceId`
    (optional, the device that is this circuit's panel, battery or bus
    bar, so drawn routes can start there), `status` (active/removed),
    `notes`.
- **WireRun**
  - `id`, `circuitId`, `fromEndpoint`, `toEndpoint` (each a device id,
    source, or splice reference), `gauge` + `gaugeUnit` (AWG | mm²),
    `color`, `length` + `lengthUnit` (m | ft), `zoneId`
    (optional, a Zone; the response also carries the zone's name as
    `zone`), `tags` (optional list of strings), `cableLabel` (the physical tag/number on the cable
    itself, optional — often a more reliable way to trace a wire in
    person than color, especially once colors fade or several runs
    share one), `switchRef` (a panel switch position, optional and
    distinct from the circuit's breaker/fuse — a device can be on a
    shared fuse but its own individually-switched position), `route`
    (optional, a list of `{x, y, z}` waypoints in meters drawn on the
    floorplan; the start is derived from the from-device or the
    circuit's panel device and is not stored), `status`,
    `attachments` (photo/file ids), `notes`.
- **Device**
  - `id`, `name`, `type` (free text, e.g. "bilge pump", "solar"), `iconAttachmentId`
    (optional: one of the device's own JPEG, PNG or WebP attachments, used as
    its icon), `role`
    (consumer | source | storage | distribution | converter; consumer by
    default, so devices recorded before roles existed stay valid),
    `zoneId` and `tags` (as on
    a wire run; `zone` carries the name),
    `ratedPowerW` (nameplate/rated power draw, optional), `signalkPath`
    (optional — a SignalK path this device corresponds to, e.g.
    `electrical.switches.anchorLight` or a battery's voltage/current
    sensor path; free text, not validated against the live data tree,
    so a device can be documented before its SignalK path exists or on
    a server that doesn't currently have a source for it), `posX`,
    `posY`, `posZ` (optional position in meters: x along the boat
    and increasing toward the bow, with 0 at the transom (the same origin
    and direction on every plan), y athwartships with 0 on the centerline, z height; any axis may be
    unset so a device can be half-placed), `status`, `notes`.
- **Plan**
  - `id`, `name`, `view` (`top` | `side`), `filename` (the uploaded
    drawing: SVG, PNG, JPEG or WebP), `zMin`/`zMax` (optional height
    range in meters; a top-view plan with a range shows only what lies
    inside it, so each deck plan shows its own deck), `calibration`
    (origin, scale and axis direction, set by clicking two points and
    entering the real distance), `status`, `notes`. Several plans per
    view are allowed.
- **Zone**
  - `id`, `name` (unique ignoring case). Renaming changes it everywhere
    because items link by id. A zone in use cannot be removed; merging two
    zones moves the items of one to the other. Writes accept either a
    `zoneId` or a zone `name`, which finds the zone ignoring case or
    creates it, which is also how CSV import resolves zones.
- **Attachment**
  - `id`, `filename`, `mimeType`, owning record type + id, uploaded date.
- **ChangeLogEntry**
  - `id`, record type + id, `timestamp`, `summary`, `diff` (what changed).

## 5. Sources / Inputs

All data is entered manually through the plugin's UI in the MVP. There is
no external data feed — wiring doesn't change fast enough, and no upstream
system on a boat has this information in structured form. Spreadsheet/CSV
import is a deferred feature (see 10.2), not an MVP input source.

## 6. API Specification

### 6.1 REST API / Public Methods

- `Circuit`, `WireRun`, and `Device` are served as SignalK resource types
  (`/signalk/v2/api/resources/wiringCircuits`, `.../wiringWireRuns`,
  `.../wiringDevices`, `.../wiringPlans`, `.../wiringZones`) via standard `listResources` / `getResource` /
  `setResource` / `deleteResource` semantics.
- The plugin configuration (§9) is served read-only as
  `/signalk/v2/api/resources/wiringSettings/config`, so the anonymously
  loaded webapp can apply it.
- Attachment upload/download and the diagram-rendering data endpoint are
  served under the plugin's own admin-gated routes
  (`/plugins/signalk-wiring/...`), since they're only ever used by the
  plugin's own UI.
- `GET /plugins/signalk-wiring/devices/:id/icon` serves a device's icon to
  any logged-in user where the server supports per-route access levels
  (admin only otherwise), so drawings can show it. Only the icon is
  exposed this way; a device's other attachments stay admin-only.
- `POST /plugins/signalk-wiring/zones/:id/merge?into=<zone id>` (admin)
  merges one zone into another.
- Plan drawings: `POST /plugins/signalk-wiring/plans/:id/image` (admin)
  uploads one, `GET .../plans/:id/image` serves it to any logged-in user
  where the server supports per-route access levels (signalk-server
  2.36 and later), and to admins only otherwise.

### 6.2 Events / Streaming

Not applicable — wiring documentation is not a live-updating data source;
no deltas are published for it.

## 7. User Interface

A dedicated plugin webapp, reached from the SignalK admin UI, providing:

- Browse/search circuits, wire runs, and devices (by name, zone, or
  status).
- Forms to create/edit circuits, wire runs, and devices, including gauge
  + unit, color, zone, tags, and notes. The zone field is a dropdown
  with an "Add new zone..." entry and a hint saying what a zone is.
- A role on every device (a dropdown with a hint on each choice), shown
  in the device list and details, with a role filter on the device list,
  and a colour per role on floorplan markers.
- A zones manager to rename, merge and remove zones, and zone and tag
  filters on the circuit, wire run and device lists.
- Photo/file attachment upload and viewing per wire run or device: any
  number of photos, and PDF schematics or other files alongside them.
  Images open full size; PDFs and other files show as labelled tiles. On a
  device, one image can be marked as its icon (and cleared again), which is
  then shown in device lists, on the circuit diagram and on floorplan
  markers. Deleting the icon image clears the icon.
- An auto-generated circuit diagram (source → wire run(s) → device(s))
  rendered from the data, per circuit.
- A change log view per record, showing prior edits.
- A settings panel for the installation's convention
  (ABYC E-11 / DIN EN ISO 13297 / freestyle), used only to drive UI
  labeling hints (e.g. suggested wire colors), never enforced.
- CSV import: upload a spreadsheet, map its columns to wiring fields (or
  skip them), preview the resulting circuits/wire runs/devices, then
  import. Column mapping rather than a fixed layout, since a real-world
  export's columns won't match another boat's.
- A floorplan view: upload a top-down or side drawing, calibrate it
  once, then place devices by clicking (one 3D position shown in both
  views), draw wire run routes over it (click to add, drag to adjust),
  and read the measured cable length, offered as a suggestion next to
  the recorded length and never applied automatically. Selecting a
  circuit highlights its devices and routes in both views.
- A panel load summary: per active circuit, total connected devices'
  rated wattage converted to amps via the circuit's voltage, checked
  against its breaker rating. States its own known limitation in the UI
  (a device fed by more than one circuit counts its full wattage on
  each) rather than presenting a number without that caveat.

The webapp shares the stowage webapp's look and feel: a dark header bar
with the title and a theme toggle, an underlined tab strip, warm light
surfaces, and a red-shifted night theme (every colour a shade of red, so it
does not disturb night vision). The theme is remembered in the browser,
defaults to the browser's preference, and can optionally follow
`environment.sun` or `environment.mode` (plugin option `autoTheme`). In the
night theme the plan drawings are inverted and tinted red.

No mobile-specific design constraints beyond the SignalK admin UI's own
responsive behavior.

## 8. Persistence

Circuits, wire runs, devices, attachments, and change log entries must
all survive a server restart. Nothing in this plugin is ephemeral.
Storage mechanism is detailed in ARCHITECTURE.md.

## 9. Configuration

- **Convention**: ABYC E-11 | DIN EN ISO 13297 | freestyle (default:
  freestyle). Shows example wire colours as the colour field's
  placeholder on the wire run form; freestyle shows none.
- **Default gauge unit**: AWG | mm² — pre-selected on new wire run forms,
  overridable per record (default: AWG).
- **Default length unit**: m | ft — pre-selected on new wire run forms,
  overridable per record (default: m). Same reasoning as the gauge unit
  above: a preference to reduce re-entry, not something enforced.

Everything else (zones, circuit/device names, voltage, breaker rating,
rated power, SignalK path) is free-form user data, not plugin
configuration.

## 10. MVP Scope

### 10.1 MVP Features

- Circuit / wire run / device data model with full CRUD via the UI.
- Managed zone list plus free-text tags on wire runs and devices.
- Photo/file attachments on wire runs and devices.
- Change log (append-only) on edits.
- Auto-generated per-circuit diagram view.
- Convention setting (drives labeling hints only).
- CSV import with column mapping (moved out of deferred — see below).
- Panel load summary.
- Floorplan view with device positions and measured wire routes.

### 10.2 Post-MVP / Deferred

- Zone polygons drawn on top plans, so a device's or route's zone can be
  computed from its position; zone parents (deck, room), kinds and notes;
  grouping lists and the load summary by zone.
- Cross-boat/fleet comparison — out of scope for a single-vessel plugin.
- Direct DXF/DWG import for plans (a browser cannot draw them without a
  converter; export SVG from the CAD tool instead).
- Correcting warped or skewed drawings: calibration assumes a uniform
  scale on an axis-aligned plan.
- PDF/print export of diagrams — deferred until the diagram view itself
  is validated with real data.

## 11. References

- [ABYC E-11](https://abycinc.org/) — AC & DC Electrical Systems on Boats.
- [DIN EN ISO 13297](https://www.iso.org/standard/58743.html) — Small
  craft — Electrical systems — Alternating and direct current
  installations.
- [SignalK Resource Provider API](https://signalk.org/specification/) —
  `registerResourceProvider` pattern used for data persistence/exposure.

## 12. Design Decisions

- **Convention is a setting, not a constraint.** Different boats follow
  different (or no) wiring standards; enforcing one would make the
  plugin unusable for a chunk of its intended audience. Considered
  hard-coding ABYC since it's the more common convention referenced in
  SignalK's own ecosystem, rejected because DIN EN ISO 13297 boats and
  freestyle installations are equally valid subjects to document.
- **Gauge stored with an explicit unit rather than normalized.** Boats
  commonly mix US (AWG) and EU (mm²) sourced equipment/wire during
  refits; normalizing to one unit would lose the as-labeled value people
  actually read off the wire or the spec sheet.
- **Devices have a role, not separate record types.** Sources, storage,
  distribution and converters are devices like any other, so circuits,
  wire runs, positions, routes and the floorplan work unchanged for them.
  The role defaults to consumer. Only consumers add to the panel load
  summary; the specific kind (solar, generator, a battery chemistry) stays
  in the free-text type. Distribution and converters are separate roles
  because a switch or an inverter neither produces, stores nor uses power
  in the plain sense. See plan 0011.
- **Zones are a managed list, with free-text tags beside them.** The MVP
  kept zones as free text so documentation could start without defining a
  list. Real data then showed the same area spelled several ways, so zones
  became a list seeded from the existing text (spellings differing only in
  case or padding merged), with tags for groupings that are not physical
  areas. See plan 0010.
- **Removed records are kept, not deleted.** The point of change tracking
  is a historical record — deleting a removed wire run would defeat that
  purpose.
- **Wiring reads are anonymously accessible, same as SignalK's built-in
  `notes`/`routes` resources.** Considered forcing admin auth on reads
  too, rejected for MVP: it breaks from SignalK's standard resource
  contract, and wiring data isn't secret in the way credentials are —
  being able to pull it up on a phone mid-repair without an admin login
  is genuinely useful. Server operators who expose their SignalK
  instance beyond their own network already control this globally via
  `allow_readonly`; the README calls this out explicitly so it's an
  informed choice, not a surprise.
- **`circuit.source` split into `sourceLabel` + `breakerRating`.**
  Originally one free-text field (e.g. `"Breaker 4, 15A"`). Splitting
  out a numeric rating enables checking a circuit's actual load against
  it (a real feature, not hypothetical — see the panel load summary),
  which a free-text field can't support. Existing free-text values
  migrated into `sourceLabel` as-is; `breakerRating` starts empty rather
  than attempting to regex-extract a number out of old text — a
  wrong auto-extracted rating silently feeding a load check is worse
  than an honestly-empty field.
- **`voltage` is per-circuit, not an installation-wide setting.** A boat
  commonly has more than one voltage domain (a 12V DC panel and a 230V
  AC panel are both normal) — a single global value wouldn't describe
  that.
- **`device.signalkPath` is free text, not validated against the live
  SignalK data tree.** SignalK paths are heterogeneous (vendor/custom
  segments, no fixed enumerable set to check against), and more
  importantly the wiring record should be documentable standalone — a
  device's physical wiring is worth recording before, or even if, its
  SignalK path exists on this particular server.
- **CSV import un-deferred once a real spreadsheet existed to design
  against.** §10.2 originally deferred this specifically for lack of
  real usage data; a real electrical worksheet (German column headers,
  duplicate header names, comma-decimal numbers, a combined gauge+unit
  cell) surfaced concrete requirements a hypothetical design would have
  guessed at, so the deferral's own condition was met. Built as generic
  column-mapping rather than a fixed importer for that one file's shape,
  since the next real CSV won't look like it either.
- **Panel load summary attributes a device's full wattage to every
  circuit it's wired into**, not split proportionally. Correct handling
  needs per-wire-run power data, which isn't collected — the summary's
  own UI states this rather than presenting a precise-looking number
  that isn't.
