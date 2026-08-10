# BetterDiscord Fork-Specific Behavior

This document tracks intentional behavior in this fork that must survive future
upstream merges. It is not a list of every file that differs from upstream.
Ordinary upstream changes should be accepted unless they overlap one of the
contracts below.

The current merge audit targets upstream
[`8e3078b4`](https://github.com/BetterDiscord/BetterDiscord/commit/8e3078b4e4f3e2fcf5b0b4644bd86c5e15e71333)
on 2026-08-11. Commit labels are abbreviated for readability; every commit link
targets its full 40-character SHA.

This document tracks the historical integration of upstream
`upstream-merge-44e21745` and the later upstream range through `8e3078b4`. It is
a durable record for merge behavior and preserved deltas; current checkpoint
status is not tracked here.

## Merge policy

- Prefer upstream behavior and ancestry by default.
- A local textual difference is not automatically protected.
- If upstream does not touch a protected area, take the upstream change normally.
- If upstream overlaps a protected area, review that hunk before changing it.
- Port small compatible upstream fixes around the fork behavior where possible.
- Treat upstream plugin-facing behavior as authoritative. When upstream assumes
  a newer Web, Electron, or Discord runtime, audit the older macOS/pinned Discord
  targets and backport only the internal plumbing needed to preserve that
  behavior.
- If compatibility is unclear, keep the current fork behavior and ask before changing it.
- Any injector, recovery, bootstrap, or OpenAsar handoff adjustment requires an explicit user checkpoint.
- Record reviewed upstream ancestry only after every upstream hunk is accepted,
  adapted, or intentionally retained from the fork and the resulting tree passes
  the final verification gate.
- Once verified, include the full reviewed upstream range in ancestry, including
  commits whose changes were wholly skipped or superseded. When needed, use a
  tree-neutral ancestry merge and keep the fork adaptations above it so those
  commits do not reappear as divergence.

## Upstream versus this fork

| Area | What upstream does | What this fork prefers/does | Merge rule |
| --- | --- | --- | --- |
| Injection and Discord updates | Uses the application-ASAR wrapper model. In [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829), the only new injector change is a spelling correction and the only migrator change suppresses production logs. | Extends the wrapper model with cross-platform resource discovery, release/dev injection, safe uninject, macOS recovery, and identity-matched BetterDiscord/OpenAsar handoff handling. | Keep the fork plumbing. Port only a reviewed target-layout/path adjustment, never a wholesale replacement. |
| Plugin startup | Upstream generally keeps disabled plugins inert but still force-starts `0BDFDB.plugin.js`. | No plugin or library receives special treatment. A disabled plugin, including `0BDFDB.plugin.js` or ZeresPluginLibrary, stays disabled. Plugin `load()` remains lazy until enablement. | Preserve the generic enabled-state check in `pluginmanager.ts`. Review any future upstream plugin lifecycle change around it. |
| Plugin/theme settings, search, and editors during hot reload | Upstream refreshes the addon list but leaves settings panels and BetterDiscord editor windows created from the old addon open. Its installed-addon search also stores the visible text separately from the filter and labels the placeholder with the filtered result count. The retained Settings-title portal can reuse that search when entering the Addon Store or keep stale callbacks after the addon page remounts. It also tracks only one updater even though Discord can commit two title roots for the same panel. | Closes only the matching settings modal and BetterDiscord detached/external source editors, using a discard-only path with no toast, prompt, automatic reopen, or BetterDiscord save callback. Installed and Store searches are controlled by their owning pages and have distinct mode keys. Titles publish after their owner commits, and a per-provider title store updates every committed title root, so modal/editor activity cannot leave the visible root stale. Every Store entry/exit starts empty. The installed placeholder uses the full count while its results label uses the filtered count. Normal user closes keep their existing behavior; system-editor processes remain untouched. | Preserve the addon type/ID/filename-scoped reload close, post-commit title publication, multi-header title-store fan-out, controlled searches, and distinct installed/Store keys. Do not replace them with a global modal/window close, make reload invoke normal save/confirm callbacks, publish titles by updating another component during render, track only one retained header updater, reuse search state across Store transitions, or use the filtered result count as the installed-total placeholder. |
| BetterDiscord settings integration | Uses a strict `openUserSettings` + `USER_SETTINGS_MODAL_KEY` lookup, a modal-key close helper, upstream section placement, and upstream version rendering. | Takes the strict opening lookup, but keeps resilient footer-first section placement and the DOM-backed version row with debug-copy and tooltip behavior. Closing uses reviewed modal-key, legacy export, and layer-pop compatibility tiers. | Keep the adopted strict opening lookup unless runtime testing disproves it. Preserve the fork placement/version hooks and close tiers until upstream supplies equivalent compatibility. |
| OS accent color | Upstream initializes the color in Electron main and listens for `accent-color-changed`, but its in-flight guard can use an uninitialized CSS key, remain stuck after a rejection, and drop a newer event. Electron does not expose that event on macOS. | Keeps startup initialization on every `dom-ready`, serializes and coalesces live changes, recovers after CSS insertion/removal failures, and on all supported macOS versions uses Electron's local-notification bridge for AppKit's public `NSSystemColorsDidChangeNotification` before re-reading the authoritative accent getter. Registration fallbacks remain for Electron/runtime compatibility. | Preserve the queued lifecycle and platform-specific listener until upstream provides equivalent behavior. Do not version-gate the AppKit notification or replace it with the early `AppleAquaColorVariantChanged` signal. When removing the old accent IPC, keep the fork's unrelated `EDITOR_CLOSE` IPC path. |
| Activity iframe hardening | Upstream exempts `*.discordsays.com` Activity frames from the generic `contentWindow` proxy. | Keeps that Activity exception, but validates the URL safely and grants direct `contentWindow` access only to real `*.discordsays.com` hosts. Every other frame keeps the existing proxy and localStorage protection. | Preserve the upstream exception and the fork's URL guard without changing the plugin-visible Activity flow. |
| `BdApi.Patcher.instead` semantics | Upstream uses nested `instead` patch behavior with delegated callbacks and edge-case continuation ordering. | Keeps first-registered `instead` outermost, preserves callback argument/receiver forwarding, explicit/omitted returns, non-delegating suppression, and after-patch ordering while retaining the existing `unpatch()` idempotent-guard behavior. | Preserve upstream-observable semantics exactly and keep idempotent unpatch semantics as an isolated fork guard. |
| Release checksum artifacts | Upstream adds `dist/checksums.txt` with 8 packed-input hashes, uploads the ASAR and checksum file separately for pull requests, and publishes both through its Canary release. | Keeps the upstream checksum manifest and separate unarchived pull-request artifacts, but adapts publication to the fork's rolling `develop-latest` release. The list hashes packed inputs, not the ASAR stream. | Preserve the checksum behavior while keeping the fork's branch and release model unless that model is explicitly reworked. |
| `BdApi.UI` setting dependencies | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) makes plugin-created settings reactive, but its nested-category checks reverse the otherwise documented `enableWith` and `disableWith` behavior. Its top-level checks are correct. | Uses the upstream reactive panel while making nested categories follow the same polarity as top-level settings and `SettingsStore`: `enableWith` requires its controller to be on; `disableWith` blocks the dependent setting while its controller is on. | Preserve the two-line correction and its source comment until upstream fixes or explicitly clarifies the nested-category semantics; then prefer the upstream equivalent. |
| Custom CSS lifecycle and navigation | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) adds reactive predicates, new open actions, and a full-page editor, but its `initialize()` override skips the base lifecycle and its disabled panel is not re-registered. | Takes the feature set while retaining base initialization, enable-time panel registration, disable-time removal, and the settings refresh needed for re-enable. It also scopes layout/focus patches, keeps disabled CSS inactive, and closes source editors only after a successful system-editor launch. | Preserve these narrow corrections while upstream still has the failure paths. Remove a divergence when upstream provides equivalent lifecycle, cleanup, focus, disabled-state, or launch-result handling. |
| Addon Store install completion | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) leaves the install modal waiting only for an addon `loaded` event while blocking close requests after installation begins. A successfully downloaded but disabled addon emits `read`, not `loaded`. | Closes the install modal when its install promise settles, including when **Automatically Enable** is unchecked. | Preserve this completion behavior until upstream provides an equivalent success path; do not make disabled installation depend on addon startup. |
| System-editor launch failure | In [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829), the separate editor closes for every resolved `openPath()` result, while Custom CSS closes its source editor immediately after asynchronous `openExternal()`. | Uses `openPath()` in both paths and closes the BetterDiscord source editor only for its empty success string. A failed launch leaves the source editor open. | Preserve the result checks and source comments until upstream provides equivalent failure handling. |
| Native fetch transport | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) moves `BdApi.Net.fetch` into a shared internal module, raises the default timeout to eight seconds, and supports `timeout: null`. | Takes that transport atomically, resolves relative redirects correctly, and adds updater-only HTTPS/credential, redirect-query, and response-size guards through opt-in request fields. Normal `BdApi.Net.fetch` calls keep their upstream behavior. | Preserve the relative-redirect correction and opt-in updater safety fields until upstream provides equivalent handling. Do not make the updater's restrictions global without a separate review. |
| Shared Addon Store catalogue | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) lets the Store and addon updater share a native-fetch catalogue, but its initiating caller does not await the request and offline, timeout, cache, retry, and disable/re-enable paths can hang or race. | Keeps one returned in-flight promise, a 30-second inactivity timeout, cancellation and stale-result guards, replacement cache fallback, fixed retry delays, response validation, and lifecycle logging. | Preserve the narrow request-state corrections until upstream provides equivalent settlement, cancellation, cache, and recovery handling. Keep Stage 1 install completion intact. |
| Identity-aware plugin/theme updater | Upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829) matches installed addons to Store rows by type/filename, downloads the Store source, and writes it synchronously. That can replace a same-filename fork with an unrelated Store addon. | Stage 7B shares one coordinator across plugins and themes, compares a declared `@updateUrl` with an identity-approved Store candidate, chooses the highest comparable newer version, reuses checked bytes through a bounded memory cache, and replaces the installed file atomically. Per-addon freshness, restart restoration, conditional requests, bounded concurrency, provider backoff, and optional update notifications are fork additions. | Preserve identity-before-version selection, safe source validation, atomic replacement, and per-addon scheduling. Future upstream updater work should be adapted around these guarantees instead of restoring filename-only Store replacement. |
| BetterDiscord core updater | Upstream performs BetterDiscord core update checks alongside plugin/theme update checks. | BetterDiscord core checks stay disabled at startup, on the scheduler, and from the Updates-panel refresh. Plugin/theme startup, scheduled, file-event, and manual checks remain enabled. | Keep every core-check call commented while preserving the dormant implementation for future review. Never couple the fork's core updater back into addon refreshes. |
| Discord/Webpack compatibility | Upstream follows its current module discovery paths. | Keeps guards for throwing exports/getters, early bundle parsing, wrapped message exports, safer React-tree walking, and removal of stale module lookups. | Preserve a guard only while the current upstream implementation does not provide equivalent protection. Review same-file overlaps instead of replacing blindly. |
| Older macOS and pinned Discord runtimes | Upstream targets its current supported runtime and may use newly shipped Web/Electron APIs directly. Upstream `8e3078b4` adds `BdApi.Utils.loadEntry` and uses `Map.prototype.getOrInsertComputed` for its private content cache. | Keeps the exact upstream `loadEntry` plugin contract and algorithm, but selects the native Map helper by capability and otherwise uses equivalent private insert-if-absent cache plumbing. The currently audited legacy band is Discord Stable `0.0.350`-`0.0.402` on Electron 35/37, with macOS Big Sur as an active target. | Preserve upstream inputs, parsing, calls, ordering, returns, logging, rejection boundaries, and cache lifetime. Keep compatibility internal and capability-based; do not globally patch `Map.prototype`, version-gate Electron, or expose a fork-only alternate API. |
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

