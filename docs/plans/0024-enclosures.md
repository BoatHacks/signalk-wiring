# Implementation Plan: 0024 - Enclosures

Tracks GitHub issue #19.

## Overview

An AC breaker box or a DC distribution panel can hold other devices (breakers,
bus bars, fuses, switches), so the contents do not each have to be placed on
the floorplan. On a schematic, such an enclosure acts as a link to its own
"inside" schematic, which shows the wiring of its contents.

## Decisions agreed with the user

- **A separate "Enclosure" role.** Enclosures are a new device role, used for
  breaker boxes, distribution panels and similar housings. Cables are drawn
  to the devices inside, not to the enclosure itself, so circuit derivation,
  the load summary and the protection checks do not change.
- **Contents: any device, enclosures may nest.** An enclosure can hold any
  device, including other enclosures, to any depth (a cabinet holding a
  breaker box holding breakers). A device has at most one parent, and a
  cycle is refused.
- **Floorplan: only the enclosure is placed.** The contents show in the
  enclosure's marker (a count, and a list in its popover) and cannot be placed
  on a plan separately. Taking a device out of its enclosure makes it
  placeable again.
- **Boundary cables: ports derived from the cables.** On the outer
  schematic the enclosure is drawn as one box with one port per cable that
  crosses its boundary, named after the inner device and terminal. The same
  cables appear on the inside page as "to <outer device>" stubs. There is no
  port list to maintain by hand.
- **The inside page is created on demand, one per enclosure.** Opening an
  enclosure on a schematic creates its inside page the first time, named after
  the enclosure, with the contents placed and auto-arranged. It is an ordinary
  schematic that can be edited, appears in the schematic list and is marked as
  the inside of that enclosure.
- **Removing an enclosure removes its contents too**, after a confirmation
  that lists them. This is the user's choice; the plan keeps it as decided and
  adds the safeguards below.

## Approach

### Data

- Migration 15 adds `devices.parent_id` (TEXT, a device) and
  `schematics.enclosure_id` (TEXT, the enclosure this page is the inside of),
  guarded and safe to run twice. `role` accepts `enclosure`.
- The store validates `parent_id`: it must be an enclosure, not the device
  itself, with no cycle through nested enclosures; logged like any field.
  `enclosure_id` is set only by the "open inside" action, one page per
  enclosure (unique).
- Removing an enclosure (the existing removed state) removes its contents and
  their cables the way a removal does today, as one undoable action, and
  removes its inside page. Undo restores all of it. Permanent deletion keeps
  the existing rule that a device with live or removed cables is refused, so
  the contents' cables must be purged first.

### Derived data (pure, `src/enclosures.js`)

- `contentsOf(id)` (direct and all nested), `pathOf(id)` (the chain of
  enclosures), and `boundaryCables(enclosureId)`: the live cables with exactly
  one end inside the enclosure (at any depth). Each gives the outer port: the
  inner device and terminal, the conductors, and the outer device it connects
  to. A cable with both ends inside is internal and shown only on the inside
  page.
- The resource layer serves `parentId` on devices and `enclosureId` on
  schematics, and the boundary cables with the enclosure.

### UI

- **Device form and page:** Role "Enclosure"; a "Inside" picker (an enclosure)
  on every other device; an enclosure's page lists its contents and has an
  "Open inside schematic" button; "in <enclosure>" shows on a device page.
  The Devices tab shows the enclosure in a column and can filter by it.
- **Floorplan:** a device with a parent is not placeable (the placement
  tools skip it and say why); the enclosure's marker shows the count and its
  popover lists the contents with links.
- **Outer schematic:** an enclosure box shows its name, the count of contents
  and a link mark; double-click opens the inside page (created the first
  time), and the box has one port per boundary cable, in the schematic's
  normal style, so the router and the checks work unchanged. Devices inside an
  enclosure cannot be added to an outer page that does not contain their
  enclosure.
- **Inside schematic:** an ordinary page; boundary cables end in "to <outer
  device>" stubs (reusing the off-page stubs); a header link goes back to the
  outer page.
- **Removal:** the confirmation lists the contents and their cables; the
  undo message restores everything.
- Plan 0023's double-click on a device opens the device page; on an enclosure
  box in a schematic it opens the inside page instead (the device page stays
  one click away from the inspector).

### Defaults chosen without asking

- Existing breaker boxes and panels are not converted; the user changes their
  role to Enclosure by hand, and puts the contents inside by hand (a bulk
  "Inside" action on the Devices tab handles several at once).
- The inside page is named "<enclosure name> (inside)".
- A boundary port's name is "<inner device> <terminal>".
- A device removed from an enclosure stays on the pages it was placed on; on
  the inside page it is placed by auto-arrange when first created.
- The plan version is chosen by the user at release.

## Test Strategy

- Pure `enclosures.js`: contents and path through nested enclosures, a cycle
  refused, boundary cables with one end inside, internal cables ignored.
- Store: migration 15 safe to run twice, `parent_id` validation (not an
  enclosure, itself, a cycle), one inside page per enclosure, removal and undo
  of an enclosure with contents, purge refusal rules.
- Webapp in headless Chromium: setting the role and the Inside picker, the
  floorplan marker and count, the placement skip, the outer box with derived
  ports, creating and opening the inside page, the stubs, and removal with
  undo; the router and circuits unchanged on the boat's pages.

## Implementation Steps

- [x] Migration 15, the store fields and validation, `src/enclosures.js`, with
      tests.
- [x] Device form, page and list: role, the Inside picker, contents, filter,
      bulk Inside.
- [ ] Floorplan: skip contents when placing, the enclosure marker and popover.
- [ ] Schematic: the enclosure box with derived ports, the inside page, the
      stubs and links.
- [ ] Removal and undo with contents.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and a comment on issue #19.

## Files to Create/Modify

- `src/store.js`, `src/schema.sql`, `src/resources.js`, `src/routes.js`, new
  `src/enclosures.js`.
- `public/app.js`, `public/deviceFields.js`, `public/schematicView.js`,
  `public/schematic.js`, `public/floorplan*.js`, `public/router.js`,
  `public/style.css`.
- Tests, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Several inside pages for one enclosure, or choosing an existing page as the
  inside.
- Setting a device's zone from its enclosure.
- Enclosure-level load and heat summaries.

## Open questions

None. The design questions (role, nesting, floorplan, boundary cables, inside
page, removal) are settled above; the defaults list is for review.
