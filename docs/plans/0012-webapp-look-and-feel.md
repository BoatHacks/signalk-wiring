# Implementation Plan: 0012 - Webapp look and feel

## Overview

Make the wiring webapp look and behave like the stowage webapp, so the two
feel like one set of tools on the boat's displays.

## Decisions

- Same design tokens: warm light surfaces and a green accent by day, and a
  red-shifted night theme where every colour is a shade of red.
- Same structure: a dark header bar with the title and a theme toggle, an
  underlined tab strip, content in a centred column (full width on the
  floorplan).
- Same theme behaviour: remembered in the browser, defaulting to the
  browser's preference, with an optional `autoTheme` plugin option that
  follows `environment.sun`, then `environment.mode`.
- Plan drawings are black on white paper, so in the night theme they are
  inverted and tinted red rather than shown as a white box.
- Device role colours on floorplan markers come from tokens, with
  distinguishable shades of red at night.

## Test Strategy

- `themeFromEnvironment` (pure) is unit tested; the setting resolves with a
  safe default.
- Manual: both themes checked in headless Chromium against a mock server.
  Not checked on the boat's displays or in a real night session.

## Implementation Steps

- [x] `public/theme.js`, toggle and header in `public/app.js`
- [x] Stylesheet rewritten on the shared tokens
- [x] `autoTheme` plugin option and setting
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG
