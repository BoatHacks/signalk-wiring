# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- More choices for what a cable carries: Ethernet, CAN bus, USB, HDMI, serial (RS-232, RS-485, TTL such as VE.Direct and VE.Bus) and coaxial (antenna, RF), next to NMEA 2000, Seatalk-1, NMEA 0183, sensor and other. Each has its own colour on the schematics and the floorplan, in the day and the red night theme, and shows as a badge in the cable table.

## [0.9.4] - 2026-11-16

### Changed

- Load Summary (plan 0043, issue 34): a fuse or breaker shows the summed load of everything behind it. A row with circuits behind it has an arrow that opens them with the sum, its amps and the rating check; the sum counts each device once, adds peaks as if everything ran at once and does not count converter losses, and a fuse that is over its rating only with everything behind it reads "over rating with everything behind it". A fuse fed only by a charging source has nothing behind it. Circuits with no consumer of their own or behind them (and no finding) are folded behind "Show N circuits with no consumers", closed by default and remembered in the browser. A line above the table counts all circuits: "55 circuits: 0 over rating, 1 incomplete, 54 ok".

### Changed

- The Dashboard order follows the data (plan 0042, issue 31). With no live value yet, Needs attention and Statistics come first and the live cards follow; the live power card collapses to one line with a closed "How to set it up" disclosure, battery banks show their recorded capacity with one shared note instead of "no live data" each, and the switches card is one line while every state is unknown. Once a live value arrives the live cards move first and stay there for the visit.
- The Statistics tiles look like links (border, arrow, hover and focus state) and wrap and grow so no tile is left alone in a row. The battery tile shows energy in kWh, with each bank's own amp hours in its note; amp hours of separate banks are no longer added up.

## [0.9.3] - 2026-11-16

### Changed

- UI quick fixes (issue 28, plan 0041). Wording: "cable" replaces "wire run" in everything shown, singular forms such as "1 device" and "1 cable", the spelling "meter" instead of "metre" (in the web app, the API descriptions and the docs), a pipe between the parts of every list row, "None" for an empty select, and the demo banner reads "Demo: sample boat, edits reset on restart".
- A list that cannot be loaded shows a plain sentence with a Retry button and the technical text in a smaller line (lists, Dashboard, Load Summary, Batteries, Buses, Changes).
- An active status is a small muted word instead of a badge, and an "ok" result (cable checks, Load Summary) is a muted tick, so findings stand out.
- The device page shows the NMEA 2000 block only for a device on a bus or with an NMEA 2000 port, and the switching lines (switch path, confirmation) have a block of their own. The History block uses the wording of the Changes tab ("Changed", "rated power: 45 to 60 W"), and a Changes card with one change prints its time once.
- Layout: the tab bar fades at the edge where more tabs are hidden, scrolls the current tab into view and marks it for screen readers; Load Summary and the circuit page scroll their table, not the whole page, on a phone; Load Summary uses the full width; links are blue everywhere; Batteries puts its intro first, Devices and Schematics got a short intro; the schematic toolbar and the bulk bar selects look like the filter selects.
- Sortable column headers show a faint mark and a hover state, and the direction button of the sort control is disabled, with a reason, until a sort is chosen. The long Load Summary explanation and the schematic legend are folded behind closed "How this is worked out" and "Legend" disclosures.
- Floorplan tab: an always available Legend (it also explains the thin arrow where a cable crosses to another plan, which is now smaller and neutral), labelled "Top view" and "Side view" plan pickers, Recalibrate, Remove plan and the scale text under a "Plan settings" disclosure, the not drawn list shows from and to and scrolls in a box, the Show control matches the buttons, and the "Add a plan" form is folded behind a button once a plan exists.

## [0.9.2] - 2026-11-16

### Added

- Lists can be sorted. The Cables and Load Summary tables have clickable column headers: a click sorts ascending, a second click descending, a third returns to the usual order. Devices, Circuits, Conduits, Batteries, Buses and Zones have a "Sort by" choice with an ascending and descending button next to their filters. Names sort in natural order ("B10-3" before "B10-12"), cable gauges sort by cross section across AWG and mm², lengths in feet and metres sort together, and empty values always come last. Each list remembers its sort in the browser. The Changes list keeps newest first.
- The Zones page shows an arrow at each zone. Clicking it opens a list of the devices in that zone (each a link to the device) and clicking again closes it. Zones start collapsed, and a zone without devices has a dimmed arrow.
- The Conduits page has the same arrow at each conduit, opening the list of cables that run through it (each a link to the cable). The arrow does not open the conduit's page; clicking elsewhere on the row still does.
- Each enclosure on the Devices page has the same arrow, opening the list of what it holds, including what is inside enclosures within it (indented, each a link to the device). Selecting devices for the bulk Inside action is unchanged.

### Fixed

- A battery bank's "Protected by" list on the Batteries page named every fuse and breaker behind the bank, the demo's house battery 36 of them. It now lists only the fuses and breakers on the bank's own output, the ones between the battery and the rest of the system, such as the main fuse. The bank's `protectedBy` in the derived data changes the same way.

## [0.9.1] - 2026-11-16

### Fixed

- Demo mode no longer starts empty on a server behind a shared address, such as a cloud host. It used to ask the GitHub API for the newest demo files on every start, and the API's limit of 60 requests an hour per address was often used up by others, so no demo files arrived. The plugin now reads a file list, `demo/manifest.json`, and the files themselves from raw.githubusercontent.com, without the API; an unchanged demo costs one request per start. The plugin status names the demo version by the start of the manifest's checksum instead of a commit. `scripts/demo-manifest.js` writes the list, and the demo builder runs it.

### Changed

