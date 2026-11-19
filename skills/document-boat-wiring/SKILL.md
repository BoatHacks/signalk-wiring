---
name: document-boat-wiring
description: Document a boat's whole electrical system in the signalk-wiring SignalK plugin, working with the owner. Gathers what they have (owner's manual wiring sheets, refit plans and parts lists, photos of panels and bus bars), builds the devices, cables and circuits on a local sandbox server, interviews the owner one question at a time to fill the gaps, iterates until the model matches the boat, then installs it on the boat's own SignalK server. Use when someone wants to document, map, model or fill in their boat's wiring, or asks for help with signalk-wiring data entry.
---

# Document a boat's wiring in signalk-wiring

You help a boat owner turn what they know and have (drawings, plans, photos,
memory) into a complete, checked model of the boat's electrical system in the
`signalk-wiring` plugin: every source, battery, bus bar, fuse, breaker, switch and
load, the cables between them, and the circuits the plugin works out from them. The
end result lives on the boat's SignalK server, where the owner and future agents can
look up what feeds what.

Expect a large boat to take a long session. A first useful model comes early; the
rest is iteration.

## How to work

- **One question at a time**, most consequential first. Give each question its
  context ("in your engine room photo, the covered block left of the bus bar"). When
  the owner cannot tell which part you mean, crop and mark the image and show it.
- **Show before you advance.** Each phase ends with the owner's go-ahead.
- **Never guess silently.** When you assume something or two sources disagree, record
  it: tag the record `unverified` and say why in its notes. Leave unknown values blank;
  the gap report finds them.
- **Rank the sources** when they disagree:
  1. the owner's word, the most recent first;
  2. labels in photos;
  3. the owner's own marked-up drawings;
  4. as-built drawings;
  5. design plans and parts lists;
  6. the factory manual.

  Plans often show what was intended, not what was built. The factory manual is right
  for whatever was never changed.
- **Read the plugin's rules before modelling.** They are in `SPEC.md` sections 1.3, 2
  and 4 of the signalk-wiring repository. On a server running signalk-server 2.31 or
  later they are also in the OpenAPI document at
  `<server>/skServer/openapi/plugins/signalk-wiring`. Then read
  `reference/modelling.md`, which covers how real boats map onto them.

## Safety and privacy rules

- Never ask for, type or store the owner's SignalK password. To write to a server that
  has security on, use `tools/token.mjs`: the owner approves an access request in the
  Admin UI and the token goes to a file only they can read.
- Ask before every write to the boat's server. Never restart it, change its settings,
  security or plugins, or install software on it.
- Use `tools/seed.mjs` only against the sandbox. Once the model is on the boat, the
  boat's copy is the master: changes are made there, in the web app or through the
  API, and the data file is history.
- The owner's material stays on their computer. Do not upload drawings or photos to
  outside services. Registration numbers, hull numbers, serials and addresses are
  private: keep them out of anything shared, and ask before putting them in the model.
- Treat the cable checks and load figures as advice, never as a safety verdict, and
  say so when you report them.

## The working folder

Agree on a folder with the owner (for example `~/boat-wiring/<boat name>/`) and keep
everything for this boat in it:

```
sources/        drawings, plans, parts lists, photos (the owner's material)
notes/
  sources.md        inventory of the material: what each item covers, its date, how trusted
  boat-profile.md   the boat as you understand it (built in phase 3)
  open-questions.md what still needs an answer
crops/          zoomed parts of drawings and photos
wiring-data.mjs the model as data (see tools/wiring-data.example.mjs)
.wiring-token   access token for the boat's server, if needed (never share it)
sandbox/        the local server (tools/sandbox.mjs), safe to delete at the end
```

If the folder is a git repository, ignore `.wiring-token` and `sandbox/`.

## Phases

### 1. Set up

- Check Node.js is 22.13 or newer (`node --version`). If it is older, help the owner
  install a current LTS release first.
- Find the boat's SignalK server: its address, whether it can be reached from this
  computer, and whether signalk-wiring is installed on it and at which version
  (`<server>/plugins/signalk-wiring/version`). Note how the owner reaches it: on board,
  remotely, or only by carrying this computer to the boat. Do not change anything there.
- Start the sandbox: `node <skill>/tools/sandbox.mjs up --dir <folder>/sandbox`
  (see `reference/sandbox.md`). Use the same plugin version as the boat when it has
  one (`--plugin signalk-wiring@<version>`).
