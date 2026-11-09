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

- **Circuit**: what one fuse or breaker protects, worked out from the
  cables: that device, the cables on both sides of it up to the nearest bus
  bar, and everything downstream until the next fuse or breaker. A cable
  that no fuse or breaker covers is still a circuit, flagged as having no
  protection. Circuits are never created by hand.
- **Wire run (cable)**: a physical cable between two devices, from the
  supply side (From) to the load side (To). It lists its conductors. A
  splice or junction is a device (role distribution, type Splice), so each
  stretch between devices is its own cable.
- **Conductor**: one wire in a cable, of type positive, negative, line
  (AC), neutral or earth, with an optional colour and optional terminals.
- **Terminal**: a named connection point on a device, with a conductor type,
  an optional voltage and, on a converter, a port.
- **Device**: anything a cable ends at: a pump, light, instrument, battery,
  fuse, switch, bus bar, splice, etc.
- **Zone**: a named area a wire run or device is in (e.g. "salon", "aft
  cabin", "port lazarette"), chosen from a managed list. Used to find and
  filter. Access hints (behind a panel, under a hatch) belong in notes.
- **Conduit**: a physical path several cables share: a conduit, hose, loom,
  trunking or cable tray. It has its own optional route on the plans, and
  cables are assigned to it, so "which cables are in the conduit behind the
  galley panel?" has an answer. A cable is a wire run. A conduit that holds
  both AC and DC cables shows a warning (not a block): the standards restrict
  sharing rather than forbid it, so the advice is separate conduits where
  possible, and otherwise the AC in its own sheathed cable, all insulation rated
  for the highest voltage present, and ideally a partition.
- **Role**: what a device does with power: consumer (uses it), source
  (supplies it: solar, shore power, generator, hydro, wind, alternator),
  storage (batteries), distribution (switches, breakers, fuses, bus bars,
  panels, isolators, relays) or converter (inverters, chargers, DC-DC).
- **Tag**: a free-text label for any other grouping, such as an audio
  zone, which overlaps physical areas. An item can have several.
- **Convention** — the labeling/color standard selected for the
  installation (ABYC E-11, DIN EN ISO 13297, or freestyle/none).

## 2. Domain Rules

- A **cable** connects exactly two devices, From (supply side) to To (load
  side). Circuits are worked out from the positive and line conductors by
  `src/circuits.js`:
  - Batteries (storage), consumers and sources (solar panel, shore power
    inlet, generator, alternator) end a circuit. Converters (DC-DC,
    inverter, charger) sit between circuits, each port being an end of the
    circuit on its side. A cable between two batteries joins a bank and is
    not part of any circuit.
  - Distribution devices pass a circuit through. One with a trip rating
    (a fuse or breaker) protects its branch and gives it its rating; one
    without (switch, bus bar, splice) only passes it through. A bus bar
    with several protected branches gives one circuit per branch plus the
    feeder to the bus bar.
  - A circuit takes the voltage of the supply it is fed from (a battery or
    source nominal voltage, or a converter port terminal voltage); the
    circuit record can override it. A circuit is AC when it is fed by a
    line conductor, otherwise DC.
  - Negative conductors never join circuits. A negative cable need not
    follow its positive: it can take its own path or end at a negative bus
    bar, and belongs to every circuit whose consumers return through it. A
    consumer with no negative recorded is assumed to return alongside its
    feed.
  - A cable entered the wrong way round (From a load, or To a source) is
    reported as a warning on the circuit overview.
- A **device** can be fed by more than one circuit (e.g. a device with a
  primary and backup supply); devices are not owned by a single circuit.
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

### 3.1b Enclosures

An enclosure (a breaker box, a distribution panel) holds other devices through
a `parent_id` on the contained device, to any depth, with no cycles. Only the
enclosure is placed on the floorplan. Cables end on the contained devices, so
circuits and the load summary are unchanged. On a schematic the enclosure is
one box with a port per cable that crosses its boundary, and opening it creates
its own inside page, where those cables end in "to ..." tabs. Removing an
enclosure removes its contents, their cables and the inside page; Undo restores
them.

### 3.2 Transitions

- `active → removed`: user marks a wire run/device as removed (e.g.
  during a refit). The record is retained, not deleted. A circuit record
  becomes removed by itself when the cables stop implying it, and active
  again if they imply it once more.
- Editing an active record's attributes (gauge, color, routing, etc.)
  appends a **change log entry** rather than silently overwriting history.
- `removed → gone`: a removed cable can be deleted permanently on a second,
  confirmed step (the Cables tab). This erases the cable with its conductors,
  conduit assignments, schematic bends, attachments and change log. On the
  schematic canvas and the floorplan, removing a cable shows the undo message
  and, when it ends without an Undo, deletes the cable the same way, with no
  confirm dialog and no second step. A removed device, conduit or schematic can also be deleted permanently
  on a confirmed step (the device page, the Conduits and Schematics lists
  with "Show removed"). A device is refused while any cable, live or
  removed, still ends on it. A device removed from a canvas is only taken
  off that page or plan (it becomes "not placed"); devices are removed on
  the Devices tab or through the API.
- There is no `removed → active` transition, with one exception: **undo**.
  Right after a cable, device or conduit is removed in the web app, an
  "X removed. Undo" message is shown for about eight seconds. Undo sets the
  record back to active and appends a change log entry "restored (undo)" with
  the before and after status. Only that message uses it; once the message is
  gone, a record that was not undone stays removed, and if something is
  reinstalled later it's a new record (possibly referencing the old one as
  prior art).

