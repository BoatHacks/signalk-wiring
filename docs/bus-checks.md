# Bus checks: the limits, the sources and the assumptions

This page is for review (plan 0037, issue #4). It says what the NMEA 2000 bus
checks assume and where every number comes from. The checks are advice, not a
guarantee: the bus maker's own instructions and your installer decide. The
limits live in one data file, `src/busLimits.json`, which cites the same
sources; each limit is one line there and can be changed later.

## Summary for review

**Limits used (the lower figure where sources disagree)**

| Check | Limit used | Warning at | Sources |
| --- | --- | --- | --- |
| Backbone length, micro cable | 100 m | 90 m | Garmin (length page, glossary), Actisense, Digital Yacht |
| Backbone length, mini cable | 100 m | 90 m | the same |
| Backbone length, maxi cable | 100 m | 90 m | Garmin and Digital Yacht (Actisense gives 250 m for heavy cable), see the assumptions |
| One drop | 6 m | none | Garmin (both pages), Actisense, Digital Yacht |
| All drops together | 78 m | 70.2 m | Garmin and Actisense 78 m (Digital Yacht gives 76 m) |
| Devices on the bus | 50 | 45 | Garmin, Actisense, Digital Yacht |
| Terminators | exactly 2 | none | Actisense, Digital Yacht |
| One LEN | 0.05 A (50 mA) | | Digital Yacht |
| Bus current against the supply rating you enter | the rating | 90 percent of it | none, your own figure |
| Bus current above the standard supply figure | 3 A (60 LEN) | warning, when your rating is higher | Digital Yacht (Actisense gives 4 A micro, 8 A mini) |
| Nominal bus voltage, for the circuit load | 12 V when the circuit has no voltage | | Actisense (devices need 9 to 16 V) |

**Assumptions to confirm**

1. **Total drops 78 m (decided by the user).** Garmin and Actisense say 78 m,
   Digital Yacht 76 m. The plugin uses 78 m; change `totalDropLengthM` to use
   76 m.
2. **Maxi backbone 100 m, the same as micro and mini (decided by the user, the
   strictest reading).** Actisense gives 250 m for mid and heavy cable, while
   Garmin and Digital Yacht give 100 m without separating cable classes. Change
   `backboneLengthM.maxi` to use a longer limit for heavy cable.
3. **The three classes** are micro, mini and maxi as recorded on the backbone;
   the guides name cable grades (lite, mid, heavy) and connector sizes. Micro
   and mini use the light cable figure, maxi the heavy cable figure.
4. **The bus current limit is the supply rating you enter** on the backbone
   (the fuse or the supply device). Without one the check says "cannot check".
   The 3 A figure is only a warning level, because the guides differ by
   connector size.
5. **A device without a LEN counts as unknown**, never as zero. A sum that is
   already over the rating fails even when some LENs are missing, because the
   known part is a lower bound.
6. **Drop lengths are in metres.** The backbone length uses its own unit (m, ft,
   in, cm or mm); another unit cannot be converted and reads "cannot check".
7. **A device on two ports** of one backbone counts once for the device count
   and the LEN, and both drops count for the drop total.
8. **A warning is 90 percent of a limit.** The per drop limit and the terminator
   count have no warning level.
9. **Voltage drop along the backbone** is not checked yet.

**The bus load on the circuit.** The load of a bus is added to the circuit that
its power feed joins: the circuit protected by the fuse, breaker or source named
as "fed from" (else the circuit that source supplies, else one it sits in). Per
device, LEN times 0.05 A times the circuit voltage (12 V if the circuit has
none) in watts; a device with no LEN counts its rated power instead; a device
with neither is counted as unknown wattage. The Load Summary, the cable checks
and `GET /load-summary` see it and say it comes from a bus. If the device that
makes the power feed also has a rated power of its own on the same circuit, it
is counted there too.

**Not covered:** the open limits review box of plan 0037 stays unticked until you
have confirmed this page.

## What is checked

1. Backbone length for the cable class.
2. Each drop at most 6 m.
3. All drops together at most 78 m.
4. At most 50 devices.
5. Exactly two terminators.
6. Bus current (LEN total times 0.05 A) against the supply rating.
7. A power feed is present.

Each result is ok, warning, fail or "cannot check", with the numbers used, the
reasoning, and the sources. "Cannot check" names what is missing: the cable
class, the backbone length, a drop length, a LEN, or the supply rating.

## Sources

Only the figures were taken; no text is copied.

- Garmin, NMEA 2000 Cable Length and Device Limitations:
  https://www8.garmin.com/manuals/webhelp/GUID-1415AAD0-FE63-42A6-8F8D-DB713D616122/EN-US/GUID-D30B8240-E352-4F53-89CD-3E7DFD78FCAF.html
  (100 m between any two points, drop 6 m, all drops 78 m, 50 devices)
- Garmin, NMEA 2000 Glossary:
  https://www8.garmin.com/manuals/webhelp/GUID-1415AAD0-FE63-42A6-8F8D-DB713D616122/EN-US/GUID-9C47C97C-88A2-4EC6-9846-9B6937C3ACA7.html
  (drop 6 m, a backbone cable 100 m)
- Actisense, 3 fundamentals of designing an NMEA 2000 network:
  https://actisense.com/news/3-fundamentals-of-designing-an-nmea-2000-network/
  (lite 100 m, mid and heavy 250 m, drop 6 m, all drops 78 m, 50 nodes, a
  terminator at each end, 9 to 16 V at the devices, 4 A micro and 8 A mini)
- Digital Yacht, NMEA 2000 Networking Guide:
  https://digitalyacht.net/nmea-2000-networking-guide/
  (backbone under 100 m, supply under 3 A or 60 LEN, 1 LEN is 50 mA, drop 6 m,
  all drops under 76 m, 50 devices, two terminators; the plugin uses 78 m, chosen by the user)

## Where it shows

`GET /buses` returns each backbone with its derived data and checks. The web
app (the Buses tab) reads that route; it keeps no second copy of the rules. The
code is `src/buses.js`; the tests (`test/buses.test.js`) work each case out by
hand in comments.