### Plugin/theme hot-reload UI safety

Primary files:

- `src/betterdiscord/builtins/customcss.ts`
- `src/betterdiscord/modules/addonmanager.ts`
- `src/betterdiscord/ui/modals.ts`
- `src/betterdiscord/ui/settings/addonshared.tsx`
- `src/betterdiscord/ui/settings/addonlist.tsx`
- `src/betterdiscord/ui/settings/addoncard.tsx`
- `src/betterdiscord/ui/settings/addonstore.tsx`
- `src/betterdiscord/ui/settings/components/search.tsx`
- `src/betterdiscord/ui/settings/panel.tsx`
- `src/betterdiscord/ui/settings/title.tsx`
- `src/betterdiscord/ui/settings.tsx`
- `src/betterdiscord/ui/updater.tsx`
- `src/betterdiscord/utils/addonsettingsmodal.ts`
- `src/common/constants/ipcevents.ts`
- `src/electron/main/modules/editor.ts`
- `src/electron/main/modules/ipc.ts`
- `src/electron/preload/api/editor.ts`

Upstream
[`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829)
rebuilds a plugin or theme card after its file reloads, but it does not replace
an already-open settings panel or close an editor holding the old source. This
fork treats those surfaces as owned by the addon instance or file that created
them:

- Settings entry points pass the addon type and ID into the modal. The modal
  listens only for that matching `plugin-unloaded` or `theme-unloaded` event.
- A matching reload invokes the raw modal close function instead of the normal
  Done/confirm path. BetterDiscord therefore does not request a save, show a
  toast, or automatically reopen the panel.
- The in-app detached editor closes through `FloatingWindows` without its
  normal unsaved-changes prompt or Save control.
- The separate BetterDiscord editor window closes through a dedicated IPC
  command that force-destroys only the matching plugin/theme filename window.
  This bypasses its normal unsaved warning and does not write the editor buffer.
- A system text editor opened through the operating system is deliberately not
  closed because BetterDiscord does not own that process.
- The installed plugin/theme search value is controlled by the addon page so a
  Settings-title remount during reload cannot clear the visible text while
  leaving a hidden filter active. The Addon Store search is controlled by its
  own page as well. Distinct installed/Store keys force the retained title
  portal to mount a fresh control on every Store entry or exit, whichever UI
  path caused the transition. Its installed-list placeholder always reports
  the full installed count; only the title's results label reports the filtered
  count.
- BetterDiscord settings titles publish through a layout effect after their
  page commits. Upstream publishes during render by synchronously updating the
  retained header root; after Discord remounts an addon page, that update can
  be dropped and leave the old search text, result label, and callbacks visible.
  Post-commit publication also prevents an interrupted render from exposing an
  uncommitted reset or update-button callback. Do not add an unmount cleanup
  that clears the title because an outgoing installed/Store header could erase
  its replacement during the same commit.
- Discord can keep two committed title roots for one Plugins or Themes panel.
  Each settings-panel provider owns a title store that subscribes every live
  root and publishes the same cached snapshot to all of them. Do not restore a
  single mutable updater: a hidden root can become its owner when a settings
  modal or editor closes, leaving the visible controlled search stuck on stale
  text and callbacks. Keep the store provider-scoped rather than global so
  different panels and discarded layout generations cannot overwrite one
  another.

Ordinary user closes retain the existing upstream behavior. Settings-panel
persistence remains owned by the plugin or theme, and the detached/external
editors retain their existing explicit Save and unsaved-warning behavior. The
reload guard can prevent BetterDiscord from calling a normal save callback, but
it cannot undo data that third-party settings code already wrote immediately on
change or deliberately writes from its own unmount cleanup.

### Settings integration

Primary files: `src/betterdiscord/ui/settings.tsx`,
`src/betterdiscord/utils/settingslayout.ts`, and
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
  footer section; otherwise it inserts immediately after
  `games_and_apps_section`, then after the activity section or an activity-child
  anchor, and only then appends it. Do not restore upstream's unchecked
  `findIndex() + 1` placement.
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
[`48a9fb48`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/48a9fb48864cf1a371548960638431417eaf6507).

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
  [`26d9406e`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/26d9406e5dbd3955dacf7b779467a5e5e947fcd1).

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
- `timeout: null` explicitly disables the timeout. The shared catalogue retains
  its finite 30-second inactivity timeout, while Stage 7B addon and descriptor
  requests use their own finite limits.

Intentional divergence from upstream `44e21745`:

- Resolve a redirect with `new URL(res.headers.location, uri)`. Upstream's
  one-argument form throws for ordinary relative locations such as
  `/download/file`.
- Expose opt-in `httpsOnly` and `maxResponseBytes` fields to internal callers.
  Stage 7B enables them for addon sources: every redirect must remain HTTPS,
  embedded URL credentials are rejected, and response bodies are stopped at
  the transport boundary. These restrictions are not silently applied to
  ordinary `BdApi.Net.fetch` calls.
- In HTTPS-only mode, do not copy a token-bearing query string onto a redirect
  with a different origin. Same-origin redirects retain upstream's query
  preservation behavior.
- The correction is also present in upstream's unmerged
  [`3ce61469`](https://github.com/BetterDiscord/BetterDiscord/commit/3ce614695ef454259f07fd4dda8109ad4a5146fb)
  fix. Remove the fork comment and take upstream when equivalent handling lands
  in the reviewed upstream branch.

Inherited limitations such as incomplete `303`/POST redirect semantics,
non-replayable streamed request bodies across redirects, and query preservation
outside the updater's HTTPS-only mode are not introduced by this stage. Keep
this port narrow rather than rewriting the public transport during the
`44e21745` integration.

### Shared Addon Store catalogue

Primary files:

- `src/betterdiscord/modules/core.ts`
- `src/betterdiscord/builtins/store/addonstore.ts`
- `src/betterdiscord/modules/addonstore.ts`
- `src/betterdiscord/ui/misc/storeembed.tsx`
- `src/betterdiscord/ui/settings/addonstore.tsx`

Stage 6 takes upstream's Store/native-fetch catalogue design. Settings now
initialize before the catalogue, embeds and settings pages subscribe through
the common Store hook, and the catalogue starts only while the Addon Store or
addon updater needs it. Stage 7B's shared plugin/theme coordinator uses this
catalogue for Store candidates instead of retaining a private Store request.

Intentional request-lifecycle corrections:

- The initiating caller and every concurrent caller receive the same real
  in-flight promise. Upstream creates a detached promise but does not return or
  await the fetch chain on the initiating path.
- The bulk catalogue uses a 30-second network-inactivity timeout instead of
  `timeout: null`.
- Going offline or disabling both catalogue consumers aborts the active
  request. Request identity checks prevent a cancelled or older response from
  changing the newer catalogue, loading state, or retry timer.
- Offline fallback replaces the visible rows instead of appending the cache,
  and persisted `known` filenames are normalized to an array.
- Non-success HTTP responses and non-array JSON are failures. While the Addon
  Store is enabled, successful Store refreshes use the configured hourly
  interval; failed Store refreshes retry after five minutes, or 30 seconds for
  `ECONNRESET`, without multiplying that delay by the interval setting.
  Updater-only scheduling remains owned by the Stage 7B coordinator.
- Disable removes reconnect listeners and scheduled Store refreshes. Reconnect
  starts a fresh request only while the Store or addon updater is enabled.
- The Addon Store UI and plugin/theme updates are independent consumers. Turning
  off **Enable Addon Store** may hide/stop the Store itself, but it does not
  impair automatic addon checks while **Automatically Check For Updates** is
  enabled. An explicit manual updater refresh may request the catalogue even
  when both background consumers are off.

Logging is deliberately tiered:

- `debug`: request start/success, shared-request reuse, stale-result discard,
  timer scheduling/cleanup, and harmless disabled guards.
- `info`: connection loss and reconnection/recovery.
- `warn`: deliberate request cancellation, skipped offline requests, finite
  timeouts, invalid cache repair, HTTP failures, and unexpected cancellation.
- `stacktrace`/console error: unexpected networking, JSON, or catalogue-shape
  failures.

The Addon Store builtin also takes two narrow corrections from upstream audit
commit
[`7dc97d15`](https://github.com/BetterDiscord/BetterDiscord/commit/7dc97d1588c1d9dc3f1d133c998feb9071d86e3f):
use the full regex match length when excluding links inside codeblocks, and
cache the resolved link-opener module/key pair rather than its exhausted
generator. The direct protocol-array lookup still comes from `44e21745`.

Stage 1's install-modal promise completion and the unchanged `Addon.download()`
path remain responsible for closing successful downloads when **Automatically
Enable** is either on or off.

The Store subview also keeps a narrow navigation convenience in
`src/betterdiscord/ui/settings/addonpage.tsx`: while the Plugin or Theme Store
is open, clicking its already-selected sidebar item returns to the respective
installed-addons page. The listener targets only that panel's current
`data-list-item-id`; it does not alter the fork's Settings placement or refresh
hooks.

### Identity-aware plugin/theme updater (Stage 7B)

Primary files:

- `src/betterdiscord/modules/addonupdater.ts`
- `src/betterdiscord/utils/addonupdate.ts`
- `src/betterdiscord/utils/addonupdateurl.ts`
- `src/betterdiscord/utils/addonupdatestate.ts`
- `src/betterdiscord/modules/updater.ts`
- `src/betterdiscord/ui/updater.tsx`
- `src/betterdiscord/stores/json.ts`
- `src/electron/preload/api/filesystem.ts`

The final rewritten implementation is recorded in
[`a2ed8d5b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/a2ed8d5b04cd8b8f9975e4cdbc540c20e054615d),
followed by the core-policy correction in
[`eeae6df8`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/eeae6df8d34b7602e4e5e546aca1e75b3037fb94).