## 4. Data Model

- **Circuit** (a thin record kept in step with the cables on every write
  through the store; never created or deleted by hand)
  - `id`, `name` (editable; defaults to the protecting device's name, or
    "Unprotected: " and the end devices), `key` (`protector:<device id>` or
    `cable:<first cable id>`), `cableIds` (the cables it had when last
    synced, used to carry the record over when its key changes, for example
    when a fuse is added to an unprotected circuit), `voltage` (optional
    override), `convention` override (optional), `status`, `notes`
    (editable).
  - The resource also carries `derived`, never stored: `protectorId`,
    `unprotected`, `ratingA` (the trip rating of the protecting device),
    `voltage` (override, else the supply voltage), `derivedVoltage`, `ac`,
    `cableIds` (feed cables), `returnCableIds` (negative cables serving
    it), `implicitReturnDeviceIds`, `deviceIds`, `supplyDeviceIds`,
    `endDeviceIds` and `warnings`. It is null for a removed circuit.
  - `meterPath` and `meterUnit` (optional, `A` or `W`): a SignalK path that
    measures this whole derived circuit, used by load calibration.
  - Setting a circuit resource accepts only `name`, `notes`, `voltage`,
    `convention`, `meterPath` and `meterUnit`; creating or deleting one is
    refused.
- **WireRun** (a cable)
  - `id`, `fromDeviceId` (supply side), `toDeviceId` (load side),
    `conductors` (a list; none means a single positive conductor): each has
    `conductor` (positive | negative | line | neutral | earth), `color`,
    optional `fromDeviceId` / `toDeviceId` (where this conductor lands when
    that is not the cable's end, for example a negative landing on a
    negative bus bar at the supply end) and optional `fromTerminal` /
    `toTerminal` (a terminal name on that device). Written and logged with
    the cable. A cable is AC or DC, never both: a list that has a line or
    neutral conductor together with a positive or negative one is refused with
    "A cable cannot carry both AC and DC" (earth and signal conductors are
    allowed in either kind). This follows the usual marine requirement that AC
    conductors running with DC ones are sheathed, bundled or kept apart (ABYC
    E-11, cited from a reprint of the 2003 edition and not checked against the
    current one; the ISO 13297 clause wording was not confirmed), so it is a
    design rule of this plugin and not a quotation of the standard.
  - `link` (series | parallel, optional): only on a cable whose two ends are
    both batteries (storage devices); any other cable refuses it. A cable
    between two batteries without one counts as parallel. A series link is one
    positive conductor, a parallel link carries positive and negative.
  - `gauge` + `gaugeUnit` (AWG | mm²; one gauge per cable), `length` +
    `lengthUnit` (m | ft), `zoneId`
    (optional, a Zone; the response also carries the zone's name as
    `zone`), `tags` (optional list of strings), `cableLabel` (the physical
    tag/number on the cable itself, optional, often a more reliable way to
    trace a wire in person than color), `switchRef` (a panel switch
    position, optional), `route` (optional, a list of `{x, y, z}` waypoints
    in meters drawn on the floorplan; the start is derived from the
    from-device and is not stored), `status`, `attachments` (photo/file
    ids), `notes`.
