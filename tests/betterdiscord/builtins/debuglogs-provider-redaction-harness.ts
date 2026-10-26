/* eslint-disable no-console */
import {mock} from "bun:test";
import https from "https";
import http from "http";
import {EventEmitter} from "node:events";
import type {DriedRequest} from "@common/native-fetch";
import type {ProviderTokenDiagnostic} from "@common/provider-auth";

let loggingEnabled = false;
const unpatchers: Array<() => void> = [];
const writes: string[] = [];
const consoleLines: Array<{level: string; args: unknown[]}> = [];
const events: ProviderTokenDiagnostic[] = [];
let streamsCreated = 0;
const pendingCompletions: Array<() => void> = [];
let holdCompletion = false;
let validationStatus = 200;
let malformedValidation = false;
let validationNetworkError = false;
let missingGitLabScope = false;
const originalConsoles = {info: console.info, warn: console.warn, debug: console.debug};
const originalHttpsRequest = https.request;
const originalHttpRequest = http.request;
for (const level of ["info", "warn", "debug"] as const) console[level] = (...args) => {consoleLines.push({level, args});};

mock.module("@structs/builtin", () => ({"default": class {
    get<T>(): T {return loggingEnabled as T;}
    after(object: Record<string, (...args: unknown[]) => unknown>, key: string, callback: (object: unknown, args: unknown[]) => void) {
        const original = object[key];
        object[key] = (...args) => {const result = original(...args); callback(object, args); return result;};
        unpatchers.push(() => {object[key] = original;});
    }
    unpatchAll() {for (const unpatch of unpatchers.splice(0).reverse()) unpatch();}
}}));
mock.module("@stores/config", () => ({"default": {get: () => "stable"}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: () => {}}}));
mock.module("fs", () => ({"default": {
    existsSync: () => false,
    createWriteStream: () => {
        streamsCreated++;
        return {write: (value: string) => writes.push(value), end: (value: string) => writes.push(value)};
    }
}}));

const {nativeFetch} = await import("../../../src/electron/preload/api/fetch");
mock.module("../../../src/betterdiscord/polyfill/remote", () => ({"default": {
    nativeFetch: (request: DriedRequest) => nativeFetch({
        ...request,
        providerTokenUsage: request.providerTokenUsage ? {
            ...request.providerTokenUsage,
            report: event => {events.push(event); request.providerTokenUsage!.report(event);}
        } : undefined
    })
}}));
https.request = ((url: string, _options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    let activeResponse: EventEmitter | undefined;
    const request = Object.assign(new EventEmitter(), {
        destroyed: false,
        destroy(error?: Error) {
            request.destroyed = true;
            if (error) queueMicrotask(() => {request.emit("error", error); activeResponse?.emit("error", error);});
            request.emit("close");
        },
        end() {
queueMicrotask(() => {
            if (request.destroyed) return;
            request.emit("finish");
            const validation = /\/(?:rate_limit|user)$/.test(url);
            if (validation && validationNetworkError) {request.emit("error", new Error("Private provider transport failure")); return;}
            const data = missingGitLabScope ? {error: "insufficient_granular_scope"}
                : url.includes("rate_limit") ? {resources: {core: {limit: 5000, remaining: 10, reset: 123}}} : {id: 12, username: "dummy"};
            const status = validation ? validationStatus : 204;
            const res = Object.assign(new EventEmitter(), {statusCode: status, headers: {}, destroy() {}});
            activeResponse = res;
            callback(res as unknown as http.IncomingMessage);
            const complete = () => {
                if (validation) res.emit("data", Buffer.from(malformedValidation ? "not json" : JSON.stringify(data)));
                res.emit("end");
            };
            if (holdCompletion) pendingCompletions.push(complete);
            else queueMicrotask(complete);
        });
}
    });
    return request;
}) as typeof https.request;
http.request = https.request;

