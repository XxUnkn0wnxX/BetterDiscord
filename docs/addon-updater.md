# Plugin and theme updates

BetterDiscord checks an addon's `@updateUrl` and eligible Addon Store entry for
newer versions. **Checks never install automatically:** choose **Update** or
**Update All** to install.

## Settings

Open **User Settings → BetterDiscord → Settings → Addon Manager**.

| Setting | Default | Controls |
| --- | --- | --- |
| Automatically Check For Updates | On | Startup, scheduled and changed-file checks. Manual checks remain available when off. |
| Update Check Interval | 4 hours | Per-addon freshness, adjustable from 2–12 hours. |
| Show Addon Update Notifications | On | Success toasts and persistent failure cards. |

- **Manual check:** open **BetterDiscord → Updates → Check For Updates**. It requests a fresh pass, subject to provider backoff; repeated clicks share work or observe a 60-second cooldown.
- **Enabled and disabled addons:** both receive checks; updates preserve their existing state.
- **Core updates:** BetterDiscord's own updater stays disabled at startup, on the scheduler and from the manual button.

## Which source wins?

| Available sources | Result |
| --- | --- |
| Declared `@updateUrl` only | Use it if its identity, content and newer version qualify. |
| Eligible Store entry only | Offer its newer version; validate the downloaded file before installation. |
| Both | Choose the highest comparable newer version. Equal versions prefer `@updateUrl`. |
| Neither qualifies | Offer no update. |

**Identity comes before version:**

- Repository, Discord author ID or normalized author-name matches can establish identity. A Store filename alone cannot.
- A repository mismatch needs an independent author match to qualify.
- A declared URL with unknown identity can fall back to a validated matching addon name, provided there is no confirmed repository mismatch. Author-only differences do not block this fallback. Store entries never receive it.
- SemVer and dotted numeric versions can be compared. Uncomparable candidates are rejected instead of guessed.

## Declare an update URL

Start the file with its JSDoc metadata, including the download source:

```js
/**
 * @name Example Plugin
 * @version 1.0.0
 * @updateUrl https://github.com/owner/example/blob/main/Example.plugin.js
 */
```

BetterDiscord reads this file to find its version. **`@source` supplies identity
and project information; it is not a download fallback.**

| Supported source | Accepted forms |
| --- | --- |
| GitHub | Repository blob/raw file URLs and Gists |
| GitLab | Repository `/-/blob/` or `/-/raw/` files, including nested groups; snippets |
| Gitea / Forgejo | Repository `src/` and `raw/` branch, tag or commit files; includes Codeberg, Gitea.com and `git.slowb.ro` |
| Bitbucket | Cloud file/snippet URLs and Server browse/raw files |
| Azure DevOps | Supported repository file/item API URLs with a safe path and revision |
| SourceHut | Repository blob and tree/item file links |
| Paste services | Supported public/raw Pastebin, dpaste, Pastes.io and Hastebin-compatible URLs |
| Other HTTPS hosts | Direct files returning valid plugin/theme source |

- Gists/snippets select the installed filename, or the sole plugin/theme file when no exact match exists.
- Ambiguous file lists, ordinary web/login pages and encrypted PrivateBin/ZeroBin pages are rejected.
- Recognizing a URL does not guarantee that the host permits access or returns valid content.

## Safe installation and storage

- Require HTTPS, safe redirects and valid UTF-8 addon source. Reject embedded URL credentials, HTML, binary data and Git LFS pointers.
- Validate metadata, addon type/name, identity and version before replacement.
- Recheck the installed file and modification time, then replace atomically. A local edit or competing update cancels the stale replacement.
- Keep the installed copy on failure and preserve enabled/disabled state on reload.
- Store hashes, bounded metadata, cache validators and retry state in the channel's `addon-updater.json`. It contains no raw update URLs, tokens or downloaded bodies.
- Keep downloaded bodies only in memory; fetch and validate them again after eviction or restart when needed.

| Limit | Value |
| --- | --- |
| Request timeout / redirects | 15 seconds / 5 HTTPS hops |
| Source file / descriptor JSON | 16 MiB / 2 MiB |
| Raw request concurrency | 3 overall, 2 per origin |
| Descriptor requests | Serialized; at most 5 pages |
| In-memory body cache | 128 MiB |

## Notifications and troubleshooting

The **updates available** notice provides **View** and **Update All**. It is
separate from the success/failure notification setting.

| Situation | Behavior or action |
| --- | --- |
| No update appears | Check source identity, URL and version. Same-filename Store entries may be unrelated. |
| Source rejected | Check HTTPS, addon metadata/type/name and that the response is a source file. |
| Offline | Automatic checks wait for reconnection while enabled. |
| Missing source, 404/410 | Cache the result quietly for 30 minutes. |
| Rate limited | Pause that provider origin until retry is allowed; report the pause in the console. |
| Temporary network/server failure | Back off before retrying. |
| Install succeeds | Remove the pending row and show a toast when notifications are enabled. |
| Install fails | Keep the installed copy; log the reason and show a persistent failure card when enabled. |

## Optional authentication

[GitHub, GitLab.com and git.slowb.ro tokens](provider-tokens.md) can authorize
eligible update requests. Tokens are restricted to supported provider routes.
Plugin self-updaters retain their own checking and installation logic.

## Maintainer references

- [URL forms](../src/betterdiscord/utils/addonupdateurl.ts), [identity/content/version rules](../src/betterdiscord/utils/addonupdate.ts)
- [Coordinator and installation](../src/betterdiscord/modules/addonupdater.ts), [persisted state](../src/betterdiscord/utils/addonupdatestate.ts)
- [URL tests](../tests/betterdiscord/utils/addonupdateurl.test.ts), [updater tests](../tests/betterdiscord/modules/addonupdater.test.ts), [restart tests](../tests/betterdiscord/modules/addonupdater-restart.test.ts)
- [Stage 7B preservation contract](fork-specific-changes.md#identity-aware-plugintheme-updater-stage-7b)
- [Documentation index](README.md)
