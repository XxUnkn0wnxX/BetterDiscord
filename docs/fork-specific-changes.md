# BetterDiscord Fork-Specific Behavior

This document tracks intentional behavior in this fork that must survive future
upstream merges. It is not a list of every file that differs from upstream.
Ordinary upstream changes should be accepted unless they overlap one of the
contracts below.

Last audited against fork `develop` at
[`969320b9`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/969320b94ee5b6cc1479fb0a8480e218568e9ecd)
and upstream
[`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829)
on 2026-07-22. Commit labels are abbreviated for readability; every commit
link targets its full 40-character SHA.

## Merge policy

- Prefer upstream behavior and ancestry by default.
- A local textual difference is not automatically protected.
- If upstream does not touch a protected area, take the upstream change normally.
- If upstream overlaps a protected area, review that hunk before changing it.
- Port small compatible upstream fixes around the fork behavior where possible.
- If compatibility is unclear, keep the current fork behavior and ask before changing it.
- Any injector, recovery, bootstrap, or OpenAsar handoff adjustment requires an explicit user checkpoint.
- Record reviewed upstream ancestry only after every upstream hunk is accepted,
  adapted, or intentionally retained from the fork and the resulting tree passes
  the final verification gate.

## Upstream versus this fork

| Area | What upstream does | What this fork prefers/does | Merge rule |
| --- | --- | --- | --- |
| Injection and Discord updates | Uses the application-ASAR wrapper model. In [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829), the only new injector change is a spelling correction and the only migrator change suppresses production logs. | Extends the wrapper model with cross-platform resource discovery, release/dev injection, safe uninject, macOS recovery, and identity-matched BetterDiscord/OpenAsar handoff handling. | Keep the fork plumbing. Port only a reviewed target-layout/path adjustment, never a wholesale replacement. |
| Plugin startup | Upstream generally keeps disabled plugins inert but still force-starts `0BDFDB.plugin.js`. | No plugin or library receives special treatment. A disabled plugin, including `0BDFDB.plugin.js` or ZeresPluginLibrary, stays disabled. Plugin `load()` remains lazy until enablement. | Preserve the generic enabled-state check in `pluginmanager.ts`. Review any future upstream plugin lifecycle change around it. |
| BetterDiscord settings integration | Uses upstream settings layout discovery, version rendering, and Custom CSS predicates. | Uses resilient section placement, the current `openUserSettings` discovery, and a DOM-backed version row with debug-copy and tooltip behavior. | Port upstream settings features manually around these hooks. Observable placement/navigation/debug-copy behavior must remain. |
| `BdApi.UI` setting dependencies | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) makes plugin-created settings reactive, but its nested-category checks reverse the otherwise documented `enableWith` and `disableWith` behavior. Its top-level checks are correct. | Uses the upstream reactive panel while making nested categories follow the same polarity as top-level settings and `SettingsStore`: `enableWith` requires its controller to be on; `disableWith` blocks the dependent setting while its controller is on. | Preserve the two-line correction and its source comment until upstream fixes or explicitly clarifies the nested-category semantics; then prefer the upstream equivalent. |
| Custom CSS navigation | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) adds reactive panel removal, new open actions, and editor layout changes. | Avoids the stale `updateAccount` settings-module lookup. Closing settings uses the discovered `closeUserSettings` export and falls back to `LAYER_POP`. | Take the upstream Custom CSS feature set, but reconcile the two overlapping files and preserve a working close/navigation fallback. |
| Addon Store install completion | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) leaves the install modal waiting only for an addon `loaded` event while blocking close requests after installation begins. A successfully downloaded but disabled addon emits `read`, not `loaded`. | Closes the install modal when its install promise settles, including when **Automatically Enable** is unchecked. | Preserve this completion behavior until upstream provides an equivalent success path; do not make disabled installation depend on addon startup. |
| System-editor launch failure | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) closes the separate BetterDiscord editor whenever Electron's `shell.openPath()` promise resolves. Electron also resolves failures, using a nonempty error string. | Closes the BetterDiscord editor only when `openPath()` returns an empty success string. A failed system-editor launch leaves the BetterDiscord editor open. | Preserve the result check and its source comment until upstream provides equivalent failure handling. |
| BetterDiscord core updater | Upstream performs BetterDiscord core update checks alongside plugin/theme update checks. | BetterDiscord core checks stay disabled at startup, on the scheduler, and from the Updates panel. Plugin and theme update checks remain enabled. | Port shared catalogue/native-fetch work around the commented core-check calls. Do not disable plugin/theme updating. |
| Discord/Webpack compatibility | Upstream follows its current module discovery paths. | Keeps guards for throwing exports/getters, early bundle parsing, wrapped message exports, safer React-tree walking, and removal of stale module lookups. | Preserve a guard only while the current upstream implementation does not provide equivalent protection. Review same-file overlaps instead of replacing blindly. |
| Workflows, docs, and local wrappers | Upstream uses its own branches, release flow, badges, and documentation. | Uses fork `develop`, fork CI/release behavior, fork badges/docs, and `local-build.zsh`, `local-inject.zsh`, and `local-uninject.zsh`. | Keep these fork-owned unless the user explicitly requests a workflow, documentation, or wrapper update. |
| Local Bun test compatibility | Newer Bun can execute all native Intl assertions. | Bun 1.1.20 on macOS 11 uses a test-only PluralRules shim and skips only the native NumberFormat/currency assertions that abort that binary. | Keep the condition exact to Bun 1.1.20/Darwin 20 so newer Bun always runs the native tests. |

## Source and commit map

### Injection, recovery, and OpenAsar handoff

Primary files:

- `scripts/inject.ts`
- `scripts/helpers/injection.ts`
- `scripts/uninject.ts`
- `scripts/build.ts`
- `src/common/discordResources.ts`
- `src/electron/main/migrator.ts`
- `src/electron/main/macosrecovery.ts`
- `src/electron/main/macoshandoff.ts`
- `local-build.zsh`, `local-inject.zsh`, and `local-uninject.zsh`

Key commits:

- [`4c34e7f6`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/4c34e7f69d9a42f8888f39894008ff35d684dfe1) — adopt the application-ASAR wrapper.
- [`dbd8994a`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/dbd8994a38ffd719bbac1017eab0a8df4aafbe50) — preserve OpenAsar behind the BetterDiscord wrapper.
- [`c25c40b0`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/c25c40b0de3b00cc3515a1068e725c5a8cdad4f5), [`a6bb4129`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/a6bb4129c46b0df2d7b878af303c2cf89c05d807), [`ec2693fc`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/ec2693fc8f5c2dd5ae794a16447caa69133ab003), and [`2d28f20c`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/2d28f20c64ecb2557d09867edff3641972179640) — harden update recovery, relaunch, timeout, and termination behavior.
- [`8dff536f`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8dff536f1ba57c012de2c3145576c95180094055), [`43d4b077`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/43d4b077b412ca1885b7062bbf36a18b12ed7bc4), and [`5884e70b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/5884e70b9929b4d4b87d18150b0a0d61b58445bd) — preserve and identity-scope OpenAsar handoffs.
- [`b9bd7326`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/b9bd7326bf5f358c4925203bc3e970103e2c9061), [`f3d66c16`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/f3d66c16f5126ab7ee784938c26e6302d7576571), [`afffecd3`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/afffecd3832e4e5a16c32f83e74991cc613afc75), and [`52d0b675`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/52d0b67583142fb29ea57da828842874a47db5e3) — keep timeout/build-wrapper and uninject behavior compatible.