The first Stage 7 port followed upstream's Store-only lookup. Runtime testing
then proved that a matching filename is not enough: the Store's
`JumpToTop.plugin.js` is a different addon from this fork's installed
`JumpToTop.plugin.js`. Stage 7B replaces that filename-only decision with one
shared plugin/theme coordinator while continuing to use the Stage 6 catalogue
for eligible Store candidates.

Source and identity rules:

- Inspect an installed addon's declared `@updateUrl` and its same-type,
  same-filename Store row independently. A matching filename is only a lookup
  key; identity is decided before any version comparison.
- A candidate is identity-approved when its repository, Discord `authorId`, or
  normalized author name matches the installed addon. A confirmed Store
  repository mismatch is rejected unless an independent author match proves
  the identity. A Store row with no positive identity evidence remains
  ineligible.
- A declared URL with no repository or author evidence may use the narrow
  fallback of a fully validated matching addon name. This fallback is not
  granted to Store rows because the installed addon explicitly chose the URL.
- The installed JumpToTop source identifies
  `github.com/XxUnkn0wnxX/BDPlugins`; the Store row identifies
  `github.com/snappycreeper/BetterDiscordPlugins`. Their repository and author
  identities do not match, so the Store row is rejected regardless of which
  version number is larger.
- Compare strict SemVer first, then loose dotted numeric versions. Opaque
  versions are never ordered lexically. Only identity-approved candidates that
  are newer than the installed version are offered; the highest comparable
  version wins, and equal candidates prefer the addon's declared update URL.