const {default: DebugLogs} = await import("../../../src/betterdiscord/builtins/developer/debuglogs");
const {default: Net} = await import("../../../src/betterdiscord/api/net");
const {fetchAddonUpdate} = await import("../../../src/betterdiscord/modules/net");
const {validateProviderToken} = await import("../../../src/betterdiscord/modules/provider-token-validation");
const {configureProviderTokens, hasProviderTokenUseReporter} = await import("../../../src/common/provider-auth");
const assert = (condition: boolean, message: string) => {if (!condition) throw new Error(message);};
const longToken = "gh-dummy-token-123456";
const shortToken = "tiny";
configureProviderTokens({github: longToken, gitlab: shortToken});

const cases = [
    DebugLogs.sanitize(`literal=${longToken}`),
    DebugLogs.sanitize({"authorization": `Bearer ${longToken}`, "short": shortToken}),
    DebugLogs.sanitize(new Error(`request failed with ${longToken}`)),
    DebugLogs.sanitize(`https://example.test/?access_token=${encodeURIComponent(longToken)}`)
];
assert(cases.every(value => !value.includes(longToken) && !value.includes(shortToken)), "Sanitized debug output leaked a configured token.");
assert(cases[0].includes("****3456"), "Long tokens should retain only the helper's masked suffix.");
assert(cases[1].includes("****"), "Short tokens should be fully masked.");
configureProviderTokens({github: "", gitlab: ""});
assert(!DebugLogs.sanitize(`old=${longToken}`).includes(longToken), "Recently removed token should remain redacted from saved logs.");

