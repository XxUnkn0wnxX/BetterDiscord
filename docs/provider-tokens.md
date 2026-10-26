# Optional addon update tokens

Add a GitHub, GitLab.com or git.slowb.ro token to authorize eligible plugin/theme
update requests. Leave a provider's field empty to disable its token fallback.
See the [updater guide](addon-updater.md) for source selection and installation.

GitHub normally allows **60 anonymous requests/hour per IP**, or **5,000
authenticated requests/hour per user**. Tokens for the same user share that
allowance; secondary limits still apply.
[GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## Choose a token

| Provider | Token | Minimum access for public updates |
| --- | --- | --- |
| GitHub | Fine-grained, recommended | Built-in public repository read access; no extra permissions |
| GitHub | Classic | All scopes unchecked |
| GitLab.com | Legacy personal access token | `read_api` |
| GitLab.com | Fine-grained | User → Read, plus applicable project read permissions below |
| git.slowb.ro | Forgejo personal access token | Public only; `read:user` and `read:repository` |

> [!WARNING]
> **Keep permissions minimal.** Use a dedicated token with only the access listed
> here. Extra read scopes expose more data; write/admin scopes can allow changes
> or deletion if the token leaks. Addon updates do not need them.

Extra permissions do **not** cause rejection: an existing token is accepted when
the required read checks pass. BetterDiscord's validation and update requests
remain read-only.

## GitHub fine-grained token

1. Open [Create a fine-grained token](https://github.com/settings/personal-access-tokens/new).
2. Name it **BetterDiscord addon updates** and choose an expiration.
3. Select your personal account as **Resource owner**.
4. Keep **public-only** repository access and leave extra permissions unselected.
5. Select **Generate token**, then paste it into **GitHub Token** in BetterDiscord.

Public repository reads are included automatically.
[GitHub token guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

## GitHub classic token

1. Open [Create a classic token](https://github.com/settings/tokens/new).
2. Add a note and expiration.
3. Leave **all scopes unchecked**, including `repo` and `public_repo`.
4. Generate the token and paste it into the same **GitHub Token** field.

Unscoped classic tokens can read public information, including public releases.
[Classic token instructions](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic),
[public release permissions](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name).

## GitLab.com legacy token

1. Open [Personal access tokens](https://gitlab.com/-/user_settings/personal_access_tokens).
2. Select **Generate token → Legacy token**.
3. Enter a name and expiration.
4. Select **`read_api`** only. `read_repository` alone does not cover every supported API read.
5. Generate and paste it into **GitLab Token**.

[GitLab token instructions](https://docs.gitlab.com/user/profile/personal_access_tokens/#create-a-personal-access-token),
[scope reference](https://docs.gitlab.com/security/tokens/access_token_scopes/).

## GitLab.com fine-grained token

1. Open [Personal access tokens](https://gitlab.com/-/user_settings/personal_access_tokens).
2. Select **Generate token → Fine-grained token**; enter a name and expiration.
3. Under **Group and project access**, include the addon projects you use.
4. Under **Add resource permissions → User**, add **User → Read** for validation.
5. Under **Group and project**, add the reads your addons need:

   | Source | Permission |
   | --- | --- |
   | Release metadata | Release → Read |
   | Release asset links | Release Link → Read |
   | Repository files | Repository → Read |
   | Snippet metadata | Snippet → Read |

6. Generate and paste it into **GitLab Token**.

Both GitLab types use this field and `PRIVATE-TOKEN` authentication. Validation
checks the provider response, not a required prefix. **The account check cannot
prove access to every selected project.**
[Creation guide](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/),
[API permissions](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens_rest/).

## git.slowb.ro token

1. Open [Settings → Applications](https://git.slowb.ro/user/settings/applications).
2. Create a token named **BetterDiscord addon updates**.
3. Select **Public only**.
4. Give **user** and **repository** **Read** access (`read:user`, `read:repository`).
5. Generate and paste it into **git.slowb.ro Token**.

Setup checks both permissions. Tokens restricted to specific repositories cannot
include the user permission this validator needs.
[Forgejo scopes](https://forgejo.org/docs/v16.0/user/authentication/token-scope/),
[API authentication](https://forgejo.org/docs/v16.0/user/api/usage/).

## Add, replace or remove

1. Open **User Settings → BetterDiscord → Settings → Access Tokens**, beside **Addon Manager**.
2. Paste only the token: no `Bearer` prefix or quotes.
3. Wait for validation. **Yellow** means checking; **red** means invalid or confirmed missing permissions.
4. A successful check saves automatically. Use the eye button to reveal/hide the value.

- **Replacement:** the saved token stays active until the new value passes validation.
- **Invalid/unfinished draft:** never saves; closing the control discards it and cancels pending validation.
- **Empty field:** removes the saved token immediately. Reset also cancels pending validation.
- **Missing permissions:** prevents saving and shows a warning until **Dismiss** or **×**. Create a new GitLab/Forgejo token with the required scopes; rotation/regeneration preserves existing scopes.
- **Temporary failure or unconfirmed denial:** retains the draft for Retry without treating it as confirmed invalid or showing a missing-permission warning.

[GitLab token troubleshooting](https://docs.gitlab.com/security/tokens/token_troubleshooting/).

### What validation checks

| Provider | Probe |
| --- | --- |
| GitHub | [`GET /rate_limit`](https://docs.github.com/en/rest/rate-limit/rate-limit); no extra fine-grained permissions or primary REST allowance consumed |
| GitLab.com | [`GET /api/v4/user`](https://docs.gitlab.com/api/users/#retrieve-the-current-user); confirms account access, not every project's permissions |
| git.slowb.ro | `GET /api/v1/user`; setup also probes `GET /api/v1/repos/search?limit=1` |

Checks share a **10-second deadline**, reject redirects and save no profile data.
Extra permission probes run only when setting/replacing a token.

### Storage

Tokens are **plaintext** in the channel's settings and included in settings
backups. The masked field controls display only. On macOS:

```text
~/Library/Application Support/BetterDiscord/data/<channel>/settings.json
```

Stable, PTB and Canary keep separate settings.

## Which requests use a token?

**Priority:** request-supplied credentials → saved provider token → anonymous.
Empty/scheme-only authorization allows fallback; a supplied nonempty credential
is preserved even when invalid. BD does not inspect arbitrary plugin settings.

| Provider | Eligible HTTPS reads |
| --- | --- |
| GitHub | Recognized release/addon-file routes at `api.github.com`; managed Gist metadata |
| GitLab.com | Recognized release/addon-file routes under `/api/v4`; managed snippet metadata |
| git.slowb.ro | Recognized `/api/v1` repository routes and addon files under `/raw/branch/`, `/raw/tag/` or `/raw/commit/` |

- Covers managed updates and recognized self-update calls through `BdApi.Net.fetch`, including SHC's GitHub release checks and MessageLogger's Slowbro raw file.
- Drops generated authorization on redirects to another origin or unrelated path.
- Does not authorize unrelated API calls, other raw/CDN hosts, self-hosted GitLab or GitHub Enterprise.
- Custom Node/browser networking does not inherit this fallback.

## Debug logs

With **Developer Settings → Debug Logs** enabled, console and `debug.log` record:

| Event | Level | Details |
| --- | --- | --- |
| Validation starts/passes | Info | Provider, setup/reactive trigger and masked token |
| Validation fails | Warning | Fixed invalid, permission or temporary-failure reason |
| Authenticated request completes successfully | Info | Calling addon, main provider hostname, token source and masked suffix |

- Show only the final four token characters; short values are fully masked.
- Successful-use means an HTTP 2xx/304 response completed, not that an addon was installed.
- Attribution uses the managed addon or actual plugin source frame. A calling library identifies the library; unavailable attribution is **unknown addon**.
- No full request URLs, response bodies or raw credentials in these entries.
- Anonymous requests, cache hits and disabled logging produce no token-use entry.
- Cancelled validation results and requests from an earlier debug session remain silent.

## Invalid tokens and failed updates

| Problem | Action |
| --- | --- |
| Invalid token | Paste the complete value; replace expired/revoked credentials. |
| Missing access | Check the required scopes and selected projects; GitLab legacy uses `read_api`. |
| Temporarily unavailable | Restore connectivity or wait for rate-limit reset, then **Retry**. |
| Valid token, update fails | Check repository access, source URL and any addon-supplied credential taking priority. |
| Rate-limit pause | Wait for the provider reset/backoff; normal updater cooldowns still apply. |

If an eligible request using BD's saved token returns **401**:

1. BD rechecks the credential; concurrent failures share one check.
2. A confirmed invalid token is cleared only if it is still the current saved value.
3. The open field clears/remasks, and a persistent warning stays until **Dismiss** or **×**.

Successful requests need no extra probe. Permission, rate-limit and temporary
failures retain the saved token; addon-owned credentials stay under addon
control. The failed request is not automatically retried. Later requests without
their own credential become anonymous after removal.

[Documentation index](README.md) · [Plugin and theme updater](addon-updater.md)
