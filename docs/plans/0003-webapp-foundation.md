# Implementation Plan: 0003 - Webapp foundation

## Overview

Stand up the webapp's foundation: vendored Preact + `htm` (no CDN, no
build step — see ARCHITECTURE.md §2.4), static asset serving from
`routes.js`, and a minimal read-only shell (circuits list → circuit
detail, devices list → device detail) that proves the whole stack works
end to end. Forms, the diagram view, attachments, and the change-log
view are deliberately deferred to later plans — this plan's job is to
retire the "does static serving + Preact + the resource API actually
work together" risk before building more UI on top of it.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §7 (User Interface — browse/search circuits and devices)
- ARCHITECTURE.md §2.2 (static webapp routes), §2.4 (webapp: Preact +
  htm, vendored, tablet-first, inline forms — inline forms land in plan
  0004, not here), §4 (tech stack), §7 (file structure)

## Approach

Vendor `htm/preact/standalone.module.js` — a single-file ESM bundle that
already combines Preact + `htm`, published specifically for
build-tool-free browser use — into `webapp/vendor/`. No bundler, no
JSX compiler; `<script type="module">` and tagged-template `html` calls.

Static serving lives in `routes.js` alongside the admin API routes
(same file, same admin gate) rather than a separate module: it's a
handful of lines (read file under `webapp/`, set `Content-Type` by
extension, 404 on traversal attempts, SPA-fallback unmatched paths to
`index.html`), not enough to justify its own file yet.

Layout target is an iPad-sized tablet per the earlier design discussion
— a single-column list/detail layout that doesn't need a responsive
breakpoint yet, since the MVP has no sidebar/multi-pane layout planned.

## Test Strategy

- Unit test the static file handler in `routes.js` (correct
  `Content-Type`, path-traversal rejection, SPA fallback) the same way
  as the existing route tests — fake req/res, no real HTTP server.
- No unit tests for the Preact components themselves in this plan (no
  test runner for browser-side JS is set up yet, and the components are
  thin fetch+render wrappers); correctness here is verified manually
  against the live server instead.
- Manual: load the live server's admin UI, open the plugin's webapp,
  confirm the circuits/devices lists and detail views render real data
  from the resource API created in plan 0001.

## Real Browser Verification (headless Chromium, not curl)

Verifying UI changes by curling routes and checking status codes was not
enough here and missed real bugs — this needed an actual browser
executing the JS, which is why the process below matters, not just the
result.

Set up `puppeteer-core` (in scratch, pointed at the host's already-
installed `/usr/bin/chromium` — no bundled browser download) to log into
the admin UI, then separately load `http://localhost/signalk-wiring/`
headless and screenshot each view (circuits list, circuit detail,
devices list, device detail) with console errors captured. This caught
three real bugs `node --test` and curl both missed:

1. **Stray "Loading…" text left in the DOM after render.** Preact's
   `render()` diffs against a container's *existing* children rather
   than replacing them outright — `index.html`'s static "Loading…"
   fallback wasn't created by Preact, so it was never cleaned up. Fixed
   by clearing the container's `textContent` immediately before the
   first `render()` call in `app.js`.
