# Implementation Plan: 0019 - AC and DC awareness

Tracks GitHub issue #5.

## Overview

Devices can be marked AC or DC, and the app uses the mark, together with the
ports and terminals it already has, to choose the right cable type when a
cable is drawn: AC with line, neutral and earth from a shore inlet to a
charger's AC in port, DC with positive and negative from the charger's DC out
port to the battery. AC and DC cables are also drawn differently on the
schematic and the floorplan, so they can be told apart at a glance and in the
red night theme.

## Decisions agreed with the user

- **Where the mark lives.** A new device field "Current" with the values AC,
  DC or unset (either or both). Ports get no separate mark: the AC or DC of a
  port comes from its terminals' conductor types (line, neutral and earth are
  AC; positive and negative are DC), so the standard ports already say it. The
  device mark matters for devices without terminals, or whose terminals do not
  decide it.
- **Mismatch.** When the two ends of a new cable disagree (one AC, one DC),
  the quick popover shows a clear warning ("Shore inlet is AC, Battery is
  DC") and asks for the type to be picked deliberately. Nothing is blocked,
  because a real mismatch is sometimes legitimate (a rectifier modelled as one
  device).
- **How marks get set.** New devices start with a mark from their type, and a
  one-time migration fills existing devices the same way from their type and
  terminals. A mark set by hand is never overridden. The user can always
  change it in the device form.
- **Full cable form.** Choosing the From and To devices in the full Cables
  form suggests the cable type by the same rule as the popover, until the user
  picks a type themselves, so both paths agree.
- **Line style.** On the schematic and the floorplan, DC cables stay solid
  lines and AC cables get a long-dash pattern, so they differ even in the
  night theme, where colours are hard to tell apart. Each wire on the
  schematic also carries the standard marker at its midpoint: a tilde for AC and
  the DC symbol for DC (IEC 60617). The second conductor of a cable, today a
  dashed overlay, becomes a thinner paired line alongside, so dashes mean AC
  and nothing else.
- **A cable is AC or DC, never both.** A cable that mixes AC conductors (line,
  neutral) with DC conductors (positive, negative) is rejected with the message
  "A cable cannot carry both AC and DC", in the store (so the API, the forms,
  the quick popover and CSV import all get it; an import row is reported as an
  error). Earth and signal conductors are allowed in either kind, since a
  protective earth or a data pair does not make a cable AC or DC. Reasoning:
  ABYC E-11 (11.16.4.1.5 in the 2003 reprint, not checked against the current
  edition) requires AC conductors that run with DC ones to be sheathed, bundled
  or otherwise kept separate, and a classification society rule for recreational
  craft says an AC circuit shall not share a wiring system with a DC circuit
  unless a separation method is used. ISO 13297:2020 (clauses 17 and 20) was not
  retrieved, so the exact wording there is unconfirmed; the rule is a design
  choice that follows the common requirement, stated as such in the SPEC. The
  live data was checked: no existing cable mixes the two.
- **Conduits that hold both AC and DC cables get a warning, not a block.** The
  standards restrict rather than forbid it. ABYC E-11 (an Ancor reprint of the
  2003 edition, not checked against the current one) says AC conductors that
  run with DC ones must be sheathed, bundled or otherwise kept separate, so
  separate sheathed cables can share a conduit. A classification society rule
  for recreational craft says a DC circuit shall not share a wiring system with
  an AC circuit unless a separation method is used (separate compartments in
  ducting or trunking, a partition on a tray). The UK MCA guidance (MGN 629
  Part 8) wants separate panel boards for AC and DC and AC wiring in twin or
  multicore cable. NEC, a land code, allows it when all insulation is rated for
  the highest voltage present. The ISO 13297:2020 clause text was not retrieved.
  So the warning reads along the lines of "This conduit holds AC and DC cables:
  keep them in separate conduits where you can; if they share one, the AC must
  be in its own sheathed cable, all insulation rated for the highest voltage, and
  ideally a partition", with the cable names listed. It shows on the conduit's
  page, as a line on the Conduits list, and as a notice right after a cable is
  assigned that creates the mix. It never blocks an assignment.
- **Standards.** No public standard prescribes a line style for AC against DC
  on boats. IEC 60617 (DIN EN 60617) defines the AC and DC symbols used as
  labels on conductors; IEC 61082 only governs line widths and types in
  general, where dashed lines conventionally mean something else; ABYC E-11
  requires separate AC and DC wiring diagrams. The markers follow IEC 60617 and
  the pattern is this project's own convention, stated in the SPEC.
- **Not in this plan** (asked about, not chosen): warnings on existing cables
  and on circuits that mix AC and DC in the circuits view, and an AC or DC badge
  on devices.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (device fields, conduits), §7 (UI, schematic and floorplan
  drawing).
- ARCHITECTURE.md §3 (schema and migrations), the schematic and floorplan
  sections.

## Approach

### Data and presets

- Migration 10 adds `devices.current` (TEXT, null, `ac`, `dc`, or null for
  either), guarded so it is safe to run twice.
- The resource maps it as `current` (`'ac'`, `'dc'` or absent). The store
  validates the value and logs a change like any other field.
- Type presets in `public/deviceTypes.js` (mirrored in the store for imports
  and the API, as the critical-type default is):
  - AC: Shore power inlet, Generator, Isolation transformer.
  - DC: Solar panel, Alternator, Wind generator, Hydro generator, Fuel cell,
    Battery, Battery bank, Lead-acid battery, AGM battery, LiFePO4 battery,
    Starter battery, House battery, Shunt, Battery isolator, Battery switch.
  - Unset: converters (MPPT charger, DC-DC converter, inverter, charger: their
    ports say it), other distribution devices, consumers (the supply side
    decides).
- The one-time fill in the migration applies the same table to existing
  devices by type name (case-insensitive), and additionally sets DC for a device
  whose terminals are all positive and negative and AC for one whose terminals
  are all line, neutral and earth. It only writes where `current` is null and
  never touches a device that has a mark.

### The rule (pure, in `public/schematic.js` or a new `public/current.js`)

`endCurrent(device, terminalName)`:
1. The dropped-on terminal's conductor decides: line, neutral or earth is AC,
   positive or negative is DC, signal is none.
2. Else the device mark.
3. Else, when the device has terminals, the current its terminals agree on (all
   AC or all DC); mixed or none is unknown.
4. Else unknown.

`suggestKind(from, fromTerminal, to, toTerminal)` returns
`{ kind, mismatch }`:
- one known end gives that end's current; both known and equal gives it;
- both known and different gives the supply end's current and
  `mismatch: { fromCurrent, toCurrent }`;
- both unknown falls back to today's rule (`defaultKind`: DC both, a lone
  positive at a distribution device, AC for AC terminals);
