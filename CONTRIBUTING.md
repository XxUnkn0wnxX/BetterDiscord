# Contributing to this fork

Thanks for helping improve this macOS-focused BetterDiscord fork.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Before changing a
fork-sensitive area, also read:

- [Manual macOS build and injection](docs/manual-install.md)
- [Fork-specific changes and upstream policy](docs/fork-specific-changes.md)

Changes intended only for the upstream BetterDiscord project should be proposed
upstream. Fork behavior, macOS wrapper/recovery work, and bugs reproduced in
this repository belong in this fork's
[issue tracker](https://github.com/XxUnkn0wnxX/BetterDiscord/issues).

## Branch and pull requests

The working and pull-request target branch is `develop`.

Keep changes focused, preserve existing authorship, and explain any intentional
departure from upstream behavior. Do not rewrite workflows, injection plumbing,
or OpenAsar coordination as part of an unrelated change.

When upstream introduces a newer Web, Electron, or Discord-runtime assumption,
keep its public/plugin-facing contract authoritative. Check that assumption on
the fork's older macOS and pinned Discord targets, and use a narrow
capability-based backport when needed instead of creating a fork-only API.

## Local setup

Clone the fork and install dependencies with Bun:

```sh
git clone --branch develop https://github.com/XxUnkn0wnxX/BetterDiscord.git
cd BetterDiscord
bun install
```

The main source areas are:

- `src/betterdiscord/` — renderer UI, settings, addons, APIs, and runtime logic;
- `src/electron/` — Electron main/preload integration and macOS recovery;
- `src/common/` — code shared across process boundaries;
- `scripts/` — build, pack, inject, uninject, and resource-discovery tooling;
- `tests/` — Bun tests for shared, renderer, Electron, and wrapper behavior;
- `docs/` — fork behavior and manual installation documentation.

## Build and test

Run the checks relevant to the files you changed. The normal complete gate is:

```sh
bun ./node_modules/typescript/bin/tsc --noEmit
bun test --timeout 10000 tests/
zsh local-build.zsh -mrts 45
```

For targeted TypeScript/TSX linting:

```sh
bun ./node_modules/eslint/bin/eslint.js path/to/changed-file.ts
```

CSS follows the root [`.stylelintrc`](.stylelintrc); TypeScript and TSX follow
[`eslint.config.js`](eslint.config.js).

Do not upgrade Bun merely to make a test run on one checkout. This fork keeps a
narrow Bun 1.1.20/macOS 11 compatibility path while newer Bun versions retain
their normal test coverage.

## Runtime verification on macOS

For quick renderer iteration:

```sh
zsh local-build.zsh build --module=betterdiscord
zsh local-inject.zsh stable dev
```

Before calling an injected change complete, use the release ASAR:

```sh
zsh local-build.zsh -mrts 45
zsh local-inject.zsh stable
```

Open Discord after injection and verify the affected behavior directly. Use PTB
or Canary only when the change could differ by Discord channel.

## Protected fork behavior

Changes in these areas need an explicit compatibility review:

- application-ASAR injection, safe uninject, macOS recovery, and the
  BetterDiscord/OpenAsar handoff;
- Settings placement, navigation, version/debug-copy behavior, and Custom CSS;
- plugin loading, which must not special-case `0BDFDB.plugin.js` or another
  plugin library;
- plugin/theme updates, source identity validation, and atomic replacement;
- upstream plugin APIs and Webpack helpers on older macOS and pinned older
  Discord/Electron builds;
- BetterDiscord core updates, whose startup, scheduled, and manual entry points
  remain disabled;
- fork workflows, wrappers, documentation, badges, and `develop` assumptions.

If an upstream change overlaps one of these areas, preserve the fork behavior
until the conflict has been reviewed and runtime-tested. Compatibility adapters
must preserve upstream inputs, outputs, ordering, errors, and plugin-visible
calls unless a separately reviewed upstream bug fix intentionally changes them.

## Reporting bugs

Before opening a fork issue:

1. Check for an existing matching issue.
2. Reproduce with the current `develop` branch and a release injection.
3. Confirm the problem is not caused only by a plugin or theme when practical.

Include:

- macOS and Discord channel/version;
- the embedded BetterDiscord branch/commit;
- exact reproduction steps and expected behavior;
- whether OpenAsar is installed;
- relevant screenshots and the newest scoped BetterDiscord debug log;
- the plugins/themes needed to reproduce the issue.

Do not send fork-only injector, updater, or OpenAsar integration problems to the
upstream installer support flow.

## Commit style

- Use a concise imperative title.
- Explain behavior and compatibility decisions in the commit body.
- Group larger messages into sections such as `Feature`, `Fixes`, and
  `Verification`.
- Keep documentation and source comments synchronized with intentional fork
  differences.
- Never commit `tmp/`, local runtime reports, credentials, or generated Discord
  application files.

## License

By contributing, you agree that your contribution is provided under this
repository's [Apache License 2.0](LICENSE.md).
