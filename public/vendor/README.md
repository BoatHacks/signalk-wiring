# Vendored dependencies

Everything here is committed as-is rather than fetched from a CDN,
because the plugin must work with no internet connectivity (the boat may
be at sea) — see ARCHITECTURE.md §2.4.

- `preact-standalone.module.js` — Preact 10.29.8 + `htm` 3.1.1, from
  `htm`'s published `preact/standalone.module.js` bundle (a single
  self-contained ES module combining both, with no further imports,
  built for exactly this build-tool-free use case). Exports `html`
  (tagged-template JSX-like syntax), `render`, `h`, `Component`, and the
  hooks (`useState`, `useEffect`, etc).
- `dagre.esm.js` — `@dagrejs/dagre` 3.1.1's published `dist/dagre.esm.js`
  build: a self-contained ES module with `@dagrejs/graphlib` (its only
  dependency) already bundled in, no further imports. Used for circuit
  diagram layout (ARCHITECTURE.md §4) — computes node positions only;
  rendering is hand-rolled SVG in `app.js`. Exports `layout`, `graphlib`
  (for building the input graph), `Graph`, `version`, `debug`, `util`,
  and a `default` combining all of them.
- `licenses/` — the upstream licenses for the libraries above: Preact
  (MIT), `htm` (Apache-2.0), `@dagrejs/dagre` (MIT, `dagre-LICENSE`) and
  its bundled `@dagrejs/graphlib` dependency (`dagre-LEGAL.txt`, third-
  party notices collected by dagre's own build).

To update Preact/htm: `npm pack htm@<version>`, extract, and replace
`preact/standalone.module.js` from the tarball (it bundles whichever
Preact version `htm` depends on at that version — check
`node_modules/preact/package.json` inside the extracted tarball for the
exact version, and update the license files + this note to match).

To update dagre: `npm pack @dagrejs/dagre@<version>`, extract, and
replace `dist/dagre.esm.js` (plus its `dist/dagre.esm.js.LEGAL.txt` and
`LICENSE`).