- The demo boat's battery capacities follow the SignalK demo server: house 5120 Ah, starter 1280 Ah and bow thruster 2304 Ah (its `capacity.nominal` in coulombs divided by 3600), where they were 400, 90 and 120 Ah. The house battery's capacity change in the demo history and the make and model texts follow.
- Two boxes of the demo's 12 V DC schematic page overlapped (the starter switch on the inverter/charger, the engine alternator on the shore charger), which the Dashboard reported under Needs attention. They are moved to free spots, and a demo test now fails when any page of the demo has overlapping boxes.
- The demo boat's charger and alternator fuses have names that say what they protect: "Shore charger house fuse", "Orion starter output fuse", "Orion thruster output fuse", "Alternator house fuse" and "Alternator starter fuse" (they were "Charger fuse house", "Charger fuse starter", "Charger fuse thruster", "Alternator fuse" and "Starter charge fuse", two of which were easy to mix up).
- The demo builder reads `demo/source/layout.json`, the position of every schematic box and zone block, so a hand-arranged layout survives a rebuild. `scripts/read-layout.js` captures it from a running server (the schematic counterpart of `read-positions.js`). The demo now carries the current layout of the 12 V DC, 230 V AC and DC distribution panel pages.
- The demo boat no longer has the empty "Switch panel" enclosure (and its empty inside page).

## [0.9.0] - 2026-11-15

### Changed

- The demo boat's three solar arrays each have a 10 A PV fuse between the array and its charge controller (`Bimini PV fuse`, `Deck port PV fuse`, `Deck starboard PV fuse`), and the PV cables S-01, S-11 and S-21 are split into array to fuse and fuse to controller (S-02, S-12 and S-22 are the short fuse to controller cables, 4 mm2 throughout). The three PV cables used to read "cannot check" because nothing protected them; every cable of the demo can now be checked.
- The Dashboard no longer counts a DC-DC converter as a power input. A DC-DC charger moves energy between two buses that are already counted (a battery or an alternator feeds it), so counting its meter would count the same power twice. Solar controllers, alternators, chargers and source devices still count.
- The demo boat has the two DC-DC chargers its SignalK demo server publishes: "Orion to starter" and "Orion to thruster", each fed from the House battery through its own fuse and wired to the starter and bow thruster batteries through the existing charger output fuses (the thruster output is now 25 mm2 and 63 A). Their meters are `electrical.chargers.orionStarter.current` and `electrical.chargers.orionThruster.current`. The shore charger now charges the house bank only.
- A new device starts with a LEN of 0 (the New device form shows 0, and a device created without a LEN through the resource API gets 0), so it no longer makes the bus checks say they cannot check. An empty LEN still means unknown, and existing devices are not changed. A bus device with a LEN of 0 counts no load on the bus; only an unknown LEN falls back to the rated power.
- The demo boat has a real NMEA 2000 backbone, "Main NMEA2000", with its five taps, a power feed from the DC panel main fuse and LENs on the sensors, so all seven bus checks pass. The demo builder reads `backbones` and `len` from `boat.json`.

### Added

- Demo mode. A file named `demo-mode-active` in the plugin data directory turns it on. On every plugin start the plugin then checks GitHub (`BoatHacks/signalk-wiring`, branch `main`) for newer demo files, updates its local `demo/` folder after verifying every file, and resets `wiring.db`, `plans/` and `attachments/` to the demo boat. The first reset keeps the previous database as `wiring.db.before-demo`. A server without the file behaves as before. The plugin status says what happened.
- In demo mode the web app header shows a subdued note after the title: "demo mode, some features might not work as expected". The settings served to the web app have a new `demoMode` value.

### Changed

- The `showFloorplan` plugin option ("Show the Floorplan tab") is removed. Whether the Floorplan tab shows now follows demo mode: hidden in demo mode, shown otherwise. `showFloorplan` is still in the served settings, as a derived value. An old `showFloorplan` entry in an existing configuration is ignored.

## [0.8.2] - 2026-11-15

### Added

- A plugin option "Show the Floorplan tab" (`showFloorplan`, on by default). Turned off, the web app hides the Floorplan tab, sends a link or bookmark to `#/floorplan` to the Dashboard, and leaves out what points to it: the floorplan count and the "on a floorplan" line on the Dashboard, and the hints that say to draw a route there. The floorplan data is kept and comes back when the option is turned on again.

### Changed

- The Dashboard's "Switches on" list is now a "Switches" card with one small chip for every switchable consumer, switched off ones included, in name order so the chips keep their place. On is a filled blue chip with a filled dot, off a plain grey outline with an open dot, and unknown a dashed outline with a question mark, so the state does not depend on red and green (the night theme keeps its red tones and uses brightness and the marks). Each chip links to the device and its tooltip names the switch that feeds it.

- The Load Summary says what is really missing on an incomplete circuit. A circuit that is not wired back to any battery or source now reads "No supply: this circuit is not wired back to a battery or a source, so its voltage is unknown" (it used to ask for a nominal voltage on a supply that does not exist), and a circuit with no fuse or breaker reads "No fuse or breaker: nothing to compare the load with" instead of asking for a trip rating. The summary rows of `GET /load-summary` carry the same texts and two new flags, `missingSupply` and `unprotected`.

- The Dashboard no longer lists the devices that have no meter under Live power in and out. Under the battery reading it now shows the numbers behind it: each bank's voltage, current and power, the net power into or out of the batteries, and input minus output.
- In the Dashboard's Needs attention card, every cable and bus on the list says why: a cable that is too small or drops too much voltage gives the reason in a sentence, a check that cannot be made says what is missing, and a bus lists each of its checks that is not ok with the first line of its reasoning.

## [0.8.1] - 2026-11-15

### Added

