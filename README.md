# BetterDiscord macOS fork

[![CI Status][ci-badge]][ci-link] [![License][license-badge]][license-link] [![Website][website-badge]][website-link] [![Docs][docs-badge]][docs-link] [![Discord][discord-badge]][discord-link] [![Translate][translate-badge]][translate-link]

[ci-badge]: https://img.shields.io/github/actions/workflow/status/XxUnkn0wnxX/BetterDiscord/ci.yml?branch=develop&logo=github&label=develop&style=for-the-badge
[ci-link]: https://github.com/XxUnkn0wnxX/BetterDiscord/actions/workflows/ci.yml
[license-badge]: https://img.shields.io/badge/license-Apache--2.0-3a71c1?style=for-the-badge
[license-link]: LICENSE.md
[website-badge]: https://img.shields.io/badge/upstream-website-3a71c1?logo=firefoxbrowser&style=for-the-badge
[website-link]: https://betterdiscord.app
[docs-badge]: https://img.shields.io/badge/upstream-docs-3a71c1?logo=readthedocs&style=for-the-badge
[docs-link]: https://docs.betterdiscord.app
[discord-badge]: https://img.shields.io/badge/upstream-discord-7289da?logo=discord&logoColor=white&style=for-the-badge
[discord-link]: https://betterdiscord.app/invite
[translate-badge]: https://img.shields.io/badge/upstream-translate-3a71c1?logo=crowdin&style=for-the-badge
[translate-link]: https://translate.betterdiscord.app

This is an independent, macOS-focused fork of
[BetterDiscord](https://github.com/BetterDiscord/BetterDiscord). It is built
for local use from the `develop` branch and does not provide or promote the
upstream installer downloads.

The maintained workflow for this fork is to build it locally, inject it into a
standard macOS Discord installation, and open Discord normally.

The Website, Docs, Discord, and Translate shields above are upstream community
resources. This fork deliberately does not link or promote upstream installer
downloads.

## :sparkles: How this fork differs

- **:package: Wrapper injection:** Uses an application-ASAR wrapper with macOS update recovery and an
  identity-matched OpenAsar handoff instead of desktop-core-only injection.
- **:hammer_and_wrench: Local workflow:** Provides Zsh wrappers for release/dev injection, safe uninject, and
  Stable, PTB, or Canary selection.
- **:no_entry_sign: Core updates:** Keeps BetterDiscord core update checks disabled while plugin and theme
  updates remain active.
- **:shield: Safer addon updates:** Uses identity-aware plugin/theme updates so a same-filename Store addon
  cannot silently replace an unrelated forked addon.
- **:electric_plug: Library-neutral loading:** Gives no special startup treatment to `0BDFDB.plugin.js` or another plugin
  library; disabled plugins stay disabled.
- **:paintbrush: Runtime hardening:** Retains fork-specific Settings, Custom CSS, editor, Addon Store, and Discord
  runtime compatibility fixes around reviewed upstream changes.

See [docs/fork-specific-changes.md](docs/fork-specific-changes.md) for the full
upstream-versus-fork inventory and the rules used for future merges.

## :apple: Supported workflow

This repository is maintained and documented for standard local Discord
installations on macOS. Upstream code may continue to support other operating
systems, but Windows and Linux installation are outside this fork's supported
workflow.

Prerequisites:

- macOS with Discord Stable, PTB, or Canary installed normally;
- [Bun](https://bun.sh/) available in `PATH`;
- Git and Zsh.

## :hammer_and_wrench: Build and inject

Clone the fork's `develop` branch and install its dependencies:

```sh
git clone --branch develop https://github.com/XxUnkn0wnxX/BetterDiscord.git
cd BetterDiscord
bun install
```

Build a release ASAR and inject it into Discord Stable:

```sh
zsh local-build.zsh -mrts 45
zsh local-inject.zsh stable
```

The injector closes the selected Discord client before changing its wrapper.
Open Discord again after the command finishes. Replace `stable` with `ptb` or
`canary` when needed.

For a quick renderer-development loop:

```sh
zsh local-build.zsh build --module=betterdiscord
zsh local-inject.zsh stable dev
```

Use a release build for final runtime verification. The dev mode points Discord
at the unpacked `dist/` output and is intended only for local iteration.

## :wastebasket: Remove the fork

Restore the payload that existed before BetterDiscord wrapped it:

```sh
zsh local-uninject.zsh stable auto
```

This preserves a nested OpenAsar payload when one was already installed.

## :book: Documentation

- [Manual macOS build and injection](docs/manual-install.md)
- [Fork-specific changes and upstream policy](docs/fork-specific-changes.md)
- [Contributing to this fork](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Apache License 2.0](LICENSE.md)

The detailed manual guide covers release and dev injection, dry runs,
Stable/PTB/Canary selection, update recovery, OpenAsar ordering, and safe
uninject behavior.

## :link: Upstream and license

BetterDiscord is the upstream project. This fork preserves upstream authorship
and remains available under the [Apache License 2.0](LICENSE.md). Fork-specific
support and changes should be handled in this repository rather than through
the upstream installer support flow.
