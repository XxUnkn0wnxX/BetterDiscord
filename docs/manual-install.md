# Manual macOS Build and Injection

This guide covers the maintained macOS build and injection workflow. The local
Zsh wrappers are the recommended path; direct Bun commands remain available for
development and troubleshooting.

macOS Big Sur and pinned older Discord releases are active compatibility
targets. The current audit covers Stable `0.0.350`–`0.0.402` (Electron 35 and
37). Discord may stop serving or connecting to historical clients.

Fork changes preserve upstream plugin contracts and backport runtime
assumptions through capability checks when needed. See [optional updater
tokens](provider-tokens.md) for supported GitHub, GitLab, and git.slowb.ro
plugin/theme requests, setup steps, and the **Access Tokens** controls.

**On this page:** [Prerequisites](#prerequisites) · [Quick release](#quick-release) ·
[Build](#build-betterdiscord-with-bun) · [Inject](#normal-bun-injection-methods) ·
[macOS recovery](#macos-update-recovery) · [Install manager and OpenAsar](#macos-discord-install-manager-and-openasar-order) ·
[Local wrappers](#local-zsh-wrappers) · [Quick examples](#quick-examples)

## Prerequisites

- Standard local macOS Discord installation; portable builds and the web app
  are outside this workflow.
- Bun **1.1.20** available in `PATH`.

From the repository root, confirm Bun's version, then install dependencies:

```sh
bun --version
bun install
```

[package.json](../package.json), GitHub Actions and the build check share this
temporary host-compatibility pin. Revisit it after a newer Bun backport or
machine upgrade; keep local and Actions versions aligned. See the
[pin policy](fork-specific-changes.md#temporary-bun-build-runtime-pin).

## Quick release

```sh
./local-build.zsh dist -mrts 45
./local-inject.zsh stable
```

Fully restart Discord after injection. Replace `stable` with `ptb` or `canary`
as needed. The wrapper closes the selected client before injection.

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

For a fresh install, run the manager first (optionally installing OpenAsar to
top-level `app.asar`), then inject BetterDiscord so it wraps the payload as
`betterdiscord.app.asar`.

The manager's `--BD` modifier is for in-place maintenance:

| Invocation | Result |
| --- | --- |
| Without `--BD` | Removes a valid BetterDiscord wrapper. If OpenAsar is requested, installs it as top-level `app.asar`; inject BetterDiscord afterward. |
| `--openasar --BD` or `--openasar-source <path> --BD` | Preserves a valid wrapper and replaces only its nested `betterdiscord.app.asar`; no reinjection is needed. |
| `--BD` without a wrapper | Falls back to standalone `app.asar`; inject BetterDiscord afterward if both are wanted. |
| `--update`, with or without OpenAsar | Creates the stock or standalone OpenAsar layout first; inject BetterDiscord last. |

`--BD` requires `--openasar` or `--openasar-source` and cannot be combined
with `--update`. The manager validates the complete wrapper ownership marker
before using the nested target. If a wrapper disappears or becomes invalid, it
refuses instead of falling back to a top-level target.

### Development Injection

Development injection points Discord at unpacked `dist/`. Build first with
`bun scripts/build.ts`.

| Discord channel | Command |
| --- | --- |
| Stable | `bun scripts/inject.ts` |
| PTB | `bun scripts/inject.ts ptb` |
| Canary | `bun scripts/inject.ts canary` |

### Release Injection

Release injection points Discord at `dist/betterdiscord.asar`. Build and pack
first:

```sh
NODE_ENV=production bun scripts/build.ts --minify
bun scripts/pack.ts
```

| Discord channel | Command |
| --- | --- |
| Stable | `bun scripts/inject.ts release` |
| PTB | `bun scripts/inject.ts release ptb` |
| Canary | `bun scripts/inject.ts release canary` |

## Local Zsh Wrappers

These local helpers are:

- [../local-build.zsh](../local-build.zsh)
- [../local-inject.zsh](../local-inject.zsh)
- [../local-uninject.zsh](../local-uninject.zsh)

These are the maintained macOS workflow. They recognize `Discord`, `Discord
PTB`, and `Discord Canary`, quit through AppleScript, and detect processes via
the `.app/Contents/MacOS/` layout. Use direct Bun commands for individual
development or diagnostic steps.

### `local-build.zsh`

This wrapper runs the repository build and pack commands without prompting.

Usage:

```sh
./local-build.zsh [build|production|pack|dist] [options]
```

| Mode | Action |
| --- | --- |
| `build` | Runs `bun scripts/build.ts`; accepts build options such as `--module=betterdiscord`. |
| `production` | Runs `NODE_ENV=production bun scripts/build.ts --minify`. |
| `pack` | Runs `bun scripts/pack.ts`. |
| `dist` | Builds production output and packs the ASAR. |

Options may follow the mode. A timeout option may also come first, in which
case the wrapper uses its default `dist` mode. For the maintained workflow,
pass `-mrts 45`; the long form is `--macos-recovery-timeout-seconds 45`.
`--help` prints wrapper usage.

### `local-inject.zsh`

This wrapper stops the selected Discord client, then calls the Bun injector.

Usage:

```sh
./local-inject.zsh [stable|ptb|canary] [release|dev] [--dry-run]
```

| Input | Behavior |
| --- | --- |
| Channel omitted | Prompts for `stable`, `ptb`, or `canary`. |
| Mode omitted | Defaults to `release`. |
| `release` | Uses `dist/betterdiscord.asar`. |
| `dev` | Uses `dist/betterdiscord.js`. |
| `--dry-run` | Does not stop Discord or change files; prints the proposed wrapper changes. |

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

| Input | Behavior |
| --- | --- |
| Channel omitted | Prompts for `stable`, `ptb`, or `canary`. |
| Mode omitted | Defaults to `auto`, the least strict mode. |
| `release` or `dev` | Also verifies that the loader matches the selected injection style. |
| Normal uninject | Checks the layout before acting. |
| `--dry-run` | Validates and reports the layout without stopping Discord or changing files. |
| BetterDiscord not installed | A normal uninject exits successfully without disabling recovery or stopping Discord. |

`auto` is usually the easiest choice when removing BetterDiscord's wrapper.

Examples:

```sh
./local-uninject.zsh
./local-uninject.zsh stable
./local-uninject.zsh ptb auto
./local-uninject.zsh canary dev
./local-uninject.zsh stable auto --dry-run
```

## Quick Examples

For the recommended release and development paths, see [Quick release](#quick-release), [development injection](#development-injection), and [release injection](#release-injection) above.

Reset/update Stable and install OpenAsar, then inject BetterDiscord last:

```sh
$HOME/Apps/Scripts/shell/discord_install_manager.zsh --channel stable --update --openasar
./local-inject.zsh stable
```

Refresh OpenAsar inside an existing BetterDiscord wrapper without reinjecting:

```sh
$HOME/Apps/Scripts/shell/discord_install_manager.zsh --channel stable --openasar --BD
```

Build only the BetterDiscord module and inject it into Canary in dev mode on macOS:

```sh
./local-build.zsh build --module=betterdiscord
./local-inject.zsh canary dev
```