- A Dashboard (issue #24), the first tab and the page the app opens on. Statistics (counts, total cable length, protected circuits, battery capacity, summed consumer load, what is still missing), a "Needs attention" overview built on the cable and bus checks, live power in and out with the battery's net flow, battery banks, the switches that are on, and last-hour sparklines from the server's history routes when a history provider is installed. Live data uses the one shared stream every 5 seconds, pauses while the browser tab is hidden, greys readings older than a minute and leaves them out of sums, and says "no live data" rather than zero. A Live switch is remembered per browser. Every entry links to its record.
- Plugin options `dashboardInputs` and `dashboardOutputs` (issue #24): up to 12 entries each of label, SignalK path, unit (W or A) and, for amps, a voltage or a voltage path. They are validated when the settings load (bad entries are dropped and noted in the plugin status), appear in the admin UI as lists of small forms, are served through the `wiringSettings` resource and are in the OpenAPI description. An empty list falls back to the meter paths on devices.
- `useLive` takes options for extra paths, the update period and pausing while the browser tab is hidden.

### Changed

- The address `#/` now opens the Dashboard instead of the Circuits tab; the Circuits tab is `#/circuits`.

### Fixed

- The documented minimum signalk-server version for read-only routes and the OpenAPI description was 2.36. The server source shows `router.access` and plugin `getOpenApi` are present from 2.31.0, so the docs now say 2.31. (No code change: both are feature-detected.)
- Duplicating a device now keeps its battery details and monitoring paths, explicit AC/DC setting, AC/DC ratings and schematic colors.

## [0.8.0] - 2026-11-15

### Added

- NMEA 2000 backbones (issue #4, the first part). A backbone is one record with its taps (the drop of each device with port, drop length, place along the backbone and an optional power feed), a cable class, length, terminators and supply rating, served as the `wiringBackbones` resource and documented in the OpenAPI description. Devices get a LEN (load equivalency number). The bus checks are advisory (backbone length for its cable class, each drop, all drops together, device count, exactly two terminators, bus current against the supply rating, a power feed present, and "cannot check" naming what is missing) with limits and cited sources in `docs/bus-checks.md`, and `GET /buses` returns each backbone with its derived data and checks. The load of a powered bus is added to the circuit its power feed joins, so the Load Summary and the cable checks count it. Database schema version 18.
- The Buses tab (issue #4). It lists the backbones (class, length, devices, LEN total and a verdict badge from the checks) and opens a detail view with the taps (device, port, drop length, place along the backbone, power feed and its source, LEN), the checks with their reasoning and sources and the advisory note, add and edit forms with a tap editor, duplicate, remove with Undo, history and attachments. A device that is a tap shows an "On the bus" section on its page, and the device form and page have the LEN field.
- A backbone on schematic pages: placed from an "Add bus" list, it is drawn as one thick line with a short drop to each tapped device on the page, a terminator mark at each end that has one and a mark at the power feed. It can be selected, dragged like a device and taken off the page with Undo; Auto-arrange sets its tapped devices in a row under the line. Placements are stored with the page (`backboneBoxes`), database schema version 19.
- A backbone on the floorplan: the Draw route tool has a Backbone choice, with waypoints, midpoint handles and the same editing as a cable. The line is drawn thicker in the signal colour with a mark at each tap (the drop length on hover), starts or ends at a tap device that sits at that end, and backbones without a route are listed as not drawn.
- An optional protocol label on cables (NMEA 2000 cable, Seatalk-1, NMEA 0183, sensor, other, `protocol` in the cable resource), with a select in the cable form, a badge in the cable table and a colour on schematics and the floorplan in both themes. Database schema version 20.
- The device form can add standard ports from any preset, including NMEA 2000 (the port named "NMEA 2000"), and "NMEA 2000 device" is a suggested type.
- The plugin publishes an OpenAPI 3.0.3 description of its API (issue #7), so a bridge such as the signalk-mcp-server plugin can offer the wiring data to an AI assistant. The SignalK server serves it at `/skServer/openapi/plugins/signalk-wiring`. It covers the resource API (devices, cables, circuits, conduits, zones, plans, schematic pages, settings) and the plugin routes with plain-English descriptions, parameters, error cases and examples; reads need the read-only level and writes the admin login. Relay switching and the calibration routes are not in it. The list of operations is generated from the registered routes, and tests fail when a route or resource type is left out.
- Four read-only query routes for assistants and dashboards: `GET /search` (devices and cables by words, ranked, each hit says why it matched, at most 100), `GET /trace/:deviceId` (what feeds a device and what it feeds, through enclosures and loops, with the protecting fuse or breaker and the circuits involved), `GET /load-summary` (the numbers and warnings of the Load Summary tab) and `GET /checks` (the cable check verdicts and reasoning with the counts, using the voltage drop limits of the plugin settings). They share the calculation of the web app, so the numbers agree.
- The "continues on <plan>" marks of the floorplan are less intrusive. Where a route leaves a plan there is now a short faint arrow (which still jumps to the other plan when clicked) and its label shows only for the chosen cable or conduit and while the pointer is on the arrow, so the labels no longer cover the markers and numbered stacks of a plan with many cables.
- The route panel of the floorplan (where the cable, measured and recorded length show) now also names the two devices the cable connects.
- In the floorplan Draw route tool, with no wire run or conduit chosen, clicking a drawn cable or conduit chooses it (the nearest one within a few pixels, a wider reach for a finger), so you can start editing its route without finding it in the lists first. A click on empty plan still asks you to pick one.
- A device can be dragged out of a numbered stack on the floorplan. Open the stack and drag the grip in front of a device onto the plan; the device leaves the stack, follows the pointer and is saved where it is dropped on the plan. The list fades while you drag, and releasing outside the plan changes nothing.
- The floorplan Show menu has a "Group nearby devices" switch. With it off, overlapping devices are drawn as separate markers instead of numbered stacks, so each one can be dragged. It is on by default and remembered per browser.

### Fixed

- Cables on the floorplan stay attached when a device is moved. The To end of a drawn route is a stored point, so before, moving a device left the end of its cables behind. Now the ends of routes that sit at the device's old position (or at the enclosure that holds it) move with it, and are saved with the move. An end you have moved away from the device by hand stays where it is.
- The Cables page looked shifted to the right: its table (now 13 columns with the Checks column) was wider than the 1000 px page column and made the whole page scroll sideways. The page now uses the full width for the Cables tab, and on a narrower screen the table scrolls inside its own frame.

### Changed

- A cable that is part of more than three circuits (a battery negative, for example) shows the first three in the Cables table and the cable form and an "and N more ..." link that opens the rest, instead of listing every circuit.

## [0.7.4] - 2026-11-13

### Changed

- Every `GET` route of the plugin (attachment list and download, circuit diagram, change log, plan drawings, device icons, derived warnings) is now registered with read-only access where the server supports it (signalk-server 2.36 and later), so a read-only user can browse everything. Writes, purges and uploads stay admin-only; switching and calibration stay read-write. Older servers keep the admin-only default.

## [0.7.3] - 2026-11-12

### Added

- Cable checks (issue #10, plan 0034), advisory only. Every cable that carries current (signal, data, antenna and earth-only cables are exempt) is checked for size against the fuse or breaker that protects it and against its load, and for voltage drop over its round trip length. Warning badges ("cable too small", "voltage drop high", a muted "cannot check: needs length") on the Cables tab open a popover with every number and where it came from, the Load Summary counts the results, and a mark on the schematic wire and its stub shows the reason on hover, with the badges again in the wire inspector. Two plugin options set the voltage drop limits for critical and other loads (3 and 10 percent, 0.5 to 20). The ampacity table is our own and conservative, with its sources in `docs/cable-checks.md`, and is awaiting review before a release.
- Floorplan routes get midpoint handles. With a wire run or a conduit chosen, a small circle sits in the middle of every stretch of its route; dragging it adds a point there, so a bend can be added between two existing points without redrawing the end of the route. Dragging shows a dashed preview. The new point takes its height from the point before it.
- Touch polish (issue #12, plan 0031). Two-finger pan and pinch zoom on the schematic canvas and the floorplan (a second finger cancels a one-finger drag, nothing is saved), invisible hit areas of about 44 px for fingers on terminal dots, bend and midpoint handles, the connect handle, off-page tabs, floorplan markers and clusters (a mouse sees no change), the quick cable popover and the cluster and bundle lists kept on screen, and guards against the browser's own pinch zoom, pull-to-refresh and text selection on the canvases.
- Device colors (plan 0030). A device has a schematic box color and a schematic icon color (new columns `devices.schematic_box_color` and `schematic_icon_color`, migration 17), edited in the device form with a hex field, a color picker and a Clear button, and shown with swatches on the device page. A colored device box on the schematic gets that outline and a light tint fill, enclosure boxes included, and the red night theme dims it. The icon color is stored only; nothing draws it yet.
- A built-in library of simple 24 by 24 line icons, one per device type with role fallbacks and a generic one, and a pure `iconFor(device)` that picks the icon from type and model text.
- Device icons are shown (plan 0032). A device's icon now comes before its name in the Devices list, the circuits list and circuit page, both From and To of the cables tables, the circuit diagram nodes, the schematic New device palette, beside the type and device pickers, and on the device page title. A device with its own attached icon image keeps showing that image. Icons follow the day and night themes, rows keep their height, and long names still truncate.
- Changes tab (issue #13, plan 0033). A new tab lists what changed lately across the whole system, grouped by record (device, cable, conduit, zone, plan, circuit or schematic), newest activity first, with each entry in words ("gauge: 6 to 10 mm2", "terminals added: B+") and its local time. The group header links to the record. Filters for date range (today, 7 days, 30 days by default, custom), kind (several) and text; a group shows its latest 5 entries with "Show N more", and groups load 20 at a time. Circuit entries stay hidden unless the Circuits kind is picked. New route `GET /plugins/signalk-wiring/changelog` (admin login, like the per-record log).
- Deleting a record permanently now leaves one entry "permanently deleted" in the change log, with its name and kind, for cables, devices, conduits and schematic pages. Its other history is still erased.

### Changed

- Dashed AC lines on the schematics and the floorplan now show the gaps of the dashes in a lighter tint of the line colour (half the opacity of the dash on the schematics) instead of the page background, so an AC wire reads as one line.

### Fixed

- A wire can now be drawn between two terminals of the same device, for example from one relay contact to another on a relay board. The wire drawing, the quick cable popover and the cable form accepted only two different devices before; they now accept one device when the two ends name different terminals. A wire dropped on two signal terminals starts as a signal cable even when the device also has power terminals. Same terminal on both ends and a bare box of the same device are still refused.

## [0.7.2] - 2026-11-12

### Added

- Snap to grid in the schematic editor (issue #14, plan 0028). A Snap button
  turns a 16 unit grid on or off (on by default, remembered per browser) and a
  faint dot grid shows while it is on, in both themes. Devices and off-page
  tabs snap by their top-left corner, wire bend points and dragged stretches
  by their coordinates, zone shapes when moved, resized or a polygon corner is
  moved. Hold Alt while dragging to flip the snap.
- Auto-arrange stage one leaves hand-placed devices alone (issue #14). A device
  you drag or drop at a chosen spot is marked (new column
  `schematic_devices.hand_placed`, migration 16; older pages have every device
  free). The first click arranges only the other devices; the second click
  arranges everything and clears the marks with the bend points and tabs, and
  Undo restores them.

### Fixed

- Crossings of an off-page stub line with a wire or another stub line were
  sometimes plain intersections (issue #14). Hops that lay closer together than
  one hop were dropped, and a crossing near the end of a horizontal stretch got
  none. Close hops are now drawn as one wide hop, and the vertical line hops
  where the horizontal one has no room.

## [0.7.1] - 2026-11-12

### Changed

- The floorplan is decluttered (issue #21, plan 0027). Device names show only
  for the hovered or selected device and for the devices of a highlighted
  circuit, conduit or wire run, smaller and with a halo, and stay inside the
  drawing at its edge. Overlapping markers collapse into numbered clusters
  that list their devices when clicked. A new Show menu switches Names,
  Devices, Cables and Conduits and filters by role, remembered per browser.
  Selecting something fades the rest. Cables or conduits along the same
  segment are drawn as one thicker line with a count; click it to list and
  select them.

## [0.7.0] - 2026-11-09

### Changed

- The plugin now uses Node's built-in `node:sqlite` instead of `better-sqlite3`
  (issue #16): no native module to install or build, no install scripts, and no
  runtime dependencies at all. Node 22.13 or newer is required (the first
  version where `node:sqlite` needs no flag). The database file is the same
  SQLite file, so existing data opens unchanged.

## [0.6.8] - 2026-11-09

### Changed

- While a device, an off-page tab or a wire handle is dragged, all wires are
  routed live with the real router (at most about 15 updates per second), so
  the picture during the drag is the same as after the drop. Escape cancels a
  drag and restores the positions and the last route.

## [0.6.7] - 2026-11-09

### Added

- Auto-arrange has two stages: after the first click the button reads "Arrange
  everything", and a second click with nothing edited in between also clears
  hand-placed wire bends and tabs. The full arrange can be undone.
- Double-click or double-tap a hand-routed wire to remove its bend points and
  let the router route it again (undoable).

### Changed

- Wires in the same conduit, or between the same two devices, are routed
  together along one path in parallel lanes, splitting near their ports.
- Dragging the midpoint handle of a wire moves only the horizontal or vertical
  segment it sits on. A segment left shorter than one line width is merged into
  its neighbours.
- The view no longer rescales under the pointer while a bend or segment is
  dragged.

## [0.6.6] - 2026-11-09

### Added

- Enclosures: a new Enclosure device role for breaker boxes and distribution
  panels (database migration 15). Devices can be put inside an enclosure (the
  Inside picker, a bulk Put inside action, an Inside filter on the Devices
  tab), to any depth. Only the enclosure is placed on the floorplan, where its
  marker shows a count and lists the contents.
- On a schematic an enclosure is one box with a port per cable that crosses its
  boundary. Double-click opens its inside page, created the first time, where
  those cables end in "to ..." tabs; a link leads back to the outer page.
- Removing an enclosure removes its contents, their cables and its inside page
  after a confirmation, and Undo restores them.

## [0.6.5] - 2026-11-09

### Added

- Zones can be drawn on a schematic page as rectangles, ovals (circle and
  square with Shift) or polygons, on a background layer. A polygon starts as a
  triangle and has draggable corners and midpoints (database migration 14).
  Shapes are visual only; a device keeps its own zone.
- Double-click or double-tap a device on the schematic (or the floorplan with
  the Select tool) to open its page.

### Changed

- The AC and DC marks along wires are gone. The conductor dot on a port is
  bigger and carries the symbol: "=" for DC, "~" for AC, a two-way arrow for
  signal and the earth symbol for earth.
- The default signal colour is orange by day and amber at night, clearly apart
  from AC neutral blue.

## [0.6.2] - 2026-11-09

### Changed

- The line to an off-page "to" tab is drawn like its cable: conductor colours,
  the AC or DC line style and the normal width.
- Wires no longer cross just before a port (the MultiPlus DC in wires enter in
  port order), conduit bands end clear of ports, and their labels sit where no
  line passes. Lines to tabs keep a wider gap to other wires.
- Routing no longer depends on timing: the same page always routes the same way.

## [0.6.1] - 2026-11-08

### Changed

- Schematic router rules are strict: no line runs on top of or hides another,
  including wires between the same two devices (separate lanes), and lines
  cross only with a bridge. Parallel lines keep at least two line widths of
  clear space.
- Wires and stubs leave a port straight out of the device for a visible
  length, so every connection shows at its port.
- The line from a device to an off-page tab is routed like any wire and never
  overlaps other lines, tabs or devices.

### Added

- Off-page "to" tabs can be dragged; the position is saved on the page
  (database migration 13) and kept by Auto-arrange and Tidy.

## [0.6.0] - 2026-11-08

### Added

- Cable gauge is picked from a list of standard sizes (metric 0.75 to 95 mm2,
  AWG 18 to 4/0) in the quick cable popover, the cable form and bulk edit.
  Aught sizes are stored as 0, -1, -2 and -3 and shown as 1/0 to 4/0.
- AC and DC ratings (current and voltage) on switches, breakers and fuses
  (database migration 12).
- Removed devices, conduits and schematics can be deleted permanently, with a
  confirmation. A device is refused while a cable still ends on it.
- Version stamps on the packed webapp and an update hint ("A new version is
  available") that checks every 10 minutes and when the tab becomes visible.
- Schematic wires are routed around every device box, with bridges at
  crossings, lanes for off-page stubs and wires of one conduit running together.
- Devices on a schematic no longer overlap; opening a page with overlaps offers
  Tidy. Auto-arrange spaces devices by cable length.
- Conduit bands drawn around the stretches where wires share a conduit, with a
  label; "Highlight a circuit" also lists conduits.

### Fixed

- Loading texts showed a literal `&hellip;`.
- Gauges of 1/0 and larger no longer display as 0 on the schematic.

## [0.5.1] - 2026-11-08

### Fixed

- Live mode ignored every update from a real SignalK server, so nothing showed
  live (relay states, meter values and the new battery readings). The server
  answers a `vessels.self` subscription with updates under the vessel's own
  context (`vessels.urn:mrn:...`), and the app only accepted `vessels.self`. It
  now takes the vessel's context from the server's hello message. It also asks
  for a fixed one second period instead of the instant policy, which the server
  was ignoring with a warning. Found by testing against the live server; the
  earlier checks only used mock servers.

## [0.5.0] - 2026-11-08

### Added

- Live voltage, state of charge and time remaining for batteries, on the
  Batteries tab, the circuit diagram, the schematic and the battery page. A
  battery with no paths of its own uses those of its monitoring device, a bank
  shows the first value found in it, a missing time remaining shows "not
  discharging" when the current says so, and values that stop arriving are
  marked stale. The time remaining is the monitor's own value, never computed.
- The battery fields in the device form and on the device page: chemistry and
  purpose, capacity, usable percent, make and model, install date (with its
  age), the monitoring device and the four SignalK paths. Choosing a chemistry
  fills the nominal voltage and usable percent until you set them, the type
  can preset chemistry and purpose, and the time remaining path is suggested
  from the state of charge path. The page also shows the bank the battery
  belongs to.
- The link type on cables between batteries: the quick popover and the cable
  form offer a parallel link (positive and negative) and a series link (one
  positive conductor), and the cables table shows a series or parallel badge.
- Battery details on storage devices: chemistry (flooded, AGM, gel, LiFePO4,
  other lithium, other), purpose (house, starter, thruster, windlass, motor,
  other), capacity in amp-hours, usable fraction, make and model, install
  date, a monitoring device and four optional SignalK paths (voltage, current,
  state of charge, time remaining). Every value is validated and logged. A
  one-time migration fills chemistry and purpose from the old type names
  (Lead-acid, AGM, LiFePO4, Starter and House battery) without touching a
  value set by hand.
- A link type on a cable between two batteries: series or parallel (a cable
  with none counts as parallel). Any other cable refuses it.
- Banks now have a computed voltage, layout (such as 2S2P), total and usable
  amp-hours and energy, their chemistries, monitors and the protectors of the
  circuits they feed, plus warnings for uneven strings, differing voltages,
  mixed chemistries and links that cannot be reduced. A battery on its own is
  a bank of one. Served by `GET /derived`.
- A Batteries tab (`#/batteries`): one card per bank with its batteries, layout,
  voltage, total and usable amp-hours and energy, chemistries, monitors, the
  protectors, its warnings, and a note naming exactly what is missing when it
  is incomplete (no made-up totals).

### Changed

- The storage type suggestions are now Battery and Battery bank, since
  chemistry and purpose are fields. Devices that already use the other type
  names keep them.

## [0.4.6] - 2026-11-08

### Added

- A "Current" field on every device (Either, AC or DC), with presets from the
  type: shore power inlets, generators and isolation transformers are AC;
  solar panels, alternators, wind and hydro generators, fuel cells, batteries,
  shunts, battery isolators and battery switches are DC. New devices get the
  preset (also through the API and CSV import), and a one-time migration fills
  existing devices from their type and terminals without touching a mark set
  by hand.
- The cable type is chosen from the two ends. A new cable in the quick popover
  or the full cable form starts as AC (line, neutral, earth) or DC from the
  dropped-on terminal, the device mark or the device terminals. When one end
  is AC and the other DC, a warning names both devices and asks for the type to
  be chosen; nothing is blocked. In the full form a kind you pick yourself
  stays, and editing a cable never changes its kind.
- A warning on conduits that hold both AC and DC cables: a banner on the
  conduit page naming the cables under AC and DC, a "Mixes AC and DC" line in
  the Conduits list, and the same notice after adding the cable that creates the
  mix. Adding is never blocked.
- AC and DC line style. On the schematic, AC cables are drawn with a long-dash
  pattern and DC cables solid, and each wire carries a marker at its midpoint
  (a tilde for AC, the DC symbol for DC). Floorplan routes use the same dash
  pattern for AC, without markers. A small legend under the schematic toolbar
  explains it.

### Changed

- The second conductor of a cable on the schematic is now a thin paired line
  drawn beside the first instead of a dashed overlay, so dashes mean AC only.
- A cable can no longer carry both AC and DC conductors (line or neutral with
  positive or negative). The store refuses it with "A cable cannot carry both
  AC and DC" on create and update, through the API, the forms and the quick
  popover. Earth and signal conductors are allowed in either kind. A CSV import
  reports a refused cable as an error row and carries on with the others, and
  the forms now show the reason a write was refused.

## [0.4.5] - 2026-11-08

### Added

- Hash routing. The address bar follows the tab and the open circuit, device,
  conduit, schematic or floorplan plan, so reload, back, forward and pasted
  links keep the view. An unknown tab falls back to Circuits, and an unknown
  or removed id opens the list with a short "not found" notice.
- Undo for removals. Removing a cable, device or conduit shows an "X removed.
  Undo" message at the top for about eight seconds (it waits while the pointer
  is on it). Undo puts the record back to active and the change log records it
  as "restored (undo)". This is the one allowed way from removed back to
  active.
- Search box on the devices, cables and circuits lists (name, label, type,
  zone, tags, and the device names at the ends), combined with the zone and tag
  filter, and a "Show removed" toggle, off by default and remembered per list.
- Links between views: device names in the cables table and circuit detail open
  the device, a load summary row opens its circuit, and a circuit's cable rows
  open the Cables tab.
- Duplicate a device (button on its page) or a cable (icon in the table). A
  device copy is named "<name> copy" and opens in the edit form; a cable copy
  opens in the cable form prefilled, so the ends can be changed before saving.
- "Take photo" button next to "Add file" in the attachment list, for phone
  cameras.
- Load summary: an "incomplete" circuit now says what is missing and what to do
  right under the badge, the badges have tooltips, and a legend sits under the
  table.
- Schematic: Delete wire (button or Delete key) removes the cable with no
  confirmation, shows Undo, and deletes it for good when the message ends;
  "Remove from this page" (or the Delete key) takes a device off the page only,
  with Undo. Escape cancels a drag, popover or selection.
- Floorplan: in the Draw route tool, clicking a wire run's To device ends the
  route there; clicking another device shows "This route ends at <device>".
- Floorplan: continuation marks, a stub labelled "continues on <plan>" that
  links to the plan where a route goes on after leaving a deck's height range.
- Floorplan: "Delete wire run" in the route panel (Undo, then deleted for good).
- Floorplan: Escape cancels the tool or route; Delete removes the selected
  waypoint or clears a device's placement (with Undo).

### Changed

- The row icons on the Cables table stay on one line, so rows are one line high.
- Removed cables, devices and circuits are hidden from the lists until "Show
  removed" is turned on.
- Floorplan: the bow and up arrows are smaller and fixed in the top right
  corner of the plan view, not drawn at the origin.

## [0.4.4] - 2026-11-08

### Added

- Ports. Terminals that name a port are drawn grouped as a block per port, with
  the port name written on the device: inputs on the left, outputs on the
  right, signal ports (data, relays) along the bottom, on schematics and on the
  circuit diagram. A new "signal" terminal and cable type covers VE.Bus and
  relay contacts. A device of type DC-DC converter, MPPT charger, inverter,
  inverter/charger, battery charger or MultiPlus starts with its standard ports
  and terminals (a button fills them in on an existing device). Dropping a wire
  on one terminal of a port picks the matching terminal of the same port for
  the other conductor.
- A device with more than one terminal shows them as separate dots, coloured by
  conductor, on schematics and on the circuit diagram. The name (and port) is
  the hover text; the always-visible terminal labels on schematics are gone.
  A cable that names a terminal ends on its dot.
- New cables start with default conductor colours: red for positive, black for
  negative, brown, blue and green/yellow for AC line, neutral and earth. They
  are filled into the colour fields and can be changed or emptied. Editing an
  existing cable never fills colours in.
- Cables tab: a cable that is already marked removed gets a Delete permanently
  button. It asks first, then erases the cable with its history, attachments,
  conduit assignments and schematic bends. Removing stays the safe default.
- Cables tab: tick several cables (or all shown) and change gauge, length, cable
  label, zone or add tags on all of them at once. Empty fields leave each
  cable as it is.
- A device of type Shunt is metered from its SignalK path (an explicit Meter
  path still wins), so loads downstream of it use its readings for the Live
  view and load calibration.
- "MPPT charger" as a suggested Converter type. "Solar charge controller" is no
  longer suggested as a Source, since a controller changes power and the solar
  panel is the source. Devices already using that type keep it.

### Fixed

- Emptying a text, number or SignalK path field on an edit form (for example
  the device's SignalK path) now clears it; before, the old value was kept.

### Changed

- Cables tab: the Edit, Remove, Attachments and History buttons are icons now,
  with the word as a tooltip.
- Device positions and route points set by clicking on a plan are rounded to
  the centimeter (two decimals), and the position fields step by 0.01.

## [0.4.3] - 2026-11-08

### Added

- Live view: a Live tool on the floorplan, and a Live button on the circuit
  diagram and on schematics. Consumers show on or off from the SignalK
  state of the relay that feeds them, and clicking one switches it through
  the plugin. A consumer nothing can switch is greyed, a never-remote one
  shows a lock, and a live meter reading shows where one exists. Where a
  relay feeds several consumers they all switch together and the tooltip
  says so.
- Switching through the plugin: `POST /switch` (read-write login) refuses
  never-remote devices, asks for confirmation where a device is flagged,
  sends the PUT in the format the path holds, and logs each action on the
  switch device.
- Device fields: switch path, "Confirm before switching", "Never switch
  remotely", meter path and meter unit (also a meter path on a circuit).
  New devices of critical-looking types (bilge pump, refrigerator,
  autopilot, navigation light, windlass) start with confirmation on.
- Load calibration: a Calibrate load dialog on a consumer. Delta mode
  switches it on and off three times against a meter (by the plugin, or by
  hand with prompts and automatic continue when the meter shows a clear
  step) and gives the average with its spread and warnings for noise or
  drift; Watch mode records a device you run yourself and gives the average,
  peak and share of time on, with an "on" threshold you can change. A relay
  shared by several consumers gives a group result. Runs execute in the
  plugin, can be cancelled, and are accepted or rejected; amps meters give an
  estimate (power factor 1), watt meters an exact figure.
- The device page shows the latest accepted measured values beside the
  nameplate rating, and the load check counts a measured device at its
  measured peak (breaker check) and shows the measured average, labelled as
  measured.

- Schematics: a new tab with several named diagrams of the electrical system.
  Place existing devices or create new ones from a palette by role, drag
  them around, or Auto-arrange them left to right from the supply. Drag a
  wire from a device or terminal to another and the cable exists at once: a
  small popover asks Positive, Negative or Positive + negative (with an
  optional gauge and length, and "More..." for the full cable form), and the
  derived circuit is shown. Wires are right-angled, coloured by conductor
  (with red-shifted colours at night), can be bent with draggable points, and
  highlight their circuit when selected. A cable to a device that is not on
  the page is a stub with a tab that jumps to a page showing that device or
  adds it. Deleting a wire removes the cable after a confirmation; taking a
  device off a page never deletes it. Schematics are served as the new
  `wiringSchematics` resource.
- Floorplan: a Connect tool beside Select, Place device and Draw route. Click
  the From device, the To device and the route on the plan, then Finish; the
  cable gets the drawn route and its measured length.

## [0.4.2] - 2026-11-07

### Added

- Circuits are worked out from the cables. Record a cable between two
  devices (from the supply side to the load side) and the circuit it belongs
  to appears: what one fuse or breaker protects, with its rating, voltage,
  AC or DC, supply and end devices. A cable with no fuse is still a circuit,
  flagged "no protection", and moves onto a fuse when you add one, keeping
  its name and notes. Branches off a bus bar are separate circuits; a
  negative can take its own path or land on a negative bus bar.
- A Cables tab with the new cable form: From (supply side) and To (load
  side) device pickers with a "New device..." entry, Positive, Negative or
  Positive + negative (AC and earth under "More"), a "negative lands on at
  the supply end" picker that starts as the last one you used, colour per
  conductor, gauge, length, label, zone and tags. Terminals are asked for
  only on converters and devices with several. The circuit the cable
  belongs to is shown under the form.
- Devices: a trip rating on fuses and breakers, a nominal voltage on
  batteries and sources, terminals (with ports on converters), and a power
  factor on consumers of an AC circuit.
- A `GET /plugins/signalk-wiring/derived` route (readonly) with the battery
  banks and derivation warnings, and a `derived` object on each circuit
  resource.

- Conduits: a new tab for conduits, hoses, looms, trunking and cable trays.
  A conduit has a name, a kind (a dropdown with suggestions, kinds already
  used and an "Add kind..." entry), an optional inner diameter, a zone,
  notes and photos. Cables are added to a conduit on its page; a cable can
  pass through several conduits in order, and the order can be changed.
  Conduits are served as the new `wiringConduits` resource, and the wire run
  resource lists its `conduitIds`.
- Floorplan: draw a conduit's route like a cable's, see the cables along it
  highlighted, and see how many cables are not drawn anywhere, with a button
  to draw each. A cable with no route of its own is drawn along its conduits
  and its measured length is taken from them.
- CSV import: a "Wire run: conduit" column names the conduits of each cable
  (several in order, separated by ; or >). Conduits already recorded are
  matched by name and reused; new ones are created.
- The cable table on the Cables tab names the conduits of each cable, and
  zones count conduits as well as devices and wire runs.

### Changed

- Circuits are a read-only overview (name, notes, voltage override, rating,
  AC or DC, warnings). The circuit creation form and its free-text source,
  breaker and panel fields are gone, as is the floorplan panel link; the
  protecting fuse or breaker device and its position say it. A cable's ends
  are devices instead of free text, and its colour is per conductor.
- The load check reads the derived circuits: consumers only, watts divided
  by volts, with the optional power factor applied on AC circuits, against
  the rating of the protecting device.
- CSV import creates devices (matched by name ignoring case, created when
  missing) and cables; circuits follow, and the circuit column names the
  derived circuits.
- Existing databases are migrated on first start: cable ends are matched to
  devices by name (an end that matches nothing is kept as a note on the
  cable), colours become a positive conductor, and circuits made by hand are
  kept as removed records with their names and notes.
- The device Type field is a dropdown: popular types for the chosen role
  (solar panel, shore power inlet, battery, fuse, inverter, bilge pump and
  more), then types already used on other devices, and an "Add type..."
  entry for anything else. Existing free-text types are kept.
- The axis indicator on calibrated plans uses arrow tips on its lines
  instead of the "to bow" and "up" text labels. Hovering an arrow still
  names its direction.

## [0.4.1] - 2026-11-07

### Added

- Device icons: mark one of a device's images as its icon (or clear it).
  The icon appears in the device list and details, on circuit diagrams and
  on floorplan markers, and is tinted red in the night theme. Deleting the
  icon image clears the icon. Icons are served by a read-only route, so
  they show for anyone who can see the drawing; a device's other
  attachments stay admin-only.
- Attachments: images open full size, PDFs and other files show a labelled
  tile, and the upload button says it takes photos, schematics and files.

### Added

- Plans can be removed from the Floorplan tab. They stay in the record as
  removed, like other records, and placed devices and routes are kept.
- A placed device can be removed from the plans: select its marker and use
  Remove placement, which clears its position in every view.
- Calibrated plans show which way the bow is and an axis indicator on the
  drawing, so a plan calibrated the wrong way round is easy to spot.

### Fixed

- Calibration instructions now say to click the stern end first and then a
  point toward the bow, with the same origin on every plan. A plan
  calibrated the other way round put the same device at the stern in one
  view and the bow in another, and moving it in one view moved it the wrong
  way in the other.

### Changed

- The webapp now looks like the stowage webapp: a dark header bar with a
  theme toggle, an underlined tab strip, warm light surfaces, and a
  red-shifted night theme. Plan drawings are tinted red in the night theme.

### Added

- Plugin option `autoTheme`: follow `environment.sun` or `environment.mode`
  to switch between the light and night themes automatically.

## [0.4.0] - 2026-11-07

### Changed

- Zones are now a managed list instead of free text. Each device and wire
  run has at most one zone, picked from a dropdown with an "Add new
  zone..." entry and a hint explaining what a zone is. Existing zone text
  migrates automatically (spellings differing only in case or padding merge
  into one zone). A new Zones tab renames, merges and removes zones.

### Added

- Device roles: consumer, source, storage, distribution (switches,
  breakers, bus bars, panels) and converter (inverters, chargers, DC-DC).
  Existing devices become consumers. The device form explains each role,
  the list has a role filter, floorplan markers are coloured by role, and
  the panel load summary counts only consumers.
- Free-text tags on devices and wire runs for groupings that are not
  physical areas, such as audio zones.
- Zone and tag filters on the circuit, wire run and device lists.
- A `wiringZones` resource and a zone merge route.

## [0.3.1] - 2026-11-07

### Added

- The SignalK path field on devices suggests paths from the vessel's live
  data tree as you type. Several words match in any order, and any text is
  still accepted so a path can be documented before it exists.

### Fixed

- Creating a circuit, wire run, device or plan, and importing a CSV,
  failed with "crypto.randomUUID is not a function" when the webapp was
  loaded over plain http, which is how most boat LANs serve SignalK. Ids
  are now generated in a way that works without a secure context.

## [0.3.0] - 2026-11-07

### Added

- Floorplan tab: upload top-down and side drawings (SVG, PNG, JPEG or
  WebP), calibrate each with two clicks and a real distance, place
  devices by clicking in either view (one 3D position shown in both),
  and draw wire run routes with a measured 3D length offered next to the
  recorded length. Circuits can name a panel device that routes start
  from, and selecting a circuit highlights its devices and routes.
- Devices gain `posX`, `posY`, `posZ`; wire runs gain `route`; circuits
  gain `panelDeviceId`; a new `wiringPlans` resource. Existing databases
  migrate automatically.

### Fixed

- The plugin configuration had no effect. The default gauge and length
  units now pre-select on new wire run forms, and the wiring convention
  sets the colour field's example placeholder. The settings are served
  read-only at `wiringSettings/config`.

## [0.2.0] - 2026-09-23

### Added

- Circuit `voltage` and `breakerRating` (numeric, splits out of the old
  free-text `source`), wire run `cableLabel`/`switchRef`/`lengthUnit`,
  and device `ratedPowerW`/`signalkPath` fields.
- CSV import: upload a spreadsheet, map its columns to wiring fields (or
  skip them), preview the resulting circuits/wire runs/devices, then
  import — generic column mapping, not tied to one spreadsheet's layout.
- Panel load summary: per active circuit, total connected devices' rated
  wattage converted to amps via the circuit's voltage and checked
  against its breaker rating, flagging circuits over their rating.

### Changed

- `circuit.source` renamed to `sourceLabel`. Existing installations
  migrate automatically on first start after upgrading — no manual
  action needed.

### Fixed

- Numeric form fields (gauge, length, etc.) silently rejected decimal
  values (e.g. `3.5`) due to a missing `step` attribute on the input.

## [0.1.0] - 2026-09-23

Initial release — the full MVP scope from SPEC.md §10.1.

### Added

- Circuit / wire run / device data model, exposed as SignalK resource
  types (`wiringCircuits`, `wiringWireRuns`, `wiringDevices`) with
  anonymous reads and admin-gated writes.
- Removed-but-kept record lifecycle: "removing" a record marks it
  `removed` instead of deleting it.
- Per-record change log (creation, field-level diffs on edit, removal),
  with a webapp view.
- Photo/file attachment upload, viewing, and deletion per wire run or
  device.
- Auto-generated per-circuit wiring diagram (source → wire run(s) →
  device(s)), computed and rendered client-side.
- Admin webapp: browse/search circuits and devices, inline create/edit
  forms, all built on vendored Preact + `htm` with no CDN dependency and
  no build step, so the plugin works with no internet connectivity.
- Configurable wiring convention setting (ABYC E-11 / DIN EN ISO 13297 /
  freestyle) — drives UI labeling hints only, never enforced.