URL normalization and source validation:

- Convert supported web/file forms into raw sources for GitHub and Gists;
  GitLab and snippets; Gitea/Forgejo hosts including Codeberg, Gitea.com, and
  `git.slowb.ro`; Bitbucket Cloud, Server, and snippets; Azure DevOps;
  SourceHut; Pastebin, dpaste, Pastes.io, and maintained Hastebin-compatible
  hosts. An already-direct generic HTTPS source remains usable.
- Gists and snippets resolve through bounded provider metadata calls and must
  select the exact installed filename, or the only plugin/theme file when no
  filename is available. Descriptor calls are serialized and bounded in size
  and pagination rather than guessing among multiple files.
- Require HTTPS, reject embedded credentials, remove fragments, follow at most
  five redirects, and reject a downgrade or unsafe redirect. Known
  PrivateBin/ZeroBin pages are rejected because their client-side encrypted
  payload is not a raw addon file.
- Limit addon source bodies to 16 MiB at the native transport boundary and
  request identity encoding. The unusual size is allowed up to that hard
  safety ceiling; exceeding it fails the update and leaves the installed copy
  unchanged.
- Require fatal UTF-8 decoding and reject HTML/login responses, binary/control
  bytes, and Git LFS pointer files. The filename/type must be a plugin or theme,
  the first JSDoc metadata block must begin on the first line, its name must
  match the installed addon, and its version must be comparable. Identity and
  version are checked again on the downloaded body before installation.
