# The sandbox server

The model is built on a SignalK server on the owner's own computer, separate from
the boat's. It can be reseeded and thrown away freely, and the owner reviews it in the
web app before anything touches the boat.

## With the sandbox tool (Node.js 22.13 or newer)

```
node <skill>/tools/sandbox.mjs up --dir <folder>/sandbox
node <skill>/tools/sandbox.mjs status --dir <folder>/sandbox
node <skill>/tools/sandbox.mjs down --dir <folder>/sandbox
```

`up` does the following, once:
1. installs `signalk-server` and `signalk-wiring` into the folder;
2. writes a minimal settings file with security off, and mDNS and the TCP stream
   servers off, so it cannot clash with another SignalK server on the computer;
3. enables the plugin.

It then starts the server on the first free port from 3100 and prints the web app
address. The first install takes a few minutes; later starts take seconds.

Options:
- `--port <n>` picks the port.
- `--plugin signalk-wiring@<version>` matches the boat's plugin version. A path to a
  checkout installs that instead.
- `--length-unit ft|m` and `--gauge-unit AWG|mm2` set the plugin defaults for new
  cables.

The data lives in `<folder>/sandbox/config/plugin-config-data/signalk-wiring/`.
Deleting the folder removes everything. The server log is `<folder>/sandbox/server.log`.

## With Docker

Where Node.js cannot be updated, the official image works:

```
docker run -d --name wiring-sandbox -p 3100:3000 -v "$PWD/sandbox-config:/home/node/.signalk" signalk/signalk-server
```

Then install signalk-wiring from the Admin UI App Store
(`http://localhost:3100/admin/`), restart the container, and enable the plugin under
Server > Plugin Config. The image starts with security off. The tools work the same
against `http://localhost:3100`.

## Notes

- The sandbox has no boat data: Live mode, meters and battery state stay empty. That is
  expected. Those come alive on the boat's server.
- The owner can use the web app on the sandbox to edit things directly. Those edits are
  not in `wiring-data.mjs`. Either reproduce them in the data file before the next seed,
  or stop seeding and treat the sandbox as the master from then on. The transfer tool
  copies the sandbox as it is, edits included.
- On Windows, run the tools from PowerShell or a terminal with Node.js on the path.
  Stop the sandbox with `down`, not by closing the window.