- **Battery details** (on a Device with role storage; all optional):
  `chemistry` (flooded | agm | gel | lifepo4 | lithium | other), `purpose`
  (house | starter | thruster | windlass | motor | other), `capacityAh` (amp-hours
  of this battery), `usableFraction` (0 to 1), `makeModel`, `installedOn` (an ISO
  date, shown as an age), `monitorDeviceId` (the shunt or battery monitor that
  measures it) and four SignalK paths: `voltagePath`, `currentPath`, `socPath`
  and `timeRemainingPath`. Choosing a chemistry suggests a nominal voltage per
  12 V battery (12 V for the lead-acid kinds, 12.8 V for LiFePO4) and a usable
  fraction (0.5 for flooded, AGM and gel, 0.8 for the lithium kinds), which stay
  editable. A battery with no path of its own uses its monitor's.
- **Bank** (derived, never stored): batteries joined by cables form a bank. A
  series link joins batteries into a string and parallel links join strings. A
  bank has its `strings`, a layout such as 2S2P (when all strings are equally
  long), a voltage (the sum along a string), a total capacity (the sum over
  strings of the smallest capacity in each string), a usable capacity (with the
  lowest usable fraction in the bank), energy in Wh, its chemistries, monitors
  and the protectors of the circuits it feeds, and warnings (uneven strings,
  strings that differ in voltage, mixed chemistries, a parallel link between
  different voltages, a network that cannot be reduced to series strings in
  parallel). A missing capacity or voltage makes the bank incomplete and says
  what is missing; no number is ever made up. A battery with no links is a bank
  of one.
