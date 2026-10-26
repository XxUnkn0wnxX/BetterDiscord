import {afterEach, describe, expect, test} from "bun:test";
import {captureProviderTokenReporter, configureProviderTokens, getProviderForUpdateRequest, getProviderTokenGeneration, maskProviderToken, normalizeProviderToken, providerAddonFromStack, providerHeadersForHop, providerTokenUseForHop, redactProviderTokens, sanitizeProviderAddonLabel, sanitizeProviderError, selectProviderAuthorization, setProviderTokenUseReporter, type ProviderTokenDiagnostic} from "@common/provider-auth";

const github = "dummy-github-secret-1234";
const gitlab = "dummy-gitlab-secret-5678";
const release = "https://api.github.com/repos/owner/addon/releases/tags/Nightly-Fork";
afterEach(() => {configureProviderTokens({}); setProviderTokenUseReporter();});

describe("private provider authorization policy", () => {
    test("requires explicit managed purpose at selection and native header boundaries", () => {
        const slowbro = "dummy-slowbro-secret-4321";
        configureProviderTokens({github, gitlab, slowbro});
        for (const [provider, url] of [
            ["github", release],
            ["gitlab", "https://gitlab.com/api/v4/projects/1/releases"],
            ["slowbro", "https://git.slowb.ro/api/v1/repos/o/r/releases/latest"]
        ] as const) {
            expect(selectProviderAuthorization(url)).toBeUndefined();
            expect(selectProviderAuthorization(url, {}, "recognized-self-update")).toBeUndefined();
            const managed = selectProviderAuthorization(url, {}, "managed-addon-update")!;
            expect(managed.provider).toBe(provider);
            const callerHeaders = {Accept: "application/json", Authorization: "Bearer "};
            expect(providerHeadersForHop(url, url, {headers: callerHeaders}, {...managed, purpose: "recognized-self-update"})).toEqual(callerHeaders);
            expect(providerHeadersForHop(url, url, {}, {...managed, purpose: undefined} as unknown as typeof managed)).toEqual({});
        }
    });

    test("captures one reporter session and keeps addon labels bounded and secret-free", () => {
        const oldEvents: ProviderTokenDiagnostic[] = [];
        const newEvents: ProviderTokenDiagnostic[] = [];
        setProviderTokenUseReporter(event => oldEvents.push(event));
        const captured = captureProviderTokenReporter()!;
        setProviderTokenUseReporter(event => newEvents.push(event));
        captured({kind: "validation-start", provider: "github", trigger: "setup", maskedToken: "****"});
        expect(oldEvents).toHaveLength(1);
        expect(newEvents).toHaveLength(0);
        setProviderTokenUseReporter(() => {throw new Error("Disposed reporter");});
        expect(() => captureProviderTokenReporter()!({kind: "validation-start", provider: "github", trigger: "setup", maskedToken: "****"})).not.toThrow();
        setProviderTokenUseReporter();
        expect(captureProviderTokenReporter()).toBeUndefined();

        const longCallerToken = `not-configured-${"a".repeat(180)}-1234`;
        const stack = `Error\n at call (betterdiscord://betterdiscord/plugins/Library-${longCallerToken}.plugin.js:2:4)\n at caller (betterdiscord://plugins/Requester.plugin.js:8:1)`;
        expect(providerAddonFromStack(stack, [longCallerToken])).toBe("Library-****1234.plugin.js");
        expect(providerAddonFromStack("Error\n at helper (https://example.test/Other.plugin.js:2:1)")).toBe("unknown addon");
        expect(sanitizeProviderAddonLabel("https://example.test/private?q=secret")).toBe("unknown addon");
        expect(sanitizeProviderAddonLabel("label\n at other()")).toBe("unknown addon");
        expect(sanitizeProviderAddonLabel("x".repeat(200))).toHaveLength(120);
    });

    test("authenticates Slowbro addon raw and API reads without expanding to other Forgejo traffic", () => {
        const slowbro = "dummy-slowbro-secret-4321";
        configureProviderTokens({github, gitlab, slowbro});
        const raw = "https://git.slowb.ro/XxUnkn0wnxX/MessageLoggerV2-Remake/raw/branch/main/MessageLoggerV2.plugin.js";
        for (const url of [raw, raw.replace("/branch/", "/tag/"), raw.replace("/branch/", "/commit/"),
            "https://git.slowb.ro/api/v1/repos/o/r/releases/latest",
            "https://git.slowb.ro/api/v1/repos/o/r/releases/tags/v1",
            "https://git.slowb.ro/api/v1/repos/o/r/releases/1/assets/2",
            "https://git.slowb.ro/api/v1/repos/o/r/raw/Test.theme.css",
            "https://git.slowb.ro/api/v1/repos/o/r/contents/Test.plugin.js"]) {
            const snapshot = selectProviderAuthorization(url, {}, "managed-addon-update")!;
            expect(snapshot.provider).toBe("slowbro");
            const headers = providerHeadersForHop(url, url, {}, snapshot);
            expect(headers).toEqual({Authorization: `token ${slowbro}`});
            expect(providerTokenUseForHop(url, url, {headers}, snapshot.purpose, snapshot)?.event).toEqual({provider: "slowbro", source: "betterdiscord", maskedToken: "****4321"});
        }
        for (const url of [raw.replace("git.slowb.ro", "codeberg.org"), raw.replace("git.slowb.ro", "git.slowb.ro.evil.test"),
            raw.replace("/raw/", "/src/"), raw.replace("MessageLoggerV2.plugin.js", "README.md"),
            "https://git.slowb.ro/api/v1/user", "https://git.slowb.ro/api/v1/repos/o/r/issues",
            raw.replace("https:", "http:"), raw.replace("git.slowb.ro", "git.slowb.ro:444")]) {
            expect(selectProviderAuthorization(url, {}, "managed-addon-update"), url).toBeUndefined();
            expect(providerHeadersForHop(raw, url, {}, selectProviderAuthorization(raw, {}, "managed-addon-update")), url).toEqual({});
        }
        expect(selectProviderAuthorization(raw, {headers: {Authorization: "token caller-secret"}}, "managed-addon-update")).toBeUndefined();
        expect(selectProviderAuthorization(raw, {method: "POST"}, "managed-addon-update")).toBeUndefined();
        expect(selectProviderAuthorization(raw, {rejectUnauthorized: false}, "managed-addon-update")).toBeUndefined();
        expect(selectProviderAuthorization(`${raw}?token=caller`, {}, "managed-addon-update")).toBeUndefined();
        expect(redactProviderTokens(slowbro)).toBe("****4321");
        const generation = getProviderTokenGeneration("slowbro");
        configureProviderTokens({github, gitlab});
        expect(getProviderTokenGeneration("slowbro")).toBe(generation + 1);
        expect(selectProviderAuthorization(raw, {}, "managed-addon-update")).toBeUndefined();
        expect(selectProviderAuthorization(release, {}, "managed-addon-update")?.token).toBe(github);
    });

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

    test("authorizes managed update reads but leaves general provider traffic anonymous", () => {
        configureProviderTokens({github, gitlab});
        const allowed = [
            release, "https://api.github.com/repos/o/r/releases", "https://api.github.com/repos/o/r/releases/latest",
            "https://api.github.com/repos/o/r/releases/42", "https://api.github.com/repos/o/r/releases/42/assets",
            "https://api.github.com/repos/o/r/releases/assets/42", "https://api.github.com/repos/o/r/contents/dir/Addon.plugin.js",
            "https://api.github.com/gists/abc123", "https://gitlab.com/api/v4/snippets/12",
            "https://gitlab.com/api/v4/projects/group%2Frepo/releases", "https://gitlab.com/api/v4/projects/1/releases/permalink/latest",
            "https://gitlab.com/api/v4/projects/1/releases/v1/assets/links/42",
            "https://gitlab.com/api/v4/projects/1/repository/files/dir%2FTheme.theme.css/raw"
        ];
        for (const url of allowed) expect(selectProviderAuthorization(url, {method: "HEAD"}, "managed-addon-update"), url).toBeDefined();
        const denied = [
            "https://api.github.com/user", "https://api.github.com/repos/o/r", "https://api.github.com/repos/o/r/issues",
            "https://api.github.com/search/code", "https://api.github.com/graphql",
            "https://api.github.com/repos/o/r/contents/README.md", "https://raw.githubusercontent.com/o/r/main/A.plugin.js",
            "https://github.com/api/v3/repos/o/r/releases", "https://api.github.com.evil.test/repos/o/r/releases",
            "https://gitlab.com/api/v4/projects/1", "https://selfhost.test/api/v4/projects/1/releases",
            "https://gitlab.com/api/v4/projects/1/repository/files/README.md/raw", "https://api.github.com:444/repos/o/r/releases",
            release.replace("https:", "http:"), release.replace("api.github.com", "user:pass@api.github.com")
        ];
        for (const url of denied) expect(selectProviderAuthorization(url, {}, "managed-addon-update"), url).toBeUndefined();
        expect(selectProviderAuthorization(release, {method: "POST"}, "managed-addon-update")).toBeUndefined();
        expect(selectProviderAuthorization(release, {rejectUnauthorized: false}, "managed-addon-update")).toBeUndefined();
        expect(selectProviderAuthorization("https://api.github.com/gists/abc123", {}, "managed-addon-update")?.provider).toBe("github");
        expect(selectProviderAuthorization("https://gitlab.com/api/v4/projects/a%2Fb/snippets/12", {}, "managed-addon-update")?.provider).toBe("gitlab");
    });

    test("preserves meaningful caller credentials and applies blank fallback without mutation", () => {
        configureProviderTokens({github, gitlab});
        const callerHeaders: Array<Record<string, string>> = [{Authorization: "Bearer caller"}, {authorization: "invalid-but-nonempty"}, {"PRIVATE-TOKEN": "caller"}, {"Job-Token": "caller"}, {"PRIVATE-TOKEN": "token"}, {"JOB-TOKEN": "Basic"}];
        for (const headers of callerHeaders) {
            expect(selectProviderAuthorization(release, {headers}, "managed-addon-update")).toBeUndefined();
            expect(providerHeadersForHop(release, release, {headers}, selectProviderAuthorization(release, {}, "managed-addon-update"))).toEqual(headers);
        }
        for (const key of ["access_token", "PRIVATE-TOKEN", "auth", "api_key"]) {
            expect(selectProviderAuthorization(`${release}?${key}=caller`, {}, "managed-addon-update")).toBeUndefined();
        }
        for (const value of ["", "  ", "Bearer", "token", "Basic"]) {
            const headers = {Authorization: value, Accept: "application/json"};
            const snapshot = selectProviderAuthorization(release, {headers}, "managed-addon-update");
            expect(providerHeadersForHop(release, release, {headers}, snapshot)).toEqual({"Accept": "application/json", "Authorization": `Bearer ${github}`, "User-Agent": "BetterDiscord"});
            expect(headers.Authorization).toBe(value);
        }
        const url = "https://gitlab.com/api/v4/projects/1/releases";
        const headers = {Authorization: "Bearer "};
        expect(providerHeadersForHop(url, url, {headers}, selectProviderAuthorization(url, {headers}, "managed-addon-update"))).toEqual({"PRIVATE-TOKEN": gitlab});
        expect(selectProviderAuthorization(`${release}?token=`, {}, "managed-addon-update")).toBeDefined();
        expect(selectProviderAuthorization(`${release}?access_token=Bearer`, {}, "managed-addon-update")).toBeUndefined();
        const rawBlank = {"PRIVATE-TOKEN": "  ", "JOB-TOKEN": " "};
        expect(providerHeadersForHop(url, url, {headers: rawBlank}, selectProviderAuthorization(url, {headers: rawBlank}, "managed-addon-update"))).toEqual({"PRIVATE-TOKEN": gitlab});
        expect(rawBlank).toEqual({"PRIVATE-TOKEN": "  ", "JOB-TOKEN": " "});
    });

    test("classifies eligible anonymous requests without requiring configured credentials", () => {
        configureProviderTokens({});
        expect(selectProviderAuthorization(release, {}, "managed-addon-update")).toBeUndefined();
        expect(getProviderForUpdateRequest(release)).toBe("github");
        expect(getProviderForUpdateRequest("https://gitlab.com/api/v4/projects/1/releases")).toBe("gitlab");
        expect(getProviderForUpdateRequest("https://api.github.com/gists/abc123")).toBeNull();
        expect(getProviderForUpdateRequest("https://api.github.com/gists/abc123", {}, "managed-addon-update")).toBe("github");
        expect(getProviderForUpdateRequest(release, {headers: {"PRIVATE-TOKEN": "token"}})).toBeNull();
        expect(getProviderForUpdateRequest(release, {method: "POST"})).toBeNull();
    });

    test("adds GitHub's required user agent only when generating its authorization", () => {
        configureProviderTokens({github});
        const snapshot = selectProviderAuthorization(release, {}, "managed-addon-update");
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
        const snapshot = selectProviderAuthorization(release, {}, "managed-addon-update")!;
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
