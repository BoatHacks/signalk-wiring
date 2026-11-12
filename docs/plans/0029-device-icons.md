# Implementation Plan: 0029 - Device icons

## Overview

The app gets a built-in icon library of its own, in two sets: simple icons for
device types, and detailed front-view drawings of the devices on the boat in
which every port and terminal is a distinct visual element. The detailed icons
appear on the device page; showing them in schematic boxes is a separate
roadmap item (issue #23).

## Decisions agreed with the user

- **Two sets.** Simple icons, one per device type. Detailed icons, device
  specific, with every port and terminal drawn as its own element.
- **Detailed icons go on the device page.** Schematic boxes keep their port
  blocks for now; the schematic use is on the roadmap as issue #23, so each
  port element carries the app's terminal name for the later mapping.
- **Scope of the detailed set: the Victron units plus the other boat devices.**
  The Victron units on board are the MultiPlus-II 48/3000/35-32, Cerbo GX,
  GX Touch 50, two SmartShunts, two Orion-Tr Smart 48/12-30A, the solar MPPT
  charger (SmartSolar or BlueSolar 150/35 class, the exact model is not
  confirmed), the isolation transformer (3600 W) and the VE Transfer Switch
  (5 kVA). The other boat devices: BMS, breakers (single pole, 2P, RCBO), bus
  bars, Schuko outlets (single and double), the MEGA fuse holder, the DC main
  switch, the CAN-USB dongle, solar panels, the shore power inlet, the motor
  controller connector and the NMEA 2000 bus connection.
- **Drawn by us.** All artwork is drawn from scratch with simple shapes, using
  the manufacturers' product photos only as a reference for what connectors a
  unit has and where they sit. No tracing, no brand logos, no wordmarks, no
  product photos in the repository.

## Approach

### 1. Icon library (`public/builtinIcons.js`, `public/icons/`)

- Simple icons: 24 by 24 units, line style, `currentColor` stroke, one per
  device type in the app's type list, with a fallback per role and one generic
  icon.
- Detailed icons: SVG files with a viewBox that matches the unit's proportions,
  front view, colours from theme tokens (`currentColor`, `--surface`,
  `--text-muted`) so day and night both work. Every port and terminal is a
  separate element with a distinct shape per connector kind (terminal post,
  screw terminal, ring bolt, RJ45, USB, HDMI, M12 or N2K connector, Schuko
  pin pair, MC4) and a data attribute `data-terminal` that carries the exact
  terminal name used by the boat's cables (for example "AC in L", "DC in +",
  "VE.Direct 1"), plus a `<title>` and a small label where it fits. Terminals
  that are two sides of a pair are two elements.
- A pure `iconFor(device)` that returns the simple key and, if one exists, the
  detailed key, from the device type and model text; unit tests for every type
  and every boat device.

### 2. Display

- Device page: the detailed icon next to the title and a "Ports" strip listing
  the drawn terminals; the device's own attached image icon still wins in lists
  and on the floorplan.
- Devices list rows and the type picker: the simple icon when the device has no
  attached icon image.
- A static preview gallery for review (not part of the app): an HTML sheet of
  all icons at several sizes, in day and night colours.

## Defaults chosen without asking

- The user's own attached icon image keeps priority over the built-in ones in
  lists, circuit drawings and the floorplan.
- The detailed icons are drawn for 230 V and 48 V versions as they are on the
  boat, not for every variant of the product line.
- Where the unit's exact terminal layout is not on the manufacturer's public
  pages, the drawing follows the boat's recorded terminals and says so in a
  comment.
- The release version is chosen by the user.

## Test Strategy

- Pure tests: `iconFor`, that every detailed icon parses as valid SVG, has no
  external references or scripts, has unique `data-terminal` values, and that
  for the boat's devices the set of drawn terminals equals the terminals used by
  the boat's cables and recorded ports (a fixture from the live data).
- Text scan: no brand names or wordmarks in the SVG files, no em or en dashes.
- Headless Chromium: the gallery and the device page in both themes.

## Implementation Steps

- [ ] Simple icons for all device types, `iconFor`, tests.
- [ ] Detailed icons for the Victron units.
- [ ] Detailed icons for the other boat devices.
- [ ] Device page and list display, the review gallery.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and a comment on issue #23
      with the port tagging convention.

## Files to Create/Modify

- New `public/builtinIcons.js`, `public/icons/*.svg`, a gallery file outside the
  app, `public/app.js`, `public/style.css`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Detailed icons in schematic boxes with wires lined up to the ports (#23).
- Detailed icons for devices the boat does not have.
- A user choice between an attached image and the built-in icon per device.

## Open questions

None. The decisions are above; the defaults list is for review.
