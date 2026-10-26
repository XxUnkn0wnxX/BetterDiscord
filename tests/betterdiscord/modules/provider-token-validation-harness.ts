import {mock} from "bun:test";

type FetchCall = {url: string; init: RequestInit & Record<string, any>;};
const calls: FetchCall[] = [];
let respond: (url: string, init: FetchCall["init"]) => Promise<Response> = async () => new Response("", {status: 500});
const fetchMock = async (url: string, init: FetchCall["init"]) => {
    calls.push({url, init});
    return respond(url, init);
};
mock.module("@modules/net", () => ({fetch: fetchMock}));

const {validateProviderToken} = await import("../../../src/betterdiscord/modules/provider-token-validation");
const assert = (condition: boolean, message: string) => {if (!condition) throw new Error(message);};
const githubQuota = {resources: {core: {limit: 5000, remaining: 0, reset: 123}}};

respond = async () => Response.json(githubQuota);
const classic = "gh-classic-dummy-123456";
const fineGrained = "github_pat_dummy-123456";
const githubClassicResult = await validateProviderToken("github", classic, new AbortController().signal);
const githubFineResult = await validateProviderToken("github", fineGrained, new AbortController().signal);
assert(githubClassicResult.status === "valid" && githubFineResult.status === "valid", "Both opaque GitHub PAT types should use the same validation contract, including zero remaining quota.");
assert(calls[0].url === "https://api.github.com/rate_limit" && calls[1].url === calls[0].url, "GitHub should use the read-only quota endpoint.");
assert(new Headers(calls[0].init.headers).get("authorization") === `Bearer ${classic}`, "GitHub token should use an explicit Bearer header.");
assert(new Headers(calls[1].init.headers).get("authorization") === `Bearer ${fineGrained}`, "Fine-grained token should use the same Bearer header.");
assert(new Headers(calls[0].init.headers).get("user-agent") === "BetterDiscord", "GitHub validation requires an application User-Agent.");

respond = async () => Response.json({id: 123, username: "dummy"});
const gitlabToken = "glpat-dummy-123456";
assert((await validateProviderToken("gitlab", gitlabToken, new AbortController().signal)).status === "valid", "GitLab PAT should validate against the identity endpoint.");
assert(calls[2].url === "https://gitlab.com/api/v4/user", "GitLab should use its identity endpoint.");
assert(new Headers(calls[2].init.headers).get("private-token") === gitlabToken, "GitLab should use PRIVATE-TOKEN.");

const options = calls[2].init;
assert(options.method === "GET" && options.redirect === "error" && options.maxRedirects === 0, "Validation should be GET-only and reject redirects.");
assert(options.httpsOnly === true && options.rejectUnauthorized === true, "Validation should require HTTPS and TLS verification.");
assert(options.maxResponseBytes === 64 * 1024 && options.timeout === 10_000, "Validation should bound response bytes and transport timeout.");
assert(new Headers(options.headers).get("accept-encoding") === "identity", "Validation should request identity encoding.");

assert((await validateProviderToken("gitlab", "opaque-fine-grained-dummy", new AbortController().signal)).status === "valid", "GitLab fine-grained tokens should use the same identity contract without a prefix gate.");
respond = async () => new Response("", {status: 403, headers: {"WWW-Authenticate": "Bearer error=\"insufficient_scope\""}});
const missingGitLab = await validateProviderToken("gitlab", gitlabToken, new AbortController().signal);
assert(missingGitLab.status === "unavailable" && missingGitLab.missingPermission === "user-read", "A documented GitLab scope denial should identify required validation access.");
const validityPermission = await validateProviderToken("gitlab", gitlabToken, new AbortController().signal, "validity");
assert(validityPermission.status === "unavailable" && validityPermission.missingPermission === undefined, "Reactive validity checks must not produce setup permission warnings.");
for (const error of ["insufficient_scope", "insufficient_granular_scope"]) {
    respond = async () => Response.json({error, error_description: "Provider text must not escape into the result"}, {status: 403});
    const missingBodyPermission = await validateProviderToken("gitlab", gitlabToken, new AbortController().signal);
    assert(missingBodyPermission.status === "unavailable" && missingBodyPermission.missingPermission === "user-read", "GitLab's legacy and fine-grained JSON scope denials should produce the fixed setup permission result without requiring a challenge header.");
    assert(!JSON.stringify(missingBodyPermission).includes("Provider text"), "Provider error descriptions must be discarded.");
}

