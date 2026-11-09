# Handoff

Written 2026-11-06 for the agent taking over. Read this first, then
`SPEC.md`, `ARCHITECTURE.md` and `IMPLEMENTATION_CHECKLIST.md`.

## State of the repo

- `main` was in sync with `origin/main`. Version in `package.json` is
  0.2.0; `CHANGELOG.md` has an `[Unreleased]` entry for the config fix.
- Plans `docs/plans/0001` to `0009` are complete.
- Recent commits on top of the 0.2.0 release:
  - `9a3f25f` adds `.github/workflows/publish.yml` (npm OIDC publish).
  - `51f9ee1` makes the three config options take effect.
  - `c2e46a4` adds plan 0009.

## Not on npm yet

`npm view signalk-wiring` returns 404. A GitHub release `v0.2.0` exists
but the package was never published, and the live `signalk-server`
container does not have the plugin installed. To release:

1. First publish by hand (`npm publish --otp=<code>`), then configure the
   trusted publisher on npmjs.com for `BoatHacks/signalk-wiring` with
   workflow filename `publish.yml`. After that a GitHub release publishes
   automatically. Details are in the `npm-oidc-publish` skill.
2. The 0.2.0 tag does not include the config fix. Bump the version
   (the `plugin-release` skill has the procedure) before publishing if
   the fix should ship.
3. Plugin file changes only take effect after the `signalk-server`
   container restarts; there is no hot reload. Install plugins inside the
   container (one exact package, npm there), not on the host.

The user declined to publish when asked, so do not publish without a new
go-ahead.

## Running the tests

The host has Node 20.19.2, which is below the required 22. On the host,
`npm test` runs 31 tests and the three SQLite files
(`store`, `routes`, `resources`) crash with SIGSEGV because
`node:sqlite` needs Node 22.13 or newer and is not available there. This is
an environment problem, not a test failure.

The full suite (55 tests, all passing at the last run) runs in the
`signalk-server` container, which has Node 26:

```sh
S=<a scratch dir>
tar --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C $S/wiring-src
podman cp $S/wiring-src signalk-server:/tmp/wiring-test
podman exec -w /tmp/wiring-test signalk-server sh -c 'npm install --no-audit --no-fund && npm test'
podman exec signalk-server rm -rf /tmp/wiring-test
```

This copies the repo to a throwaway directory inside the container, so the
host `node_modules` and the running server are untouched.

## Seeing the webapp without the live server

The plugin is not installed on the live server, so to look at the UI,
serve `public/` from a small Node script that also answers
`/signalk/v2/api/resources/<type>` with mock JSON, then screenshot with
headless Chromium (`/usr/bin/chromium --headless --screenshot`). No
Playwright or Puppeteer is installed. This was used to check the wire run
form after the config change. It proves rendering, not behaviour against
a real server.

## Known gaps and unverified items

- The config change (units pre-selected, colour placeholder) has not been
  clicked through on a real SignalK server, which the checklist asks for.
- The colour placeholder examples ("red (DC +), yellow (DC -)" for ABYC
  E-11; "brown (L), blue (N), green/yellow (PE)" for DIN EN ISO 13297) were
  written from general knowledge. The user was asked to check them.
- The convention setting only changes that placeholder. The per-circuit
  `convention` column exists in the schema but is not used by the UI.
- CSV import does not apply the default units to imported wire runs.

## Plan 0009 (floorplan view) is implemented

All six steps are committed. Remaining gaps, none verified on a real
server:

- Nothing has been clicked through against a live signalk-server. The
  viewer was exercised with a mock server and synthetic pointer events in
  headless Chromium (placing in both views, panel link, route drawing,
  measured length, undo). Real mouse and touch drag, wheel zoom and delete
  point are untested.
- The readonly download route relies on `router.access` (signalk-server
  2.36+); older servers fall back to admin-only reads.
- Plans are not editable after creation except by recalibrating or
  uploading again (a PUT to `wiringPlans` can rename or set a height
  range; there is no UI for it yet).
- The Legend 36 drawings are in `samples/` (git-excluded): the stowage
  plugin's drawing split into interior and deck, and the side profile
  JPEG was supplied separately.

## Working agreements with the user

- Author commits as Tobias Rosenstock with the GitHub hidden email already
  set in this repo's git config. Do not add AI or Claude attribution to
  commits or pull requests.
- Do not use em dashes in any written text, including commit messages and
  docs. Use commas or restructure.
- Ask before outward-facing or hard-to-reverse actions (publishing to npm,
  pushing, creating releases). Pushes so far were each requested
  explicitly.
- The user wants open design questions asked up front, one decision at a
  time, before a larger piece of work is started.
- Keep `README.md` status accurate as work completes.
