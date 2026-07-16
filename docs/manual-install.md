# Manual Build And Injection

This document is for this fork of BetterDiscord.

Use the normal Bun commands first if you want the baseline manual workflow. The local Zsh wrappers are convenience helpers layered on top of that flow, and they are mainly for macOS.

## Prerequisites

- A standard local Discord install. Portable builds, Snap packages, and the web app are not supported.
- Bun installed and available in `PATH`.
  On macOS, the recommended path for this fork is:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install bun
```

  See the [Homebrew website](https://brew.sh/) and the [Homebrew install page](https://brew.sh/) if you need the full setup details first.
  Linux and Windows setup is left up to the user.
- Project dependencies installed with:

```sh
bun install
```

## Build BetterDiscord With Bun

These are the normal build commands used by this repo.

### Development Build

Build the unpacked output in `dist/`:

```sh
bun scripts/build.ts
```

You can pass extra build arguments when needed, for example:

```sh
bun scripts/build.ts --module=betterdiscord
```

### Production Build

Build the minified production output in `dist/`:

```sh
NODE_ENV=production bun scripts/build.ts --minify
```

### Pack The Release ASAR

Create `dist/betterdiscord.asar` from the built output:

```sh
bun scripts/pack.ts
```

### Full Release Build

Build and pack in one flow:

```sh
NODE_ENV=production bun scripts/build.ts --minify
bun scripts/pack.ts
```

Use the full release build before any release injection method.

## Normal Bun Injection Methods

The actual injection logic lives in [../scripts/inject.ts](../scripts/inject.ts). The wrapper script [../local-inject.zsh](../local-inject.zsh) calls that Bun script for you, but it does not perform the injection directly.

After any injection, fully restart the target Discord client.

The current injector uses Discord's application wrapper layout. It renames the
existing `Contents/Resources/app.asar` to `betterdiscord.app.asar`, then creates
an owned `Contents/Resources/app/` loader that starts BetterDiscord before the
renamed payload. If the existing payload is OpenAsar, it remains the payload
behind BetterDiscord.

Bun is only used for development tooling: dependency installation, building,
packing, and manually running the inject/uninject scripts. Installed update
recovery does not call Bun.

On Windows and Linux, the injector, uninjector, and update migrator recognize
both `app-X.Y.Z` and plain `X.Y.Z` version directories. They select the newest
directory containing the modern `resources/app.asar` or application-wrapper
layout. Old `discord_desktop_core`-only directories are deliberately ignored.

### macOS Update Recovery

On macOS, Discord's Electron main process prepares a detached recovery helper
inside the selected channel's `betterdiscord-bootstrap` folder. The helper uses
the macOS-provided Zsh through `/usr/bin/env zsh -f` with a fixed system `PATH`;
it does not load `.zshrc`, Oh My Zsh, custom shell paths, Bun, or a separately
installed Node runtime.

For each recovery run, BetterDiscord replaces these logs instead of appending
to older runs:

- `betterdiscord-bootstrap/betterdiscord-bootstrap.log` — concise recovery and handoff events
- `betterdiscord-bootstrap/betterdiscord-bootstrap-console.log` — detailed Zsh execution trace

The active helper records its process-group-owning parent in
`betterdiscord-bootstrap/betterdiscord-update-helper.pid`. A validated `TERM`
to that PID stops the helper and any helper child processes before removing the
PID file. Each run also has a unique recovery ID, so an older helper cannot
overwrite current state or logs.

The helper disables ShipIt's early relaunch, waits for the replacement
`app.asar` to stabilize, rebuilds the BetterDiscord wrapper, and writes
`wrapper-ready.json`. If a matching live OpenAsar handoff is detected,
BetterDiscord lets OpenAsar restore `betterdiscord.app.asar` and relaunch the
client. Without a matching OpenAsar helper, BetterDiscord owns the relaunch.
If no Discord replacement appears, BetterDiscord publishes a matching
`wrapper-result.json` no-update result so OpenAsar can end its wait without
patching or relaunching the unchanged client.
Deliberate uninject still disables this recovery before restoring the wrapped
payload.

### macOS Discord Install Manager And OpenAsar Order

The Discord install manager described here is macOS-only.

The normal fresh-install order remains:

1. Run the Discord install manager, optionally installing OpenAsar to top-level `app.asar`.
2. Inject BetterDiscord last so it wraps that payload as `betterdiscord.app.asar`.

The manager's `--BD` modifier is the in-place maintenance exception:

- Without `--BD`, a valid BetterDiscord wrapper is removed. If `--openasar` is requested, OpenAsar is installed as top-level `app.asar`; inject BetterDiscord again afterward.
- With `--openasar --BD` or `--openasar-source <path> --BD`, a valid wrapper is preserved and only its nested `betterdiscord.app.asar` is replaced; BetterDiscord does not need to be reinjected.
- With `--BD` but no wrapper, the manager falls back to standalone `app.asar`; inject BetterDiscord afterward if both are wanted.
- `--BD` requires `--openasar` or `--openasar-source` and cannot be combined with `--update`.
- A full `--update`, with or without `--openasar`, creates the stock or standalone OpenAsar layout first; inject BetterDiscord last.

The manager validates the complete BetterDiscord ownership marker and wrapper before using the nested target. Wrappers that disappear or become invalid are refused instead of receiving a top-level fallback.

### Development Injection

Development injection points Discord at the unpacked `dist/` directory. Build first with `bun scripts/build.ts`.

Stable:

```sh
bun scripts/inject.ts
```

PTB:

```sh
bun scripts/inject.ts ptb
```

Canary:

```sh
bun scripts/inject.ts canary
```

### Release Injection

Release injection points Discord at `dist/betterdiscord.asar`. Build first with:

```sh
NODE_ENV=production bun scripts/build.ts --minify
bun scripts/pack.ts
```

Stable:

```sh
bun scripts/inject.ts release
```

PTB:

```sh
bun scripts/inject.ts release ptb
```

Canary:

```sh
bun scripts/inject.ts release canary
```

## Local Zsh Wrappers

These local helpers are:

- [../local-build.zsh](../local-build.zsh)
- [../local-inject.zsh](../local-inject.zsh)
- [../local-uninject.zsh](../local-uninject.zsh)

These wrappers are mainly for macOS. They assume macOS app names such as `Discord`, `Discord PTB`, and `Discord Canary`, use AppleScript to quit the app, and detect processes through the `.app/Contents/MacOS/` layout.

If you want the most portable workflow across checkouts, use the Bun commands above first.

### `local-build.zsh`

This is a small wrapper around the repo build and pack commands. It is not interactive.

Usage:

```sh
./local-build.zsh [build|production|pack|dist] [extra args...]
```

Examples:

```sh
./local-build.zsh build
./local-build.zsh build --module=betterdiscord
./local-build.zsh production
./local-build.zsh pack
./local-build.zsh dist
```

What each mode does:

- `build`: runs `bun scripts/build.ts`
- `production`: runs `NODE_ENV=production bun scripts/build.ts --minify`
- `pack`: runs `bun scripts/pack.ts`
- `dist`: runs the production build and then packs the ASAR

### `local-inject.zsh`

This wrapper stops the selected Discord client on macOS and then calls the Bun injector script.

Usage:

```sh
./local-inject.zsh [stable|ptb|canary] [release|dev] [--dry-run]
```

Notes:

- If you omit the channel, it becomes interactive and prompts for `stable`, `ptb`, or `canary`.
- If you omit the mode, it defaults to `release`.
- `release` expects `dist/betterdiscord.asar`.
- `dev` expects `dist/betterdiscord.js`.
- `--dry-run` does not stop Discord or modify files; it prints the wrapper
  changes that would be made.

Examples:

```sh
./local-inject.zsh
./local-inject.zsh stable
./local-inject.zsh ptb release
./local-inject.zsh canary dev
./local-inject.zsh stable release --dry-run
```

### `local-uninject.zsh`

This wrapper removes BetterDiscord's owned `Contents/Resources/app/` loader and
renames `betterdiscord.app.asar` back to `app.asar`. It does not inspect or
replace the restored payload, so an OpenAsar payload remains OpenAsar.

Usage:

```sh
./local-uninject.zsh [stable|ptb|canary] [auto|release|dev] [--dry-run]
```

Notes:

- If you omit the channel, it becomes interactive and prompts for `stable`, `ptb`, or `canary`.
- If you omit the mode, it defaults to `auto`.
- `auto` is the least strict mode and is usually the easiest choice when you just want to remove BetterDiscord's wrapper.
- `release` and `dev` add an extra check so the wrapper only restores a loader that matches the expected injection style.
- `--dry-run` does not stop Discord or modify files; it only validates and
  reports the detected layout.

Examples:

```sh
./local-uninject.zsh
./local-uninject.zsh stable
./local-uninject.zsh ptb auto
./local-uninject.zsh canary dev
./local-uninject.zsh stable auto --dry-run
```

## Quick Examples

Build a release bundle and inject it into stable Discord with the normal Bun flow:

```sh
NODE_ENV=production bun scripts/build.ts --minify
bun scripts/pack.ts
bun scripts/inject.ts release
```

Do the same thing with the local wrappers on macOS:

```sh
./local-build.zsh dist
./local-inject.zsh stable
```

Reset/update Stable, install OpenAsar, and then wrap it with BetterDiscord:

```sh
$HOME/Apps/Scripts/shell/discord_install_manager.zsh --channel stable --update --openasar
./local-inject.zsh stable
```

Refresh OpenAsar inside an already installed BetterDiscord wrapper without reinjecting BetterDiscord:

```sh
$HOME/Apps/Scripts/shell/discord_install_manager.zsh --channel stable --openasar --BD
```

Build only the BetterDiscord module and inject it into Canary in dev mode on macOS:

```sh
./local-build.zsh build --module=betterdiscord
./local-inject.zsh canary dev
```
