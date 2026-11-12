# Implementation Plan: JSON OpenAPI discovery

## Overview

Expose the plugin's JSON routes through Signal K's `getOpenApi` hook so API
clients can discover their inputs, responses, permissions and effects.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §6.1: plugin routes and native resources.
- ARCHITECTURE.md §2.2, §2.2.1 and §6: route registration and authorization.

## Approach

Build an OpenAPI 3.0 document in JavaScript using small schema/operation
helpers, shared change-log kinds and the calibration timing defaults. Keep
runtime dependencies at zero. Route handlers, validation, access levels and
switching behavior remain unchanged. Explicitly describe destructive purge,
shared-switch effects, confirmation, background calibration and uncertain
switch outcomes. Binary transfers and native Resources routes are separate.

Zod or another schema library could generate request schemas from validators,
but the current handlers use handwritten checks. Introducing such a library
would also require a validation migration; it is outside this discovery change.

## Test Strategy

Compare the document against routes actually registered by both routers,
including the older admin-only fallback. Verify stable unique operation IDs,
resolved references, path/query parameters, no-content responses, safety
descriptions, examples and fresh-document behavior without a running store.
Run the existing route/switching/calibration tests with synthetic data. Validate
the document independently and check generic MCP parser compatibility. Confirm
discovery through a real temporary Signal K server without executing hardware
actions, and check the packed npm artifact.

## Implementation Steps

- [x] Add the generated document and native discovery hook.
- [x] Add route coverage and contract regression tests.
- [x] Update API docs and changelog.
- [x] Run tests, independent validation, native discovery and package checks.

## Verification

- All 722 tests pass on Node 22.23.5 and 24.22.2, including the tests added in
  upstream 0.7.1 while this change was being prepared.
- Swagger Parser 12 accepts the OpenAPI document. An isolated Ajv 8 probe
  validates all three request examples and 88 responses across 32 response
  contracts from the existing route/calibration tests. Validation tools are
  installed outside the repository; package dependencies remain unchanged.
- The signalk-mcp generic parser accepts all 22 operations with no unsupported
  schemas; each still requires its own saved review.
- The packed plugin loads in a temporary Signal K 2.34.0 server on Node 24.
  Native discovery returns the document, MCP describes all 22 operations, and
  a version read succeeds after approval through native Plugin Config.
  Readonly reads succeed; readonly switching and non-admin attachment metadata
  access are denied. No hardware is connected or operated.
- Signal K 2.34.0 already exposes `router.access`, despite the existing route
  comments mentioning 2.36. The document describes feature availability
  instead of asserting that version boundary; a fake legacy router verifies
  the admin-only fallback.
- `npm pack`, JavaScript syntax and `git diff --check` pass. No lint or type-check
  script is configured in this repository.

## Files to Create/Modify

`index.js`, `src/openapi.js`, `src/routes.js`, `test/openapi.test.js`, README.md,
SPEC.md, ARCHITECTURE.md and CHANGELOG.md.
