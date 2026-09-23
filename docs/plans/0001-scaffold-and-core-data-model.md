# Implementation Plan: 0001 - Scaffold plugin and core data model

## Overview

Stand up the plugin skeleton and the storage layer for circuits, wire
runs, and devices, exposed read/write via the SignalK resource provider
API. No webapp, attachments, or diagram yet — this is the foundation
everything else in the MVP builds on.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §4 (Data Model), §6.1 (REST API), §3 (State / Lifecycle Model)
- ARCHITECTURE.md §2.1 (Resource provider), §2.3 (Storage layer), §3
  (Data Models / SQL schema), §7 (File Structure)

## Approach

Follow the `signalk-plugin` skill scaffold: `index.js` entry point,
`"files": ["index.js", "src", "webapp"]` in `package.json`,
`signalk-node-server-plugin` keyword, zero runtime deps beyond
`better-sqlite3`. Build the storage layer (`src/store.js`) and schema
(`src/schema.sql`) first as pure, host-independent code, then wire the
resource provider (`src/resources.js`) on top of it, then register both
from `index.js`. Deferring the webapp and admin routes to separate plans
keeps this slice reviewable and testable in isolation.

## Test Strategy

- Unit test `src/store.js` directly against a temporary SQLite file
  (`node:test`) — CRUD for circuits/wire runs/devices, and that editing
  an active record appends a `change_log` row (SPEC.md §3.2).
- Unit test the resource provider's `listResources`/`getResource`/
  `setResource`/`deleteResource` methods against a mocked `store`, not a
  real SignalK `app` — the SignalK host itself is the I/O boundary here.
- Manual: install into a local `signalk-server` dev instance, restart,
  and confirm `GET /signalk/v2/api/resources/wiringCircuits` returns
  `[]` on a fresh install and reflects writes made via `setResource`.

## Implementation Steps

- [x] `package.json` + `LICENSE` + `.gitignore` per the `signalk-plugin`
      skill scaffold
- [x] `src/schema.sql` — `circuits`, `wire_runs`, `devices`, `attachments`,
      `change_log` tables (attachments/change_log tables created now even
      though unused until later plans, so the schema doesn't need a
      migration for plan 0002)
- [x] `src/store.js` — CRUD for circuits/wire runs/devices; every mutating
      write to an active record appends a `change_log` row
- [x] `src/resources.js` — resource provider methods for the three types,
      backed by `store.js`
- [x] `index.js` — plugin entry, config `schema` (convention, default
      gauge unit per SPEC.md §9), registers the resource provider
- [x] `test/store.test.js`, `test/resources.test.js`
- [x] `.github/workflows/test.yml`
- [x] Manual verification against a real running `signalk-server`
      (containerized, Node 24/aarch64). Installed into its `node_modules`,
      enabled via `plugin-config-data/signalk-wiring.json`, confirmed all
      three resource types register, reads are anonymous
      (`GET /signalk/v2/api/resources/wiringCircuits`), and data survives
      a full container restart.

## Post-Implementation Finding: better-sqlite3 11.x crashes on Node 24

Verification against the real server surfaced a native-module crash:
with `better-sqlite3@11.10.0`, the `signalk-server` container (Node 24)
crashed with a V8 assertion (`Assertion failed: (env) != nullptr` in
`node::RemoveEnvironmentCleanupHook`, inside `Statement::~Statement()`)
shortly after the plugin started, taking the whole container down.
`better-sqlite3` 11.x has no declared `engines` constraint, so npm
happily installs it against Node 24 even though it isn't actually
validated there.

**First fix attempt (incomplete)**: bumped to `better-sqlite3@^12.11.1`
(`engines: node 20.x–26.x`). Passed the unit suite on Node 24, a 500-op
stress test with forced GC (3x), an abrupt-exit test (3x), and 3 full
live-server restart cycles with real data — all clean, and was reported
as resolved. **This was wrong.** A follow-up search turned up the actual
upstream root cause: Node 24.19.0+ changed how cleanup hooks interact
with `node::ObjectWrap`, and `better-sqlite3` 12.x (still on
`node::ObjectWrap`) can abort during GC finalization of `Statement`
objects — a *race*, not a deterministic failure. Passing several test
runs against a timing-dependent native crash is not proof it's fixed;
it's dependent on the current Node 24 minor and got lucky on those
particular runs. See the multiple independent project fixes referenced
below, all landing on the same conclusion: only 13.x actually avoids the
race, because it's rewritten on N-API (`node-addon-api`) instead of
`node::ObjectWrap`.

**Actual fix**: bumped to `better-sqlite3@^13.0.3` and this plugin's
`engines` to `>=22` (13.x itself requires `>=22`; this sandbox's dev host
is Node 20, so host-level testing of 13.x isn't possible here — the
container's Node 24, which is the real deployment target, is what was
used to verify). Re-verified there with the same suite as before, plus
5x (not 3x) of the stress test specifically using the abrupt-exit
pattern (`process.exit(0)`, no `store.close()`, forced GC) since that's
the closest local approximation of the actual race window, and 3 more
live-server restart cycles with the plugin re-enabled. All clean.
13.x also ships per-platform N-API prebuilds (`linux-arm64.node`, etc.)
rather than per-Node-version binaries, which is itself a signal the ABI
concern is real and 13.x was built to avoid it.

**References**:
- [BetterDesk#377](https://github.com/UNITRONIX/BetterDesk/issues/377) — "Console crashes with SIGABRT (`RemoveEnvironmentCleanupHook` assertion) on Node.js 24 — better-sqlite3 Statement finalizer race"
- [ShieldCortex#471](https://github.com/Drakon-Systems-Ltd/ShieldCortex/issues/471) — "SIGABRT at teardown on Node 24 — better-sqlite3 `Database::~Database` asserts `(env) != nullptr`"
- [Rhythm#1505](https://github.com/ajhochy/Rhythm/issues/1505) — "Upgrade better-sqlite3 to 13.x (N-API) and pin every Node runtime — Node 24.19+ aborts 12.x during GC finalization"
- [ocap-kernel PR #1045](https://github.com/Consensys-Incorporated/ocap-kernel/pull/1045), [rhdh PR #5359](https://github.com/redhat-developer/rhdh/pull/5359) — independent fixes landing on the same 12.x→13.x move

**Design Decision (carries into ARCHITECTURE.md)**: pin `better-sqlite3`
to `^13.x` specifically, not just "a version with an engines range that
covers Node 24" — 12.x also declares that range but is still affected.
Also: don't call a fix for a *race condition* verified after a small,
fixed number of passing test runs; say what evidence exists and its
limits, rather than declaring it resolved.

**Process note**: mid-investigation, a SQLite file was deleted
(`rm wiring.db*`) while the live server still had it open, to try to
reset test state — this was a mistake (should have used `store.close()`
or just left the test data) and likely contributed to one rough
restart cycle. Don't do that again; either stop the plugin first or
leave stale test data for a later cleanup pass instead of unlinking a
file a live process has open.

## Files to Create/Modify

- `package.json`, `LICENSE`, `.gitignore`
- `index.js`
- `src/schema.sql`, `src/store.js`, `src/resources.js`
- `test/store.test.js`, `test/resources.test.js`
- `.github/workflows/test.yml`
