# Implementation Plan: 0030 - Device colors

## Overview

Two new device properties, "schematic box color" and "schematic icon color",
both hex values with a color picker. The box color is used on the schematic
boxes now. The icon color is stored and edited now and used once icons are
drawn in the schematic boxes (issue #23).

## Decisions agreed with the user

- **Box color: fill and outline.** The outline is the full color and the fill
  is a light tint of it, about 18 percent mixed into the theme's surface. Text
  keeps its theme color, so it stays readable.
- **Icon color: store only.** The field is saved, edited and shown on the
  device page, but nothing draws it until the icon-in-box work (issue #23). No
  icon is added to the schematic boxes by this plan.
- **Night theme: dim it.** In the red night theme the custom colors are
  darkened and shifted toward red, so a bright box does not glare.
- **Applies to all schematic boxes, enclosure boxes included.** Floorplan
  markers keep their role colors.

## Approach

### Data (`src/store.js`, `src/schema.sql`, `src/resources.js`)

- Migration 17 adds `devices.schematic_box_color` and
  `devices.schematic_icon_color` (TEXT, nullable), guarded and safe to run
  twice; `schema.sql` is updated.
- Validation in the store: empty or null clears the field, otherwise a hex
  color `#rrggbb` (a `#rgb` short form is expanded), stored lower case; anything
  else is rejected with a clear message. Changes are logged like any field.
- The device resource serves `schematicBoxColor` and `schematicIconColor`, and
  accepts them on write. CSV import and export do not carry them.

### Device form and page (`public/deviceFields.js`, `public/app.js`)

- Two fields in the device form, each with a text input for the hex value, a
  native color picker (`input type="color"`) kept in sync with it, and a Clear
  button. An invalid hex value shows an inline message and is not saved. An
  empty field means "theme color".
- The device page shows both values with a swatch.

### Schematic (`public/schematicView.js`, `public/style.css`, new
`public/colorTone.js`)

- A pure `colorTone.js`: `parseHex`, `normalizeHex`, `boxFill(hex, surface)`
  (the 18 percent mix), and `nightTone(hex)` (luminance mapped to a dim red
  of the same relative brightness, capped so it never glares). Unit tests.
- A device box with a color sets its outline to the color and its fill to the
  tint, through inline style variables on the box so selection, highlight and
  dim states keep working. The role colored outline is used only when no color
  is set. Night mode applies `nightTone` to both.

## Defaults reviewed with the user

- Light tint of about 18 percent for the fill (confirmed).
- Applies to enclosure boxes too (confirmed).
- Colors are stored lower case, `#rgb` is accepted and expanded.
- The release version is chosen by the user.

## Test Strategy

- Pure tests: `parseHex`, `normalizeHex`, `boxFill`, `nightTone` (never
  brighter than the cap, gray in gives dim red out).
- Store tests: migration 17 twice, round trip, `#rgb` expansion, rejection of
  invalid values, clearing, change log entry, old rows read as null.
- Headless Chromium on the mock server: the form (typing a hex, picking a color,
  clear, invalid value), the schematic box in day and night themes, selected,
  highlighted and dimmed states, an enclosure box.

## Implementation Steps

- [ ] Migration 17, store validation, resource fields, with tests.
- [ ] Device form and page fields.
- [ ] Schematic box fill and outline, night tone, with tests.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG.

## Files to Create/Modify

- `src/store.js`, `src/schema.sql`, `src/resources.js`, `public/deviceFields.js`,
  `public/app.js`, `public/schematicView.js`, `public/style.css`, new
  `public/colorTone.js`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Drawing the icon in the schematic box in the icon color (issue #23).
- A color per schematic page placement instead of per device.
- Showing the box color on floorplan markers.

## Open questions

None. The decisions and the reviewed defaults are above.
