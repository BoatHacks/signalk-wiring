# Demo yacht

A fictional boat for demonstrations: a 12 V yacht with a house, a starter and a
bow thruster battery, shore power, an inverter/charger, an alternator, three
solar arrays and four relay banks. Everything in it is invented. This folder is
not part of the npm package (`package.json` `files` is `index.js`, `src` and
`public`); it lives in the repository so a demo server can download it.

## What is here

- `wiring.db`: the plugin's SQLite database with the whole boat.
- `plans/` and `attachments/`: the plugin's drawing and attachment folders,
  empty for now (a `.gitkeep` each). The floorplan drawings and the device
  positions are added later.
- `source/boat.json`: the human-readable description of the boat the database
  is built from. Edit this, never the database.

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

The builder uses the plugin's own `Store`, so the schema, migrations and
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
