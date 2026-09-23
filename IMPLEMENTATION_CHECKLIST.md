# Implementation Checklist - Quick Reference

**Before implementing a feature, work through this in order:**

## Phase 1: Explore
- [ ] Read the relevant issue/task fully
- [ ] Read the relevant sections of `SPEC.md`
- [ ] Read the relevant sections of `ARCHITECTURE.md`
- [ ] Explore existing code before writing anything

## Phase 2: Plan
- [ ] Think through the approach and alternatives
- [ ] Write a short implementation plan in `docs/plans/` (see
      `docs/plans/plan-template.md`)
- [ ] Identify test scenarios up front

## Phase 3: Test
- [ ] Write tests for pure logic first (storage layer helpers, diagram
      data shaping) — these don't need the SignalK host to run
- [ ] For resource-provider/route handlers, write the test alongside the
      implementation rather than strictly before it; the SignalK
      `app.*` surface is an I/O boundary worth mocking, not TDD-driving
- [ ] Confirm new tests fail for the right reason before making them pass
- [ ] Commit tests separately from the implementation where practical

## Phase 4: Implement
- [ ] Write code to satisfy the tests / plan
- [ ] Run `npm test` frequently while working, not just at the end
- [ ] If a test seems wrong, fix the test deliberately — don't loosen it
      just to get to green

## Phase 5: Verify
- [ ] Check edge cases, not just the happy path (e.g. a wire run with no
      zone, a removed record, mixed AWG/mm² gauges on one circuit)
- [ ] Confirm the change matches `SPEC.md`
- [ ] Confirm the change follows `ARCHITECTURE.md`
- [ ] For UI changes, actually load the plugin in a running SignalK
      server and click through the change — type checks and unit tests
      don't verify the webapp renders or the forms work

## Phase 6: Document & Commit
- [ ] Update `SPEC.md`/`ARCHITECTURE.md` if this change altered what
      they describe
- [ ] Remove any temporal language from comments ("new", "recently
      added") — comments should read correctly a year from now
- [ ] All tests pass, code is linted/formatted
- [ ] Commit with a message that explains *why*, referencing the issue

---

## Common Mistakes to Avoid

**Don't:**
- Jump straight to coding before reading SPEC/ARCHITECTURE
- Skip writing tests for the storage layer and diagram-data shaping —
  those are pure enough to test cheaply and are where data-model bugs
  hide
- Loosen a test to make it pass instead of fixing the real issue
- Leave SPEC.md/ARCHITECTURE.md stale after a change that contradicts
  them
- Forget that plugin file changes need a SignalK server restart to take
  effect — there's no hot-reload

**Do:**
- Explore before planning, plan before coding
- Write down the plan somewhere reviewable, even briefly, in
  `docs/plans/`
- Verify against the docs, not just against your own memory of the task
- Keep write paths going through `src/store.js` so the change-log
  behavior (SPEC.md §3.2) stays consistent everywhere