2. **`&larr;` rendered as literal text, not `←`.** HTML entities only
   get decoded by an HTML parser; `htm` builds vnodes directly from JS
   template text, so `&larr;` was never anything but 6 literal
   characters. Fixed by using the actual `←` character (a JS
   template-literal escape, evaluated by the JS engine itself — not an
   HTML concept, so it works here where the entity didn't).
3. **Wire run table showed raw device UUIDs instead of names.**
   `CircuitDetail` printed `wr.fromEndpoint`/`wr.toEndpoint` verbatim;
   for a wire run terminating at a device, that's the device's id, not
   anything a human wants to read. Fixed by also fetching
   `wiringDevices` in `CircuitDetail` and resolving an endpoint through
   an id→name map when it matches a device, falling back to the raw
   value (a breaker/splice label) otherwise.

All three were re-verified with fresh screenshots after the fix, plus a
check that the browser's console had zero errors. Screenshots were sent
to the user directly rather than just described.

## Implementation Steps

- [x] Vendor `public/vendor/preact-standalone.module.js` (+ licenses)
- [x] ~~`src/routes.js` — add the static file handler + wildcard route~~
      **wrong approach, see correction below** — reverted
- [x] `public/index.html` — shell markup, imports `app.js` as a module
- [x] `public/style.css` — minimal layout (list/detail, tablet target)
- [x] `public/app.js` — Preact app: nav shell (Circuits/Devices tabs),
      circuits list (fetches `wiringCircuits`), circuit detail (fetches
      one circuit + filters `wiringWireRuns` client-side — no dedicated
      "wire runs for circuit" endpoint exists yet, and doesn't need one
      at this scale), devices list, device detail. All read-only.
- [x] `test/routes.test.js` — static-handler tests added, then removed
      (see correction)
- [x] Manual verification against the live `signalk-server`

## Post-Implementation Correction: webapps aren't served the way this plan assumed

The original approach (above, and ARCHITECTURE.md as first written) had
this plugin serve its own static files from `registerWithRouter`, at
`/plugins/signalk-wiring/*`. Both the path and the serving mechanism
were wrong, caught by testing against the live server rather than by
reasoning about it beforehand.

**What actually happens** (confirmed by reading
`signalk-server`'s own source, `dist/interfaces/webapps.js` and
`dist/staticfiles.js`, inside the container): `signalk-server` scans
installed packages for the `signalk-webapp` keyword and, if a `public/`
directory exists, mounts it *itself* — `app.use('/signalk-wiring',
serveStaticFiles(...))` — at `/signalk-wiring/`, not
`/plugins/signalk-wiring/`. `/plugins/<id>/` is already a built-in core
route returning plugin metadata, which is why hitting it returned
`{"enabled":true,"id":"signalk-wiring",...}` JSON instead of `index.html`
during manual verification, instead of a 404 or a rendering bug.

A second, more consequential discovery from reading the same source: the
webapp mount is **not** wrapped in `signalk-server`'s admin-auth
middleware the way `/plugins/*` is — that middleware is applied to
specific path prefixes (`/plugins`, resource-API write verbs, etc.) by
`tokensecurity.js`, and `/signalk-wiring` isn't one of them. This isn't
a gap to fix: it's consistent with SPEC.md §12's existing anonymous-read
decision (an unauthenticated visitor can browse the shell, same as they
can already read the resource API — see ARCHITECTURE.md §6), and writes
still go through the auth-gated resource API regardless of whether the
page loaded without a login.

**Fix**: removed `serveStaticFile`/`WEBAPP_DIR`/the wildcard routes from
`routes.js` entirely (SignalK core needs no code from the plugin to do
this — just the keyword and the folder name), removed the now-invalid
tests for that handler from `routes.test.js`, renamed `webapp/` →
`public/`, added `"signalk-webapp"` to `package.json` keywords. Verified
against the live server at the corrected URL, `/signalk-wiring/`.

**Process note**: this shipped with a manual-verification checkbox
already ticked based on a plan that turned out to test the wrong URL
entirely (`/plugins/signalk-wiring/`, not `/signalk-wiring/`) — the
first verification attempt got back valid-looking JSON and it would
have been easy to mistake that for success without checking what it
actually was. Read the platform's own source for a mounting convention
before designing around an assumption of how it "probably" works,
especially when the skill/doc guidance available doesn't spell out the
exact mechanism (the `signalk-plugin` skill covers resource providers
and `registerWithRouter` in detail but says nothing about webapp
mounting).

## Files to Create/Modify

- `public/vendor/preact-standalone.module.js`, `public/vendor/licenses/`,
  `public/vendor/README.md` (new, vendored)
- `public/index.html`, `public/app.js`, `public/style.css` (new)
- `package.json` (`signalk-webapp` keyword, `public` in `files`)
- `src/routes.js` (static serving added, then reverted — see correction)
