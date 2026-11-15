# Implementation Plan: 0039 - Demo mode

Tracks GitHub issue #20 (the demo content package).

## Overview

A file named `demo-mode-active` in the plugin data directory switches the plugin
into demo mode. The file is a plain marker: its presence is all that counts and
nothing is read from it. In demo mode the Floorplan tab is hidden, and on every plugin start
the plugin checks GitHub for a newer version of the demo files, updates its local
`demo/` folder when there is one, and resets the working database to the demo
boat. This gives a trade fair server a clean demo boat after every start. The
`showFloorplan` plugin option, added in 0.8.2, is removed: whether the
floorplan shows is now decided by demo mode.

## Decisions agreed with the user

- **The trigger is a file**, `demo-mode-active`, in the plugin data directory
  (`app.getDataDirPath()`, next to `wiring.db`). It holds no flags and is not
  read; only its presence counts.
- **Presence turns everything on:** hide the Floorplan tab, restore the demo
  data on every start, and check GitHub for newer demo files. There is no
  opt-out. The server where the demo content is prepared simply has no marker
  file: its data is never restored, and the Floorplan tab is shown there.
- **The demo files live in a `demo/` subfolder of the data directory**
  (`demo/wiring.db`, `demo/plans/`, `demo/attachments/`). The npm package does
  not contain them.
- **On every plugin start the plugin checks GitHub** for a newer version of the
  demo files on the **main branch**. If nothing changed, or GitHub cannot be
  reached, it carries on with the files already in `demo/`. If GitHub has a newer
  version it updates `demo/` before the plugin starts.
- **The data is restored on every plugin start** (server restart or saving the
  plugin settings), from `demo/`. Edits made during the demo are lost at the
  next start.
- **`showFloorplan` is removed from the plugin options** and is no longer
  configurable there; it is now set by demo mode.

## Approach

### 1. The marker file (`src/demoMode.js`, tested)

- `isDemoMode(dataDir)` is true when a file named `demo-mode-active` exists in
  the data directory (an empty file is the normal case; a directory of that name
  does not count). Nothing is read from the file.
- The settings served to the web app (`wiringSettings`) get `demoMode`
  (boolean) and `showFloorplan` becomes derived: false in demo mode, true
  otherwise. It is not read from the plugin options any more and is removed from
  `plugin.schema`; a stale `showFloorplan` key in an existing configuration is
  ignored.

### 2. Checking and updating the demo files (`src/demoSource.js`)

- One request asks GitHub for the last commit on `main` that touched `demo/`
  (`GET /repos/BoatHacks/signalk-wiring/commits?sha=main&path=demo&per_page=1`).
  Its sha is compared with the one stored in `demo/version.json`. Equal means
  nothing to do.
- When different: the git tree of that commit lists `demo/wiring.db`,
  `demo/plans/*` and `demo/attachments/*`. Each file is downloaded from
  `raw.githubusercontent.com` pinned to that commit sha, so all files are from
  one version. Only those three places are accepted; every other path (including
  `demo/source/`, `demo/README.md`) is ignored.
- Safety: each downloaded file is checked against the git blob sha of the tree
  entry; path names are checked (no `..`, no absolute paths, no odd characters);
  size caps (database 50 MB, plans and attachments 20 MB each, 100 MB in all);
  the database header's schema version must not be newer than the newest
  migration this plugin knows (a demo database from a newer plugin is refused and
  reported). Files go into `demo.new/` and replace `demo/` in one rename, so an
  interrupted update leaves the old files in place.
- Every request has a timeout (5 s) and the whole check a deadline (30 s). Any
  failure (offline, rate limit, bad sha, refused database) leaves `demo/`
  unchanged and is reported in the plugin status; it never stops the plugin from
  starting.

### 3. Restoring the data (`src/demoRestore.js`)

