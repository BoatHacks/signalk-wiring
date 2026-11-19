# Reading drawings and photos

## Zoom in

A full scanned sheet is usually around 5000 x 3300 pixels, and the agent sees it scaled
down to a fraction of that. Breaker ratings, wire numbers and gauges are unreadable at
that size. Look at the whole sheet once to find the regions that matter, then crop and
enlarge each one:

```
node <skill>/tools/crop.mjs sheet.jpg --info
node <skill>/tools/crop.mjs sheet.jpg crops/sheet6-port-24v.png 1500 1200 1400 1100 --scale 1.5
```

Save crops in `crops/` with names that say what they show, so they can be read again
and shown to the owner. Photos need the same treatment: a fuse rating on a holder in a
wide photo needs a crop.

To point the owner at something, draw a box and a number on a copy, for example with
Python's Pillow, and show it.

## Many sheets: parallel readers

A full set of manual sheets (DC, AC, bridge, engine, generator, windlass and so on) is
too much to read in one pass. Where the agent can start sub-agents, give each one a few
sheets and the same brief:
- the context (system voltages, which panels exist, the feed names used so far);
- the exact facts wanted;
- a structured answer: tables with a confidence per row, "unreadable" rather than a
  guess, and a list of what could not be found.

Ask for, per breaker or fuse:
- its label;
- its rating;
- which feed or bus it is on (for a panel with always-on and switched feeds, which one);
- the wire number, gauge and destination of its output.

Before changing the model, **verify each reader's key claims yourself** on the crops
it saved. A confident misreading is easy to make on a scan.

## What drawings get wrong

- **Plans are not as-built.** A refit plan, a bus bar plan or a parts list says what was
  intended. Where the owner's photos or markups differ, they win.
- **Manuals have errors.** A sheet can be printed twice under two titles, and optional
  equipment can be drawn that the boat never had. Note them in `notes/sources.md`.
- **Two documents can disagree on one value**, for example a fuse drawn as 100 A
  where the holder on board is labelled 80 A. Use the label, keep the other value in the
  notes, and tag the record `unverified` until the owner confirms.
- **Wire numbers carry information.** `117-8 RED/VIO` is wire 117, 8 AWG, red with a
  violet stripe. Matching wire numbers across sheets traces a run through connectors.
