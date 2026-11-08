# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Ports. Terminals that name a port are drawn grouped as a block per port, with
  the port name written on the device: inputs on the left, outputs on the
  right, signal ports (data, relays) along the bottom, on schematics and on the
  circuit diagram. A new "signal" terminal and cable type covers VE.Bus and
  relay contacts. A device of type DC-DC converter, MPPT charger, inverter,
  inverter/charger, battery charger or MultiPlus starts with its standard ports
  and terminals (a button fills them in on an existing device). Dropping a wire
  on one terminal of a port picks the matching terminal of the same port for
  the other conductor.
- A device with more than one terminal shows them as separate dots, coloured by
  conductor, on schematics and on the circuit diagram. The name (and port) is
  the hover text; the always-visible terminal labels on schematics are gone.
  A cable that names a terminal ends on its dot.
- New cables start with default conductor colours: red for positive, black for
  negative, brown, blue and green/yellow for AC line, neutral and earth. They
  are filled into the colour fields and can be changed or emptied. Editing an
  existing cable never fills colours in.
- Cables tab: a cable that is already marked removed gets a Delete permanently
  button. It asks first, then erases the cable with its history, attachments,
  conduit assignments and schematic bends. Removing stays the safe default.
- Cables tab: tick several cables (or all shown) and change gauge, length, cable
  label, zone or add tags on all of them at once. Empty fields leave each
  cable as it is.
- A device of type Shunt is metered from its SignalK path (an explicit Meter
  path still wins), so loads downstream of it use its readings for the Live
  view and load calibration.
- "MPPT charger" as a suggested Converter type. "Solar charge controller" is no
  longer suggested as a Source, since a controller changes power and the solar
  panel is the source. Devices already using that type keep it.

### Fixed

