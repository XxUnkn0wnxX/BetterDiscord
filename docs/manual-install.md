# Manual macOS Build and Injection

This is the maintained build and injection workflow for this macOS-focused
BetterDiscord fork.

Older macOS and pinned older Discord releases are intentional compatibility
targets. Upstream BetterDiscord features are kept plugin-compatible and, when
needed, their internal runtime assumptions are backported through small
capability checks. macOS Big Sur is actively maintained; the current
compatibility audit covers Discord Stable `0.0.350` through `0.0.402` (Electron 35 and
37). This is a compatibility target, not a guarantee that Discord will continue
to connect or serve every historical client release.

The local Zsh wrappers are the recommended user-facing workflow. The underlying
Bun commands remain documented for development, troubleshooting, and precise
control over individual build or injection steps.

## Prerequisites

- A standard local macOS Discord install. Portable builds and the web app are
  not supported by this workflow.
- Bun installed and available in `PATH`.
  On macOS, the recommended path for this fork is:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install bun
```

  See the [Homebrew website](https://brew.sh/) and the [Homebrew install page](https://brew.sh/) if you need the full setup details first.
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

The macOS recovery helper waits up to 90 seconds by default. To stamp a
different positive whole-number timeout into a build:

```sh
bun scripts/build.ts --macos-recovery-timeout-seconds 45
./local-build.zsh dist --macos-recovery-timeout-seconds 45
./local-build.zsh -mrts 45
```

`-mrts` is a local-wrapper alias for
`--macos-recovery-timeout-seconds`; the underlying Bun command uses only the
long option.

`BETTERDISCORD_MACOS_RECOVERY_TIMEOUT_SECONDS` provides the same build-time
setting for GitHub Actions. OpenAsar adds its own short coordination grace
when it is waiting for BetterDiscord, so matching configured values are safe.
The fork's workflow builds explicitly use 45 seconds; direct builds without an
override keep the normal 90-second default.

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

`pack.ts` also writes `dist/checksums.txt` with SHA-256 entries for eight packed payload files. This records the payload-input hashes; it is not the hash of `betterdiscord.asar` itself.

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

The inherited injector, uninjector, and update migrator retain cross-platform
resource discovery, but Windows and Linux installation are technical reference
only and are not part of this fork's maintained workflow. Old
`discord_desktop_core`-only directories are deliberately ignored.

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
`wrapper-ready.json`. Recovery markers bind the BetterDiscord run ID, OpenAsar
handoff ID, and source Discord PID so an older quit cannot complete a newer
handoff. If OpenAsar publishes its handoff just after BetterDiscord arms, the
helper may adopt it only when it names this same Discord process and recovery
run.

If a matching live OpenAsar handoff is detected, BetterDiscord lets OpenAsar
restore `betterdiscord.app.asar`. Either helper relaunches Discord only when
the current updater explicitly requested a restart; an ordinary or fast user
quit may repair a replaced ASAR but leaves Discord closed.
If no Discord replacement appears, BetterDiscord publishes a matching
`wrapper-result.json` no-update result so OpenAsar can end its wait without
patching or relaunching the unchanged client.
Deliberate uninject still disables this recovery before restoring the wrapped
payload.

### macOS Discord Install Manager And OpenAsar Order

The [Discord install manager](https://github.com/XxUnkn0wnxX/Scripts/blob/develop/shell/discord_install_manager.zsh) described here is macOS-only.

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

These wrappers are the maintained macOS workflow. They assume app names such as
`Discord`, `Discord PTB`, and `Discord Canary`, use AppleScript to quit the app,
and detect processes through the `.app/Contents/MacOS/` layout.

Use the underlying Bun commands above when developing or diagnosing an
individual build/injection step.

### `local-build.zsh`

This is a small wrapper around the repo build and pack commands. It is not interactive.

Usage:

```sh
./local-build.zsh [build|production|pack|dist] [options]
```

Examples:

```sh
./local-build.zsh build
./local-build.zsh build --module=betterdiscord
./local-build.zsh production
./local-build.zsh pack
./local-build.zsh dist
./local-build.zsh --help
./local-build.zsh -mrts 45
./local-build.zsh --macos-recovery-timeout-seconds 45
./local-build.zsh dist --macos-recovery-timeout-seconds 45
```

The timeout option can come first; the wrapper then uses its default `dist`
mode. `-mrts` is the short alias for the long timeout option.

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
- A normal uninject also checks the layout first. If BetterDiscord is not
  installed, it exits successfully without disabling recovery or stopping
  Discord.

Examples:

```sh
./local-uninject.zsh
./local-uninject.zsh stable
./local-uninject.zsh ptb auto
./local-uninject.zsh canary dev
./local-uninject.zsh stable auto --dry-run
```

## Quick Examples

Build a release bundle and inject it into Stable with the underlying Bun flow:

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
