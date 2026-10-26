import {afterEach, describe, expect, test} from "bun:test";
import {configureProviderTokens, getProviderForUpdateRequest, getProviderTokenGeneration, maskProviderToken, normalizeProviderToken, providerHeadersForHop, providerTokenUseForHop, redactProviderTokens, sanitizeProviderError, selectProviderAuthorization} from "@common/provider-auth";

const github = "dummy-github-secret-1234";
const gitlab = "dummy-gitlab-secret-5678";
const release = "https://api.github.com/repos/owner/addon/releases/tags/Nightly-Fork";
afterEach(() => configureProviderTokens({}));

describe("private provider authorization policy", () => {
    test("normalizes configuration, reports only meaningful changes, and masks short values", () => {
        configureProviderTokens({});
        const before = getProviderTokenGeneration("github");
        expect(configureProviderTokens({github: ` ${github} `}).changedProviders).toEqual(["github"]);
        expect(getProviderTokenGeneration("github")).toBe(before + 1);
        expect(configureProviderTokens({github}).changedProviders).toEqual([]);
        expect(normalizeProviderToken("unsafe\r\nheader")).toBe("");
        expect(normalizeProviderToken("unsafe\u007fheader")).toBe("");
        expect(normalizeProviderToken("nonascii-\u0100")).toBe("");
        expect(normalizeProviderToken("   ")).toBe("");
        expect(maskProviderToken("tiny")).toBe("****");
        expect(maskProviderToken("12345678")).toBe("****");
        expect(maskProviderToken(github)).toBe("****1234");
    });

    test("recognizes update API reads but leaves general provider traffic anonymous", () => {
        configureProviderTokens({github, gitlab});
        const allowed = [
            release, "https://api.github.com/repos/o/r/releases", "https://api.github.com/repos/o/r/releases/latest",
            "https://api.github.com/repos/o/r/releases/42", "https://api.github.com/repos/o/r/releases/42/assets",
            "https://api.github.com/repos/o/r/releases/assets/42", "https://api.github.com/repos/o/r/contents/dir/Addon.plugin.js",
            "https://gitlab.com/api/v4/projects/group%2Frepo/releases", "https://gitlab.com/api/v4/projects/1/releases/permalink/latest",
            "https://gitlab.com/api/v4/projects/1/releases/v1/assets/links/42",
            "https://gitlab.com/api/v4/projects/1/repository/files/dir%2FTheme.theme.css/raw"
        ];
        for (const url of allowed) expect(selectProviderAuthorization(url, {method: "HEAD"}), url).toBeDefined();
        const denied = [
            "https://api.github.com/user", "https://api.github.com/repos/o/r", "https://api.github.com/repos/o/r/issues",
            "https://api.github.com/search/code", "https://api.github.com/graphql", "https://api.github.com/gists/abc123",
            "https://api.github.com/repos/o/r/contents/README.md", "https://raw.githubusercontent.com/o/r/main/A.plugin.js",
            "https://github.com/api/v3/repos/o/r/releases", "https://api.github.com.evil.test/repos/o/r/releases",
            "https://gitlab.com/api/v4/projects/1", "https://gitlab.com/api/v4/snippets/12", "https://selfhost.test/api/v4/projects/1/releases",
            "https://gitlab.com/api/v4/projects/1/repository/files/README.md/raw", "https://api.github.com:444/repos/o/r/releases",
            release.replace("https:", "http:"), release.replace("api.github.com", "user:pass@api.github.com")
        ];
        for (const url of denied) expect(selectProviderAuthorization(url), url).toBeUndefined();
        expect(selectProviderAuthorization(release, {method: "POST"})).toBeUndefined();
        expect(selectProviderAuthorization(release, {rejectUnauthorized: false})).toBeUndefined();
        expect(selectProviderAuthorization("https://api.github.com/gists/abc123", {}, "managed-addon-update")?.provider).toBe("github");
        expect(selectProviderAuthorization("https://gitlab.com/api/v4/projects/a%2Fb/snippets/12", {}, "managed-addon-update")?.provider).toBe("gitlab");
    });

    test("preserves meaningful caller credentials and applies blank fallback without mutation", () => {
        configureProviderTokens({github, gitlab});
        const callerHeaders: Array<Record<string, string>> = [{Authorization: "Bearer caller"}, {authorization: "invalid-but-nonempty"}, {"PRIVATE-TOKEN": "caller"}, {"Job-Token": "caller"}, {"PRIVATE-TOKEN": "token"}, {"JOB-TOKEN": "Basic"}];
        for (const headers of callerHeaders) {
            expect(selectProviderAuthorization(release, {headers})).toBeUndefined();
            expect(providerHeadersForHop(release, release, {headers}, selectProviderAuthorization(release))).toEqual(headers);
        }
        for (const key of ["access_token", "PRIVATE-TOKEN", "auth", "api_key"]) {
            expect(selectProviderAuthorization(`${release}?${key}=caller`)).toBeUndefined();
        }
        for (const value of ["", "  ", "Bearer", "token", "Basic"]) {
            const headers = {Authorization: value, Accept: "application/json"};
            const snapshot = selectProviderAuthorization(release, {headers});
            expect(providerHeadersForHop(release, release, {headers}, snapshot)).toEqual({"Accept": "application/json", "Authorization": `Bearer ${github}`, "User-Agent": "BetterDiscord"});
            expect(headers.Authorization).toBe(value);
        }
        const url = "https://gitlab.com/api/v4/projects/1/releases";
        const headers = {Authorization: "Bearer "};
        expect(providerHeadersForHop(url, url, {headers}, selectProviderAuthorization(url, {headers}))).toEqual({"PRIVATE-TOKEN": gitlab});
        expect(selectProviderAuthorization(`${release}?token=`)).toBeDefined();
        expect(selectProviderAuthorization(`${release}?access_token=Bearer`)).toBeUndefined();
        const rawBlank = {"PRIVATE-TOKEN": "  ", "JOB-TOKEN": " "};
        expect(providerHeadersForHop(url, url, {headers: rawBlank}, selectProviderAuthorization(url, {headers: rawBlank}))).toEqual({"PRIVATE-TOKEN": gitlab});
        expect(rawBlank).toEqual({"PRIVATE-TOKEN": "  ", "JOB-TOKEN": " "});
    });

    test("classifies eligible anonymous requests without requiring configured credentials", () => {
        configureProviderTokens({});
        expect(selectProviderAuthorization(release)).toBeUndefined();
        expect(getProviderForUpdateRequest(release)).toBe("github");
        expect(getProviderForUpdateRequest("https://gitlab.com/api/v4/projects/1/releases")).toBe("gitlab");
        expect(getProviderForUpdateRequest("https://api.github.com/gists/abc123")).toBeNull();
        expect(getProviderForUpdateRequest("https://api.github.com/gists/abc123", {}, "managed-addon-update")).toBe("github");
        expect(getProviderForUpdateRequest(release, {headers: {"PRIVATE-TOKEN": "token"}})).toBeNull();
        expect(getProviderForUpdateRequest(release, {method: "POST"})).toBeNull();
    });

    test("adds GitHub's required user agent only when generating its authorization", () => {
        configureProviderTokens({github});
        const snapshot = selectProviderAuthorization(release);
        const headers = {"user-agent": "Plugin Update Check"};
        expect(providerHeadersForHop(release, release, {headers}, snapshot)).toEqual({...headers, Authorization: `Bearer ${github}`});
        expect(headers).toEqual({"user-agent": "Plugin Update Check"});
        expect(providerHeadersForHop(release, release, {headers: {"user-agent": " "}}, snapshot)).toEqual({"Authorization": `Bearer ${github}`, "User-Agent": "BetterDiscord"});
        expect(providerHeadersForHop(release, "https://api.github.com/user", {}, snapshot)).toEqual({});
        expect(providerHeadersForHop(release, release, {})).toEqual({});
        const callerHeaders = {Authorization: "Bearer caller"};
        expect(providerHeadersForHop(release, release, {headers: callerHeaders}, snapshot)).toEqual(callerHeaders);
    });

    test("reports only recognized actual provider credentials on eligible update hops", () => {
        const usage = (url: string, headers: Record<string, string> = {}) => providerTokenUseForHop(url, url, {headers}, "recognized-self-update");
        expect(usage(release, {Authorization: "token dummy-caller-token-1234"})?.event).toEqual({provider: "github", source: "caller", maskedToken: "****1234"});
        expect(usage(release, {Authorization: "Basic encoded-credential"})).toBeUndefined();
        expect(usage(`${release}?access_token=unsupported-github-query`)).toBeUndefined();
        expect(usage("https://api.github.com/rate_limit", {Authorization: "Bearer dummy-validation-1234"})).toBeUndefined();
        const gitlabUrl = "https://gitlab.com/api/v4/projects/1/releases";
        expect(usage(gitlabUrl, {"PRIVATE-TOKEN": "token"})?.event.maskedToken).toBe("****");
        expect(usage(gitlabUrl, {"JOB-TOKEN": "Basic"})?.event.maskedToken).toBe("****");
        expect(usage(gitlabUrl, {Authorization: "Bearer dummy-caller-token-9876"})?.event.maskedToken).toBe("****9876");
        for (const key of ["access_token", "private_token", "job_token"]) {
            expect(usage(`${gitlabUrl}?${key}=dummy-query-secret-6789`)?.event).toEqual({provider: "gitlab", source: "caller", maskedToken: "****6789"});
        }
        expect(usage(`${gitlabUrl}?access_token=longquery%0A%0D%09x`)?.event.maskedToken).toBe("****");
        expect(usage("https://gitlab.com/api/v4/user", {"PRIVATE-TOKEN": "dummy-validation-6789"})).toBeUndefined();
        expect(providerTokenUseForHop(release, "https://api.github.com/user", {headers: {Authorization: "Bearer dummy-secret-1234"}}, "recognized-self-update")).toBeUndefined();
        expect(providerTokenUseForHop(release, release.replace("https:", "http:"), {headers: {Authorization: "Bearer dummy-secret-1234"}}, "recognized-self-update")).toBeUndefined();
        expect(usage(release.replace("api.github.com", "user:pass@api.github.com"), {Authorization: "Bearer dummy-secret-1234"})).toBeUndefined();
        const gist = "https://api.github.com/gists/abc123";
        expect(providerTokenUseForHop(gist, gist, {headers: {Authorization: "Bearer dummy-secret-1234"}}, "managed-addon-update")?.event.source).toBe("caller");
    });

    test("requires original and current safe endpoints and never forwards generated credentials", () => {
        configureProviderTokens({github});
        const snapshot = selectProviderAuthorization(release)!;
        const headers = {Accept: "application/json"};
        for (const next of [release.replace("api.github.com", "raw.githubusercontent.com"), release.replace("https:", "http:"), "https://api.github.com/user", `${release}?access_token=caller`]) {
            expect(providerHeadersForHop(release, next, {headers}, snapshot)).toEqual(headers);
        }
        expect(providerHeadersForHop("https://api.github.com/user", release, {headers}, snapshot)).toEqual(headers);
        expect(providerHeadersForHop(release, release, {headers, rejectUnauthorized: false}, snapshot)).toEqual(headers);
        expect(providerHeadersForHop(release, release, {headers}, {...snapshot, token: "bad\r\nvalue"})).toEqual(headers);
    });

    test("redacts literal, JSON and URL forms, recent and captured credentials without changing ordinary errors", () => {
        const special = "dummy-secret/with+quote\"-9876";
        configureProviderTokens({github: special, gitlab: "tiny"});
        for (const value of [special, JSON.stringify(special), encodeURIComponent(special), encodeURIComponent(special).replace(/%[A-F\d]{2}/g, part => part.toLowerCase())]) {
            expect(redactProviderTokens(value)).not.toContain("dummy-secret");
            expect(redactProviderTokens(value)).toContain("****9876");
        }
        expect(redactProviderTokens("tiny")).toBe("****");
        configureProviderTokens({github});
        expect(redactProviderTokens(special)).toBe("****9876");
        for (let index = 0; index < 18; index++) configureProviderTokens({github: `rotated-dummy-${index}-abcd`});
        expect(redactProviderTokens(special)).toBe(special);
        const error = Object.assign(new Error(`failed ${special}`), {code: "EFAIL"});
        const safe = sanitizeProviderError(error, [special]);
        expect(safe).not.toBe(error);
        expect(safe.message).toBe("failed ****9876");
        expect(safe.stack).not.toContain(special);
        expect(safe.code).toBe("EFAIL");
        const ordinary = new Error("ordinary transport failure");
        expect(sanitizeProviderError(ordinary)).toBe(ordinary);
        configureProviderTokens({github: "bad-\ud800"});
        expect(redactProviderTokens("bad-\ud800")).toBe("****");
    });
});
