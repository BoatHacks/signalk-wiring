# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

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