- **Device**
  - `id`, `name`, `type` (free text, e.g. "bilge pump", "solar"), `iconAttachmentId`
    (optional: one of the device's own JPEG, PNG or WebP attachments, used as
    its icon), `role`
    (consumer | source | storage | distribution | converter | enclosure; consumer by
    default, so devices recorded before roles existed stay valid), `current`
    (ac | dc, or unset for either: whether the device works on AC or DC, used
    to choose the type of a new cable; a new device gets it from its type, for
    example a shore power inlet is AC and a battery DC, and the AC or DC of a
    port always comes from its terminals' conductor types),
    `zoneId` and `tags` (as on
    a wire run; `zone` carries the name),
    `ratedPowerW` (nameplate/rated power draw, optional), `tripRatingA`
    (amps, on a fuse or breaker: a distribution device with one protects
    the branch it feeds), `nominalVoltage` (on batteries and sources),
    `powerFactor` (optional, on a consumer; applied by the load check once
    its circuit is AC, blank counts as 1), `terminals` (a list of `name`,
    `conductor` (positive, negative, line, neutral, earth or signal),
    optional `voltage` and, on a converter, `port`; only needed where they
    remove ambiguity: converter ports, a battery with several posts, a fuse
    block). Terminals sharing a port name form one port ("DC in" with "DC in +"
    and "DC in -"); signal terminals (VE.Bus, relay contacts) are drawn but take
    no part in circuits. A device type such as DC-DC converter, MPPT charger,
    inverter, inverter/charger, battery charger or MultiPlus starts with its
    standard ports and terminals), `signalkPath`
    (optional — a SignalK path this device corresponds to, e.g.
    `electrical.switches.anchorLight` or a battery's voltage/current
    sensor path; free text, not validated against the live data tree,
    so a device can be documented before its SignalK path exists or on
    a server that doesn't currently have a source for it), `posX`,
    `posY`, `posZ` (optional position in meters: x along the boat
    and increasing toward the bow, with 0 at the transom (the same origin
    and direction on every plan), y athwartships with 0 on the centerline, z height; any axis may be
    unset so a device can be half-placed), `status`, `notes`.
  - **Switching and metering** (plan 0017): `switchPath` (optional, the
    SignalK state path of a relay, switch or breaker module the plugin may
    turn on and off, or of a device that switches itself),
    `confirmSwitching` and `neverRemote` (booleans, false by default),
    `meterPath` and `meterUnit` (`A` or `W`: a SignalK path that measures
    the current or power through this device, for example a shunt or a relay
    channel). A new device whose type contains bilge, refrigerator, fridge,
    freezer, autopilot, navigation light, nav light or windlass (ignoring
    case) starts with `confirmSwitching` on; an explicit value always wins and
    nothing starts as `neverRemote`.
  - The resource also carries `measured`, never written: the latest
    accepted calibration run that covers this device (its own, or a group run
    on a shared switch that lists it), as `runId`, `method`, `at`, `avgW`,
    `peakW`, `dutyCycle`, `confidence`, `estimate` and `group` (null, or the
    switch device and the consumers it covers). It is null when there is none.
- **Calibration run** (plan 0017; not a SignalK resource, served by the
  calibration routes of §6.1)
  - `id`, `deviceId` (the device the result is about: a consumer, or the
    switch for a group result), `switchDeviceId`, `consumerIds` (the
    consumers a group result covers), `method` (`delta` | `watch`), `status`
    (`running` | `done` | `failed` | `cancelled`), `review` (`pending` |
    `accepted` | `rejected`), `meterPath`, `meterUnit`, `voltage`, `estimate`
    (true when worked out from amps and a voltage, power factor 1), `startedAt`,
    `endedAt`, `params` (the timings), `samples` (downsampled, kept short),
    `details` (warnings, spread, noise, the "on" threshold), `avgW`, `peakW`,
    `dutyCycle`, `confidence` (high | medium | low) and `error`.
  - Accepting or rejecting a finished run is logged on the device. Rejected
    and unreviewed runs are kept but do not feed the load check.
- **Plan**
  - `id`, `name`, `view` (`top` | `side`), `filename` (the uploaded
    drawing: SVG, PNG, JPEG or WebP), `zMin`/`zMax` (optional height
    range in meters; a top-view plan with a range shows only what lies
    inside it, so each deck plan shows its own deck), `calibration`
    (origin, scale and axis direction, set by clicking two points and
    entering the real distance), `status`, `notes`. Several plans per
    view are allowed.
- **Conduit**
  - `id`, `name`, `kind` (free text; suggestions are Conduit, Hose, Loom,
    Trunking and Cable tray), `innerDiameter` + `diameterUnit` (mm | in,
    optional, a note only), `zoneId` (as on a wire run; `zone` carries the
    name), `route` (optional, a list of `{x, y, z}` points in meters drawn
    on the floorplan; its ends are the first and last point, nothing is
    derived from devices), `status`, `attachments`, `notes`. The response
    also carries `cableIds`, the wire runs assigned to it.
  - **Assignments**: a cable (wire run) passes through an ordered list of
    conduits, served as `conduitIds` on the wire run. It follows each
    conduit for its whole length; a cable only partly in a conduit is
    described by splitting it at a splice or junction box, or by a note.
    Assignments are made from the conduit's page (or by writing `cableIds`
    on the conduit or `conduitIds` on the wire run). Removing a conduit or
    a cable keeps its assignments.
- **Schematic**
  - `id`, `name`, `status`, `notes`, and two lists written with the record:
    `devices` (`deviceId`, `x`, `y`: the devices on this page and where they
    sit; a device can be on several pages, each with its own place) and
    `wires` (`wireRunId`, `points`: only the cables the user bent, with their
    bend points as a list of `{x, y}`). A wire is the cable record: it shows
    on a page by itself when both of the cable's devices are on it, and a
    cable with one end on the page is drawn as an off-page stub. Removing a
    schematic keeps it as removed; taking a device off a page never touches
    the device or its cables. Adding or removing a device on a page is a
    change-log entry; moving a device or a bend point is layout and is not.
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

- `Circuit` (read-only in effect, see §4), `WireRun`, and `Device` are served as SignalK resource types
  (`/signalk/v2/api/resources/wiringCircuits`, `.../wiringWireRuns`,
  `.../wiringDevices`, `.../wiringPlans`, `.../wiringZones`,
  `.../wiringConduits`, `.../wiringSchematics`) via standard `listResources` / `getResource` /
  `setResource` / `deleteResource` semantics.
