# Optional addon update tokens

BetterDiscord can use optional GitHub, GitLab.com, or git.slowb.ro access tokens for
plugin and theme update requests. Leave a field empty to disable BetterDiscord's
token fallback for that provider. GitHub fine-grained and classic personal access tokens use the
same **GitHub Token** field.

GitHub normally allows 60 anonymous REST requests per hour per IP, compared with
5,000 authenticated requests per hour per user. Tokens for the same user share
that allowance, and secondary limits still apply. See
[GitHub's rate-limit documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## Choose a token

| Provider | Recommended token | Access for public addon updates |
| --- | --- | --- |
| GitHub | Fine-grained personal access token | Automatic public repository read access; no additional permissions needed |
| GitHub alternative | Personal access token (classic) | Leave all scopes unchecked |
| GitLab.com | Personal access token with `read_api` | Read-only API access |
| GitLab.com alternative | Fine-grained personal access token | User / Read for validation, plus the relevant project read permissions below |
| git.slowb.ro | Forgejo personal access token | Public only, `read:user` and `read:repository` |

> [!WARNING]
> **Keep token permissions minimal.** Prefer a dedicated BetterDiscord token
> with only the permissions listed above. Extra read scopes can expose more
> data; write or administrative scopes can allow changes or deletion if the
> token is exposed. Addon updates do not need these extra permissions, so avoid
> adding them just for BetterDiscord.

The listed permissions are minimum requirements, not an exclusive allowlist.
An existing token with additional permissions is accepted when the required
read checks succeed, including tokens used for other applications. BetterDiscord's
validation and addon update requests remain read-only.

Public GitHub releases can be read without additional repository permissions.
These update requests do not need write, administration, or pull-request
permissions. See the
[public release endpoint](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name).

## Create a GitHub fine-grained token

1. Open [GitHub's fine-grained token creation page](https://github.com/settings/personal-access-tokens/new).
2. Enter a name such as **BetterDiscord addon updates** and choose an expiration.
3. Select your personal account as **Resource owner**.
4. Under **Repository access**, keep public-only access. Every fine-grained token already includes public repository read access.
5. Leave additional permissions unselected, then select **Generate token**.
6. Copy the token into BetterDiscord as described below.

For GitHub's complete instructions, see
[Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

## Create a GitHub classic token

1. Open [GitHub's classic token creation page](https://github.com/settings/tokens/new).
2. Enter a note such as **BetterDiscord addon updates** and choose an expiration.
3. Leave every scope unchecked, including `repo` and `public_repo`.
4. Select **Generate token**, then copy it into BetterDiscord.

[GitHub documents](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic)
that a classic token without scopes can access public
information. Either GitHub token type works in the same field; do not add a
`Bearer` prefix or quotes.

## Create a GitLab.com legacy token

1. Open [GitLab.com's personal access token settings](https://gitlab.com/-/user_settings/personal_access_tokens).
2. From **Generate token**, choose **Legacy token**.
3. Enter a token name such as **BetterDiscord addon updates** and an expiration date.
4. Select only **`read_api`**. The broader `api` scope is unnecessary; `read_repository` alone does not cover all supported API reads.
5. Select **Generate token** and copy the displayed value into BetterDiscord's **GitLab Token** field.

See GitLab's [token creation instructions](https://docs.gitlab.com/user/profile/personal_access_tokens/#create-a-personal-access-token)
and [scope reference](https://docs.gitlab.com/security/tokens/access_token_scopes/).

## Create a GitLab.com fine-grained token

Both GitLab token types use the same **GitLab Token** field and `PRIVATE-TOKEN`
header. BetterDiscord checks the provider's response rather than requiring a
particular prefix.

1. Open [GitLab.com's personal access token settings](https://gitlab.com/-/user_settings/personal_access_tokens).
2. From **Generate token**, choose **Fine-grained token**.
3. Enter a name and an expiration date.
4. Under **Group and project access**, select access covering the addon projects you use.
5. Under **Add resource permissions**, use the **User** tab to add **User → Read**. BetterDiscord needs this for its `GET /user` validation request.
6. Under **Group and project**, add the read permissions used by your addons:

   | Update source | Permission |
   | --- | --- |
   | Release metadata | Release → Read |
   | Release asset links | Release Link → Read |
   | Repository plugin/theme files | Repository → Read |
   | Snippet metadata | Snippet → Read |

7. Generate the token and paste it into BetterDiscord's **GitLab Token** field.

Choose only the resources your addons need; write permissions are unnecessary.
A successful identity check confirms the token's validity, but not access to
every project. Missing validation permission prevents autosave. See
[GitLab's creation guide](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/)
and [fine-grained API permissions](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens_rest/).

## Create a git.slowb.ro token

1. Sign in and open [Settings → Applications](https://git.slowb.ro/user/settings/applications).
2. Create a new access token named **BetterDiscord addon updates**.
3. Select **Public only** access.
4. Set **user** and **repository** permissions to **Read** (`read:user` and `read:repository`). Other permissions are unnecessary.
5. Generate the token and copy it into BetterDiscord's **git.slowb.ro Token** field.

The user permission allows the credential check; repository permission allows
addon reads. The setup check verifies both. A token restricted to specific
repositories cannot include the user permission needed by this validator.
See [Forgejo's scope reference](https://forgejo.org/docs/v16.0/user/authentication/token-scope/)
and [API authentication guide](https://forgejo.org/docs/v16.0/user/api/usage/).

## Add, replace, or remove a token

1. Open Discord **User Settings → BetterDiscord → Settings**.
2. Expand **Access Tokens**, beside **Addon Manager**.
3. Paste only the token into the matching provider's field.
4. Wait for validation. The native Discord input shows an error outline while
   checking or when validation fails. A successful check saves the token
   automatically; there is no separate Save button.
5. Use the eye button to reveal or hide the full value. Fields start masked.

A replacement stays local to the field until validation succeeds. The previously
saved token remains active during checking or an unsuccessful replacement.
Clearing the field disables that provider's token immediately. Resetting settings
also cancels pending validation. Unsaved drafts are discarded when the control
unmounts, and unfinished validation is cancelled. Invalid drafts never replace
the saved value.

GitHub validation reads [`GET /rate_limit`](https://docs.github.com/en/rest/rate-limit/rate-limit),
which does not consume its primary REST allowance and needs no fine-grained
permissions. GitLab validation reads
[`GET /api/v4/user`](https://docs.gitlab.com/api/users/#retrieve-the-current-user).
git.slowb.ro validation reads `GET /api/v1/user`; setup also checks repository
access with `GET /api/v1/repos/search?limit=1`. These checks use a ten-second
overall deadline and reject redirects.
No account/profile data is saved.

If a provider confirms missing permissions during setup, the token is not saved.
A persistent BetterDiscord warning explains the required access and stays until
you select **Dismiss** or **×**. Create a **new** GitLab or Forgejo token with the
required permissions: rotating or regenerating an existing token preserves its
scopes. A generic server denial or temporary connection/rate-limit problem is
reported separately and does not trigger that missing-permissions warning. See
[GitLab's token troubleshooting](https://docs.gitlab.com/security/tokens/token_troubleshooting/).

This permission check runs when setting or replacing the token. GitLab's account
probe cannot certify every fine-grained project permission; its selected projects
and addon API permissions must also match the sources you use.

Tokens are stored in plaintext with BetterDiscord's channel settings. On macOS:

```text
~/Library/Application Support/BetterDiscord/data/<channel>/settings.json
```

Stable, PTB, and Canary settings are separate. Settings backups include these
values. Masking and the reveal button control their display, rather than the
storage format.

## Requests and debug logs

The request's own credentials take priority, followed by the matching saved BD
token, followed by anonymous access. Empty or scheme-only authorization headers
allow fallback; a nonempty supplied credential is preserved even if it is invalid.
BetterDiscord does not inspect arbitrary plugin setting names.

Coverage includes managed plugin/theme checks and downloads where eligible, plus
recognized release and addon-file API requests through `BdApi.Net.fetch`, such as
SHC's GitHub release check. Managed gist/snippet metadata reads use the same
policy. Each provider's token is selected independently.

Tokens added by this feature are limited to matching HTTPS API reads at
`api.github.com`, `gitlab.com/api/v4`, and the recognized repository API routes at
`git.slowb.ro/api/v1`. On git.slowb.ro, existing addon URLs under
`/<owner>/<repo>/raw/branch/...`, `/raw/tag/...`, and `/raw/commit/...` also accept
the saved token when they name a `.plugin.js` or `.theme.css` file. This covers
the raw update route used by MessageLogger without changing its URL.

Tokens are dropped on redirects to another origin or an unrelated path.
Ordinary API calls, other raw/CDN downloads, other hosts,
self-hosted GitLab, and GitHub Enterprise do not receive the saved token.
Custom Node or browser networking does not inherit BD's token fallback.

With **Developer Settings → Debug Logs** enabled, a dispatched eligible request
produces one masked line in the console and `debug.log`, for example:

```text
[ProviderTokens] GitHub addon update used BetterDiscord token ****a1b2.
```

Recognized addon-supplied tokens are labeled **a supplied token**. The message
reports that a credential was sent, not that authentication succeeded. Only the
last four characters appear; short values are fully masked. Anonymous requests,
validation probes, and requests with debug logging disabled produce no token-use
line. Saved debug output also censors configured tokens and captured request
errors are sanitized.
These are debug-level console messages; enable **Verbose** in DevTools if that
level is filtered out.

## If validation or updates fail

- **Invalid token:** paste the complete value without prefixes or quotes. Replace an expired or revoked token.
- **Could not confirm access:** check the token's API permissions. GitLab's recommended setup uses `read_api`.
- **Temporarily unavailable:** restore connectivity or wait for the provider's limit to reset, then select **Retry**. The draft is not saved meanwhile.
- **Valid token, update still fails:** validation confirms the credential, not every repository's permissions or an addon's source URL. Existing addon credentials can also take priority.
- **Rate-limit pause:** BetterDiscord's managed updater separates authenticated API backoff from anonymous limits. Its normal manual-check cooldowns and genuine authenticated limits still apply. Addon self-updaters retain their own scheduling and retry logic.

If an eligible update request using a saved BetterDiscord token returns **401**,
BetterDiscord reruns the credential validator. Only a confirmed invalid token
that is still the current saved value is cleared. A persistent provider warning
then explains that it was removed and asks you to add a replacement; select
**Dismiss** or **×** to close it. An open field clears and returns to masked
display. Concurrent failures share a check, and a late result cannot erase a
replacement token.

Successful updates do not make an extra validation request. Permission failures,
rate limits and temporary validation failures retain the saved token. Credentials
supplied by an addon remain under that addon's control. The failed update is not
automatically retried with a different token; later eligible requests without
their own credentials use anonymous access once the BD token is cleared.

Clearing a saved token removes BetterDiscord's fallback; requests without their
own credentials then use anonymous access. Tokens affect addon updates; this
fork's disabled BetterDiscord core updater remains disabled.
