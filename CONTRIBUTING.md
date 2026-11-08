# Contributing to signalk-wiring

Thanks for helping. This plugin documents a boat's electrical wiring, so it
gets better with other boats' setups: wiring you cannot describe yet, devices
that do not fit, and real-world checks all matter as much as code.

## Ways to help

- **Report a bug or a missing feature** as a
  [GitHub issue](https://github.com/BoatHacks/signalk-wiring/issues). For a bug,
  say what you did, what you expected and what happened, plus the plugin
  version and your SignalK server version. A screenshot helps a lot.
- **Comment on a planned feature.** Larger features are open as issues first,
  and the open questions are listed in them. Tell us how your boat does it.
- **Share a setup that does not fit.** A device with ports we do not model, an
  unusual battery bank, a cable that carries power and data: describe it in an
  issue, even without a fix.
- **Send a pull request** for a fix or a small improvement.

## Before a bigger change

For anything larger than a small fix, open or comment on an issue first, so
we can agree on the approach before you spend time on it. Larger work goes
through a short plan document in [`docs/plans/`](docs/plans/) (see
[`plan-template.md`](docs/plans/plan-template.md) and the earlier plans for
the format): what changes, the decisions agreed, the test strategy, the steps.
[`IMPLEMENTATION_CHECKLIST.md`](IMPLEMENTATION_CHECKLIST.md) lists what to read
and do before you start. The data model and rules are in
[`SPEC.md`](SPEC.md) and the structure of the code in
[`ARCHITECTURE.md`](ARCHITECTURE.md); update them when behaviour changes.

## Setting up

You need Node.js 22 or newer (the SQLite library needs it, see the README).

```sh
git clone https://github.com/BoatHacks/signalk-wiring.git
cd signalk-wiring
npm install
npm test
```

`npm test` runs everything with Node's built-in test runner. To run one file:

```sh
node --test test/router.test.mjs
```

To try the plugin, copy or install it into a SignalK server's `node_modules`
folder and restart the server. Do not use a symlink if the server runs in a
container, because the link will not resolve inside it.

## How the code is organised

- **`src/`** is the plugin: the SQLite store (`store.js`, with ordered
  migrations), the resource provider (`resources.js`), the extra routes
  (`routes.js`), and the pure logic for circuits, switching and calibration.
- **`public/`** is the web app. It uses Preact and htm with no build step, and
  every dependency is vendored as a plain ES module under `public/vendor/`.
  Please do not add a CDN link, a bundler or a new runtime dependency without
  discussing it first.
- **`test/`** holds the tests. Pure logic (routing, geometry, form helpers,
  matching) lives in plain modules with `.mjs` tests so it needs no browser.

## Guidelines

- **Tests:** add or update tests for logic changes. Keep `npm test` green; CI
  runs it on Node 22 and 24.
- **The web app:** it must work in the light theme and the red night theme, so
  use the CSS tokens in `public/style.css` instead of fixed colours. It also
  has to work on a tablet at the helm: reasonable touch targets, nothing that
  needs hover to be understood.
- **Records are kept:** removing a record marks it removed and logs the
  change; nothing is erased silently. Look at how the existing code does it
  before adding a new delete.
- **No personal data in the repo:** do not commit database files, real
  drawings of your boat, credentials or tokens.
- **Changelog:** add a short entry under `## [Unreleased]` in
  [`CHANGELOG.md`](CHANGELOG.md) for anything a user would notice.
- **Writing:** keep code comments, docs and commit messages plain and short.
  Prefer commas, colons or a rewrite to em dashes.
- **Commits:** one logical change per commit, with a message that says what
  and why.

## Pull requests

- Describe what changed and why, and link the issue.
- Say how you checked it. For web app changes, what you clicked through (and a
  screenshot if the screen changed).
- Be clear about anything you could not try, such as real switching on a boat.
- Releases, version bumps and publishing to npm are done by the maintainers,
  so please leave `package.json`'s version alone.

## Safety

This plugin documents wiring and can switch real relays from the Live view.
Treat its checks as advice, not a guarantee, and never expose switching to
anything that has not been reviewed carefully. Changes that touch the
switching routes need extra care and a clear test plan.

## License

By contributing you agree that your contribution is licensed under the
project's [MIT license](LICENSE).