See [manual-install.md](manual-install.md) for the current wrapper and recovery flow.

Non-negotiable installed-recovery and handoff behavior:

- Installed recovery runs through `/usr/bin/env zsh -f` with a fixed system
  `PATH` and a small environment allowlist; it never runs Bun. Legacy
  `helperRuntime` marker data may be read for safe upgrades but must not be
  written or executed.
- Direct builds default to a 90-second BetterDiscord recovery timeout. Fork CI
  explicitly uses 45 seconds, and matching OpenAsar builds add their own
  10-second BetterDiscord handoff grace.
- Local staged testing also passes `-mrts 45`; this per-build override does not
  change the direct-build default.
- Each recovery run owns its own assets, helper process group, PID marker, and
  cleanup. Preserve the replace-per-run `betterdiscord-bootstrap.log` and
  `betterdiscord-bootstrap-console.log` diagnostics.
- BetterDiscord/OpenAsar coordination must remain identity-matched by
  installation, channel, target, source Discord PID, OpenAsar handoff ID, and
  BetterDiscord recovery run ID. Do not consume an unrelated
  `wrapper-ready.json` marker.
- If a live matching OpenAsar helper already owns a fresh
  `wrapper-ready.json` handoff, BetterDiscord's `before-quit` path preserves it
  and does not arm redundant recovery.