- Before the store is opened, in demo mode, and only when
  `demo/wiring.db` exists: the first time, the current `wiring.db` (if any) is
  copied to `wiring.db.before-demo` and never overwritten after that, so real
  data is not lost to an accidental marker file. Then `wiring.db` (and its `-wal`
  and `-shm`) is replaced by a copy of `demo/wiring.db`, and the `plans/` and
  `attachments/` folders of the data directory are replaced by copies of the
  demo ones.
- Without a `demo/wiring.db` (first start on a server that has never reached
  GitHub) the plugin starts with its current data and says so in the status.

### 4. Plugin start (`index.js`)

- `plugin.start` stays synchronous for the server, which does not wait for it.
  In demo mode it starts an async preparation (check and update, then restore)
  and continues with the normal start when that is done, unless the plugin was
  stopped meanwhile (a generation counter guards the race, a stop during the
  preparation cancels it). Until then routes answer as when the plugin is
  disabled and the status says "Preparing the demo". Outside demo mode nothing
  changes and nothing is awaited.
- The plugin status reports what happened: demo mode on, demo files updated to
  commit `abc1234`, unchanged, or kept because GitHub could not be reached, and
  whether the data was restored.

### 5. The web app

- `showFloorplan` from the settings keeps hiding the tab, its route and the
  hints as today.
- In demo mode the header shows a subdued " - demo mode, some features might not
  work as expected" right after the "Wiring Documentation" title (from the
  served `demoMode` setting; smaller, muted text in both themes, wrapping on a
  phone; the text is not shown outside demo mode).

### 6. Removing the plugin option

- `plugin.schema` loses `showFloorplan`; `src/settings.js`, the OpenAPI schema
  and example, and the tests are updated so it is a served, derived value.
- On the live server (the demo content prep server): remove `showFloorplan` from
  the stored plugin configuration and create no marker file. Its data is never
  restored, and the Floorplan tab shows there again.

## Defaults, reviewed with the user

These are my proposals, to be reviewed before the build:

- GitHub repository `BoatHacks/signalk-wiring`, branch `main`, fixed in the code.
- Request timeout 5 s, whole check 30 s, size caps as above.
- The first restore keeps one copy of the previous data as
  `wiring.db.before-demo`.
- Unauthenticated GitHub requests (60 an hour per address); a start uses two
  requests and one per file only when something changed.
- A demo database with a newer schema than the plugin is refused.

## Test Strategy

- Tests for `isDemoMode` (file present, absent, a directory of that name).
- Tests of the update with a fake fetch: nothing changed, changed, offline,
  timeout, rate limit, bad blob sha, disallowed paths, oversize file, newer
  schema refused, interrupted update leaves the old files, one version only.
- Tests of the restore on temporary directories: first restore keeps the backup
  once, replaces database, plans and attachments, removes -wal and -shm, skips
  without `demo/wiring.db`.
- Plugin start tests: demo mode off changes nothing; demo mode prepares before
  the store opens; a stop during the preparation cancels it; served settings
  carry `demoMode` and `showFloorplan: false`.
- A check on the container: start the packed plugin with a `demo-mode-active` file and a
  prepared `demo/` folder, with the network blocked.

## Implementation Steps

- [x] Remove the `showFloorplan` option; derive it from demo mode (marker file
      check, settings, schema, OpenAPI, tests).
- [x] The restore, with tests.
- [x] The GitHub check and update, with tests.
- [ ] The header note in demo mode (web app).
- [ ] The start sequence in `index.js`, docs (README, SPEC, ARCHITECTURE,
      demo README), CHANGELOG and a comment on issue #20.

## Files to Create/Modify

- New `src/demoMode.js`, `src/demoSource.js`, `src/demoRestore.js`; `index.js`,
  `src/settings.js`, `src/openapiSchemas.js`, `src/openapiMeta.js`,
  `public/settings.js`, `public/app.js`, `public/style.css`, tests, `README.md`, `SPEC.md`, `ARCHITECTURE.md`,
  `demo/README.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- A read-only demo mode.
- Fetching a specific release instead of `main`.

## Open questions

None. The decisions are above; the defaults are for review.