const slowbroToken = "opaque-forgejo-dummy-123456";
respond = async url => Response.json(url.endsWith("/user") ? {id: 42, login: "dummy"} : {ok: true, data: []});
const beforeSlowbro = calls.length;
assert((await validateProviderToken("slowbro", slowbroToken, new AbortController().signal)).status === "valid", "Forgejo setup should verify identity and repository scope.");
assert(calls.length === beforeSlowbro + 2 && calls.at(-1)!.url === "https://git.slowb.ro/api/v1/repos/search?limit=1", "Forgejo setup must use its bounded repository search scope probe.");
assert(new Headers(calls.at(-1)!.init.headers).get("authorization") === `token ${slowbroToken}`, "Forgejo validation must use its PAT scheme.");
const beforeValidity = calls.length;
assert((await validateProviderToken("slowbro", slowbroToken, new AbortController().signal, "validity")).status === "valid", "Forgejo validity should accept its login identity.");
assert(calls.length === beforeValidity + 1, "Reactive validity must not run the setup-only repository probe.");
respond = async url => url.endsWith("/user") ? Response.json({id: 42, login: "dummy"}) : Response.json({message: "token does not have at least one of required scope(s): read:repository"}, {status: 403});
const missingRepository = await validateProviderToken("slowbro", slowbroToken, new AbortController().signal);
assert(missingRepository.status === "unavailable" && missingRepository.missingPermission === "read:repository", "Forgejo's exact scope-denial marker should become a fixed local permission identifier.");
respond = async () => Response.json({message: "token does not have at least one of required scope(s): read:user"}, {status: 403});
const missingUser = await validateProviderToken("slowbro", slowbroToken, new AbortController().signal);
assert(missingUser.status === "unavailable" && missingUser.missingPermission === "read:user", "The identity scope denial must identify read:user rather than repository access.");
respond = async () => Response.json({id: 42, username: "wrong-field"});
assert((await validateProviderToken("slowbro", slowbroToken, new AbortController().signal)).status === "unavailable", "Forgejo must require login rather than GitLab's username field.");
respond = async url => Response.json(url.endsWith("/user") ? {id: 42, login: "dummy"} : {ok: false, data: []});
assert((await validateProviderToken("slowbro", slowbroToken, new AbortController().signal)).status === "unavailable", "A failed repository-search shape must not pass setup.");

respond = async () => new Response("", {status: 401});
assert((await validateProviderToken("github", classic, new AbortController().signal)).status === "invalid", "401 should mean invalid credentials.");
respond = async () => new Response("", {status: 403});
const permission = await validateProviderToken("gitlab", gitlabToken, new AbortController().signal);
assert(permission.status === "unavailable" && permission.reason === "permission", "403 should be a temporary/permission-unavailable result.");
assert(permission.status === "unavailable" && permission.missingPermission === undefined, "Generic 403 must not claim confirmed missing scopes.");
respond = async () => new Response("", {status: 429});
const rateLimit = await validateProviderToken("github", classic, new AbortController().signal);
assert(rateLimit.status === "unavailable" && rateLimit.reason === "rate-limit", "429 should be rate-limit unavailable.");
respond = async () => new Response("not json", {status: 200});
const malformed = await validateProviderToken("github", classic, new AbortController().signal);
assert(malformed.status === "unavailable" && malformed.reason === "response", "Malformed response should remain unavailable.");
respond = async () => new Response("x".repeat(64 * 1024 + 1), {status: 200});
const oversized = await validateProviderToken("github", classic, new AbortController().signal);
assert(oversized.status === "unavailable" && oversized.reason === "response", "Oversized bodies should be discarded as unavailable.");
const beforeInvalid = calls.length;
assert((await validateProviderToken("github", "bad\ntoken", new AbortController().signal)).status === "invalid", "Non-header-safe drafts should be invalid without network.");
assert(calls.length === beforeInvalid, "Invalid local drafts must not reach the provider.");

let timeoutSignal: AbortSignal | undefined;
respond = (_url, init) => {
    timeoutSignal = init.signal ?? undefined;
    return new Promise<Response>(() => {});
};
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let fakeNow = 0;
let nextTimerId = 0;
type ScheduledTimer = {at: number; callback: (...args: any[]) => void; args: any[];};
const timers = new Map<number, ScheduledTimer>();
(globalThis as any).setTimeout = (callback: (...args: any[]) => void, delay = 0, ...args: any[]) => {
    const id = ++nextTimerId;
    timers.set(id, {at: fakeNow + Number(delay), callback, args});
    return id;
};
(globalThis as any).clearTimeout = (id: number) => {timers.delete(id);};
let deadlineResult!: Awaited<ReturnType<typeof validateProviderToken>>;
try {
    const deadlineResultPromise = validateProviderToken("github", classic, new AbortController().signal);
    await Promise.resolve();
    fakeNow = 10_000;
    for (const [id, timer] of timers) {
        if (timer.at > fakeNow) continue;
        timers.delete(id);
        timer.callback(...timer.args);
    }
    deadlineResult = await deadlineResultPromise;
}
finally {
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
}
assert(deadlineResult.status === "unavailable" && deadlineResult.reason === "network", "The total deadline should return a fixed unavailable result.");
assert(timeoutSignal?.aborted === true, "The total deadline should abort the underlying request.");

let callerAbortSignal: AbortSignal | undefined;
respond = (_url, init) => {
    callerAbortSignal = init.signal ?? undefined;
    return new Promise<Response>(() => {});
};
const caller = new AbortController();
const abortResultPromise = validateProviderToken("gitlab", gitlabToken, caller.signal);
await Promise.resolve();
caller.abort();
const abortResult = await abortResultPromise;
assert(abortResult.status === "unavailable" && abortResult.reason === "network", "Caller cancellation should return a fixed unavailable result.");
assert(callerAbortSignal?.aborted === true, "Caller cancellation should abort the underlying request.");