- Normal and fast user quits may repair replaced ASARs but stay closed. Only a
  current explicit updater-restart signal may authorize a helper to relaunch
  Discord.

### Plugin loading and library neutrality

Primary file: `src/betterdiscord/modules/pluginmanager.ts`.

- [`453ee9c0`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/453ee9c0c907bbb88fcf69b8deb1cdfbd95ddafd) made disabled plugins inert and deferred `load()` until enablement.
- [`9e969122`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/9e96912258e4fb64ee91ce43c51fcf9389ad7297) preserved the generic enabled-state check while merging upstream and removed the active `0BDFDB.plugin.js` exception.
- The required active condition is equivalent to:

```ts
if (addon.runAt !== point || !this.state[addon.id]) continue;
```

There must be no active filename exception for `0BDFDB.plugin.js`, BDFDB, or
ZeresPluginLibrary.

### Settings integration

Primary files: `src/betterdiscord/ui/settings.tsx` and
`src/betterdiscord/styles/index.css`.

- [`adc5a164`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/adc5a1641593cc06be7b82384e398e8ee9fe05f1) added the current DOM-backed BetterDiscord version/debug-copy row.
- [`f0eb9941`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/f0eb9941cb09fb4046f5868aa33d9a503a65ee62) updated user-settings module discovery to the current API.
- [`2c4f777b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/2c4f777b964fa339b44bebee86a5a22f6cd91395) added resilient BetterDiscord section placement through
  `getBetterDiscordSectionIndex()`.

Upstream may replace obsolete implementation details, but it must preserve the
visible section placement, settings navigation, version row, debug-copy action,
and copy tooltip.

### `BdApi.UI` settings dependency polarity

Primary file: `src/betterdiscord/api/ui.ts`.

Upstream
[`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829)
adds live dependency handling to plugin-created settings panels. The fork takes
that implementation, but corrects the two nested-category checks so they agree
with upstream's top-level handling and the core `SettingsStore`:

- `enableWith: "controller"` means the dependent setting is enabled only while
  `controller` is on.
- `disableWith: "controller"` means the dependent setting is disabled while
  `controller` is on, and enabled while it is off.

This changes only whether the dependent control is clickable; it does not
change or reset the stored setting value. An inline fork-review comment marks
the two corrected lines. If upstream later supplies equivalent logic or
documents intentionally different category behavior, re-review the correction
and remove it when it is no longer needed.

The Stage 2 integration and dependency correction are recorded in
[`9c3117f3`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/9c3117f3471a19a2f1b3ffd9ca74dc174b33a02d).

### Custom CSS

Primary files: `src/betterdiscord/builtins/customcss.ts` and
`src/betterdiscord/ui/settings.tsx`.

- [`eb384c7f`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/eb384c7f8e1f9376c630add2708dc01fdc8feade) removed the stale `updateAccount` module dependency.
- Detached-editor navigation first tries `closeUserSettings`; if unavailable,
  it falls back to `DiscordModules.Dispatcher` with `LAYER_POP`.

The larger upstream Custom CSS UI is desired. Only the close/navigation
compatibility behavior and a correct Builtin enable/disable lifecycle are fork
requirements.

### Addon Store install completion

Primary file: `src/betterdiscord/ui/modals/installmodal.tsx`.

- A successful download must close the installation modal whether the addon is
  enabled immediately or installed disabled.
- Failure must also release the modal instead of leaving its spinner and close
  guard active indefinitely.
- This hotfix was found during the
  [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829)
  Stage 1 runtime pass and is recorded in
  [`8a64cd76`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8a64cd76d29b639a7806c23793dfaf3c7e95dbfa).

### System-editor launch failure

Primary file: `src/editor/preload.ts`.

