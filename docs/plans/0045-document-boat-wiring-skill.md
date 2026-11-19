# Implementation Plan: 0045 - An agent skill that documents a boat's wiring

Issue: [#45](https://github.com/BoatHacks/signalk-wiring/issues/45). Status: proof of
concept. The skill has not been run end to end by a new user on another boat.

## Overview

Filling in the plugin by hand is the hardest part of using it. An AI coding agent
(Claude Code, Codex and similar) can do most of the work if it is told how: gather what
the owner already has (factory schematics, refit plans and bills of materials, panel
photos), turn that into devices and cables, ask the owner about the gaps one question
at a time, and iterate until the model matches the boat. This plan adds that knowledge
to the repository as an agent skill, plus the small tools the agent needs.

The approach was proven on one boat: a 56 ft motor yacht with a 24 V LiFePO4 house bank,
two split-phase inverter/chargers, two engine buses and the original builder's panels.
The plugin was empty at the start. At the end it held about 240 devices, 260 cables and
130 circuits, every breaker on its feed with its rating, and 47 photos. It was built
on a local SignalK server and then copied to the boat's server. That work was done
with private, boat-specific notes and scripts. The skill makes it repeatable by any
SignalK user, without assuming that boat's setup.

## Relevant SPEC/ARCHITECTURE sections

- SPEC.md §1.3 and §2 (terminology, how circuits are worked out), §4 (data model),
  §6.1 (resource API, query routes, OpenAPI document, access levels).
- The skill does not change the plugin. It writes only through the resource API and
  the attachment routes, so the store keeps every rule and change log.

## Decisions to confirm

1. **It lives in this repository**, under `skills/document-boat-wiring/`, so it is
   versioned with the data model it describes. The alternative is a separate repository.
2. **Agent Skills format**: a `SKILL.md` with front matter plus reference files and
   tools. Claude Code loads it from `~/.claude/skills/` (or a project's `.claude/skills/`).
   Other agents that read the format, or a plain "read SKILL.md and follow it", work too.
3. **The model is built on a local sandbox server first**, then copied to the boat's
   server. The sandbox is cheap to throw away and reseed, and the owner reviews it in the
   web app before anything touches the boat. The skill can also write straight to the
   boat's server if the owner prefers, but warns against it.
4. **The copy to the boat goes through the API by default.** It needs only the boat
   server's address and an admin token. The token comes from a SignalK access request
   that the owner approves in the Admin UI, so no password passes through the agent. A
   file copy of `wiring.db` is described as an alternative. It is for an owner with shell
   access, and only before the plugin's first start on the boat.
5. **No boat data in the repository.** Examples use a small made-up boat. The owner's
   notes, scans and photos stay in a working folder outside the repository.

## Approach

### The skill (`skills/document-boat-wiring/SKILL.md`)

Phases, in order. Each phase ends with the owner's go-ahead.

1. **Set up.** Agree on a working folder, check Node.js 22.13 or newer, and find the
   boat's SignalK server: address, version, whether security is on, and whether the
   plugin is installed. Read the plugin's OpenAPI document from that server, or from the
   sandbox when the boat server is older than 2.31.
2. **Gather.** Show the owner a checklist of useful material and what each one gives:
   - the owner's manual wiring section (DC and AC sheets, breaker panels, component boards);
   - refit and upgrade plans, bills of materials, invoices and installer drawings;
   - the owner's own marked-up drawings;
   - phone photos of every panel, bus bar, fuse block and battery bank, labels legible,
     including "before" photos of anything changed;
   - battery and charger nameplates;
   - the SignalK data tree, read from the boat's server.

   The material is inventoried in `notes/sources.md`, and nothing is uploaded anywhere.
3. **Profile.** Build `notes/boat-profile.md` from the material and a short interview:
   - the system voltages and banks;
   - shore and generator arrangement;
   - what was changed from factory, and what is original;
   - where things are;
   - how the boat's server is reached.

   This replaces the private boat notes the proof of concept relied on.
4. **Model.** Write `wiring-data.mjs` from the material, following the modelling guide.
   Load it into the sandbox with the seed tool. Read back the derived circuits, the
   plugin's own checks and warnings, and the gap report.
5. **Interview and iterate.** Ask about gaps one question at a time, most consequential
   first. Each question carries its context, for example "in your engine room photo,
   the block left of the bus bar". Correct the data, reseed, and repeat.

   Record conflicts and assumptions with an `unverified` tag and a note. Rank the sources:
   - the owner's word;
   - photo labels;
   - the owner's own markups;
   - as-built drawings;
   - design plans;
   - the factory manual, which is right for whatever was not changed.

   Plans proved wrong more often than the owner's markups. Offer to annotate an image when
   the owner cannot tell which part a question means.
6. **Review.** The owner clicks through the sandbox web app. Optionally the agent drafts
   schematic pages.
7. **Install on the boat.** Copy with the transfer tool and verify the counts and
   photos. From then on the boat's copy is the master, and the seed tool must never run
   against it. Leave a short note in the working folder saying so, plus a pointer the
   owner can add to their own agent instructions.

Safety rules carried in the skill:
- never handle the owner's password;
- never restart, reconfigure or change security on the boat's server;
- ask before every write to the boat's server;
- never send the owner's material to outside services;
- treat registration numbers and serials in the material as private.

### Reference files (`skills/document-boat-wiring/reference/`)

- `gathering.md`: the checklist above with what each item gives, how to photograph a
  panel so the labels can be read, and privacy notes.
- `interview.md`: the question bank by system (house bank, distribution, charging,
  engine start, AC sources, generator, panels and breakers, loads, monitoring and
  SignalK paths), how to ask, and when to stop asking.
- `modelling.md`: how to express a real boat in the plugin's model. It points to SPEC.md
  for the rules and adds the recipes and traps found on the proof-of-concept boat:
  - **Fuse ratings:** a fuse with no rating counts as no fuse, so record ratings or
    circuits merge.
  - **Converters:** cables to a converter must name its terminals.
  - **Battery solenoids:** the plugin treats relays and solenoids as closed. A solenoid's
    always-on input stud is therefore its own device, and a normally open bridge gets both
    sides wired into it.
  - **Banks:** batteries paralleled through fuses and a bus bar need explicit `parallel`
    link cables to form one bank.
  - **Junction boxes:** a box that splits AC inputs and joins outputs is two devices.
  - **Link bars:** model them as zero-length cables.
  - **Shared runs:** cables in one run become a conduit.
  - **Parallel conductors:** dual conductors are not added together by the cable check.
  - **Gauges:** 1/0 to 4/0 are stored as 0 to -3, and factory wire numbers often encode
    the gauge.
  - **Circuit names:** protected circuits are named through their protector, unprotected
    ones through a member device.
  - **SignalK paths:** link devices to the paths found on the boat's server.
  - **Tags:** `unverified`, `original` and `not connected`.
- `reading-drawings.md`:
  - scanned sheets are too large to read whole, so crop and zoom;
  - split a set of sheets across parallel readers with a set brief and verify their key
    claims yourself;
  - the factory manual can be wrong, for example a sheet printed twice under two titles.
- `sandbox.md`: run a local SignalK server with the plugin (npm or Docker, macOS,
  Linux and Windows), on its own port and config folder, security off, and stop it after.
- `install.md`: the API copy, the file copy, getting the token, and what to verify.

### Tools (`skills/document-boat-wiring/tools/`, Node.js, no dependencies)

- `sandbox.mjs`: `up`, `status` and `down`. It installs signalk-server and the plugin
  into a folder of its own, writes a minimal settings file with security off, enables the
  plugin, starts the server on a free port and prints the address.
- `seed.mjs`: loads `wiring-data.mjs` into a server through the resource API.
  - Each record's id is a UUID derived from its key, so a rerun updates in place.
  - It purges records the data marks as retired, names circuits, assigns cables to
    conduits and uploads photos.
  - It refuses to run against a server marked as the master.
- `gaps.mjs`: lists what is still missing:
  - unverified records;
  - fuses and breakers with no rating;
  - unconnected devices;
  - cables with no gauge;
  - unprotected circuits;
  - the plugin's own warnings and cable check failures (`/derived`, `/checks`).
- `transfer.mjs`: copies a source server's wiring to a target server through the API.
  - It copies zones, devices, cables, conduits, backbones, schematics, plans and circuit
    names, keeping every id, plus the attachments and plan drawings, with icon references
    remapped.
  - It checks the counts afterwards.
  - It writes only to an empty target unless told otherwise.
- `token.mjs`: requests access on a server, waits for the owner to approve it in the
  Admin UI with admin permission, and stores the token in a file only the owner can read.
- `crop.mjs`: crops and enlarges part of a scan or photo so text can be read. It uses
  Python with Pillow, ImageMagick or macOS `sips`, whichever is installed.
- `wiring-data.example.mjs`: a complete small boat, documented. It is the template and
  the test fixture.

## Test strategy

- Unit tests under `test/` for the pure parts:
  - id derivation;
  - validation of a data file (duplicate keys, unknown devices, zones and retired keys);
  - building resource bodies from the data (AWG encoding, conductors, units);
  - the transfer plan order and id remapping.
- An integration run, by hand and written up in the pull request:
  - `sandbox up`, then seed the example boat and run `gaps`;
  - start a second sandbox as the target, transfer, and compare counts, photos and
    derived circuits;
  - seed again to show it is idempotent.
- The proof-of-concept boat's data is reloaded into a sandbox with the new tools as a
  larger check. It is not committed.

## Implementation steps

- [x] Open an issue describing the skill and link this plan:
      [#45](https://github.com/BoatHacks/signalk-wiring/issues/45). The decisions
      above still need the maintainer's agreement.
- [x] Tools: seed, gaps, token, transfer, sandbox, crop, with tests for their pure parts
- [x] Example boat data file
- [x] SKILL.md and the reference files
- [x] Integration run on sandboxes; fix what it finds
- [x] README section "Documenting your boat with an AI agent", CHANGELOG entry

## Integration run (done)

- The example boat was seeded into a sandbox, reseeded after edits (idempotent; a
  retired key was deleted), and three photos and a device icon were added. It was then
  copied to a second, empty sandbox: every record, circuit name, photo (byte for byte)
  and the remapped icon matched.
- The plugin's demo boat was copied the same way and matched exactly. That covers
  121 devices, 118 cables, 8 schematic pages with bends and enclosure pages, 4
  floorplans with drawings, a backbone and 55 circuits.
- A sandbox with security on refused anonymous writes. The token tool's access request
  was approved as admin, and the copy then went through with the token.
- The proof-of-concept boat's data file (239 devices, 262 cables) seeded into a fresh
  0.9.5 sandbox in about 3 seconds, with all 107 circuits named.
- Problems found and fixed during the run:
  - the free-port check failed on macOS;
  - the NMEA 0183 and SignalK TCP servers clashed between two servers on one computer
    (the sandbox now turns them off);
  - stale default circuit names were left over from seeding cable by cable;
  - a 401 was reported as a missing plugin.

## Files to create/modify

- `skills/document-boat-wiring/SKILL.md`
- `skills/document-boat-wiring/reference/{gathering,interview,modelling,reading-drawings,sandbox,install}.md`
- `skills/document-boat-wiring/tools/{sandbox,seed,gaps,transfer,token,crop}.mjs`, `lib/*.mjs`
- `skills/document-boat-wiring/tools/wiring-data.example.mjs`
- `test/skill-*.test.mjs`
- `README.md`, `CHANGELOG.md`
