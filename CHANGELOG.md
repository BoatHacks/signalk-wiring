# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
