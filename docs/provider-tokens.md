# Optional addon update tokens

BetterDiscord can use an optional GitHub or GitLab.com access token for plugin
and theme update requests. Leave either field empty to disable BetterDiscord's
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

## Create a GitLab.com token

1. Open [GitLab.com's personal access token settings](https://gitlab.com/-/user_settings/personal_access_tokens).
2. From **Generate token**, choose **Legacy token**.
3. Enter a token name such as **BetterDiscord addon updates** and an expiration date.
4. Select only **`read_api`**. The broader `api` scope is unnecessary; `read_repository` alone does not cover all supported API reads.
5. Select **Generate token** and copy the displayed value into BetterDiscord's **GitLab Token** field.

See GitLab's [token creation instructions](https://docs.gitlab.com/user/profile/personal_access_tokens/#create-a-personal-access-token)
and [scope reference](https://docs.gitlab.com/security/tokens/access_token_scopes/).

The field does not enforce a particular token prefix. A GitLab fine-grained token
also needs **User / Read** permission for validation, plus the appropriate project
read permissions for its update endpoints. A successful identity check does not
establish access to every repository or snippet. See
[GitLab's fine-grained API permissions](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens_rest/).

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
also cancels pending validation.

GitHub validation reads [`GET /rate_limit`](https://docs.github.com/en/rest/rate-limit/rate-limit),
which does not consume its primary REST allowance and needs no fine-grained
permissions. GitLab validation reads
[`GET /api/v4/user`](https://docs.gitlab.com/api/users/#retrieve-the-current-user).
Validation requests reject redirects and have a ten-second total deadline.
No account/profile data is saved.

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
policy. GitHub and GitLab tokens are selected independently.

Tokens added by this feature are limited to matching HTTPS API reads at
`api.github.com` and `gitlab.com/api/v4`. They are dropped on redirects to another
origin or an unrelated path. Ordinary API calls, raw/CDN downloads, other hosts,
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

Clearing a saved token removes BetterDiscord's fallback; requests without their
own credentials then use anonymous access. Tokens affect addon updates; this
fork's disabled BetterDiscord core updater remains disabled.
