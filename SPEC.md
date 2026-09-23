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
- **Zone** — a free-text physical location a wire run passes through or a
  device sits in (e.g. "engine room", "port lazarette").
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
- Every wire run and device may optionally carry a **zone** (free text).
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
    (optional, defaults to installation setting), `status`
    (active/removed), `notes`.
- **WireRun**
  - `id`, `circuitId`, `fromEndpoint`, `toEndpoint` (each a device id,
    source, or splice reference), `gauge` + `gaugeUnit` (AWG | mm²),
    `color`, `length` + `lengthUnit` (m | ft), `zone` (free text,
    optional), `cableLabel` (the physical tag/number on the cable
    itself, optional — often a more reliable way to trace a wire in
    person than color, especially once colors fade or several runs
    share one), `switchRef` (a panel switch position, optional and
    distinct from the circuit's breaker/fuse — a device can be on a
    shared fuse but its own individually-switched position), `status`,
    `attachments` (photo/file ids), `notes`.
- **Device**
  - `id`, `name`, `type` (free text, e.g. "bilge pump"), `zone` (optional),
    `ratedPowerW` (nameplate/rated power draw, optional), `signalkPath`
    (optional — a SignalK path this device corresponds to, e.g.
    `electrical.switches.anchorLight` or a battery's voltage/current
    sensor path; free text, not validated against the live data tree,
    so a device can be documented before its SignalK path exists or on
    a server that doesn't currently have a source for it), `status`,
    `notes`.
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
  `.../wiringDevices`) via standard `listResources` / `getResource` /
  `setResource` / `deleteResource` semantics.
- Attachment upload/download and the diagram-rendering data endpoint are
  served under the plugin's own admin-gated routes
  (`/plugins/signalk-wiring/...`), since they're only ever used by the
  plugin's own UI.

### 6.2 Events / Streaming

Not applicable — wiring documentation is not a live-updating data source;
no deltas are published for it.

## 7. User Interface

A dedicated plugin webapp, reached from the SignalK admin UI, providing:

- Browse/search circuits, wire runs, and devices (by name, zone, or
  status).
- Forms to create/edit circuits, wire runs, and devices, including gauge
  + unit, color, zone, and notes.
- Photo/file attachment upload and viewing per wire run or device.
- An auto-generated circuit diagram (source → wire run(s) → device(s))
  rendered from the data, per circuit.
- A change log view per record, showing prior edits.
- A settings panel for the installation's convention
  (ABYC E-11 / DIN EN ISO 13297 / freestyle), used only to drive UI
  labeling hints (e.g. suggested wire colors), never enforced.

No mobile-specific design constraints beyond the SignalK admin UI's own
responsive behavior.

## 8. Persistence

Circuits, wire runs, devices, attachments, and change log entries must
all survive a server restart. Nothing in this plugin is ephemeral.
Storage mechanism is detailed in ARCHITECTURE.md.

## 9. Configuration

- **Convention**: ABYC E-11 | DIN EN ISO 13297 | freestyle (default:
  freestyle).
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
- Free-text zone on wire runs and devices.
- Photo/file attachments on wire runs and devices.
- Change log (append-only) on edits.
- Auto-generated per-circuit diagram view.
- Convention setting (drives labeling hints only).

### 10.2 Post-MVP / Deferred

- Spreadsheet/CSV import — useful, but manual entry is enough to validate
  the data model first; import format needs real usage data to design
  against.
- Structured (picklist) zones — starting free-text avoids blocking data
  entry on defining a zone list up front; can be layered on once real
  zone names are in use.
- Cross-boat/fleet comparison — out of scope for a single-vessel plugin.
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
- **Zones are free text in MVP, not a structured list.** A structured
  zone picklist is more consistent but requires defining the list before
  any data entry can happen. Free text lets documentation start
  immediately; a picklist can be introduced later once real zone names
  exist to seed it from.
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