- If the boat's server already has wiring data, pull it into the sandbox first with
  `tools/transfer.mjs`, and build on it rather than starting over.

### 2. Gather

Show the owner the checklist in `reference/gathering.md`, say what each item gives,
and let them collect what they have; it is fine to start with little. Look at
everything they provide and write `notes/sources.md`. Read the boat's SignalK data
tree (`<server>/signalk/v1/api/vessels/self/electrical`, read-only) to learn which
batteries, chargers, inverters, solar controllers, switches and pumps already report
data and under which paths.

### 3. Profile

From the material and a short interview (`reference/interview.md`, first section),
write `notes/boat-profile.md`. It covers:

- system voltages and where each comes from;
- battery banks;
- charging sources;
- how shore power and the generator are selected;
- the inverters;
- which panels exist and where they are;
- what was changed from factory, and what is original;
- how the SignalK server is powered and reached.

Confirm it with the owner. Everything after this builds on it.

### 4. Model

Write `wiring-data.mjs`, starting from `tools/wiring-data.example.mjs` and following
`reference/modelling.md`. Work outward from the batteries:

1. batteries and their fuses;
2. switches and main fuses;
3. bus bars;
4. charging sources and converters;
5. panels and breakers;
6. loads;
7. negatives;
8. AC;
9. links to SignalK paths.

Read large drawings in pieces (`reference/reading-drawings.md`). Then:

```
node <skill>/tools/seed.mjs wiring-data.mjs --check
node <skill>/tools/seed.mjs wiring-data.mjs --url <sandbox address>
node <skill>/tools/gaps.mjs --url <sandbox address>
```

Read back the derived circuits (`/signalk/v2/api/resources/wiringCircuits`). For
every circuit, check that its supply, protection and loads make sense. A circuit fed
from the wrong place, or one called "Unprotected" that you know has a breaker, means
the model is wrong somewhere.

### 5. Interview and iterate

Work through the gap report and `notes/open-questions.md` with the owner, one
question at a time (`reference/interview.md`). After each answer or batch of
answers, fix `wiring-data.mjs`, reseed, and rerun the gap report. Ask for a photo
when it would answer several questions at once. Keep going until the owner is
satisfied; not every gap needs closing. A few unknown breaker ratings are fine if
they are recorded as unknown.

When something you recorded turns out to be wrong, remove the bad records by moving
their keys to `retired`, so the seed deletes them from the sandbox. Do not just drop
them from the file.

### 6. Review

Ask the owner to click through the sandbox web app:
`<sandbox address>/signalk-wiring/`. Point them at the Circuits, Batteries, Load
Summary and Cables tabs. Fix what they find. Offer to draft schematic pages if they
want diagrams.

### 7. Install on the boat

Follow `reference/install.md`.

1. Get a token if the boat's server has security on (`tools/token.mjs`).
2. Check that the plugin is installed and enabled there, and that it has no wiring data
   yet.
3. With the owner's go-ahead, copy with `tools/transfer.mjs`.
4. Verify the counts, the photos and a few circuits on the boat's server.

Afterwards:

- Tell the owner the boat's copy is now the master, and write that at the top of
  `notes/boat-profile.md`.
- Suggest they add a line to their own agent instructions: "The boat's wiring is
  documented in signalk-wiring at `<server>/signalk-wiring/`; read
  `/signalk/v2/api/resources/wiringCircuits` before reasoning about what feeds what."
- Offer to stop the sandbox (`tools/sandbox.mjs down`).

## Tools

All in `tools/`, Node.js 22.13 or newer, no packages to install. Run them with
`node <skill>/tools/<name>.mjs`, where `<skill>` is the folder holding this file.

| Tool | Does |
|---|---|
| `sandbox.mjs up/status/down` | A local SignalK server with signalk-wiring, security off, its own folder and port |
| `seed.mjs <data> --url <sandbox>` | Loads `wiring-data.mjs` (`--check` validates only). Rerunnable; refuses non-local servers |
| `gaps.mjs --url <server>` | What is still missing: unverified records, unrated fuses, loose devices, missing gauges, unprotected circuits, the plugin's warnings and cable checks |
| `transfer.mjs --from <a> --to <b>` | Copies all wiring data, photos and drawings between servers, ids kept. `--dry-run` first |
| `token.mjs --url <server> --out <file>` | Access token through an access request the owner approves |
| `crop.mjs <image> <out> x y w h` | Crops and enlarges part of a drawing or photo (`--info` for its size) |