Electron's `shell.openPath()` resolves to an empty string on success and a
nonempty error string on failure. Upstream
[`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829)
closes the separate BetterDiscord editor for either result. The fork checks the
resolved string and closes only on success, so a failed macOS system-editor
launch does not leave the user with neither editor open.

An inline fork-review comment records the reason for this divergence. If
upstream later checks the `openPath()` result or otherwise keeps the editor open
on failure, remove the local correction and take the upstream equivalent.

### Core updater policy

Primary files: `src/betterdiscord/modules/updater.ts` and
`src/betterdiscord/ui/updater.tsx`.

- [`ca9b45c3`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/ca9b45c3f39ecef562a0a7f5debcd967539cb920) first suppressed automatic checks on fork/develop builds.
- [`bf396278`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/bf39627879589c9f4e8aca291d27d7a16404b481) retained plugin/theme automatic checks while making core checks manual-only.
- [`8bd22d5b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8bd22d5ba36e36303ec6671985de3062d4551122) is the current policy: BetterDiscord core startup, scheduled, and manual checks are all disabled; plugin/theme checks remain active.

Keep the commented core-check calls and their explanation so future merges do
not accidentally reactivate them.

### Runtime compatibility hardening

These are secondary review surfaces, not reasons to reject unrelated upstream
work:

- `src/electron/preload/early/index.ts`
- `src/common/findFunctionBodyStart.ts`
- `src/betterdiscord/utils/object.ts`
- `src/betterdiscord/webpack/shared.ts`
- `src/betterdiscord/builtins/general/themeattributes.tsx`
- `src/betterdiscord/modules/discordmodules.ts`

- [`39f8d65b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/39f8d65b7708732fe05209aa10a4a967d373ace0) and [`ecce03cd`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/ecce03cd6492b9cddaf97617b1e26ff97e7785a1): preload/early-webpack startup parsing and guarded module access.
- [`71bb99b3`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/71bb99b368ba62ea1c0f352cb163662e20f031f7): DOM, theme-attribute, object-access, and updater-noise hardening.
- [`8760e8d7`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8760e8d73b89d0dd64f03419cab7ad31ce77f98b) and [`939b755f`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/939b755fb6b281dd651e9f792329e8c1988e30ba): wrapped message exports and restricted React-tree walking.
- [`9dae9f4b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/9dae9f4bd7f4879f88f698377395dfd299185026): removal of the stale `DiscordMarkdown` lookup.
- [`d81d4114`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/d81d41146d83d5b31231d1b0aaee81e58c161c36): fork build metadata in copied debug information.

If upstream now provides equivalent behavior, use upstream. If it touches the
same failure path without equivalent protection, adapt it around the guard.

### Repository-owned files

Keep these fork-owned unless explicitly reviewed:

- `.github/workflows/ci.yml`
- `.github/workflows/crowdin.yml`
- `.github/workflows/publish-types.yml.disabled`
- `.gitignore`
- `README.md`
- `docs/manual-install.md`
- local Zsh wrappers

The Bun 1.1.20/Darwin 20 test compatibility path currently lives in
`tests/setup.ts` and `tests/common/i18n.test.ts`; it is recorded in
[`8a64cd76`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8a64cd76d29b639a7806c23793dfaf3c7e95dbfa).

## Required checks after an overlapping upstream change

- Injection/OpenAsar: run injection, resource-discovery, recovery, and handoff tests; then ask before live injection changes.
- Plugin loading: verify disabled plugins stay inert, enablement runs `load()` once, and no library filename bypass exists.
- Settings: verify placement, search/navigation, the version row, debug-copy, and tooltip behavior.
- `BdApi.UI` dependencies: verify top-level and nested-category `enableWith` and
  `disableWith` states update immediately and each plugin callback runs once.
- Custom CSS: verify enabled/disabled startup, disable/re-enable, all open actions, file watching, saving, and detached close behavior.
- Addon Store install completion: verify successful downloads close the modal with automatic enable both off and on, and leave the requested enabled state intact.
- System editor: verify a successful `openPath()` closes the BetterDiscord
  editor and a failed launch leaves it open.
- Updater: verify no BetterDiscord core request occurs while plugin/theme automatic and manual checks still work.
- Workflows/docs/wrappers: compare them byte-for-byte with fork `develop` unless that stage explicitly changes them.
