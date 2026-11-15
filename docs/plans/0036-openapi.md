# Implementation Plan: 0036 - OpenAPI specification

Tracks GitHub issue #7.

## Overview

The plugin publishes a full OpenAPI specification of its API, so that a bridge
such as the signalk-mcp-server plugin can read it and offer the wiring data to
AI assistants. There is no MCP server in this plugin. The SignalK server has a
built-in way to publish a plugin's API description: a plugin that registers
routes can export `getOpenApi()`, and the server serves the document at
`/skServer/openapi/plugins/signalk-wiring` and lists it in its API docs page.
A small set of new read-only query routes gives an assistant derived answers
instead of raw lists.

## Decisions agreed with the user

- **No MCP server of our own.** The OpenAPI document is the interface. How the
  signalk-mcp-server plugin discovers and reads it could not be confirmed from
  here; the plan serves it the way the SignalK server publishes plugin APIs and
  documents the address in the README.
- **The specification is full, writes included, switching excluded.** Every
  read operation and every write operation (PUT, POST, DELETE, purge) is
  described, with writes marked as needing the admin login. Relay switching and
  the calibration steering routes are not in the document.
- **A small set of new read-only query routes**, so the specification offers
  useful operations: search across devices and cables, trace a device upstream
  and downstream, and the load summary with warnings (and the cable check
  results, which the dashboard of issue #24 needs too). All registered with read
  access, like the other GET routes.

## Approach

### 1. The document (`src/openapi.js`, `index.js`)

- `buildOpenApi(pluginVersion, routes)` takes the generated route list (see the
  defaults below) and returns an OpenAPI 3.0.3 object, and the plugin
  exports `getOpenApi()` next to `registerWithRouter`. `servers` is set to `/`
  so the document can name both the plugin routes (`/plugins/signalk-wiring/...`)
  and the resource API (`/signalk/v2/api/resources/<type>`).
- Resource API: for each type (`wiringDevices`, `wiringWireRuns`,
  `wiringCircuits`, `wiringConduits`, `wiringZones`, `wiringPlans`,
  `wiringSchematics`, `wiringSettings`) the list, read, create or replace and
  delete operations, with a schema for each record (field, type, unit, meaning,
  enums such as roles and conductor types), and plain-language descriptions of
  the derived data (circuits, protection, voltage, switchability, banks).
- Plugin routes: version, plan image, device icon, derived data and warnings,
  circuit diagram, attachments (list, download, upload, delete), the change log
  routes, the live state read, the purge routes (admin), and the new query
  routes. Each has parameters, responses, error cases and an example.
- Security: a bearer token scheme (the SignalK login token); reads need the
  read-only level, writes the admin level, as the routes enforce them.
- Written for assistants: every operation says in plain English what it is for
  and what a caller should do with the result, and states that the data is
  advisory documentation of a boat's wiring.

### 2. The new read-only query routes (`src/query.js`, `src/routes.js`)

- `GET /search?q=&kind=&zone=&role=&limit=`: devices and cables whose name,
  label, type, zone, tags or notes match, ranked, capped (default 25, max 100),
  each result with its kind, id, name and why it matched.
- `GET /trace/:deviceId?direction=up|down|both`: the devices and cables upstream
  (toward the supply) and downstream (toward the loads) of a device, in order,
  with the protecting fuse or breaker and the circuits involved; cycles are
  guarded.
- `GET /load-summary`: the same numbers as the Load Summary tab (circuits, rated
  power and current, protection, incomplete flags) and its warnings, and
  `GET /checks`: the cable check results (verdict and reasoning per cable,
  counts), computed with the shared pure modules so the server and the web app
  agree. Tests compare the route output with the web app's own calculation.

### 3. Tests

- A contract test: every route the plugin registers and every resource type is
  either documented or on an explicit exclusion list (switching, calibration
  steering); every documented path and method exists. The document structure is
  validated (required OpenAPI fields, every `$ref` resolves, every operation has
  a summary, responses and a security entry), and sample records from a built
  store validate against their schemas.
- Tests for the query routes (search ranking and caps, trace through enclosures
  and cycles, load summary and checks equal the web app's numbers), and for the
  access levels of the new routes.

### 4. Docs and the live check

- README section on using the API with an assistant bridge (the address of the
  document, the login, what is and is not offered), SPEC.md, ARCHITECTURE.md,
  CHANGELOG.md, a comment on issue #7 and a rewrite of the issue body to match
  this plan.
- On the live server: `GET /skServer/openapi/plugins/signalk-wiring` returns the
  document and the API docs page lists it. A real bridge cannot be tried from
  here; that check is left to the user.

## Defaults, reviewed with the user

- OpenAPI 3.0.3, built once when the plugin starts, with the plugin version in
  `info.version`.
- The list of paths and methods is **generated from the routes the plugin
  registers** (decided with the user): the document builder runs the route
  registration against a recording router and the list of resource types, so a
  route cannot be missing from the document. The descriptions, parameters,
  schemas and examples are hand-written in a metadata table keyed by method and
  path; the contract test fails for a registered route with no metadata (unless
  it is on the exclusion list for switching) and for metadata that names no
  route.
- No new runtime dependency and no dev dependency: the document is validated by
  a small checker in the tests.
- Search results are capped at 25 by default and 100 at most, and the query
  routes need only the read-only level, as the other GET routes (confirmed).
- The release version is chosen by the user; this adds routes, so a minor bump
  is likely.

## Test Strategy

- The contract and structure tests above, the query route tests, and a check of
  the document served by a real SignalK server (the container) through
  `/skServer/openapi/plugins/signalk-wiring`.

## Implementation Steps

- [ ] The query routes with tests.
- [ ] The OpenAPI document and `getOpenApi`, with the contract tests.
- [ ] README, SPEC.md, ARCHITECTURE.md, CHANGELOG.md, issue #7 comment and body.
- [ ] Check the served document on the live server.

## Files to Create/Modify

- New `src/openapi.js`, `src/query.js`; `src/routes.js`, `index.js`.
- Tests, `README.md`, `SPEC.md`, `ARCHITECTURE.md`, `CHANGELOG.md`.

## Follow-ups (not in this plan)

- Write support as reviewed proposals approved in the web app, marked in the
  change log (issue #7).
- Looking up a device's manual and proposing missing ports and ratings.
- Trying a real signalk-mcp-server against the document.

## Open questions

None. The decisions and the reviewed defaults are above.
