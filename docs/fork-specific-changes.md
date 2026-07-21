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
| BetterDiscord settings integration | Uses a strict `openUserSettings` + `USER_SETTINGS_MODAL_KEY` lookup, a modal-key close helper, upstream section placement, and upstream version rendering. | Takes the strict opening lookup, but keeps resilient footer-first section placement and the DOM-backed version row with debug-copy and tooltip behavior. Closing uses reviewed modal-key, legacy export, and layer-pop compatibility tiers. | Keep the adopted strict opening lookup unless runtime testing disproves it. Preserve the fork placement/version hooks and close tiers until upstream supplies equivalent compatibility. |
| `BdApi.UI` setting dependencies | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) makes plugin-created settings reactive, but its nested-category checks reverse the otherwise documented `enableWith` and `disableWith` behavior. Its top-level checks are correct. | Uses the upstream reactive panel while making nested categories follow the same polarity as top-level settings and `SettingsStore`: `enableWith` requires its controller to be on; `disableWith` blocks the dependent setting while its controller is on. | Preserve the two-line correction and its source comment until upstream fixes or explicitly clarifies the nested-category semantics; then prefer the upstream equivalent. |
| Custom CSS lifecycle and navigation | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) adds reactive predicates, new open actions, and a full-page editor, but its `initialize()` override skips the base lifecycle and its disabled panel is not re-registered. | Takes the feature set while retaining base initialization, enable-time panel registration, disable-time removal, and the settings refresh needed for re-enable. It also scopes layout/focus patches, keeps disabled CSS inactive, and closes source editors only after a successful system-editor launch. | Preserve these narrow corrections while upstream still has the failure paths. Remove a divergence when upstream provides equivalent lifecycle, cleanup, focus, disabled-state, or launch-result handling. |
| Addon Store install completion | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) leaves the install modal waiting only for an addon `loaded` event while blocking close requests after installation begins. A successfully downloaded but disabled addon emits `read`, not `loaded`. | Closes the install modal when its install promise settles, including when **Automatically Enable** is unchecked. | Preserve this completion behavior until upstream provides an equivalent success path; do not make disabled installation depend on addon startup. |
| System-editor launch failure | In [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829), the separate editor closes for every resolved `openPath()` result, while Custom CSS closes its source editor immediately after asynchronous `openExternal()`. | Uses `openPath()` in both paths and closes the BetterDiscord source editor only for its empty success string. A failed launch leaves the source editor open. | Preserve the result checks and source comments until upstream provides equivalent failure handling. |
| Native fetch transport | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) moves `BdApi.Net.fetch` into a shared internal module, raises the default timeout to eight seconds, and supports `timeout: null`. | Takes that transport atomically, but resolves relative redirect locations against the current request URL. | Keep the one-line redirect correction until upstream lands equivalent base-URL handling; otherwise prefer the shared upstream implementation. |
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

The Stage 4 review deliberately replaces the fork's `openUserSettings`-only
lookup from `f0eb9941` with upstream's stricter lookup requiring both
`openUserSettings` and `USER_SETTINGS_MODAL_KEY`. That adoption is not a
protected divergence; verify it at runtime and prefer the upstream form while
it works.

The protected settings behavior is:

- `getBetterDiscordSectionIndex()` first places BetterDiscord before Discord's
  footer section, then tries the activity section/children, and only then
  appends it. Do not restore upstream's unchecked `findIndex() + 1` placement.
- Keep the DOM-backed BetterDiscord version row, debug-copy action, and copy
  tooltip until upstream has runtime-proven equivalent behavior on the current
  Discord layout.
- Closing Settings selects the first available, non-throwing tier in this order:
  a discovered `USER_SETTINGS_MODAL_KEY`, the reviewed
  `USER_SETTINGS_MODAL_MODAL_KEY` constant, the legacy `closeUserSettings`
  export, and finally `LAYER_POP`.
- `ModalActions.closeModal()` returns `void`, so a normal call cannot be
  followed blindly by another fallback without risking closure of an unrelated
  modal. Continue down the hierarchy only when the current API/key is missing
  or throws.

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

Primary files:

- `src/betterdiscord/builtins/customcss.ts`
- `src/betterdiscord/ui/settings.tsx`
- `src/betterdiscord/ui/customcss/csseditor.tsx`
- `src/betterdiscord/ui/customcss/editor.tsx`
- `src/betterdiscord/styles/builtins/customcss.css`