- The plugin configuration (§9) is served read-only as
  `/signalk/v2/api/resources/wiringSettings/config`, so the anonymously
  loaded webapp can apply it.
- Live view and switching (plan 0017). `GET /plugins/signalk-wiring/live`
  (readonly access) returns, per consumer, whether anything in the wiring can
  switch it remotely (the nearest in-line device with a switch path between
  its supply and it), which switch, the other consumers that switch also
  feeds, the safety flags carried over from the switch and every consumer
  behind it, the circuit voltage, and the meters upstream of it. `POST
  /plugins/signalk-wiring/switch` (readwrite access) takes `{ consumerId |
  deviceId, state, confirmed }`, refuses never-remote devices (403), asks for
  confirmation where flagged (409 with `confirmationRequired`), sends the PUT
  through the server API in the format the path currently holds (boolean,
  0/1 or on/off words; boolean when nothing is held), and logs each action,
  refusals included, on the switch device.
- Load calibration (plan 0017), all under the plugin's routes and
  readwrite except the reads: `POST /calibration/runs` starts a run (one at a
  time), `GET /calibration/status` (readonly) is polled for progress, live
  reading and any prompt, `POST /calibration/continue`, `/finish` and
  `/cancel` steer it, `GET /calibration/runs?deviceId=` (readonly) lists runs,
  `POST /calibration/runs/:id/recompute` applies another "on" threshold to a
  finished watch run, and `.../accept` and `.../reject` decide it. Runs
  execute in the plugin and go on if the browser closes; a run left running
  when the plugin stops is marked failed at the next start.
- `GET /plugins/signalk-wiring/derived` (readonly access where the server
  supports it) returns the battery banks and the warnings of the derivation
  that belong to no single circuit, such as a cable that ends on a missing
  device.
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

No deltas are published for the wiring data. The webapp's Live mode (§7)
reads switch states and meter values from the SignalK stream
(`/signalk/v1/stream`, with REST polling as a fallback); reading needs no
special permission. Only commands and calibration runs go through the plugin.

## 7. User Interface

A dedicated plugin webapp, reached from the SignalK admin UI, providing:

- Browse/search circuits, cables, and devices (by name, zone, or
  status).
- A Cables tab with the cable form, DC first: From (supply side) and To
  (load side) device pickers, each with a "New device..." entry that makes
  the device on the spot, a choice of Positive, Negative or Positive +
  negative (AC line, AC line with neutral and earth, and Earth sit behind
  "More"), a "negative lands on at the supply end" picker for the
  two-conductor case (starting as the last negative bus bar or battery post
  used, and asked for when none has been), colour per conductor, gauge,
  length, cable label, zone, tags and notes. Terminals are asked for only on
  a converter or a device with several terminals. The circuit the cable
  belongs to is shown under the form and after saving.
- A Circuits tab that is a read-only overview of what the cables imply:
  name, notes, rating, voltage, AC or DC, an unprotected flag, warnings,
  and the supply and end devices. You can name a circuit and add notes (and
  override its voltage); there is no circuit creation form.
- Forms to create/edit devices, including trip rating (distribution
  devices), nominal voltage (batteries and sources), a terminals editor
  with port names on converters, and a power factor on consumers whose
  circuit is AC. The zone field is a dropdown
  with an "Add new zone..." entry and a hint saying what a zone is.
- A Type dropdown on devices: popular types for the chosen role (for
  example Solar panel for a source, Fuse for distribution), then types
  already used on other devices, and an "Add type..." entry for anything
  else. The type stays free text underneath, so a new type needs no setup
  and an older free-text type is kept and shown.
- A role on every device (a dropdown with a hint on each choice), shown
  in the device list and details, with a role filter on the device list,
  and a colour per role on floorplan markers.
- A Batteries tab (`#/batteries`): one card per bank with its batteries (links
  to their pages), layout, voltage, total and usable capacity and energy,
  chemistries, monitors, what protects it and its warnings, and an
  "incomplete" note naming what is missing. With Live mode on each card shows the
  bank's voltage, state of charge and time remaining from SignalK, and so do
  battery boxes on the circuit diagram and the schematic and the battery's page.
  The time remaining is only the monitor's own `capacity.timeRemaining` value
  (seconds, null while nothing discharges is normal and reads "not
  discharging" when the current shows no discharge; the SignalK specification
  makes current positive when it flows out of the battery). Nothing is
  computed: with no value there is no runtime. A reading older than a minute is
  shown stale. Device pages and the device form carry the battery fields.
