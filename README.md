# signalk-wiring

A SignalK plugin + webapp for documenting a boat's physical electrical
wiring: devices, the cables between them, and the circuits those imply, with photos and a full change
history — so tracing a fault or explaining the boat's electrical system
to someone else doesn't depend on the current owner being present.

## Features

- **Cables between devices, circuits worked out for you**: you record
  cables from the supply side to the load side of devices (battery, fuse,
  switch, lamp) and the circuits follow. A circuit is what one fuse or
  breaker protects; an unfused run is still a circuit, flagged. A cable lists
  its conductors (positive, negative, AC line, neutral, earth) with colours,
  and a negative can land on its own bus bar. Fuses and breakers carry a
  trip rating, batteries and sources a nominal voltage, and any device can
  declare terminals (with ports on converters). The cable form has a "New
  device..." entry on both ends, so nothing needs setting up first. A device
  can be fed by more than one circuit, and can record its rated power
  draw and a SignalK path (e.g. `electrical.switches.anchorLight`) it
  corresponds to. You can name a circuit and add notes.
- **Conduits**: record the conduits, hoses, looms, trunking and cable trays
  that cables share, with an optional route on the floorplan. Add cables to
  a conduit from its page; a cable can pass through several in order. A cable
  with no route of its own is drawn, and measured, along its conduits.
- A **role** on every device (consumer, source, storage, distribution or
  converter) so power sources such as solar, shore power or a generator,
  batteries, switches and inverters are told apart from the things that
  use power. Only consumers count towards a circuit's load.
- **Zones** (e.g. "engine room") on cables and devices, chosen from a
  managed list you can rename and merge, plus free-text **tags** for other
  groupings such as an audio zone, with zone and tag filters on the lists.
  Wire gauge/length recorded with explicit units (AWG or mm²; meters or
  feet) — boats often mix US and EU-sourced equipment.
- Full CRUD via the admin webapp: inline create/edit forms, no page
  reloads.
- **CSV import**: upload a spreadsheet, map its columns to wiring
  fields (or skip them), preview the result, then import — generic
  column mapping rather than a fixed layout, so it isn't tied to one
  particular spreadsheet's shape. It imports devices (matched by name,
  created when missing) and the cables between them, and circuits follow.
  A column can name each cable's conduits.
- **Panel load summary**: per derived circuit, the rated wattage of its
  consumers converted to amps via the voltage of its supply (with an
  optional power factor on AC) and checked against the rating of the fuse or
  breaker that protects it, flagging circuits over their rating.
- **Nothing is ever hard-deleted.** "Removing" a record marks it
  `removed` rather than dropping it, so the wiring's history stays
  intact — a refit doesn't erase what used to be there.
- A **change log** per record: every create/edit/removal is timestamped
  with a before/after diff, viewable from the webapp.
- The same look as the stowage webapp: a header bar, an underlined tab
  strip, and a red-shifted **night theme** that protects night vision,
  switched by a button or, with the `autoTheme` option, by the vessel's
  `environment.sun` or `environment.mode`.
- **Schematics**: several named diagrams of the electrical system. Place
  devices (or create them from a palette by role), drag a wire from one to
  another and the cable and its circuit exist; wires are right-angled and
  coloured by conductor, can be bent, and cables to devices on other pages
  show as labelled stubs. Auto-arrange lays a page out from the supply.
- A **connect tool** on the floorplan: pick the From and To devices, click
  the route, and the cable gets the drawn route and its measured length.
- A **floorplan view**: upload a top-down or side drawing (SVG, PNG,
  JPEG or WebP), calibrate it once with two clicks and a real distance,
  then place devices by clicking (one 3D position shown in both views)
  and draw wire run routes over it. The route's measured length is
  offered next to the recorded length. Several deck plans are supported,
  each with an optional height range.
- **Device icons**: mark one of a device's images as its icon, shown in
  device lists, on circuit diagrams and on floorplan markers.
- **Photo/file attachments** per cable, device or conduit (JPEG/PNG/WebP/HEIC/
  PDF, 15MB cap).
- An **auto-generated diagram** per circuit (devices joined by cables), laid out and rendered client-side.
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
login (plan drawings need any logged-in user on signalk-server 2.36 or
later, admin on older servers); a logged-out visitor can browse but not edit, and the webapp
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