- AC gives the kind `ac` (line, neutral, earth); DC gives `both`, or a lone
  `positive` when a distribution device is an end, as today; signal-only ends
  still give `signal`.
This replaces the current-detection part of `defaultKind`, which stays as the
fallback. Single-phase only; split-phase and three-phase are out of scope.

### Rejecting mixed cables

- A pure function `mixesAcAndDc(conductors)` (true when a line or neutral
  conductor and a positive or negative one are both present), in
  `public/current.js` for the webapp and mirrored in `src/store.js`, which
  throws "A cable cannot carry both AC and DC" in the wire run write path (a
  list level check next to the existing conductor checks). Per-conductor
  device overrides (the `fromDeviceId` of a negative landing) do not matter for
  this rule.
- The full cable form's kinds already never mix them; its custom kind (editing
  an existing cable with an odd conductor set) shows the same message on save.
  The quick popover and the CSV import surface the store's message.
- Migration 10 does not touch cables (none mix), and the tests cover a mixed
  cable arriving through the resource API.

### Conduit warning

- A pure function `conduitCurrentMix(cables)` in `public/current.js`: for the
  live cables assigned to a conduit, it classifies each as AC, DC or neither
  (the same cable class the line style uses) and returns the AC and DC cables and
  `mixed` when both are present. Removed cables are ignored, as everywhere else
  for conduits.
- `public/conduits.js` and the conduit views use it: the conduit detail page
  shows the warning above its cable list with the cables named under AC and DC;
  the Conduits list shows a short "Mixes AC and DC" line on a mixed conduit; the
  assign action shows the notice when its result is mixed. The text is built by a
  pure function so it is tested, and links to nothing external.

### UI

- **Device form and page.** A "Current" select (Either, AC, DC) with a hint, on
  all roles; the detail page shows it; a new device's value follows the type
  until the user sets it (like the confirm-before-switching default).