- Reuse exact validated bytes through a 128 MiB aggregate in-memory LRU and
  persist only their hash and bounded metadata. If the body was evicted or the
  client restarted, installation safely refetches and revalidates it instead of
  trusting metadata alone. Materialization releases the shared-cache entry once
  the attempt owns the checked bytes, including descriptor-resolved raw URLs.
- Installation writes the checked bytes to a temporary file, rereads the
  installed source and modification time immediately before replacement, and
  atomically renames only when both still match the renderer snapshot. A failed
  fetch, validation, stale-file check, temporary write, or rename cannot
  truncate the working copy. The public renderer `fs` shim remains unchanged.
  The initial snapshot comes from a private asynchronous preload method because
  PluginManager and ThemeManager deliberately discard `fileContent` after an
  enabled addon initializes; loaded addons must not become impossible to update.

Freshness, scheduling, and request control:

- Store per-channel updater state in `${channelPath}/addon-updater.json`.
  Freshness is per plugin/theme and per URL fingerprint, not one global "last
  checked" value. The file may contain content hashes, bounded validated
  metadata, ETags, `Last-Modified`, and provider-origin backoff state, but never
  a raw update URL or sensitive query string.
- Persist an opaque resolved-URL fingerprint so fresh validated pending updates
  can be reconstructed after restart without an immediate network burst. Raw
  URLs and bodies are never written to this state; descriptor pages such as
  gists/snippets are safely resolved again when their restored update is
  installed.
