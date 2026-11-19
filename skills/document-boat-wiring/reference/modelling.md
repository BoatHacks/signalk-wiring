# Modelling a real boat in signalk-wiring

The rules are in the plugin's `SPEC.md` (sections 1.3, 2 and 4) and in the server's
OpenAPI document (`/skServer/openapi/plugins/signalk-wiring`). Read them first. This
file covers how real boats map onto those rules, and the traps found while modelling
one: a 56 ft motor yacht with a refit lithium bank, split-phase inverters and the
original builder's panels.

The data file format is described at the top of `tools/wiring-data.example.mjs`.

## The essentials

- **A cable runs from the supply side (`from`) to the load side (`to`).** Draw
  chargers' output cables from the fuse at the bus to the charger, even though charge
  current flows the other way. The fuse protects the cable from the battery, so the
  battery side is the supply side.
- **Circuits are worked out, never entered.** A circuit is what one fuse or breaker
  protects: the cables on both sides of it up to the nearest bus bar, and everything
  downstream until the next fuse or breaker. Read the derived circuits back after every
  seed. They are the best test of the model.
- **A fuse or breaker with no `tripRatingA` counts as no fuse at all.** Its cables
  merge into the circuit upstream, or show as unprotected. Record the rating whenever
  it is known. When it is unknown, keep the device, tag it `unverified`, and expect the
  merged circuit until the rating is filled in.
- **Converters need terminals, and cables to them must name the terminal.** This
  covers chargers, inverters, inverter/chargers, DC-DC converters, solar controllers and
  isolation transformers. Give the device `terminals` with ports (for example `In+`/`In-`
  on port `in`, `Out+`/`Out-` on port `out`), and name the terminal on the positive or
  line conductor of every cable that ends on it (`toTerminal: 'In+'`). Without that the
  plugin cannot tell which side a cable is on, and warns `converter-port-unknown`.
- **A cable is DC or AC, never both.** Earth and signal conductors may join either kind.
- **Keys are forever.** A record's id comes from the namespace and its key, so renaming
  a key creates a new record. To replace one, give the new key and add the old one to
  `retired`.
- **Gauges:** AWG 1/0 to 4/0 can be written `'1/0'` .. `'4/0'` (stored as 0 to -3).
  Factory wire numbers often carry the gauge after the dash: `308-14 BRN/RED` is
  14 AWG. Record the gauge of the run, not of the short pigtail at the panel.

## Recipes

**Battery bank paralleled through fuses and a bus bar.** The plugin forms a bank only
from cables joining batteries directly. Model the real path: battery, its terminal
fuse, the bus bar. Then add link cables between the batteries with `link: 'parallel'`
(or `'series'`), noted as "bank link only, not a physical cable". The Batteries tab
then shows one bank with its layout, capacity and energy. Link cables take no part in
circuits.

**Battery switches, solenoids and relays.** The plugin treats every switch and relay
as closed. That matters in two cases:
- *A solenoid whose input side also feeds always-on circuits.* Model the input stud as
  its own device (role distribution, type Stud). The feed lands on the stud, the stud
  feeds both the solenoid and the always-on fuses, and the solenoid feeds the switched
  side. Otherwise the always-on circuits look switched.
- *A normally open bridge*, such as an emergency start solenoid between the house and
  engine buses. Draw both cables *into* the solenoid, one from each bus, so neither bus
  appears to be fed from the other.

**Link bars and studs.** A bus bar bolted to another through a link bar, or a fuse
holder on a bus stud: a cable with `len: 0` and a note ("BEP 2-way link bar, not a
cable"). The gap report does not ask for a gauge on zero-length cables.

**Paralleled conductors (dual 4/0).** Use one cable with two positive conductors and
note it. The cable check counts conductors in one cable as bundled, not as sharing the
current. A failed size check on such a run needs a human look, not a change.

**Junction boxes that split and join.** A box that splits one AC feed to two inverter
inputs and joins their outputs is two devices: "AC in split" and "AC out join". As one
device it would connect the inverters' inputs to their outputs.

**Bundled runs.** Several cables sharing one physical run, such as a 6-wire bundle
carrying an AC feed and its return: a conduit (kind "Cable bundle") holding those cables.
The cable checks then derate them for bundling.

**Shunts.** An ammeter shunt sits in series, in its branch: cable to the shunt, then
on to the load. A battery monitor shunt on the negative side carries the battery
negatives. Give batteries `monitor: '<shunt key>'`, and the shunt the SignalK paths.

**Panels.** A breaker panel can be an enclosure (`role: 'enclosure'`), with its breakers
as `parent: '<panel key>'`. Each feed into a panel bus is a cable to a distribution
device for that bus (the panel's "port 24 V always on" bus, for example). Breakers hang
off it with zero-length cables. Panels fed from two places, such as an always-on (LINE)
and a switched (LOAD) feed, need one bus device per feed.

**Original equipment.** Tag parts and cables the owner never changed `original`. When
the factory drawings are trusted for them, say so in the notes. A tag filter then shows
the factory system at a glance.

**Equipment present but not connected**, such as a disconnected bow thruster: keep the
devices, leave out the feed cable, tag them `not connected`, and say why in the notes.

**Splices.** A load spliced into another load's feed, such as a sensor powered from a
pump's breaker: a cable from that breaker (or a Splice device) to the added load, with a
note. Circuit tracing then shows the load goes off with that breaker.

**AC split phase.** 240 V loads take `line, line, earth` (plus `neutral` when 120/240).
120 V loads take `line, neutral, earth`. Note which leg. Mark AC distribution devices
`current: 'ac'`. With 0.9.5 or later, a device with `role: 'ground'` (the bonding point)
lets earth cables join circuits.

**Control wiring.** Relay coils, remote-start lines, sense leads and data cables use
`signal` conductors. They are documented but take no part in circuits.

## Naming circuits

- Name protected circuits through their fuse or breaker in `circuitNames`, with an
  optional `meterPath` and `meterUnit` that measures the whole circuit.
- Name unprotected stretches (feeders between bus bars, starter cables) in
  `groupNames`, by devices they contain.
- The plugin names a circuit once and carries the name over when the circuit changes.
  The seed renames ones left with a stale default ("Unprotected: ...") once they have a
  breaker.

## Linking to SignalK

Use the paths found in the boat's data tree:
- `signalkPath` for what the device is (for example `electrical.solar.290`);
- on batteries, `voltagePath`, `currentPath`, `socPath` and `timeRemainingPath`;
- `meterPath` with `meterUnit` `A` or `W` for something that measures current or power
  through the device.

The paths are free text and are not checked against live data. `switchPath` makes a
device switchable from the web app's Live view. Set it only when the owner asks for
switching and understands it acts on real relays.

## Checking the model

After each seed:
1. **The gap report** (`tools/gaps.mjs`): unverified records, unrated fuses and
   breakers, devices with no cable, power cables with no gauge, unprotected circuits,
   warnings, failing cable checks.
2. **The derived circuits:** each has the supply, rating and loads you expect. Surprises
   to look for:
   - a bus fed from the wrong side;
   - a load in a circuit with a much bigger fuse than its own;
   - an "Unprotected" circuit that has a breaker in reality.
3. **The banks** (`/plugins/signalk-wiring/derived`): layout, voltage and capacity as
   the owner describes them.
4. **Trace a few loads** (`/plugins/signalk-wiring/trace/<device id>?direction=up`),
   such as a bilge pump. Check that the path to the battery is the real one, and that it
   stays live when the main switch or solenoid is off when it should.
