# Upstream integration checklist: `44e21745`

This checklist covers upstream commit
[`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829)
against fork `develop` at `969320b9`.

The durable inventory of intentional fork behavior is
[docs/fork-specific-changes.md](../docs/fork-specific-changes.md). Read it before
starting any remaining stage.

## Integration rule

The goal is to take as much upstream code as possible.

- If an upstream path does not overlap an intentional fork change, take it exactly as upstream.
- A fork-side textual difference is not automatically a reason to reject upstream.
- If upstream overlaps injection/OpenAsar, plugin loading, settings integration, Custom CSS, or fork updater policy, review that hunk before changing it.
- Apply a small compatible upstream change when it preserves the fork's observable behavior.
- If both implementations cannot be preserved confidently, keep the fork behavior pending and ask before changing it.
- Never adjust injector, recovery, bootstrap, nested-ASAR, or OpenAsar handoff plumbing without presenting the exact change to the user first.
- Keep fork workflows, docs, badges, branch assumptions, and local wrappers unless explicitly reviewed.
- After each stage: run automated checks, let the user perform its runtime checks, tick the results, then create only that local stage commit. Do not push.

## Audit snapshot

- [x] Review branch: `upstream-merge-44e21745`, created from fork `develop` at `969320b9`.
- [x] Exact upstream range: `10fbc6ed..44e21745`; this is one upstream commit.
- [x] Divergence at review: fork has 51 commits and upstream has one commit beyond the merge base.
- [x] Scope: 43 changed paths, 834 additions, and 570 deletions.
- [x] Complete overlap set: six paths.
- [x] Textual conflicts: `scripts/inject.ts`, `builtins/customcss.ts`, `modules/updater.ts`, `ui/settings.tsx`, and `electron/main/migrator.ts`.
- [x] `ui/updater.tsx` auto-merges mechanically but overlaps the fork's updater policy.
- [x] No workflow, documentation, local-wrapper, plugin-manager, recovery, or handoff file changed upstream.
- [x] The commit message repeats application-ASAR, CSP, macOS, and Linux work already present at the merge base.
- [x] The quoted macOS Applications path is unchanged context, not a new `44e21745` fix.
- [x] The only new injector delta is an obsolete `Dicord` to `Discord` error-message correction.
- [x] The only new migrator delta suppresses production logs; the fork intentionally retains those diagnostics.

## All 43 upstream paths accounted for

| Treatment | Paths | Status |
| --- | ---: | --- |
| Stage 1 upstream-exact source files | 10 | Integrated and byte-identical; preview and install-hotfix runtime checks passed |
| Remaining upstream-exact files | 22 | Accept in coordinated stages |
| Upstream files plus narrow defect corrections | 5 | Accept the feature; correct only the identified lines |
| Fork-overlap files requiring manual reconciliation | 4 | Review and port upstream around the fork behavior |
| Protected paths with no useful code to port | 2 | Keep fork versions |

The protected fork behavior relevant to this range is narrow:

- application-ASAR injection and BetterDiscord/OpenAsar recovery/handoff;
- generic plugin loading with no `0BDFDB.plugin.js`, BDFDB, or ZeresPluginLibrary exception;
- BetterDiscord settings section placement, navigation, and version/debug-copy hook;
- the Custom CSS settings-close fallback and working Builtin lifecycle;
- disabled BetterDiscord core update checks while plugin/theme checks stay active;
- fork workflows, docs, metadata, and local wrappers.

## Stage 1: isolated upstream-exact changes

The Stage 1 source files are exact upstream blobs. No protected source file was
changed.

### Stage 1A: small fixes

- [x] Context-menu missing-dot selector: `src/betterdiscord/api/contextmenu.ts`.
- [x] `BdApi.Utils.className` documentation: `src/betterdiscord/api/utils.ts`.
- [x] Duplicate-unpatch guard: `src/betterdiscord/modules/patcher.ts`.
- [x] Changelog modal options copy: `src/betterdiscord/ui/modals.ts`.
- [x] Preload HTTPS `.on()` and type cleanup: `src/electron/preload/api/https.ts`.
- [x] Raw Webpack result ordering: `src/betterdiscord/webpack/searching.ts`.
- [x] Theme-preview URL: `src/betterdiscord/data/web.ts`.
- [x] User: smoke-test a real theme preview URL.

### Stage 1B: floating-window foundation

- [x] Store-backed registry: `src/betterdiscord/ui/floatingwindows.tsx`.
- [x] Store-backed container: `src/betterdiscord/ui/floating/container.tsx`.
- [x] Left-edge width and non-resizable maximize fixes: `src/betterdiscord/ui/floating/window.tsx`.
- [ ] User: verify duplicate IDs do not create duplicate windows.
- [ ] User: verify `open`, `close`, `isOpened`, and `onClose`.
- [ ] User: verify left-edge resizing changes width rather than height.
- [ ] User: verify non-resizable windows have no maximize control.

### Stage 1C: runtime-found Addon Store hotfix

This is a pre-existing fork/upstream bug uncovered during Stage 1 testing, not
one of the 43 paths changed by `44e21745`.

- [x] Reproduce a successful theme download that leaves the install modal locked on its three-dot spinner when **Automatically Enable** is unchecked.
- [x] Confirm the theme file is written and stored as disabled, so the manager emits `theme-read` but not the `theme-loaded` event awaited by the modal.
- [x] Confirm disabled plugin downloads hit the equivalent `plugin-read` versus `plugin-loaded` deadlock in the same shared modal.
- [x] Confirm the modal permanently blocks close requests after installation begins.
- [x] Confirm upstream `44e21745` leaves the install modal and addon-download completion path unchanged.
- [x] Close the modal when the install promise settles on either success or failure.
- [x] User: confirm the shared theme/plugin install modal now closes after a download with **Automatically Enable** unchecked and the UI remains interactive.
- [ ] User: download either addon type with **Automatically Enable** checked; verify the modal closes and the addon is enabled.

### Stage 1 automated gate

- [x] All ten Stage 1 source files are byte-for-byte identical to upstream `44e21745`.
- [x] Protected injector, migrator, recovery, handoff, wrappers, and workflows have no diff from fork `develop`.
- [x] `git -c core.whitespace=cr-at-eol diff --check`.
- [x] `bun ./node_modules/typescript/bin/tsc --noEmit`.
- [x] Add a test-only Bun 1.1.20/Darwin 20 compatibility path without changing newer-Bun coverage.
- [x] `bun test tests/`: 267 passed, 24 incompatible native NumberFormat/currency assertions skipped, 0 failed across 18 files.
- [x] `./local-build.zsh dist`.
- [x] Fresh `dist/betterdiscord.asar`: `996fe4c744cc3c6f386fac2786350b66e896b5663675738de93e12592f81c0e7`.
- [x] Re-run TypeScript and the supported Bun suite after the Stage 1C hotfix: 267 passed, 24 legacy-Intl skips, and 0 failed.
- [x] Re-run `./local-build.zsh dist` after the Stage 1C hotfix.
- [x] Fresh post-hotfix `dist/betterdiscord.asar`: `aa697f7c5751fbf284666d4b40105462c041f1c051351732857c2041924bd896`.
- [x] User confirmed the preview/install runtime behavior and authorized the local Stage 1 commit; carry the remaining floating-window API checks into Stage 2.
- [x] Stage 1 local commit: [`8a64cd76`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/8a64cd76d29b639a7806c23793dfaf3c7e95dbfa).

## Stage 2: settings foundation and `BdApi.UI`

Take these files exactly from upstream:

- [x] `src/betterdiscord/stores/settings.ts`.
- [x] `src/betterdiscord/structs/builtin.ts`.
- [x] `src/betterdiscord/data/settings.ts`, including upstream defaults and dependency metadata.

Take `src/betterdiscord/api/ui.ts` substantially as upstream, with one narrow
correction:

- [x] Port upstream reactive setting dependencies and `openFloatingWindow`.
- [x] Correct category `enableWith` to disable when its controller is false.
- [x] Correct category `disableWith` to disable when its controller is true.
- [x] Leave upstream's already-correct top-level dependency logic unchanged.
- [x] Add an inline fork-review comment explaining the intentional two-line divergence and when to re-review it.
- [ ] Verify plugin setting callbacks still run once and the Stage 1 floating-window registry is used.
- [x] Confirm `src/betterdiscord/modules/pluginmanager.ts` remains unchanged and has no active library filename exception.
- [x] Confirm the three foundation files are byte-for-byte upstream blobs and `api/ui.ts` differs from upstream only at the documented nested-category correction block.
- [x] Confirm all protected injector/OpenAsar, settings-hook, Custom CSS, updater, wrapper, and fork-owned paths still match fork `develop`.
- [x] User-directed fork workflow adjustment: change only the CI recovery-timeout input default and fallback from 40 to 45 seconds.
- [x] `git -c core.whitespace=cr-at-eol diff --check`.
- [x] `bun ./node_modules/typescript/bin/tsc --noEmit`.
- [x] `bun test tests/`: 267 passed, 24 Bun 1.1.20/Darwin 20 native-Intl assertions skipped, and 0 failed across 18 files.
- [x] `zsh local-build.zsh -mrts 45`.
- [x] Fresh 45-second `dist/betterdiscord.asar`: `9e04554d8ba7e20333416d30870a3fa307299be0461fd21853b2ca107ddf5012`.
- [x] Prepare and syntax-check the ignored local helper `tmp/Stage2RuntimeAudit.plugin.js`; do not commit or install it automatically.
- [x] User: injected build loaded and general functionality looked normal.
- [ ] Deferred: verify built-in Addon Store and Custom CSS dependents grey/re-enable without resetting their values.
- [ ] Not currently exercisable: no installed plugin exposes the nested-category dependency pattern.
- [ ] Deferred: verify each tested switch fires one individual callback and one panel callback, with no duplicate of either.
- [ ] Deferred: verify duplicate IDs, `isOpened`, API close, `onClose`, reopening, left-edge resizing, and the non-resizable maximize state.
- [x] User accepted the available runtime result and authorized the local Stage 2 commit.
- [x] Stage 2 local commit: [`9c3117f3`](https://github.com/XxUnkn0wnxX/BetterDiscord/commit/9c3117f3471a19a2f1b3ffd9ca74dc174b33a02d).

## Stage 3: editor bundle with one safety correction

Before Stage 3, all ten branch blobs matched the merge base. No non-merge fork
commit after the merge base introduced behavior in them; historical merge
commits selected upstream content. Stage 3 does not overlap injection/OpenAsar,
settings placement, Custom CSS navigation, updater policy, workflows, or plugin
startup.

### Upstream-exact files

- [x] `assets/locales/en-us.json`.
- [x] `src/betterdiscord/stores/editor.ts`.
- [x] `src/betterdiscord/modules/addonmanager.ts`.
- [x] `src/betterdiscord/ui/misc/addoneditor.tsx`.
- [x] `src/editor/index.html`.
- [x] `src/editor/script.ts`.
- [x] `src/editor/types/global.d.ts`.
- [x] `src/electron/main/modules/editor.ts`.
- [x] `src/electron/preload/api/editor.ts`.

### Upstream plus narrow corrections

- [x] Take the typed bridge/settings changes in `src/editor/preload.ts`.
- [x] Close the BetterDiscord editor after `electron.shell.openPath()` only when its resolved error string is empty; leave it open on failure.
- [x] Add an inline fork-review comment explaining Electron's resolved error string and when the local correction is no longer needed.

### Stage 3 behavior and verification

- [x] Confirm `addonmanager.ts` changes only editor actions and do not alter the fork's `pluginmanager.ts` loading rule.
- [x] User chose upstream's normal floating-editor switch behavior: changing editors may close and discard the prior unsaved buffer.
- [x] Confirm pinning is intentionally one persisted global editor setting: changing one window updates all existing and future editor windows.
- [x] Confirm no Bun 1.1.20-only syntax or runtime risk in the Stage 3 upstream code.
- [x] Confirm all nine exact files are byte-for-byte upstream blobs and `src/editor/preload.ts` differs only at the documented `openPath()` result check.
- [x] Keep direct Electron editor coverage in the runtime gate; the existing suite has no isolated editor-window harness, and adding one would broaden this narrow correction.
- [x] Confirm protected injector/OpenAsar, plugin-loading, settings-hook, Custom CSS, updater, wrapper, and workflow paths still match the Stage 2 commit.
- [x] Add the missing inline preservation comment to the already-tested Stage 1 Addon Store completion hotfix; this is documentation-only and does not alter its behavior.
- [x] Inspect the saved live DOM in `tmp/merge/body1.html`: the primary settings footer anchors (`developer_panel` and `logout_sidebar_item`) are present with BetterDiscord immediately before them, and the primary clickable compact version wrapper is the bound debug-copy anchor. The capture gives no indication that either fallback was needed.
- [x] `git -c core.whitespace=cr-at-eol diff --check`.
- [x] Targeted ESLint on all changed TypeScript and TSX files.
- [x] `bun ./node_modules/typescript/bin/tsc --noEmit`.
- [x] `bun test tests/`: 267 passed, 24 Bun 1.1.20/Darwin 20 native-Intl assertions skipped, and 0 failed across 18 files.
- [x] `zsh local-build.zsh -mrts 45`.
- [x] Fresh `dist/betterdiscord.asar`: `0a8c665960a52ab562a72c65060bb2d7f0e56fbcf77e850ea39d14f14803a662`.
- [x] User confirmed plugin and theme save, normal close behavior, and clean reopening appear correct.
- [x] User confirmed transitions from the floating editor to both the system and external editor appear correct.
- [x] User confirmed duplicate external opens, window reuse, and dirty-close handling appear correct.
- [x] User confirmed pin/unpin behavior and its persisted global state appear correct.
- [x] User confirmed live theme changes and system-editor handling appear correct.
- [x] User authorized the local Stage 3 commit.

## Stage 4: settings and Custom CSS reconciliation

This is a reviewed port, not a fork-file replacement.

### Upstream-exact support files

- [x] Take `src/betterdiscord/styles/builtins/customcss.css` exactly upstream.
- [x] Take the whitespace-only `src/betterdiscord/ui/customcss/mdinstallcss.tsx` change.

### Upstream plus narrow corrections

- [x] Take `src/betterdiscord/ui/customcss/csseditor.tsx` substantially upstream.
- [x] Scope its settings-page layout effect to `isSettingsPage`.
- [x] Remove `bd-custom-css-page-scroller` from the scroller during cleanup, not the panel.
- [x] Take `src/betterdiscord/ui/customcss/editor.tsx` substantially upstream.
- [x] Replace upstream's persistent global `HTMLElement.prototype.focus` patch with an event-scoped patch that unpatches after the current click and on cleanup.

### Fork-overlap files

- [x] Port upstream Custom CSS enabled/clickable predicates and modal-key close helper into `src/betterdiscord/ui/settings.tsx`.
- [x] Take upstream's stricter `openUserSettings` + `USER_SETTINGS_MODAL_KEY` discovery as explicitly approved for Stage 4.
- [x] Preserve `getBetterDiscordSectionIndex()` and the DOM version/debug-copy/tooltip behavior.
- [x] Select the first available, non-throwing close tier: live modal key, reviewed hardcoded modal key, `closeUserSettings`, then `LAYER_POP`.
- [x] Port upstream panel/open-action behavior into `src/betterdiscord/builtins/customcss.ts`.
- [x] Keep the normal `BuiltinModule.initialize()` lifecycle; do not skip initial enablement, CSS insertion, watching, or the enable/disable listener.
- [x] Keep panel registration in `enabled()`, removal in `disabled()`, and the Settings refresh needed for disable/re-enable while Settings is open.
- [x] Keep saving editor text while disabled, but prevent an open editor from re-applying CSS until the main toggle is enabled.
- [x] Close a Settings/floating source editor after `shell.openPath()` only on its empty success result; toast failures and keep the source editor open.
- [x] Document every intentional Stage 4 divergence and its removal condition in `docs/fork-specific-changes.md`, with nearby inline source comments marking each correction.
- [x] Confirm the two upstream-exact support files by blob hash and review every adapted hunk against upstream `44e21745`.
- [x] Confirm protected injection/OpenAsar, plugin loading, updater, workflow, wrapper, and release paths remain untouched.
- [x] `git -c core.whitespace=cr-at-eol diff --check`.
- [x] Targeted ESLint on all five changed TypeScript/TSX source files.
- [x] `bun ./node_modules/typescript/bin/tsc --noEmit`.
- [x] `bun test tests/`: 267 passed, 24 Bun 1.1.20/Darwin 20 native-Intl assertions skipped, and 0 failed across 18 files.
- [x] `zsh local-build.zsh -mrts 45`.
- [x] Fresh `dist/betterdiscord.asar`: `6c814f515d3778b73f2db178e026e19e949518477553a336a20c7884eb50e1ae` (670284 bytes).
- [x] User confirmed the full-page Custom CSS settings editor works and its sidebar entry hides/returns with the main toggle.
- [x] User confirmed detached and external editors open, remain open across toggle changes, and are not automatically reopened; this is the intended window lifecycle.
- [x] User confirmed opening the detached editor closes Discord Settings, covering the strict settings opener and primary live modal-key close path.
- [x] User confirmed the Settings/version integration still works after Stage 4.
- [x] User reported the remaining Stage 4 behavior looks fine in a rough runtime pass.
- Close-helper note: lower tiers are reached only when the preceding API/key is unavailable or throws because `closeModal()` returns no success result.
- [x] User authorized the local Stage 4 commit.

## Stage 5: shared native fetch

Apply this four-file bundle atomically, with one reviewed correction:

- [x] Take `src/betterdiscord/api/net.ts` exactly upstream as the thin public wrapper.
- [x] Add `src/betterdiscord/modules/net.ts` exactly upstream as the shared internal transport.
- [x] Take `src/common/native-fetch.ts` exactly upstream with nullable timeout typing.
- [x] Take the eight-second preload default from upstream in `src/electron/preload/api/fetch.ts`.
- [x] Correct relative redirects with `new URL(res.headers.location, uri)` and an inline fork-review comment.
- [x] Document the redirect divergence, removal condition, timeout behavior, and downstream no-timeout review requirement in `docs/fork-specific-changes.md`.
- [x] Confirm the first three files by upstream blob hash and verify the preload file differs only by the documented redirect correction.
- [x] Verify the public wrapper, response hydration, relative/absolute redirects, aborts, `timeout: null`, and per-hop webhook blocking with the local-only Bun 1.1.20 harness.
- [x] Verify the finite native HTTP timeout with the same bundled harness under Node; Bun 1.1.20's `node:http` timeout emulation stalls instead of firing, so only that assertion is skipped in the direct Bun run.
- [x] Confirm protected injection/OpenAsar, plugin loading, Settings, updater-policy, workflow, wrapper, and release paths remain untouched.
- [x] `git -c core.whitespace=cr-at-eol diff --check`.
- [x] Targeted ESLint on all four changed TypeScript source files.
- [x] `bun ./node_modules/typescript/bin/tsc --noEmit`.
- [x] `bun test tests/`: 267 passed, 24 Bun 1.1.20/Darwin 20 native-Intl assertions skipped, and 0 failed across 18 files.
- [x] `zsh local-build.zsh -mrts 45`.
- [x] Fresh `dist/betterdiscord.asar`: `016d2bd548cddef39e3c25dbec4b4b8db0f4b4d825194948ea779ecc378f80d2` (670323 bytes).
- [x] User confirmed the injected client, Addon Store, and network behavior look good in the Stage 5 runtime smoke test.
- [x] User authorized the local Stage 5 commit.

## Stage 6: shared Addon Store catalogue

Take these surrounding files exactly from upstream:

- [x] `src/betterdiscord/modules/core.ts`.
- [x] `src/betterdiscord/ui/misc/storeembed.tsx`.
- [x] `src/betterdiscord/ui/settings/addonstore.tsx`.
- [x] Confirm all three by upstream blob hash.

Take `src/betterdiscord/builtins/store/addonstore.ts` upstream with only two
reviewed corrections:

- [x] Use `exec[0].length` so links inside codeblocks are excluded correctly.
- [x] Cache the resolved link-opener module/key pair so disable/re-enable can reapply the patch.
- [x] Document that both corrections also appear in upstream audit commit `7dc97d1588c1d9dc3f1d133c998feb9071d86e3f`.
- [x] Verify its diff from `44e21745` contains only those corrections and their comments.

Take `src/betterdiscord/modules/addonstore.ts` substantially upstream and fix
only its verified failure paths:

- [x] Keep the upstream Store/native-fetch/shared-catalogue architecture.
- [x] Return one real in-flight promise to both initiating and concurrent consumers.
- [x] Use a 30-second inactivity timeout instead of upstream's unlimited catalogue wait.
- [x] Abort on disconnect or when both catalogue consumers are disabled.
- [x] Ignore stale completion/failure paths so an old request cannot overwrite a newer request.
- [x] Remove reconnect listeners and refresh timers when both consumers are disabled.
- [x] Replace rows before `_useCache()` so fallback/re-enable cannot duplicate cards.
- [x] Normalize cached `known` filenames to `[]` and log invalid cache repair.
- [x] Reject non-success HTTP status and non-array catalogue data.
- [x] While the Addon Store is enabled, keep successful Store refreshes on the configured interval and retry failed Store refreshes after five minutes or 30 seconds for `ECONNRESET`; leave updater-only scheduling to Stage 7's updater path.
- [x] Add subtle debug/info/warn/error logging for every new lifecycle guard and failure path.
- [x] Document the Stage 6 fork divergences and removal conditions in `docs/fork-specific-changes.md`.
- [x] Early targeted ESLint and TypeScript checks.
- [x] Focused request-state harness: 1 passed, 31 assertions, and 0 failed across shared promise, timeout, offline-before-start, disconnect/reconnect, disable/re-enable, stale response, cache replacement, HTTP/schema failure, retry timing, and log levels.
- [x] `git -c core.whitespace=cr-at-eol diff --check`.
- [x] Targeted ESLint on all five Stage 6 source files.
- [x] `bun ./node_modules/typescript/bin/tsc --noEmit`.
- [x] `bun test tests/`: 267 passed, 24 established Bun 1.1.20/Darwin 20 skips, and 0 failed across 18 files.
  An initial parallel run hit the existing five-second macOS recovery timing edge; its isolated rerun and the sequential full-suite rerun passed.
- [x] `zsh local-build.zsh -mrts 45`.
- [x] Fresh `dist/betterdiscord.asar`: `7b04ffe631846657e71fe6a775d780283f8f83a99f05d5a876f7d7bf1bc65e1c` (674855 bytes).
- [x] Confirm protected injection/OpenAsar, plugin loading, Settings placement/version, updater-policy, workflow, wrapper, and release paths remain untouched.
- [x] User: confirm the injected Addon Store catalogue loads normally.
- [x] Treat the hidden `bdAddonStore` disable/re-enable path as focused-harness coverage: its settings category uses `shown: false`, so there is no normal user-facing master off switch.
- [x] Add the user-requested local navigation hotfix: reselecting Plugins or Themes while its Store subview is open returns to that addon's installed page without changing the Settings hook.
- [x] Verify the navigation hotfix against both exact live-DOM sidebar IDs, targeted lint, TypeScript, the 31-assertion Stage 6 harness, and the supported suite: 267 passed, 24 established skips, and 0 failed.
- [x] Rebuild with `zsh local-build.zsh -mrts 45`; post-hotfix `dist/betterdiscord.asar`: `a3a3d7554b578cebd324b5211d46ded65b775204f830cdbf3889eb4fe4ea0157` (675160 bytes).
- [x] User confirmed reselecting Plugins and Themes exits their respective Store subviews; the larger installed-plugin list takes slightly longer to render than Themes but completes correctly.
- [x] Accept the Stage 6 runtime smoke: the Store catalogue loads and both addon sections return correctly; keep disconnect/reconnect as optional future fault-path coverage backed by the focused harness.
- [x] User confirmed the runtime result and authorized the local Stage 6 commit.

## Stage 7: updater conflict reconciliation

Port upstream's shared-catalogue/native-fetch updater design into the two
overlap files rather than keeping their old architecture wholesale.

- [ ] In `src/betterdiscord/modules/updater.ts`, use the Stage 6 Addon Store catalogue.
- [ ] Preserve the fork's commented BetterDiscord core startup and scheduled checks.
- [ ] Preserve plugin/theme startup, scheduled, and manual checks.
- [ ] Keep failed fetch/write handling user-visible and prevent rejected updates from leaving stale pending state.
- [ ] Avoid a renderer-blocking write where the existing asynchronous write is easy to retain.
- [ ] In `src/betterdiscord/ui/updater.tsx`, use Addon Store lookups while keeping the manual BetterDiscord core check commented out.
- [ ] Verify simultaneous plugin/theme checks share one request and both complete.
- [ ] Run Git check, typecheck, supported Bun tests, and `zsh local-build.zsh -mrts 45`.
- [ ] User: verify plugin/theme detection, success/failure downloads, pending state, and manual refresh with no BetterDiscord core request.
- [ ] After user confirmation, create only the local Stage 7 commit.

## Stage 8: protected and full-tree gate

Keep these two upstream paths entirely from the fork for this commit:

- [x] `scripts/inject.ts`: upstream only fixes a typo in code the fork replaced.
- [x] `src/electron/main/migrator.ts`: upstream only suppresses logs that the fork needs for recovery diagnostics.

Before final landing review:

- [ ] Confirm `scripts/inject.ts`, `scripts/helpers/injection.ts`, `scripts/uninject.ts`, and `scripts/build.ts` match fork `develop`.
- [ ] Confirm `src/common/discordResources.ts`, `migrator.ts`, `macosrecovery.ts`, and `macoshandoff.ts` match fork `develop`.
- [ ] Confirm local Zsh wrappers match fork `develop`.
- [ ] Confirm `pluginmanager.ts` still has generic enabled-state loading and no active library filename exception.
- [ ] Confirm fork workflows, `.gitignore`, README, and pre-existing docs remain fork-owned.
- [ ] Run `git -c core.whitespace=cr-at-eol diff --check`.
- [ ] Run `bun ./node_modules/typescript/bin/tsc --noEmit`.
- [ ] Run the full supported Bun suite and the targeted injection/recovery/handoff tests.
- [ ] Run `zsh local-build.zsh -mrts 45` and record the fresh ASAR hash.
- [ ] User: release-inject and verify Settings, editor, Custom CSS, Addon Store, updater, and relevant Stable/PTB/Canary behavior.
- [ ] Confirm the newest BetterDiscord logs have no new scoped errors.
- [ ] Prepare the final merged/adapted/corrected/skipped report.

## Stage 9: upstream ancestry reconciliation

Do this only after every implementation stage, automated gate, and user runtime
gate above is complete:

- [ ] Compare the completed branch against every path and hunk in upstream [`44e21745`](https://github.com/BetterDiscord/BetterDiscord/commit/44e21745d07d8f6672c20e52b889cbfcaf7ee829).
- [ ] Classify every upstream hunk as accepted exactly, adapted with a documented reason, or intentionally retained from the fork.
- [ ] Confirm the final report has no unaccounted upstream code.
- [ ] Ask before changing ancestry or promoting the branch into `develop`.
- [ ] Record `44e21745` as an ancestor with a normal reviewed merge, resolving protected conflicts in favor of the already-audited fork tree.
- [ ] Confirm the ancestry merge is content-neutral against the fully tested pre-merge tree; investigate any tree change before committing it.
- [ ] Re-run the final Git, type, supported Bun, build, and user runtime gates if the ancestry merge changes any content.
- [ ] Leave the fork no longer one commit behind upstream while retaining all documented fork behavior.