- Treat the current plugin/theme manager lists as the persisted-state inventory,
  including both enabled and disabled addons. Startup, manual/scheduled checks,
  and unloads prune addon freshness plus orphaned URL metadata for files no
  longer present; deleted addons do not remain as historical entries.
- Apply the same manager-list inventory rule to `plugins.json` and
  `themes.json`: enabled, disabled, and partial/compile-failed addons retain
  their state key while present, but a genuinely missing file loses its key.
  If an addon-looking file still exists but is temporarily missing valid
  metadata during an editor write, defer unknown-ID pruning and retain its
  previous key; fixing that same file lets the watcher read and restart it
  again. Atomic updater renames are treated as reloads and preserve the enabled
  state while the replacement is synchronously re-read. Each write
  serializes numeric-leading IDs first in natural numeric order, then A-Z
  case-insensitively, with punctuation/other names last. Canonical object
  serialization emits each addon ID once; if hand-edited JSON repeats a key,
  the last parsed value is retained and the next startup/write removes the
  duplicate text.
- This pruning does not add a live watcher for external edits to
  `plugins.json`/`themes.json`. BetterDiscord continues to read those files at
  startup and write them immediately for normal UI/API toggles; hand edits take
  effect on the next client start.
- Send `If-None-Match`/`If-Modified-Since` when validators exist and reuse the
  cached validated metadata on `304`. Downloaded bodies remain memory-only and
  a body needed after eviction/restart receives one unconditional refetch.
- Keep the existing 2–12 hour **Update Check Interval** setting and four-hour
  default. Startup and scheduled passes check only stale addons; a one-shot
  timer follows the earliest per-addon due time so a recent addon does not hide
  an older one.
- The manual refresh checks plugins and themes through the same coordinator,
  forces the first pass immediately, joins any active per-addon check, and
  refuses repeated manual bursts for 60 seconds. It performs at most one needed
  catalogue refresh rather than one request per manager. Concurrent manual
  callers share the same owner, so the joined caller cannot duplicate the one
  allowed core metadata check.
- A real plugin/theme file-read event receives one forced recheck after a
  750-millisecond debounce so a local downgrade or metadata change is noticed.
  Passive Settings/Store renders only read updater state and do not start
  network traffic.
