# Implementation Plan: 0005 - Circuit diagram view

## Overview

Render the auto-generated per-circuit diagram (source → wire run(s) →
device(s)) in `CircuitDetail`, using `dagre` for layout and hand-rolled
SVG for rendering, per ARCHITECTURE.md §4's design decision.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §7 (UI: "an auto-generated circuit diagram... rendered from
  the data, per circuit")
- ARCHITECTURE.md §2.2 (the existing `GET .../circuits/:id/diagram`
  route from plan 0002), §2.4 (webapp, vendored deps), §4 (`dagre` +
  hand-rolled SVG), §6 (security — see the design decision below, which
  revisits how §2.2's route factors in)

## Design Decision: compute the diagram client-side, don't call the plan 0002 endpoint

Plan 0002 built `GET /plugins/signalk-wiring/circuits/:id/diagram`,
which is admin-gated (it's under `/plugins/*`, same as every other
route in `routes.js`). But `CircuitDetail` already fetches
`wiringWireRuns` and `wiringDevices` through the anonymous resource API
to label wire-run endpoints (plan 0003) — the diagram is the *same*
data, just laid out as a graph instead of a table. Calling the gated
endpoint instead would mean an unauthenticated visitor can see the wire
run table but not the diagram of the exact same data, which is an
inconsistency with no real security rationale (ARCHITECTURE.md §6
already treats resource reads as intentionally anonymous) — not a
boundary worth having.

So the diagram is built in `app.js` from data already being fetched,
mirroring `routes.js`'s `buildCircuitDiagram` logic (dedupe endpoints
into nodes, resolve device names, one edge per wire run) rather than
calling that endpoint. `buildCircuitDiagram` itself isn't removed —
it's still a reasonable API for a non-browser consumer — just not the
webapp's data source.

## Approach

Vendor `@dagrejs/dagre`'s published `dist/dagre.esm.js` (self-contained
ESM, `@dagrejs/graphlib` already bundled in, no further imports — same
vendoring pattern as Preact/htm in plan 0003) into `public/vendor/`.

`dagre.layout(g)` computes node positions and edge routing points only;
rendering is a plain SVG `<rect>`+`<text>` per node and `<polyline>` per
edge, styled by wire color and dimmed/dashed for `removed` status —
matches the ARCHITECTURE.md §4 rationale for not using a heavier
diagramming library (small, mostly-linear graphs; full styling control).

`rankdir: 'LR'` (left-to-right) since circuits read naturally as
source → device.

## Test Strategy

No new server-side code, so no new `node:test` coverage (same reasoning
as plans 0003/0004). Manual verification in headless Chromium against
the live server: a circuit with multiple wire runs (including one to a
named device and one to a free-text label, and one `removed` wire run)
renders a diagram with correctly resolved labels and visibly distinct
removed-record styling; confirm it's visible without logging in
(validates the design decision above).

## Implementation Steps

- [x] Vendor `public/vendor/dagre.esm.js` (+ license/legal notices)
- [x] `public/app.js` — `DiagramView` component: build nodes/edges from
      already-fetched wire runs + device names, run `dagre.layout`,
      render SVG
- [x] Wire `DiagramView` into `CircuitDetail`, above the wire runs table
      (only rendered when there's at least one wire run)
- [x] `public/style.css` — diagram node/edge/label styling
- [x] Manual verification against the live server, including the
      logged-out case

## Bug found in verification: CSS was overriding per-wire colors

First screenshot showed every edge the same grey, despite two wire runs
being recorded as green and one as red. Cause: `.diagram-edge` in
`style.css` set `stroke: #94a3b8`, and an SVG presentation attribute
(the per-element `stroke="green"` set in `app.js`) loses to *any* CSS
rule targeting the element in the cascade — including a plain class
selector, not just something more specific. Fixed by removing `stroke`
from the CSS class entirely (left a comment explaining why, so it
doesn't get re-added) and giving the JS a concrete fallback
(`wr.color || '#94a3b8'`) instead of leaving the attribute unset for
colorless wire runs. Re-verified: green/green/red rendered distinctly,
confirmed by screenshot, not just by the absence of a console error —
this class of bug produces no error at all, only a real render checked
that.

## Manual Verification Results

Seeded a circuit with a genuinely branching topology — source →
splice → two devices, one leg `removed` — specifically to exercise
cases a single straight-line wire run wouldn't: node deduplication
(`splice-1` appears once despite being an endpoint on two wire runs),
device-vs-label node styling (device nodes get an accent-colored
border, `splice-1`/`breaker-2` don't since they're not device ids), and
removed-record styling (dashed + dimmed) on one edge only.

Loaded `/signalk-wiring/` in a browser with **no login** — confirms the
plan's design decision (client-side diagram, not the gated plan 0002
endpoint) actually holds, not just that it was reasoned to hold.
`svg` present, node count (4) and edge count (3) matched the seeded
data exactly, zero console errors, and — after the color-cascade fix —
the rendered colors matched what was recorded per wire run.

## Files to Create/Modify

- `public/vendor/dagre.esm.js`, `public/vendor/licenses/*`,
  `public/vendor/README.md` (vendoring)
- `public/app.js`, `public/style.css`
