# Implementation Plan: 0032 - Show the simple icons

Finishes the display part of plan 0029 for the simple icon set. The detailed
icons stay deferred.

## Overview

The built-in simple icon library (`public/builtinIcons.js`, 52 icons and
`iconFor(device)`) exists but nothing draws it. The icons now appear wherever a
device is listed, so lists, pickers, diagrams and the device page read by type
at a glance.

## Decisions agreed with the user

- **Where the icons appear:** the Devices list rows; the schematic palette and
  the add-device and type pickers; the device page title; and the circuit
  diagrams and the tables that name devices (circuits, cables, load summary).
- **A device's own attached icon image wins.** Where the app shows an attached
  image today, it still does. The built-in icon is used only for devices
  without one.
- **Tables with two devices per row show an icon before every device name,**
  both From and To, so a device name looks the same everywhere.
- **Sizes: 18 px in lists and tables, 20 px on palette buttons, 28 px next to
  the device page title.**
- **Not in this plan:** the detailed icons, icons inside schematic boxes
  (issue #23), and the schematic icon color field, which stays stored only.

## Approach

### 1. A shared icon component (`public/deviceIcon.js` or in `app.js`)

- A `DeviceIcon` component that takes a device (or a type string) and a size,
  and renders the inline SVG from `simpleIconSvg(key, size)` in a span with the
  right class. It is decorative (`aria-hidden`), uses `currentColor`, the muted
  text color in lists and the normal text color on the device page, and follows
  both themes through the text tokens.
- A `DeviceLabel` component: the icon, then the device name, then nothing else,
  used wherever a device name is drawn from a device object. A device with an
  attached icon image keeps that image through the same component, so the rule
  "own image wins" lives in one place.
- Unit tests for the choice (own image, built-in icon, unknown type falls back
  to the role icon, a missing device draws no icon).

### 2. Places

- Devices tab rows; the schematic "New device" palette buttons (icon and
  label) and the add-device and type pickers; the device page title (28 px); the
  circuit diagram nodes (the diagram already shows an attached image when there
  is one); and the device names in the circuits list, the cables table (From
  and To) and the load summary table.
- Rows must not grow taller or jump when the icon loads (the icon is inline
  SVG, not fetched); long names still truncate as today.

## Defaults reviewed with the user

- 18 px in lists, 28 px on the page, 20 px on palette buttons (confirmed).
- An icon before every device name in two-device tables (confirmed).
- Icons are decorative: the type name stays as text and no extra tooltip is
  added.
- The release version is chosen by the user.

## Test Strategy

- Pure tests for the icon choice and the label rule.
- Headless Chromium on the mock server: the Devices tab, the cables and circuits
  tables, the load summary, the device page and the schematic palette in day and
  night themes, at desktop and tablet width, with a device that has an attached
  image and one without.
- A text scan that every place above uses the shared component and no list
  draws a device name without it.

## Implementation Steps

- [ ] The shared components and tests.
- [ ] Devices list, pickers, palette and the device page title.
- [ ] Circuit diagrams and the circuits, cables and load summary tables.
- [ ] Screenshots, SPEC.md, ARCHITECTURE.md, README, CHANGELOG, tick plan 0029
      step 4 for the simple set.

## Files to Create/Modify

- New `public/deviceIcon.js` (or `DeviceIcon` in `public/app.js`),
  `public/app.js`, `public/schematicView.js` (palette only), `public/style.css`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Detailed device icons (plan 0029) and icons in schematic boxes (issue #23).
- Using the schematic icon color field in lists.

## Open questions

None. The decisions and the reviewed defaults are above.