- Raw-source requests allow at most three globally and two for each queued HTTPS
  request origin; redirect hops remain inside the global three-request bound.
  Descriptor/API discovery is serialized. **Update All** installs sequentially,
  one active batch owns each addon attempt, and joined actions cannot duplicate
  a write or failure card.
- An offline pass makes no source requests, logs that it is deferred, and
  resumes stale checks after the browser reports reconnection. A connection
  lost during raw-source requests arms the same recovery for only unfinished
  targets without shortening a longer provider reset. Transient network/server
  failures retry later instead of spinning.
- Provider `429` responses, and `403` responses carrying real rate-limit
  evidence, pause the initial and final redirect origins. Ordinary access-denied
  `403` responses are treated as settled source failures rather than throttles.
  Backoff prefers `Retry-After`, then `X-RateLimit-Reset`, then
  `RateLimit-Reset`; otherwise it uses 1, 5, 15, then 60 minutes with small
  jitter. Rate-limit pauses and resumptions are console-only warnings/info, not
  user toasts.
- Addons with neither a declared update URL nor a matching Store row are silent.
  A declared source returning `404`/`410` receives a silent 30-minute
  negative cache. Invalid permanent sources wait for the normal interval;
  missing metadata is not printed as an error for every addon.

Completion and notification rules:

- Recheck the installed addon's object, version, update URL, modification time,
  and source snapshot before handing off replacement, then compare the source
  and modification time again in preload immediately before the atomic rename.
  If it changed while the request was in flight, cancel the stale update, keep
  the installed file, log the reason, and queue a fresh debounced check.
- Remove a pending row and show success only after validation and atomic disk
  replacement settle. Failed rows stop spinning, remain retryable, and always
  log a clear warning/error for the affected plugin or theme.
- The **Show Addon Update Notifications** setting defaults on. It controls
  success toasts plus non-expiring single/batch failure cards; console logging
  remains active when it is off. A batch produces one persistent summary with
  a **View** action listing every failed addon, while the console records each
  failure. Provider rate-limit messages never create failure cards.
- The existing persistent "updates available" notice is a separate navigation
  notice and is not controlled by the success/failure notification switch.

The core-ASAR downloader retains the fork's finite 30-second timeout as dormant
code. Stage 7B does not enable BetterDiscord core requests at startup, on the
scheduler, or from the Updates-panel refresh; that literal button checks only
plugins and themes.

### Core updater policy

Primary files: `src/betterdiscord/modules/updater.ts` and
`src/betterdiscord/ui/updater.tsx`.

- [`ca9b45c3`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/ca9b45c3f39ecef562a0a7f5debcd967539cb920) first suppressed automatic checks on fork/develop builds.
- [`bf396278`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/bf39627879589c9f4e8aca291d27d7a16404b481) retained plugin/theme automatic checks while making core checks manual-only.
- [`8bd22d5b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8bd22d5ba36e36303ec6671985de3062d4551122) later disabled startup, scheduled, and manual core checks while plugin/theme checks stayed active.
- The initial Stage 7B checkpoint briefly restored the explicit Updates-panel
  core check. Runtime testing exposed upstream's broad `branch !== "main"`
  Canary classification: the staging branch was treated as Canary and the
  official stable `1.13.14` release was offered over the fork's identical
  `1.13.14` version because upstream intentionally bypassed comparison while
  switching channels. The post-checkpoint hotfix restores the fork policy by
  commenting that manual call out again; the rewritten hotfix is
  [`eeae6df8`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/eeae6df8d34b7602e4e5e546aca1e75b3037fb94).

Keep the startup, scheduler, and Updates-panel core-check calls commented with
their explanation so future merges do not accidentally reactivate them. The
core updater implementation remains available for future fork-updater work,
but no current UI or lifecycle entry point invokes it. The old
`shouldSkipAutoCheck()` helper remains unnecessary because there is no active
core path to branch-gate.

### Runtime compatibility hardening

These are secondary review surfaces, not reasons to reject unrelated upstream
work:

- `src/electron/preload/early/index.ts`
- `src/common/findFunctionBodyStart.ts`
- `src/betterdiscord/utils/object.ts`
- `src/betterdiscord/webpack/shared.ts`
- `src/betterdiscord/builtins/general/themeattributes.tsx`
- `src/betterdiscord/modules/discordmodules.ts`
- `src/betterdiscord/webpack/lazy.ts`

- [`39f8d65b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/39f8d65b7708732fe05209aa10a4a967d373ace0) and [`ecce03cd`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/ecce03cd6492b9cddaf97617b1e26ff97e7785a1): preload/early-webpack startup parsing and guarded module access.
- [`71bb99b3`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/71bb99b368ba62ea1c0f352cb163662e20f031f7): DOM, theme-attribute, object-access, and updater-noise hardening.
- [`8760e8d7`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8760e8d73b89d0dd64f03419cab7ad31ce77f98b) and [`939b755f`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/939b755fb6b281dd651e9f792329e8c1988e30ba): wrapped message exports and restricted React-tree walking.
- [`9dae9f4b`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/9dae9f4bd7f4879f88f698377395dfd299185026): removal of the stale `DiscordMarkdown` lookup.
- [`d81d4114`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/d81d41146d83d5b31231d1b0aaee81e58c161c36): fork build metadata in copied debug information.

