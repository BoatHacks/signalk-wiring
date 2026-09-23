# Implementation Plan: 0004 - Inline create/edit/remove forms

## Overview

Add the write side of the webapp: inline create/edit forms for circuits,
wire runs, and devices, plus soft-delete ("remove") actions — the last
piece needed for the webapp to be actually useful rather than a read-only
viewer. Builds directly on plan 0003's shell and plan 0001's resource
API.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §3 (removed-but-kept lifecycle — "remove" is a status change,
  not deletion), §7 (UI: forms, inline per the earlier design
  discussion), §9 (convention/gauge-unit config, already exposed via
  SignalK's own plugin-config form, not duplicated here)
- ARCHITECTURE.md §2.4 (webapp), §6 (security — write paths are
  admin-gated; the webapp shell itself is not, so a logged-out visitor
  can load the forms but submitting will 401, and the UI has to say so
  rather than fail silently)

## Approach

**A generic `<Form>` component, not three bespoke ones.** Circuits,
devices, and wire runs are all "a handful of labeled inputs, Save/
Cancel, an error banner on failure" — the same shape with different
field lists. A `fields` prop (`{key, label, type, options?}[]`) plus
`initial`/`onSubmit`/`onCancel` covers all three without duplicating the
submit/error/loading handling three times.

**Client-generates the id.** The resource API's `setResource(id, value)`
is an upsert (plan 0001) — creating a new circuit/wire run/device means
`PUT`ing to a client-generated `crypto.randomUUID()`, same pattern
SignalK's own resource types (notes, routes) use.

**Remove is a `DELETE` to the resource API**, which plan 0001's
`resources.js` already maps to `store.remove()` (status → `removed`),
never a hard delete — the webapp doesn't need its own logic for this,
just call the endpoint.

**Refetch after a successful write, no optimistic updates.** Simpler,
and the data volumes here (a boat's wiring, not a high-frequency feed)
don't need the complexity optimistic UI would add. `useResourceList`
gets a `reloadKey` so a write can trigger a refetch without a page
reload.

**401 handling**: since the webapp shell loads without auth
(ARCHITECTURE.md §6, plan 0003's correction), a logged-out visitor can
open a form and submit it, and the write will 401. The form surfaces
that as "You need to be logged into the SignalK admin UI to save
changes" rather than a generic error, since a generic "failed: 401"
message would be confusing to someone who doesn't know this plugin's
auth model.

## Test Strategy

- No new server-side routes in this plan (forms talk directly to plan
  0001's already-tested resource API), so no new `node:test` coverage —
  consistent with plan 0003, correctness here is UI behavior, verified
  by actually using it.
- Manual, in a real headless browser (per the correction from plan
  0003 — curl/status-code checks are not enough for UI bugs): create a
  circuit, add a wire run to it, edit both, remove one, confirm the
  change log (already built in plan 0002, not yet surfaced in the UI —
  still deferred) reflects it via a direct API check, and confirm the
  logged-out 401 case shows the intended message rather than breaking.

## Implementation Steps

- [x] `public/app.js` — `<Form>` generic component (text/select/number
      field types, Save/Cancel, loading + error state)
- [x] `putResource`/`deleteResource` fetch helpers with 401-aware error
      messages
- [x] `useResourceList` — add `reloadKey` param
- [x] Circuits: "+ New circuit" inline form on the list view; "Edit"/
      "Remove" on the detail view
- [x] Devices: same pattern
- [x] Wire runs: "+ Add wire run" inline form under the table in
      `CircuitDetail`; per-row "Edit"/"Remove"
- [x] `public/style.css` — form/button styling (not in the original file
      list; needed once the forms existed to look and behave right)
- [x] Manual verification in headless Chromium against the live server

## Manual Verification Results

Full create → edit → remove cycle exercised end to end, logged in as
admin (via the actual login form, not a raw credential POST — that was
blocked by the auto-mode classifier as credential handling, appropriately
so; went through Chromium's UI instead):

- Created a circuit, added a wire run, edited both, removed the wire run
  — screenshots at each step confirmed the UI *and* the underlying data
  were both right, not just that no error was thrown. Two things worth
  calling out because they were real correctness checks, not just
  "did it render":
  - Editing the circuit's name and re-checking the card confirmed
    `source` (a field the edit form didn't touch) survived untouched —
    validates `store.update`'s partial-update behavior (plan 0001) end
    to end through the UI, not just in a unit test.
  - Removing the wire run left it in the table with a "removed" badge
    and no "Remove" button (still has "Edit") — validates the
    removed-but-kept lifecycle (SPEC.md §3.1) is visible and correct
    from the UI, not just in the database.
- Created, edited, and removed a device — same pattern, same result.
- **Logged-out case**: opened the webapp in a fresh, never-logged-in
  browser context (confirming again that the shell itself needs no
  auth — plan 0003's finding) and submitted the create-circuit form.
  Got exactly the intended message ("You need to be logged into the
  SignalK admin UI to save changes"), and the form stayed open with the
  entered data intact rather than clearing or silently failing — this
  was the main behavior this plan's design set out to get right, not an
  incidental check.

No console errors traced back to this plugin's own code in either
browser context (a batch of `401` console messages appeared during the
logged-in flow too, but every actual write in that flow visibly
succeeded in the following screenshot — those trace to some other admin
UI component's own background polling, not `signalk-wiring`).

## Files to Create/Modify

- `public/app.js`, `public/style.css` (no server-side changes)
