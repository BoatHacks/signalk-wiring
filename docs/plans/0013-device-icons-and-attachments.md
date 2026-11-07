# Implementation Plan: 0013 - Device icons and attachments

## Overview

A device can have many photos and PDF schematics (attachments already cover
that), and one of its images can be marked as an icon shown on lists,
circuit drawings and the floorplan.

## Decisions

- **Many photos and schematics.** Already supported by attachments:
  any number of JPEG, PNG, WebP, HEIC and PDF files per device. The UI now
  opens images full size and labels PDFs and other files, so no new record
  type or category field was added.
- **Icon.** A nullable `devices.icon_attachment_id`, set from the device's
  attachment tiles ("Use as icon", "Clear icon"). Only JPEG, PNG and WebP
  count, since most browsers cannot draw HEIC. It must be one of that
  device's own attachments, and deleting the image clears the icon.
- **Access.** Attachments are admin-only, but a drawing is readable by any
  logged-in user, so the icon has its own read-only route
  (`GET /devices/:id/icon`) that serves only that one image. Everything
  else stays admin-only.
- **Where it shows.** Device list and details, the circuit diagram node,
  and the floorplan marker (clipped to the marker circle). In the night
  theme icons are tinted red.

## Test Strategy

- Store: valid and invalid icons, clearing, deleting the icon image, and
  the migration.
- Routes: the icon is served with safe headers, 404 and 503 cases, the
  readonly registration, and attachment deletion clearing the icon.
- Pure helpers (`public/deviceIcons.js`) are unit tested.
- Manual: setting an icon and seeing it in the list, details and diagram,
  against a mock server. The floorplan marker icon was not checked in a
  browser.

## Implementation Steps

- [x] Schema, migration, store validation, tests
- [x] Icon route, tests
- [x] Attachment tiles, icon buttons, icon display
- [x] SPEC.md, ARCHITECTURE.md, README, CHANGELOG

## Follow-ups (not in this plan)

- A caption or kind per attachment (for example "wiring schematic").
- SVG schematics (they need sanitising or an image-only path).
- Icons for wire runs.
