# Gathering the material

Show the owner this list and say what each item gives. They rarely have all of it, and
a model can start from photos alone. Put everything in `sources/` and inventory it in
`notes/sources.md`: what it covers, its date, and how far to trust it.

## Drawings and documents

| Item | What it gives | Where to find it |
|---|---|---|
| Owner's manual electrical section | Factory DC and AC wiring sheets, panel layouts with breaker labels and ratings, component boards, wire numbers and gauges | The manual's wiring section, the builder's owner site, owner forums, a dealer |
| Engine and generator manuals | Alternator, starter and control wiring, generator breaker and output | Manufacturer sites |
| Refit or upgrade plans, parts lists, invoices | What was changed: new batteries, inverters, chargers, solar, bus bars, fuses, cable sizes | The owner, the installer |
| The owner's own marked-up drawings | What was actually built, in their words | The owner |
| Survey reports | Equipment lists, ratings, deficiencies found | The owner |
| Equipment manuals and nameplates | Ratings, terminals, fuse recommendations | Manufacturer sites, photos of labels |

Scans of whole manual pages are fine. Higher resolution is better, since breaker
ratings and wire numbers are printed small.

Factory drawings can be wrong or duplicated. A sheet may carry another sheet's
drawing under its own title. Note it when you find one, and work around it.

## Photos

Phone photos are often the best source of what is really there. Ask for:

- **Every panel, front and back** where it can be opened safely: breaker labels and
  ratings, switch labels.
- **Bus bars, fuse blocks and fuse holders**, close enough that the labels and fuse
  ratings can be read. Each fuse holder, and what lands on each stud.
- **The battery compartment(s)** and the main switch and fuse.
- **Chargers, inverters, DC-DC converters and solar controllers**: the label (model)
  and the wiring underneath.
- **Solenoid, relay and junction boxes**, with the cover off.
- **"Before" photos** of anything that was changed, if the owner has them. They show
  which parts are original.
- **Cable labels** where cables are marked.

Tips to pass on:

- Shoot straight on, in good light, without flash glare on clear covers.
- Take one wide photo for context, then close-ups of each part.
- A photo of a label beats a description of it.
- Name or group the files by location if easy; it does not matter much.

Safety: the owner should not open panels or touch wiring that is live and unprotected
just to take a photo. Photos through clear covers are fine.

## What the SignalK server already knows

Read-only, with no changes:

- `<server>/signalk/v1/api/vessels/self/electrical`: batteries, chargers, inverters,
  solar, DC-DC converters, switches, pumps, with their instance numbers and names.
- `<server>/signalk/v1/api/sources`: which devices and gateways report data.

These give the paths to link devices to (battery voltage and state of charge, charger
current, relay states), and often names the owner has set in their equipment.

## Privacy

The material may hold registration and hull numbers, serial numbers, home
addresses and invoice details.

- It stays in the working folder.
- Do not send it to outside services.
- Do not copy these details into the model unless the owner wants them there. A serial
  in a device's notes can be useful, but ask first.