- A Conduits tab: list conduits with zone and kind filters, create and edit
  them (the kind is a dropdown with an "Add kind..." entry, like the device
  type), and on a conduit's page add cables to it or take them out, change
  the order a cable passes through its conduits, and attach photos. The
  cable table on the Cables tab names the conduits of each cable.
- A zones manager to rename, merge and remove zones, and zone and tag
  filters on the circuit, wire run and device lists. These three lists also
  have a search box (name, label, type, zone, tags) and a "Show removed"
  toggle, off by default and remembered per list in the browser. Device names
  in the cable table and on a circuit page link to the device, a load summary
  row links to its circuit, and a circuit's cable rows link to the Cables tab.
  A device or a cable can be duplicated; a cable copy opens in the cable form
  prefilled so its ends can be changed before saving.
- Photo/file attachment upload and viewing per wire run or device: any
  number of photos, and PDF schematics or other files alongside them.
  Images open full size; PDFs and other files show as labelled tiles. On a
  device, one image can be marked as its icon (and cleared again), which is
  then shown in device lists, on the circuit diagram and on floorplan
  markers. Deleting the icon image clears the icon. A "Take photo" button
  next to "Add file" opens the phone camera.
- An auto-generated circuit diagram (devices joined by cables, negative
  returns dotted) rendered from the derived circuit, per circuit.
- A change log view per record, showing prior edits.
- A settings panel for the installation's convention
  (ABYC E-11 / DIN EN ISO 13297 / freestyle), used only to drive UI
  labeling hints (e.g. suggested wire colors), never enforced.
- CSV import: upload a spreadsheet, map its columns to wiring fields (or
  skip them), preview the resulting devices and cables, then
  import. A row is a cable to a device; the supply side comes from a "from
  device" column, a supply device column, or a fuse made from the circuit
  grouping column. Devices are matched by name ignoring case against those
  already recorded and created when missing; circuits follow the cables,
  and the old circuit column names the derived circuits afterwards. Column mapping rather than a fixed layout, since a real-world
  export's columns won't match another boat's. A column can name the
  conduits of each cable (several in order, separated by ; or >); conduits
  already recorded are matched by name ignoring case and reused, and the
  others are created.
- A floorplan view: upload a top-down or side drawing, calibrate it
  once, then place devices by clicking (one 3D position shown in both
  views), draw wire run routes over it (click to add, drag to adjust),
  and read the measured cable length, offered as a suggestion next to
  the recorded length and never applied automatically. Selecting a
  circuit highlights its devices and routes in both views. The bow and up
  arrows sit in a small fixed box in the top right corner of each plan view
  and do not scale with the zoom. In the Draw route tool, with a wire run
  chosen, clicking its To device appends that device's position as the last
  route point and finishes the route (the run selection clears and the tool
  goes idle); clicking any other device only shows "This route ends at <To
  device>". Where a route leaves a plan (a point outside the plan's height
  range) a short stub with an arrow and the link "continues on <plan name>"
  is drawn at the last visible point; the link switches to the first plan,
  by name, of the same view that shows the next point, and points without a
  height never produce one. The route panel names the chosen cable and has a
  "Delete wire run" button that works like deleting a wire on the schematic
  (no confirmation, Undo, permanent delete when the Undo window ends); there
  is no key shortcut for it. Escape cancels the in-progress route or the
  current tool; Delete removes the selected waypoint or clears the selected
  device's placement (it becomes "not placed", with Undo).
- Conduits on the floorplan: draw a conduit's route like a cable's (it is
  drawn as a thick line under the cables), and see its cables highlighted.
  A cable with no route of its own is drawn along its conduits and its
  measured length comes from them: each conduit counts for its whole
  length, in the cable's order, turned to meet the one before, with a
  straight link counted where two conduits do not meet. A cable with a
  route of its own keeps it. A cable with neither shows nothing; the
  floorplan says how many cables are not drawn and lets you pick one to
  draw.
