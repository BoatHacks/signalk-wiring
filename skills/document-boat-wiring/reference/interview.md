# Interviewing the owner

## How to ask

- **One question at a time.** Ask the question whose answer changes the most of the
  model first. Group questions only when they are about the same part and one look
  answers them all ("both 12 V solenoid fuses: same rating?").
- **Give context the owner can act on.** Say which photo, drawing or panel you mean,
  what you see there, and why it matters. Example: "Your engine room photo shows a
  2-stud block with two heavy black cables going down beside the red pair. Is that
  block in the salon or the engine room? In the salon it combines the inverter
  negatives; in the engine room it is the junction the plan called for."
- **Show, do not describe**, when the owner cannot place a part: crop and mark the
  drawing or photo (`tools/crop.mjs`, then draw a box) and show it.
- **"I don't know" is a fine answer.** Record the value as unknown (blank, tagged
  `unverified`, with a note), add it to `notes/open-questions.md` as something to look at
  on board, and move on.
- **Believe the owner over the documents**, but say so when their answer contradicts
  a drawing. Sometimes they will check and correct themselves.
- **Ask for a photo** when it would settle several questions at once.
- **Do not ask what the material already answers.** Use the source ranking in SKILL.md
  to settle a disagreement yourself, and ask only when it matters.

## The questions that save the most work

Ask these early. Each one can settle dozens of records at once.

1. **What was changed from factory, and what was left alone?** The factory drawings can
   then be trusted for everything the owner says is untouched. Example answer: "Nothing
   downstream of the battery solenoids was changed."
2. **What are the system voltages, and where does each come from?** For example 24 V
   house from LiFePO4, 12 V from a DC-DC converter, 12 V engine start from AGMs.
3. **How are shore power and the generator selected?** Transfer switch, interlocked
   breakers, auto transfer, and anything fixed in one position. Which shore cords are
   used?
4. **Where do the main parts physically sit?** Battery compartment, distribution area,
   main panels, inverters.
5. **How is the SignalK server powered and reached?** This affects install and safety.

## Questions by system

Use these as a checklist, not a script. Skip what the material answers.

**Batteries and banks**
- Make, model, chemistry, capacity (Ah) and nominal voltage of each battery.
- How the batteries are joined: series or parallel, through a bus bar or directly.
- Terminal fuses, the main switch, the main fuse (type and rating), and the order they
  are in.
- Battery monitor or BMS: which one, and its SignalK path.

**Distribution**
- Each bus bar: what feeds it and what lands on it. Studs joined by link bars rather
  than cables.
- Each fuse: rating and type (ANL, MIDI/AMI, MRBF, Class-T, blade). Which feed each
  fuse protects.
- Battery switches, solenoids and relays. Which side of each is always live.

**Charging**
- Every charger, DC-DC converter, solar controller, alternator path and inverter/charger:
  where its input and output land, and the fuses on both sides.
- Which charger charges which bank. Any charger that was repurposed.

**Engine start**
- Start batteries, how they are charged, starter cables, emergency parallel or
  combiner, alternator breakers.

**AC**
- Shore inlets and cords, isolation transformer, galvanic isolator, generator breaker.
- The source selector, and the path through inverters, including any bypass.
- Main panel breakers: labels, ratings, which leg or both (240 V), and the loads behind
  them.

**Panels and loads**
- Each panel's breakers: label, rating, and whether it sits on an always-on or a
  switched feed.
- Loads the owner cares about most: bilge pumps (always on?), refrigeration,
  navigation, electronics, windlass, thruster, heads.
- Anything added later and spliced into an existing feed. Note which feed.

**Monitoring and SignalK**
- Which devices report to SignalK, and under which paths.
- Relays the owner switches remotely. This is documentation only: never set up
  switching unless the owner asks.

## When to stop

- Stop when the owner is satisfied, not when every field is filled.
- Before installing, go through the remaining gap report items once with the owner, so
  they know what is still unknown.
