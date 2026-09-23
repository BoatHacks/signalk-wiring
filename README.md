# signalk-wiring

A SignalK plugin + webapp for documenting a boat's physical electrical
wiring: circuits, wire runs, and devices, with photos and a full change
history — so tracing a fault or explaining the boat's electrical system
to someone else doesn't depend on the current owner being present.

## Features

- **Circuit → wire run → device** data model: a circuit has a source
  (breaker/fuse) and one or more wire runs; a wire run connects two
  endpoints (a device, a source, or a splice); a device can be fed by
  more than one circuit.
- Free-text **zones** (e.g. "engine room") on wire runs and devices, and
  wire gauge recorded with an explicit unit (AWG or mm²) — boats often
  mix US and EU-sourced equipment.
- Full CRUD via the admin webapp: inline create/edit forms, no page
  reloads.
- **Nothing is ever hard-deleted.** "Removing" a record marks it
  `removed` rather than dropping it, so the wiring's history stays
  intact — a refit doesn't erase what used to be there.
- A **change log** per record: every create/edit/removal is timestamped
  with a before/after diff, viewable from the webapp.
- **Photo/file attachments** per wire run or device (JPEG/PNG/WebP/HEIC/
  PDF, 15MB cap).
- An **auto-generated diagram** per circuit (source → wire run(s) →
  device(s)), laid out and rendered client-side.
- A configurable **wiring convention** setting (ABYC E-11 / DIN EN ISO
  13297 / freestyle) — drives labeling hints in the UI only, never
  enforced on the data, since not every boat follows one standard.
- Works with **zero internet connectivity**: the webapp's dependencies
  (Preact, `htm`, `dagre`) are vendored into the package, never loaded
  from a CDN — this plugin is meant to work at sea.

## Installation

Install from the SignalK admin UI's **Appstore** (search "wiring"), or:

```sh
cd ~/.signalk
npm install signalk-wiring
```

then restart `signalk-server` — plugin updates don't hot-reload.

Requires **Node.js ≥ 22** (see [Why Node ≥ 22](#why-node--22) below).

## Access & security

Circuit/wire run/device **reads** are anonymous — same as SignalK's
built-in `notes`/`routes` resources — reachable at
`/signalk/v2/api/resources/wiringCircuits` (and `wiringWireRuns`,
`wiringDevices`), and the webapp shell itself
(`/signalk-wiring/`) loads without logging in too. **Writes**,
**attachments**, and the **change log** all require the SignalK admin
login; a logged-out visitor can browse but not edit, and the webapp
shows a clear message rather than failing silently. If you expose your
SignalK instance beyond your own network, this is controlled by
SignalK's own `allow_readonly` setting. See
[ARCHITECTURE.md §6](ARCHITECTURE.md#6-security-considerations) for the
full reasoning.

## Why Node ≥ 22

This plugin uses `better-sqlite3` for local storage, pinned to `^13.x`
specifically. Earlier majors (11.x, 12.x) can abort the *entire*
`signalk-server` process with a native crash on Node ≥ 24.19, due to a
GC-finalization race in how they interact with Node's cleanup hooks —
only 13.x's N-API rewrite avoids it. 13.x itself requires Node ≥ 22.
See [docs/plans/0001](docs/plans/0001-scaffold-and-core-data-model.md)
for how this was found and fixed.

## Documentation

- [SPEC.md](SPEC.md) — what this plugin does and why (data model,
  domain rules, MVP scope, design decisions).
- [ARCHITECTURE.md](ARCHITECTURE.md) — how it's built (components, data
  storage, API surface, security model).
- [docs/plans/](docs/plans/) — the implementation history, including a
  few corrections made along the way and why.

## Development

```sh
npm install
npm test
```

The webapp (`public/`) uses [Preact](https://preactjs.com/) and
[`htm`](https://github.com/developit/htm) (JSX-like syntax without a
build step) plus [`dagre`](https://github.com/dagrejs/dagre) for diagram
layout, all vendored as plain ES modules under `public/vendor/` — see
`public/vendor/README.md` for versions and how to update them. No CDN
dependency, no bundler.

## License

MIT