- A Schematics tab: several named diagrams of the electrical system, for
  example "12 V system" or "Shore power and inverter". Create, rename and
  remove pages. A page is an SVG canvas with pan (drag the background) and
  zoom (wheel or buttons). Place existing devices from a list, or make new
  ones from a palette by role (battery or source, consumer, fuse or switch,
  converter) by clicking or dragging a type onto the canvas; a new device is
  named in place. Drag devices to arrange them, or Auto-arrange them left to
  right from the supply. Devices show their terminals as dots; a device whose
  terminals name ports shows one block per port (see the ports section).
  AC and DC cables are drawn differently: DC is a solid line and AC a long-dash
  line, so they differ in the red night theme too, and each wire carries a
  marker at its midpoint, a tilde for AC and the DC symbol for DC (IEC 60617).
  A cable's second conductor is a thin line beside the first. No public
  standard prescribes a line style for AC against DC on boats, so the
  pattern is this plugin's own convention; only the symbols follow IEC 60617.
  Floorplan routes use the same dash pattern for AC without markers. Drag from a
  terminal or from a device's connect handle to another device or terminal
  to draw a wire: the cable exists as soon as it is dropped, a popover asks
  Positive, Negative or Positive + negative with an optional gauge and
  length, "More..." opens the full cable form, and the derived circuit is
  shown at once. Wires are routed with right angles and coloured by
  conductor (red positive, black negative, brown line, blue neutral, green
  earth, red-shifted shades at night), with gauge and label on hover; a
  selected wire shows handles to add, move and remove bend points. Selecting
  a wire or picking a circuit highlights the devices and wires of that
  circuit. A cable whose other end is not on the page is a short stub with a
  tab "to <device>": clicking it jumps to a page that shows that device or
  adds it here. Deleting a wire (the button or the Delete or Backspace key)
  removes the cable at once with no confirmation: an "Undo" message is shown
  and, when it ends without a click, the cable is deleted permanently with
  its history and attachments (admin only; if that fails the cable stays
  removed and a notice says so). "Remove from this page" or the Delete key
  on a selected device only takes it off this page, with Undo; the device
  itself is never removed from a canvas. Escape cancels a drag, a popover or
  the selection; keys are ignored while an input, select or textarea has
  focus.
- A Connect tool on the floorplan, beside Select, Place device and Draw
  route: click the From device (supply side), then the To device, then the
  route waypoints on the plan, then Finish. The same popover asks the
  conductors, and the cable gets the drawn route and its measured length.
  Finishing with no waypoints records no route and no length.
- A Live mode (plan 0017) on the floorplan (a tool beside Select, Place
  device, Draw route and Connect), on the circuit diagram and on
  schematics (a Live button). Consumers show on or off from the SignalK
  state of the in-line switch that feeds them, read from the SignalK stream.
  Clicking a consumer switches it through that switch, asking for
  confirmation where flagged and saying so when the switch feeds several
  consumers. A consumer no switch can reach is greyed, a never-remote one is
  greyed with a lock, a switch device is shown and clicked on its own, and a
  live reading of the nearest trustworthy meter shows under a consumer where
  one exists. A tooltip says which switch operates it and what else that
  switch feeds. Needs a read-write login to switch; reading needs none.
