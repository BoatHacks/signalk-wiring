# Demo yacht

A fictional boat for demonstrations: a 12 V yacht with a house, a starter and a
bow thruster battery, shore power, an inverter/charger, an alternator, three
solar arrays and four relay banks. Everything in it is invented. This folder is
not part of the npm package (`package.json` `files` is `index.js`, `src` and
`public`); it lives in the repository so a demo server can download it.

## What is here

- `wiring.db`: the plugin's SQLite database with the whole boat.
- `plans/`: the four floorplan drawings, named `<planId>.svg` the way the
  plugin stores an uploaded drawing. `attachments/` is empty (a `.gitkeep`).
- `source/boat.json`: the human-readable description of the boat the database
  is built from. Edit this, never the database.
- `source/drawings/`: the four supplied drawings under their own names, kept
  byte for byte; the builder copies them into `plans/`.
- `source/positions.json`: device name to `x`, `y`, `z` in meters, read by the
  builder (see "Floorplans and positions").

## Use it

1. Stop the SignalK server (the plugin keeps the database open).
2. Copy `wiring.db`, `plans/` and `attachments/` into the plugin's data
   directory (`<server config>/plugin-config-data/signalk-wiring/`).
3. Remove `wiring.db-wal` and `wiring.db-shm` from that directory if they exist.
4. Start the server.

The database has schema version 17. The plugin migrates older databases up,
never down, so the demo server must run a plugin at least as new as the
database (the version of the plugin that built it, or later).

## Rebuild it

```sh
node scripts/build-demo.js            # writes demo/wiring.db
node scripts/build-demo.js out.db     # or somewhere else
```

The builder (which also copies the drawings into `plans/` and applies `source/positions.json`) uses the plugin's own `Store`, so the schema, migrations and
validation are the real ones. It needs Node 22.13 or newer (`node:sqlite`); on a
host with an older Node, run it in the SignalK server container, the way the
tests run there, and copy the file back. The output is deterministic (ids come
from names, times from the fixed build date in the spec), and
`test/demo.test.mjs` fails when the committed database no longer matches the
spec.

## The boat

- 12 V DC: house battery (LiFePO4, 400 Ah), starter battery, bow thruster
  battery; main fuse, battery switch, main positive bus; alternator; shore
  charger with three outputs; three solar arrays, each with a charge controller;
  the engine start circuit and the bow thruster feed with its contactor; a DC
  distribution panel (an enclosure with an inside page); four relay banks (also
  enclosures with inside pages); chartplotter, autopilot, a small data bus with
  signal cables.
- 230 V AC: shore power inlet, an AC panel with breakers, the inverter/charger,
  a water heater and two outlet circuits.
- Conduits: mast, engine room and forepeak, each with assigned cables.
- Pages: "12 V DC", "230 V AC", and one inside page per enclosure.
- Change log: 21 edits over the four weeks before the build date.

## SignalK paths

- Relay channels: `electrical.switches.bank.<bank>.<channel>.state`. Bank 10: 1
  Navigation lights, 2 Stern light, 3 Steaming light, 4 Tricolour, 5 Anchor
  light, 6 Deck light. Bank 11: 1 Black water valve, 2 Cockpit alarm, 3 Ambilight
  TV, 4 Fuel transfer, 5 Tender remote, 6 Deck wash pump. Bank 12: 1 Radio galley,
  2 Nav instruments, 3 AIS power, 4 VHF power, 5 Radio saloon, 6 AIS silent.
  Bank 13: 1 Bow thruster, 2 Fresh water pump, 3 Bilge pump, 4 Fridge, 5 Freezer,
  6 Saloon lights, 7 Cabin lights, 8 Instruments.
- Batteries: `electrical.batteries.house`, `.starter` and `.bowThruster`, each
  with `.voltage`, `.current` and `.capacity.stateOfCharge` (the battery's
  voltage, current and state of charge path fields).
- Solar: `electrical.solar.bimini`, `.deckPort`, `.deckStarboard` on the arrays,
  and `electrical.chargers.bimini`, `.deckPort`, `.deckStarboard` on their
  charge controllers. The shore charger is `electrical.chargers.shore` and the
  inverter/charger `electrical.inverters.main`.

## How the relay channels are modelled