const api = new Net();
const release = "https://api.github.com/repos/o/r/releases/latest";
const gitlab = "https://gitlab.com/api/v4/projects/1/releases";
const lineCount = () => consoleLines.length;
const text = () => consoleLines.map(line => DebugLogs.sanitize(...line.args)).join("\n");
const originalCheckFilesize = DebugLogs.checkFilesize;
try {
    configureProviderTokens({github: longToken, gitlab: shortToken});
    await api.fetch(release);
    assert(!hasProviderTokenUseReporter() && !lineCount(), "Debug-disabled request logged token use.");
    loggingEnabled = true;
    await DebugLogs.enabled();
    assert(hasProviderTokenUseReporter(), "Debug reporter did not register after capture setup.");
    await fetchAddonUpdate(release, undefined, "Managed.plugin.js");
    assert(lineCount() === 1 && text().includes("Managed.plugin.js: github.com update request succeeded (HTTP 204) using BetterDiscord token ****3456."), "Completed managed request did not log its truthful caller/host/status and masked token.");
    assert(consoleLines[0].level === "info" && writes.some(value => value.includes("[CONSOLE:INFO]") && value.includes("Managed.plugin.js: github.com")), "Info success did not reach the actual debug writer.");
    await api.fetch(release, {headers: {Authorization: "token dummy-supplied-token-7890"}});
    assert(lineCount() === 2 && text().includes("unknown addon: github.com") && text().includes("a supplied token ****7890."), "Caller credential success did not log safely with an honest unknown caller.");
    await api.fetch(gitlab);
    await api.fetch(`${gitlab}?access_token=dummy-query-token-2468`);
    assert(lineCount() === 4 && text().includes("gitlab.com") && text().includes("BetterDiscord token ****.") && text().includes("a supplied token ****2468."), "Short/query credentials were not masked correctly.");
    const supplied = "dummy-gist-token-4567";
    await fetchAddonUpdate("https://api.github.com/gists/abc123", {headers: {Authorization: `Bearer ${supplied}`}}, `Caller-${supplied}.plugin.js`);
    assert(lineCount() === 5 && text().includes("Caller-****4567.plugin.js"), "Captured caller credentials were not redacted from addon labels.");
    assert(events.every(event => event.kind === "update-success" && Object.keys(event).sort().join(",") === "addon,kind,maskedToken,provider,source,status"), "Native observer exposed unexpected fields.");
    assert(!writes.join("").includes(longToken) && !text().includes("dummy-"), "Captured success output leaked a credential.");

    configureProviderTokens({});
    const anonymousBaseline = lineCount();
    await api.fetch(release);
    await api.fetch("https://api.github.com/rate_limit", {headers: {Authorization: "Bearer dummy-validation-1234"}});
    await api.fetch(release, {headers: {Authorization: "Basic unsupported"}});
    assert(lineCount() === anonymousBaseline, "Anonymous, ordinary validation API or unsupported credentials produced an update success line.");

    configureProviderTokens({github: longToken});
    for (const status of [200, 401, 403, 429, 500]) {
        validationStatus = status;
        const before = lineCount();
        const result = await validateProviderToken("github", longToken, new AbortController().signal);
        assert(lineCount() === before + 2 && consoleLines[before].level === "info", "Each actual validation should emit one start and one settled result.");
        assert(consoleLines[before + 1].level === (result.status === "valid" ? "info" : "warn"), "Validation success/failure level is incorrect.");
        assert(text().includes("token validation started (setup, ****3456)"), "Validation start omitted its trigger or masked suffix.");
    }
    validationStatus = 200;
    malformedValidation = true;
    await validateProviderToken("github", longToken, new AbortController().signal);
    assert(consoleLines.at(-1)?.level === "warn" && text().includes("setup, response, ****3456"), "Malformed validation must produce a fixed Warn reason.");
    malformedValidation = false;
    validationNetworkError = true;
    await validateProviderToken("github", longToken, new AbortController().signal);
    assert(consoleLines.at(-1)?.level === "warn" && text().includes("setup, network, ****3456") && !text().includes("Private provider"), "Network validation failure must report a fixed Warn reason without its error text.");
    validationNetworkError = false;
    validationStatus = 403;
    missingGitLabScope = true;
    await validateProviderToken("gitlab", "unconfigured-fine-grained-1234", new AbortController().signal);
    assert(consoleLines.at(-1)?.level === "warn" && text().includes("setup, missing-permissions, ****1234"), "Confirmed missing permissions must be reported at Warn.");
    missingGitLabScope = false;
    validationStatus = 200;
    const beforeLocal = lineCount();
    await validateProviderToken("github", "bad\ntoken", new AbortController().signal);
    const preaborted = new AbortController(); preaborted.abort();
    await validateProviderToken("github", longToken, preaborted.signal);
    assert(lineCount() === beforeLocal, "Invalid local drafts or pre-aborted validation emitted diagnostics.");

    holdCompletion = true;
    const staleValidation = new AbortController();
    const cancelled = validateProviderToken("github", longToken, staleValidation.signal);
    await Bun.sleep(0);
    const afterStart = lineCount();
    staleValidation.abort();
    await cancelled;
    pendingCompletions.splice(0).forEach(complete => complete());
    assert(lineCount() === afterStart, "Cancelled stale validation emitted a settled result.");
    holdCompletion = false;

    const baseline = lineCount();
    holdCompletion = true;
    await api.fetch(release);
    loggingEnabled = false; await DebugLogs.disabled();
    loggingEnabled = true; await DebugLogs.enabled();
    pendingCompletions.splice(0).forEach(complete => complete());
    assert(lineCount() === baseline, "An old request logged into the re-enabled logging session.");
    loggingEnabled = false; await DebugLogs.disabled();
    await api.fetch(release);
    loggingEnabled = true; await DebugLogs.enabled();
    pendingCompletions.splice(0).forEach(complete => complete());
    assert(lineCount() === baseline, "A request started with logging disabled logged after enable.");
    holdCompletion = false;
    await api.fetch(release);
    assert(lineCount() === baseline + 1, "The current logging session failed to report a completed request.");

    let finishOldEnable: (() => void) | undefined;
    const streamBaseline = streamsCreated;
    DebugLogs.checkFilesize = () => new Promise<void>(resolve => {finishOldEnable = resolve;});
    const delayedEnable = DebugLogs.enabled();
    loggingEnabled = false; await DebugLogs.disabled();
    finishOldEnable!(); await delayedEnable;
    assert(!hasProviderTokenUseReporter() && streamsCreated === streamBaseline, "Delayed enable completion resurrected disabled capture.");
    DebugLogs.checkFilesize = originalCheckFilesize;
    assert(!text().includes("https://") && !writes.join("").includes(longToken), "Diagnostic output exposed a URL or token.");
}
finally {
    loggingEnabled = false;
    await DebugLogs.disabled();
    DebugLogs.checkFilesize = originalCheckFilesize;
    https.request = originalHttpsRequest;
    http.request = originalHttpRequest;
    Object.assign(console, originalConsoles);
}
