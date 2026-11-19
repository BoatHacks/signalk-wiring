# Installing the model on the boat's server

Ask the owner before each step that writes to the boat's server. Do not restart it or
change its settings; if something needs that, tell the owner what and why, and let
them do it.

## 1. Check the target

- The boat's server answers from this computer: on board, on the boat's network, or
  through whatever remote access the owner uses.
- signalk-wiring is installed and enabled there: `<server>/plugins/signalk-wiring/version`
  answers. If not, the owner installs it from the Admin UI App Store, restarts the
  server, and enables it under Server > Plugin Config. Plugin updates do not hot-reload.
- Use the same plugin version as the sandbox, or newer. If the boat's version is older,
  either the owner updates it, or you rebuild the sandbox with that version and check
  the model there first.
- The target has no wiring data yet (`transfer.mjs --dry-run` says so). If it has some,
  stop and talk to the owner. That data may be newer than the sandbox: pull it into the
  sandbox and merge there first.

## 2. Access

- If the server has security off, no token is needed.
- If it has security on, writing needs an admin token:

  ```
  node <skill>/tools/token.mjs --url <boat server> --out <folder>/.wiring-token
  ```

  The owner approves the request in the Admin UI under Security > Access Requests, with
  permission "Admin". The token goes to a file only the owner can read. Never print it,
  and keep it out of any repository. The owner can revoke it afterwards under Security >
  Devices.

## 3. Copy

```
node <skill>/tools/transfer.mjs --from <sandbox> --to <boat server> --to-token-file <folder>/.wiring-token --dry-run
node <skill>/tools/transfer.mjs --from <sandbox> --to <boat server> --to-token-file <folder>/.wiring-token
```

The copy covers:
- zones, devices, cables, conduits, NMEA 2000 backbones and schematic pages;
- floorplans with their drawings;
- every photo and file;
- circuit names, notes and meter paths.

Record ids are kept, and removed records are left behind unless `--include-removed`. The
tool checks the counts at the end and fails loudly if they differ. On the boat, the
change log starts with these records' creation.

## 4. Verify

- `node <skill>/tools/gaps.mjs --url <boat server> [--token-file ...]` shows the same
  counts and gaps as the sandbox.
- Open `<boat server>/signalk-wiring/` with the owner. Check the circuits, the
  Batteries tab (now with live voltage and state of charge where paths were linked), and
  a few photos.

## 5. Hand over

- The boat's copy is now the master. Write that at the top of `notes/boat-profile.md`.
  Do not run `seed.mjs` against the boat. Later changes are made in the web app, or
  through the API with the owner's go-ahead.
- Suggest the owner add a line to their own notes or agent instructions saying where the
  wiring is documented and how to read it:
  - `<server>/signalk-wiring/` for people;
  - `/signalk/v2/api/resources/wiringCircuits` and the plugin's search, trace and checks
    routes for agents.
- Offer to stop the sandbox, and to revoke the token if it is no longer needed.

## Alternative: copying the database file

For an owner with shell access to the boat's computer and a plugin that has **never been
enabled there**:
1. Stop the sandbox.
2. Copy `wiring.db` (without `-wal` and `-shm`), `attachments/` and `plans/` from the
   sandbox's `config/plugin-config-data/signalk-wiring/` into the boat's
   `<config dir>/plugin-config-data/signalk-wiring/`. The config dir is usually
   `~/.signalk`, or `/data/conf/signalk` on Venus OS.
3. The owner then enables the plugin.

This keeps the sandbox's change log as well. Never copy over a database the plugin is
running on. Use the same plugin version on both sides.