Stage 5 adopts upstream
[`8e3078b4`](https://github.com/BetterDiscord/BetterDiscord/commit/8e3078b4e4f3e2fcf5b0b4644bd86c5e15e71333)
`BdApi.Utils.loadEntry` behavior. Its private content cache uses the native
`Map.prototype.getOrInsertComputed` when that method exists and an equivalent
local insert-if-absent path otherwise. The fallback must retain an existing
`undefined`, cache the exact fulfilled or rejected Promise, and leave the key
absent when the computation throws synchronously. It must never modify the
global Map prototype. This keeps the public API identical for plugins while
supporting the Electron 35/37 renderers used by the fork's currently audited
Discord Stable `0.0.350`-`0.0.402` band.

Plugin-author reminder: this API is opt-in. BetterDiscord does not discover or
load lazy entries for plugins in the background. A plugin supplies a Discord
lazy-loader function or source string when it needs that entry; the helper
checks the referenced chunk, skips worker chunks, loads normal chunks, and
returns the entry exports. Callers should handle `null`, an empty array, and
rejection paths because the source shape and Discord runtime are external.

If upstream now provides equivalent behavior, use upstream. If it touches the
same failure path without equivalent protection, adapt it around the guard.

### Repository-owned files

Keep these fork-owned unless explicitly reviewed:

- `.github/workflows/ci.yml`
- `.github/workflows/crowdin.yml`
- `.github/workflows/publish-types.yml.disabled`
- `.gitignore`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `LICENSE.md` and its packaging references in `scripts/types.ts`,
  `types/package.json`, and `types/README.md`
- `README.md`
- `docs/manual-install.md`
- local Zsh wrappers

The root README is the macOS fork landing page. Its fork CI, license,
repository, and issue links must point to `XxUnkn0wnxX/BetterDiscord`. The
Website, Docs, Discord, and Translate shields are retained as clearly labelled
upstream community resources, but upstream installer/download badges and
instructions are deliberately omitted from the supported local workflow.

`LICENSE.md` is the same Apache License 2.0 legal text previously stored in
`LICENSE`, with Markdown headings added for rendering. The generated type
package also publishes `LICENSE.md`, and its repository/support metadata points
to this fork.

The Bun 1.1.20/Darwin 20 test compatibility path currently lives in
`tests/setup.ts` and `tests/common/i18n.test.ts`. The type-package generator
also invokes the repo-local TypeScript binary explicitly because that Bun
version does not add `node_modules/.bin` to `Bun.$`'s command path. Root package
metadata declares Bun 1.1.20 as the supported minimum instead of incorrectly
requiring 1.2. The root `packageManager` field pins the repository toolchain to
Bun 1.1.20, and CI reads that field instead of floating on the latest release.
Repository-identity tests keep canonical expected values explicit so the
lockfile's TypeScript 5.7.3 and Bun matcher types do not infer an optional
expected argument. The original test compatibility work is recorded in
[`26d9406e`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/26d9406e5dbd3955dacf7b779467a5e5e947fcd1).

## Required checks after an overlapping upstream change

- Injection/OpenAsar: run injection, resource-discovery, recovery, and handoff tests; then ask before live injection changes.
- Plugin loading: verify disabled plugins stay inert, enablement runs `load()` once, and no library filename bypass exists.
- Settings: verify placement, search/navigation, the version row, debug-copy, and tooltip behavior.
- `BdApi.Utils.loadEntry`: compare the public result/call/error behavior with
  upstream and run the cache suite through both the native helper and legacy
  fallback paths. Spot-check an injected pinned client when runtime exports are
  relevant.
- `BdApi.UI` dependencies: verify top-level and nested-category `enableWith` and
  `disableWith` states update immediately and each plugin callback runs once.
- Custom CSS: verify enabled/disabled startup, disable/re-enable, all open actions, file watching, saving, and detached close behavior.
- Addon Store install completion: verify successful downloads close the modal with automatic enable both off and on, and leave the requested enabled state intact.
- System editor: verify a successful `openPath()` closes the BetterDiscord
  editor and a failed launch leaves it open.
- Updater: verify no BetterDiscord core request occurs at startup, on the scheduler, or from the explicit Updates-panel refresh; plugin/theme automatic/manual checks must still work with the Addon Store UI both enabled and disabled.
- Workflows/docs/wrappers: compare them byte-for-byte with fork `develop` unless that stage explicitly changes them.