- [`eb384c7f`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/eb384c7f8e1f9376c630add2708dc01fdc8feade) removed the stale `updateAccount` module dependency.
- Stage 4 adopts upstream's full-page settings editor, React ref handling,
  enabled/clickable predicates, detached-state updates, system/external editor
  actions, and already-detached toast.

Intentional Stage 4 divergence from upstream `44e21745`:

- Do not add upstream's `CustomCSS.initialize()` override as written. It skips
  `Builtin.initialize()`, so initially enabled Custom CSS would not load,
  inject, watch its file, or install the main setting listener.
- Register the Custom CSS panel from `enabled()` and remove it from
  `disabled()`. Upstream registers it once from `initialize()`, removes it when
  disabled, and does not put it back on re-enable.
- Keep the delayed Settings refresh after the main toggle changes. Because this
  port still removes/re-registers the panel, an already-open Settings view must
  be rebuilt so the panel disappears or returns immediately.
- Apply the full-page panel/scroller classes only for `isSettingsPage`, and
  remove the scroller class from the same scroller node that received it.
  Upstream applies the effect without checking the flag and removes that class
  from the wrong element.
- Suppress ancestor focus only for the remainder of the current Monaco click's
  event propagation, then immediately unpatch. Never leave
  `HTMLElement.prototype.focus` globally replaced between clicks or after an
  editor unmounts.
- An editor may continue saving while the main Custom CSS toggle is off, but
  `DOMManager` must receive an empty stylesheet until that toggle is enabled
  again. This prevents an open editor from silently reactivating disabled CSS.
- The main toggle controls CSS application, file watching, and panel visibility;
  it does not close an already-open detached/external editor or reopen one when
  enabled again. Opening the detached editor from Settings does close Settings.
- Open the system editor with `shell.openPath()`. Close the Settings or floating
  source editor only when Electron returns its empty success string; show an
  error and leave the source editor open for a nonempty error or rejection.
- Keep the reviewed Settings close hierarchy documented above for detached
  editor navigation.

Each correction has a nearby `Fork review` source comment. If upstream later
supplies equivalent behavior, remove the local correction and take the
upstream implementation rather than preserving divergence for its own sake.

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

Primary files: `src/editor/preload.ts` and
`src/betterdiscord/builtins/customcss.ts`.

Electron's `shell.openPath()` resolves to an empty string on success and a
nonempty error string on failure. In the separate editor preload, upstream
[`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829)
calls `openPath()` but closes for either resolved string. In the Custom CSS
settings/floating paths, upstream calls asynchronous `openExternal()` and
closes the source editor immediately without waiting for launch success. The
fork uses success-gated `openPath()` in both paths and closes only for its empty
success string, so a failed macOS system-editor launch does not leave the user
with neither editor open.

An inline fork-review comment records the reason for this divergence. If
upstream later checks the `openPath()` result or otherwise keeps the editor open
on failure, remove the local correction and take the upstream equivalent.

### Native fetch transport

Primary files:

- `src/betterdiscord/api/net.ts`
- `src/betterdiscord/modules/net.ts`
- `src/common/native-fetch.ts`
- `src/electron/preload/api/fetch.ts`

Stage 5 takes upstream's shared native-fetch transport as one atomic change:

- `BdApi.Net.fetch` becomes a thin public wrapper around the new internal
  `@modules/net` implementation.
- Existing request/body streaming, abort handling, response hydration,
  per-redirect webhook blocking, redirect limits, and TLS verification remain.
- The default timeout moves from three to eight seconds.
- `timeout: null` explicitly disables the timeout. Stage 6 and Stage 7 must
  review each no-timeout Addon Store/updater call so a stalled request cannot
  leave shared state pending forever.

Intentional divergence from upstream `44e21745`:

- Resolve a redirect with `new URL(res.headers.location, uri)`. Upstream's
  one-argument form throws for ordinary relative locations such as
  `/download/file`.
- The correction is also present in upstream's unmerged
  [`3ce61469`](https://github.com/BetterDiscord/BetterDiscord/commit/3ce614695ef454259f07fd4dda8109ad4a5146fb)
  fix. Remove the fork comment and take upstream when equivalent handling lands
  in the reviewed upstream branch.

Inherited limitations such as incomplete `303`/POST redirect semantics,
non-replayable streamed request bodies across redirects, and copying source
query parameters onto the redirect target are not introduced by this stage.
Keep this port narrow rather than rewriting the transport during the
`44e21745` integration.

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