- Emptying a text, number or SignalK path field on an edit form (for example
  the device's SignalK path) now clears it; before, the old value was kept.

### Changed

- Cables tab: the Edit, Remove, Attachments and History buttons are icons now,
  with the word as a tooltip.
- Device positions and route points set by clicking on a plan are rounded to
  the centimeter (two decimals), and the position fields step by 0.01.

## [0.4.3] - 2026-11-08

### Added

- Live view: a Live tool on the floorplan, and a Live button on the circuit
  diagram and on schematics. Consumers show on or off from the SignalK
  state of the relay that feeds them, and clicking one switches it through
  the plugin. A consumer nothing can switch is greyed, a never-remote one
  shows a lock, and a live meter reading shows where one exists. Where a
  relay feeds several consumers they all switch together and the tooltip
  says so.
- Switching through the plugin: `POST /switch` (read-write login) refuses
  never-remote devices, asks for confirmation where a device is flagged,
  sends the PUT in the format the path holds, and logs each action on the
  switch device.
- Device fields: switch path, "Confirm before switching", "Never switch
  remotely", meter path and meter unit (also a meter path on a circuit).
  New devices of critical-looking types (bilge pump, refrigerator,
  autopilot, navigation light, windlass) start with confirmation on.
- Load calibration: a Calibrate load dialog on a consumer. Delta mode
  switches it on and off three times against a meter (by the plugin, or by
  hand with prompts and automatic continue when the meter shows a clear
  step) and gives the average with its spread and warnings for noise or
  drift; Watch mode records a device you run yourself and gives the average,
  peak and share of time on, with an "on" threshold you can change. A relay
  shared by several consumers gives a group result. Runs execute in the
  plugin, can be cancelled, and are accepted or rejected; amps meters give an
  estimate (power factor 1), watt meters an exact figure.
- The device page shows the latest accepted measured values beside the
  nameplate rating, and the load check counts a measured device at its
  measured peak (breaker check) and shows the measured average, labelled as
  measured.

- Schematics: a new tab with several named diagrams of the electrical system.
  Place existing devices or create new ones from a palette by role, drag
  them around, or Auto-arrange them left to right from the supply. Drag a
  wire from a device or terminal to another and the cable exists at once: a
  small popover asks Positive, Negative or Positive + negative (with an
  optional gauge and length, and "More..." for the full cable form), and the
  derived circuit is shown. Wires are right-angled, coloured by conductor
  (with red-shifted colours at night), can be bent with draggable points, and
  highlight their circuit when selected. A cable to a device that is not on
  the page is a stub with a tab that jumps to a page showing that device or
  adds it. Deleting a wire removes the cable after a confirmation; taking a
  device off a page never deletes it. Schematics are served as the new
  `wiringSchematics` resource.
- Floorplan: a Connect tool beside Select, Place device and Draw route. Click
  the From device, the To device and the route on the plan, then Finish; the
  cable gets the drawn route and its measured length.

## [0.4.2] - 2026-11-07

### Added

- Circuits are worked out from the cables. Record a cable between two
  devices (from the supply side to the load side) and the circuit it belongs
  to appears: what one fuse or breaker protects, with its rating, voltage,
  AC or DC, supply and end devices. A cable with no fuse is still a circuit,
  flagged "no protection", and moves onto a fuse when you add one, keeping
  its name and notes. Branches off a bus bar are separate circuits; a
  negative can take its own path or land on a negative bus bar.
- A Cables tab with the new cable form: From (supply side) and To (load
  side) device pickers with a "New device..." entry, Positive, Negative or
  Positive + negative (AC and earth under "More"), a "negative lands on at
  the supply end" picker that starts as the last one you used, colour per
  conductor, gauge, length, label, zone and tags. Terminals are asked for
  only on converters and devices with several. The circuit the cable
  belongs to is shown under the form.
- Devices: a trip rating on fuses and breakers, a nominal voltage on
  batteries and sources, terminals (with ports on converters), and a power
  factor on consumers of an AC circuit.
- A `GET /plugins/signalk-wiring/derived` route (readonly) with the battery
  banks and derivation warnings, and a `derived` object on each circuit
  resource.

- Conduits: a new tab for conduits, hoses, looms, trunking and cable trays.
  A conduit has a name, a kind (a dropdown with suggestions, kinds already
  used and an "Add kind..." entry), an optional inner diameter, a zone,
  notes and photos. Cables are added to a conduit on its page; a cable can
  pass through several conduits in order, and the order can be changed.
  Conduits are served as the new `wiringConduits` resource, and the wire run
  resource lists its `conduitIds`.
- Floorplan: draw a conduit's route like a cable's, see the cables along it
  highlighted, and see how many cables are not drawn anywhere, with a button
  to draw each. A cable with no route of its own is drawn along its conduits
  and its measured length is taken from them.
- CSV import: a "Wire run: conduit" column names the conduits of each cable
  (several in order, separated by ; or >). Conduits already recorded are
  matched by name and reused; new ones are created.
- The cable table on the Cables tab names the conduits of each cable, and
  zones count conduits as well as devices and wire runs.

### Changed

- Circuits are a read-only overview (name, notes, voltage override, rating,
  AC or DC, warnings). The circuit creation form and its free-text source,
  breaker and panel fields are gone, as is the floorplan panel link; the
  protecting fuse or breaker device and its position say it. A cable's ends
  are devices instead of free text, and its colour is per conductor.
- The load check reads the derived circuits: consumers only, watts divided
  by volts, with the optional power factor applied on AC circuits, against
  the rating of the protecting device.
- CSV import creates devices (matched by name ignoring case, created when
  missing) and cables; circuits follow, and the circuit column names the
  derived circuits.
- Existing databases are migrated on first start: cable ends are matched to
  devices by name (an end that matches nothing is kept as a note on the
  cable), colours become a positive conductor, and circuits made by hand are
  kept as removed records with their names and notes.
- The device Type field is a dropdown: popular types for the chosen role
  (solar panel, shore power inlet, battery, fuse, inverter, bilge pump and
  more), then types already used on other devices, and an "Add type..."
  entry for anything else. Existing free-text types are kept.
- The axis indicator on calibrated plans uses arrow tips on its lines
  instead of the "to bow" and "up" text labels. Hovering an arrow still
  names its direction.

## [0.4.1] - 2026-11-07

### Added

- Device icons: mark one of a device's images as its icon (or clear it).
  The icon appears in the device list and details, on circuit diagrams and
  on floorplan markers, and is tinted red in the night theme. Deleting the
  icon image clears the icon. Icons are served by a read-only route, so
  they show for anyone who can see the drawing; a device's other
  attachments stay admin-only.
- Attachments: images open full size, PDFs and other files show a labelled
  tile, and the upload button says it takes photos, schematics and files.

### Added

- Plans can be removed from the Floorplan tab. They stay in the record as
  removed, like other records, and placed devices and routes are kept.
- A placed device can be removed from the plans: select its marker and use
  Remove placement, which clears its position in every view.
- Calibrated plans show which way the bow is and an axis indicator on the
  drawing, so a plan calibrated the wrong way round is easy to spot.

### Fixed

- Calibration instructions now say to click the stern end first and then a
  point toward the bow, with the same origin on every plan. A plan
  calibrated the other way round put the same device at the stern in one
  view and the bow in another, and moving it in one view moved it the wrong
  way in the other.

### Changed

- The webapp now looks like the stowage webapp: a dark header bar with a
  theme toggle, an underlined tab strip, warm light surfaces, and a
  red-shifted night theme. Plan drawings are tinted red in the night theme.

### Added

- Plugin option `autoTheme`: follow `environment.sun` or `environment.mode`
  to switch between the light and night themes automatically.

## [0.4.0] - 2026-11-07

### Changed

- Zones are now a managed list instead of free text. Each device and wire
  run has at most one zone, picked from a dropdown with an "Add new
  zone..." entry and a hint explaining what a zone is. Existing zone text
  migrates automatically (spellings differing only in case or padding merge
  into one zone). A new Zones tab renames, merges and removes zones.

### Added

- Device roles: consumer, source, storage, distribution (switches,
  breakers, bus bars, panels) and converter (inverters, chargers, DC-DC).
  Existing devices become consumers. The device form explains each role,
  the list has a role filter, floorplan markers are coloured by role, and
  the panel load summary counts only consumers.
- Free-text tags on devices and wire runs for groupings that are not
  physical areas, such as audio zones.
- Zone and tag filters on the circuit, wire run and device lists.
- A `wiringZones` resource and a zone merge route.

## [0.3.1] - 2026-11-07

### Added

- The SignalK path field on devices suggests paths from the vessel's live
  data tree as you type. Several words match in any order, and any text is
  still accepted so a path can be documented before it exists.

### Fixed

- Creating a circuit, wire run, device or plan, and importing a CSV,
  failed with "crypto.randomUUID is not a function" when the webapp was
  loaded over plain http, which is how most boat LANs serve SignalK. Ids
  are now generated in a way that works without a secure context.

## [0.3.0] - 2026-11-07

### Added

- Floorplan tab: upload top-down and side drawings (SVG, PNG, JPEG or
  WebP), calibrate each with two clicks and a real distance, place
  devices by clicking in either view (one 3D position shown in both),
  and draw wire run routes with a measured 3D length offered next to the
  recorded length. Circuits can name a panel device that routes start
  from, and selecting a circuit highlights its devices and routes.
- Devices gain `posX`, `posY`, `posZ`; wire runs gain `route`; circuits
  gain `panelDeviceId`; a new `wiringPlans` resource. Existing databases
  migrate automatically.

### Fixed

- The plugin configuration had no effect. The default gauge and length
  units now pre-select on new wire run forms, and the wiring convention
  sets the colour field's example placeholder. The settings are served
  read-only at `wiringSettings/config`.

## [0.2.0] - 2026-09-23

### Added

- Circuit `voltage` and `breakerRating` (numeric, splits out of the old
  free-text `source`), wire run `cableLabel`/`switchRef`/`lengthUnit`,
  and device `ratedPowerW`/`signalkPath` fields.
- CSV import: upload a spreadsheet, map its columns to wiring fields (or
  skip them), preview the resulting circuits/wire runs/devices, then
  import — generic column mapping, not tied to one spreadsheet's layout.
- Panel load summary: per active circuit, total connected devices' rated
  wattage converted to amps via the circuit's voltage and checked
  against its breaker rating, flagging circuits over their rating.

### Changed

- `circuit.source` renamed to `sourceLabel`. Existing installations
  migrate automatically on first start after upgrading — no manual
  action needed.

### Fixed

- Numeric form fields (gauge, length, etc.) silently rejected decimal
  values (e.g. `3.5`) due to a missing `step` attribute on the input.

## [0.1.0] - 2026-09-23

Initial release — the full MVP scope from SPEC.md §10.1.

### Added

- Circuit / wire run / device data model, exposed as SignalK resource
  types (`wiringCircuits`, `wiringWireRuns`, `wiringDevices`) with
  anonymous reads and admin-gated writes.
- Removed-but-kept record lifecycle: "removing" a record marks it
  `removed` instead of deleting it.
- Per-record change log (creation, field-level diffs on edit, removal),
  with a webapp view.
- Photo/file attachment upload, viewing, and deletion per wire run or
  device.
- Auto-generated per-circuit wiring diagram (source → wire run(s) →
  device(s)), computed and rendered client-side.
- Admin webapp: browse/search circuits and devices, inline create/edit
  forms, all built on vendored Preact + `htm` with no CDN dependency and
  no build step, so the plugin works with no internet connectivity.
- Configurable wiring convention setting (ABYC E-11 / DIN EN ISO 13297 /
  freestyle) — drives UI labeling hints only, never enforced.