- **Quick popover** (`public/quickCable.js`, `public/cablePopover.js`): uses
  `suggestKind`, shows the mismatch warning above the kind choice, and lists
  the AC kind among the offered kinds when it is the suggestion (it already
  does for AC). Choosing a kind keeps working as today.
- **Full cable form** (`CableForm` in `public/app.js`): when the From and To
  devices are chosen and the kind has not been touched, set the kind from
  `suggestKind` and show the same mismatch warning; once the user changes the
  kind it stays theirs. Editing an existing cable never changes its kind.
- **Line style.** A cable counts as AC when it has a line conductor and DC when
  it has a positive or negative one; a signal or earth-only cable is drawn as
  today (a cable cannot be both, see above). On the schematic (`public/schematic.js`
  `conductorTypes`, `WireShape`) AC wires get `stroke-dasharray` of a long dash,
  DC stay solid, the midpoint gets a small marker (tilde or the DC symbol) in a
  neutral token colour, and the second conductor becomes a thin line alongside
  instead of a dashed overlay. On the floorplan route lines (`floorplanView.js`)
  AC routes use the same long-dash pattern; no markers there, to keep plans
  readable. The pattern and marker colours use the existing CSS tokens so the
  night theme works. The SPEC states the convention and why.

### Defaults chosen without asking

These are open to change in review:

- Generator is AC and Alternator is DC; a genset or alternator that is the other
  kind is changed by hand.
- Distribution devices and consumers stay unset.
- The markers appear on schematic wires only, not on floorplan routes.
- The mark is a device field, so CSV import has no column for it in this plan
  (imported devices get the type preset).

## Test Strategy

- Pure: `conduitCurrentMix` (AC only, DC only, both, removed cables ignored,
  signal and earth-only cables counted as neither) and its warning text;
  `endCurrent` and `suggestKind` golden cases (shore inlet to charger AC
  in, charger DC out to battery, both unknown, one known, mismatch, dropped on a
  terminal against the device mark, signal terminals, distribution ends); the
  type preset table; `mixesAcAndDc` (line with positive, neutral with
  negative, earth and signal allowed in either); the cable current class and the line style function
  (dash pattern and marker for AC, DC, signal, mixed).
- Store: a mixed cable is rejected on create and update through the store and
  the resource API, an AC cable with earth and a DC cable with earth are
  accepted; migration 10 is safe to run twice, the one-time fill by type and by
  terminals never overrides a set mark, validation of the value, change log.
- Webapp in headless Chromium against a mock server: draw shore inlet to
  charger to battery and see AC then DC suggested, the mismatch warning in the
  popover, the full form suggestion and that a manual kind sticks, and a
  screenshot of AC and DC wires in the light and the night theme.

## Implementation Steps

- [x] Migration 10, the `current` field in the store and resource, type
      presets, the one-time fill, with tests.
- [x] The rule: `endCurrent` and `suggestKind`, used by the quick popover with
      the mismatch warning, and the rejection of mixed AC and DC cables in the
      store, the forms and the import, with tests.
- [ ] Device form and page: the Current select and the type-driven default; the
      full cable form suggestion and warning.
- [ ] Line style: AC pattern and markers on the schematic, the AC pattern on the
      floorplan, thinner paired second conductor, night theme check.
- [ ] Conduit warning: `conduitCurrentMix`, the conduit page, the Conduits list
      and the assign notice, with tests.
- [ ] SPEC.md, ARCHITECTURE.md, README, CHANGELOG, and a comment on issue #5.

## Files to Create/Modify

- `src/store.js`, `src/schema.sql`, `src/resources.js` (migration 10, the field).
- `public/deviceTypes.js`, `public/current.js` (new, the rule and the line
  style helpers), `public/schematic.js`, `public/quickCable.js`,
  `public/cablePopover.js`, `public/schematicView.js`,
  `public/floorplanView.js`, `public/conduits.js`, `public/app.js`,
  `public/style.css`.
- Tests for the store (mixed cable rejection, migration), the rule, the
  presets and the line style helpers; `public/import.js` for the import error.
- `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Warnings on existing cables and on circuits that mix AC and DC without a
  converter, and an AC or DC badge on devices (both were offered and not chosen).
- Split-phase and three-phase AC (more than one line conductor).
- A CSV import column for the current.

## Open questions

None. The design questions (where the mark lives, mismatch handling, how marks
are set, other uses, the line style) are settled above; the defaults list is
for review.