- A Calibrate load dialog on a consumer's page. A mode choice, delta or
  watch. Delta switches the device on and off (by the plugin where a
  switch reaches it, otherwise by hand with prompts such as "Turn on the
  kettle, then press Continue") against a chosen meter, records a resting
  reading, the load once it has settled, and the resting reading again, three
  times by default, and gives the average step with its spread and warnings
  for noise, drift or a step too small to trust. Watch records the meter
  while the user runs the device, for the average, the peak and the duty
  cycle (the share of time above the "on" threshold, by default 10 percent of
  the peak and at least three times the resting noise, changeable before
  accepting). Timings have defaults that can be changed. For hand-switched
  steps the dialog shows the live reading and notices a clear step in the
  meter and continues by itself (switchable off). Progress is polled while
  the run executes in the plugin; the result offers Accept, Reject and
  Repeat. A shared switch gives a group result recorded on the switch with
  its consumers listed. A watt meter gives an exact figure; an amps meter
  gives amps times the circuit voltage with a power factor of 1, marked as an
  estimate. A meter that counts the load negatively (a battery discharge
  current) is handled. The device page shows the latest accepted figures
  beside the rated power.
- A panel load summary: per derived circuit, the wattage of the
  consumers it ends at converted to amps via the circuit's voltage (watts
  divided by volts; on AC circuits a rated consumer's power factor is applied
  when set), checked against the rating of the fuse or breaker that
  protects it. A consumer with an accepted calibration run counts at its
  measured peak for the breaker check, and the measured average is shown
  for energy; the table says whether a circuit is measured, partly measured
  or rated, and whether any figure is an estimate. An "incomplete" circuit
  says under its badge what is missing (voltage, rating or both) and what to
  do, the badges have tooltips and a legend sits under the table. A group figure is counted
  once per circuit, and a measured figure takes no power factor. The summary
  states its own known limitations in the UI (a device fed by more than one
  circuit counts its full wattage on each; peaks are summed as if they
  coincided) rather than presenting a number without that caveat.

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

- Cable / device data model with full CRUD via the UI, circuits derived from the cables.
- Managed zone list plus free-text tags on wire runs and devices.
- Conduits: shared cable paths with their own route and assigned cables.
- Photo/file attachments on wire runs and devices.
- Change log (append-only) on edits.
- Auto-generated per-circuit diagram view.
- Terminals, trip ratings and nominal voltages on devices, conductors per cable.
- Convention setting (drives labeling hints only).
- CSV import with column mapping (moved out of deferred — see below).
- Panel load summary.
- Floorplan view with device positions and measured wire routes.
- Schematics: drawn diagrams from which cables are created, and a connect
  tool on the floorplan.

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
- **Conduits are records with assignments on the conduit, and a layer on
  top of cables.** A conduit is a physical thing with its own route that
  several cables share, so it is not a label on the cable. Cables are added
  from the conduit's page, and circuits are still derived from the
  electrical connections; a conduit only says where cables run. The route,
  not the conduit, decides what is drawn: a cable with its own route keeps
  it, so a cable only partly in a conduit is handled by giving it a route
  or by splitting it at a junction. Fill estimates and derating are left
  for later.
- **A schematic draws the cables, it does not own wiring.** A wire on a
  schematic is the cable record, so drawing one creates the cable through the
  same payload the cable form builds, and circuits, the load check and the
  change log follow without a second source of truth. A page stores only
  layout (which devices, where, and any bend points), so the same device can
  sit on several pages and the pages stay small and readable; a cable shows
  on a page when both its devices are there, and as a labelled stub when only
  one is, so nothing is hidden. Layout moves are not logged, because the
  wiring facts are logged on the cable.
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
- **Switching goes through the plugin, on the in-line switch (plan 0017).**
  The control path lives on the relay, switch or breaker module in the
  wiring, and a consumer is switchable when one sits between its supply and
  it. The plugin sends the PUT rather than the browser so it can refuse,
  require a confirmation and log, and the same code serves the live view and
  calibration. A shared switch has the strictest flags of everything behind
  it, because turning it off turns all of it off. Results of a shared switch
  are a group figure and are never split between its consumers
  automatically: that would present a guess as a measurement.
- **Circuits are derived from the cables (plan 0014).** A circuit used to be
  created first, by hand, as an empty shell with free-text source, breaker
  and panel fields that overlapped with devices (a breaker is a device).
  Now you record cables between devices and circuits follow, so there is
  one place to enter wiring and nothing to keep in step. The retired fields
  (`sourceLabel`, `breakerRating`, `panelRef`, `panelDeviceId`) are gone;
  the rating comes from the fuse or breaker device. A circuit made by hand
  in an older version is kept as a removed record with its name and notes.
  Older free-text cable ends were matched to devices by name where
  possible; an end that matched nothing is kept as a note on the cable. The
  floorplan panel link went with the panel field, since the protecting
  device and its position say it.
- **Retired design, kept for history: `circuit.source` split into `sourceLabel` + `breakerRating`.**
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
  circuit that feeds it**, not split proportionally. Correct handling
  needs per-wire-run power data, which isn't collected — the summary's
  own UI states this rather than presenting a precise-looking number
  that isn't.