Each channel is a relay device, named after what it switches (for example
"Bilge pump relay (13.3)"), with the channel's SignalK switch path as its
switch path and a trip rating (the channel's fuse). It sits on its bank's bus
inside the bank enclosure and one cable runs from it to the consumer. The live
view derives from the wiring that the consumer is switchable through the
nearest switch device upstream, so every one of the 26 consumers lights up with
its own switch and none shares one. Channel 13.1 is the bow thruster contactor,
fed from the thruster battery through its own fuse, with no trip rating of its
own. The cable's "switch" note (for example "Bank 13 channel 3") is a label
only; it is the switch path on the relay that makes a consumer switchable.
Critical consumers (navigation lights, bilge pump, fridge, freezer, autopilot)
ask for confirmation before switching, as the app does for those types.

## Cable check findings, on purpose

- Cable B13-3, bilge pump: 2.5 mm2 over 14 m for a 4 A load is a voltage drop of
  about 7.7 percent against the 3 percent limit for a critical load. It shows
  "voltage drop high" and a warning mark on the schematic wire.
- Cable B11-6, deck wash pump: a 1.5 mm2 cable (20 A) behind a 25 A relay
  channel. It shows "cable too small" (a failure).

Every other power cable passes (107 checked), and the data bus cables are
exempt. These two are for demonstrating the checks, not examples to copy.

## Floorplans and positions

Four plans, from four SVG drawings of a 36 foot sailboat (bow to the right in
all of them). The hull outline is taken to be 10.9 m long (`hullLengthM` in
`source/boat.json`; the supplied figure, change it there and rebuild if it is
not right). Boat coordinates are meters: x from the stern toward the bow, y
athwartships with 0 on the centerline and positive to port (the top of a top
view), z above the waterline.

| Plan | View | Drawing | Origin (px) | Scale (px/m) | Heights (z) |
| --- | --- | --- | --- | --- | --- |
| Deck | top | deck, 1420x660 | 43, 329 (stern, centerline) | 123.39 | 1.0 to 15 |
| Interior | top | interior from above, 970x370 | 29, 187 (stern, centerline) | 84.04 | -1.5 to 1.0 |
| Side profile | side | exterior with rig, 740x1025 | 26, 885 (stern, waterline) | 62.57 | 1.0 to 15 |
| Interior profile | side | interior section, 1000x265 | 38, 170 (stern, waterline) | 84.77 | -1.5 to 1.0 |

Every calibration has the direction vector `[1, 0]` and no flip, so the bow is
+x and up the drawing is +y (top views) or +z (side views). The scale is the
drawn length of the hull outline divided by 10.9 m, so it differs per drawing.

Heights: z = 0 is the waterline, the deck is about 1.0 m above it and the
coachroof top about 1.6 m. The Interior plans cover everything below the deck
(down to the bilge, -1.5 m), the Deck and exterior side plans cover deck level
and above, up to the masthead (about 13.9 m). The app applies a height range to
top views only (a side view shows every device), so the side plans' ranges are
for information. The exterior drawing puts its deck line at about 1.4 m by its
own waterline, a little above the 1.0 m of the interior drawing: devices at deck
level sit a little low on it.

Positions come from `scripts/place-demo.js`: each zone has a box in boat meters
and its devices (the ones not inside an enclosure; the enclosure itself is
placed) are spread in an even grid in the order of the spec, with a usual height
per zone and a few fixed places or heights (batteries low, the mast items aloft
at x 6.75, lights at their usual places). The script checks that every position
is inside the hull outline of the drawing it shows on and that no two share a
spot, and is deterministic:

```sh
node scripts/place-demo.js            # rewrites source/positions.json
```

| Zone | x (m) | y (m) | usual z (m) |
| --- | --- | --- | --- |
| Lazarette | 1.5 to 3.0 | -0.4 to 0.4 | 0.55 |
| Aft cabin | 2.2 to 3.0 | 0.6 to 1.1 | 0.5 |
| Engine room | 3.35 to 4.85 | -0.45 to 0.45 | 0.2 |
| Galley (port) | 4.0 to 5.5 | 0.55 to 1.3 | 0.7 |
| Nav station (starboard) | 4.0 to 5.5 | -1.3 to -0.55 | 0.8 |
| Saloon | 5.75 to 7.45 | -1.2 to 1.2 | 0.75 |
| Forward cabin | 8.3 to 9.2 | -0.5 to 0.5 | 0.7 |
| Forepeak (anchor locker) | 9.3 to 10.3 | -0.2 to 0.2 | 0.2 |
| Cockpit, Deck, Mast | fixed places | | 1.1 to 13.7 |

72 devices are placed (56 below the deck on the Interior plans, 16 at or above
deck level on the Deck plan); the devices inside an enclosure have no position.
Zones themselves have no position in the plugin's model.

Adjusting on a server and reading back: load the demo into a test server,
move devices on the floorplan, then capture them (the resources are readable by
any logged in user, so a token of any user works):

```sh
node scripts/read-positions.js [token] [baseUrl]    # default http://localhost:3000
```

This writes `source/positions.json` from `GET /signalk/v2/api/resources/wiringDevices`
(devices with a position, by name). Run `node scripts/build-demo.js` in the
container afterwards, and commit the file, the database and `plans/`. Note that
`place-demo.js` overwrites the file again: use one or the other.
