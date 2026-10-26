/* eslint-disable no-console */
import {mock} from "bun:test";
import https from "https";
import http from "http";
import {EventEmitter} from "node:events";
import type {DriedRequest} from "@common/native-fetch";
import type {ProviderTokenUse} from "@common/provider-auth";

let loggingEnabled = false;
const unpatchers: Array<() => void> = [];
const writes: string[] = [];
const consoleLines: unknown[][] = [];
const events: ProviderTokenUse[] = [];
let streamsCreated = 0;
const pendingDispatches: Array<() => void> = [];
let holdDispatch = false;
const originalDebug = console.debug;
const originalHttpsRequest = https.request;
const originalHttpRequest = http.request;
console.debug = (...args) => {consoleLines.push(args);};

mock.module("@structs/builtin", () => ({"default": class {
    get<T>(): T {return loggingEnabled as T;}
    after(object: Record<string, (...args: unknown[]) => unknown>, key: string, callback: (object: unknown, args: unknown[]) => void) {
        const original = object[key];
        object[key] = (...args) => {
            const result = original(...args);
            callback(object, args);
            return result;
        };
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
            purpose: request.providerTokenUsage.purpose,
            report: event => {events.push(event); request.providerTokenUsage!.report(event);}
        } : undefined
    })
}}));
https.request = ((_url: string, _options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    const request = Object.assign(new EventEmitter(), {
        destroyed: false,
        destroy(error?: Error) {
            request.destroyed = true;
            if (error) queueMicrotask(() => request.emit("error", error));
            request.emit("close");
        },
        end() {
            const dispatch = () => {
                if (request.destroyed) return;
                request.emit("finish");
                callback(Object.assign(new EventEmitter(), {statusCode: 204, headers: {}, destroy() {}}) as unknown as http.IncomingMessage);
            };
            if (holdDispatch) pendingDispatches.push(dispatch);
            else queueMicrotask(dispatch);
        }
    });
    return request;
}) as typeof https.request;
http.request = https.request;

const {default: DebugLogs} = await import("../../../src/betterdiscord/builtins/developer/debuglogs");
const {default: Net} = await import("../../../src/betterdiscord/api/net");
const {fetchAddonUpdate} = await import("../../../src/betterdiscord/modules/net");
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
const text = () => consoleLines.map(args => DebugLogs.sanitize(...args)).join("\n");
const originalCheckFilesize = DebugLogs.checkFilesize;
try {
    configureProviderTokens({github: longToken, gitlab: shortToken});
    await api.fetch(release);
    assert(!hasProviderTokenUseReporter() && !lineCount(), "Debug-disabled request logged token use.");
    loggingEnabled = true;
    await DebugLogs.enabled();
    assert(hasProviderTokenUseReporter(), "Debug reporter did not register after capture setup.");
    await api.fetch(release);
    assert(lineCount() === 1 && text().includes("GitHub addon update used BetterDiscord token ****3456."), "Generated token did not log one masked console line.");
    assert(writes.some(value => value.includes("GitHub addon update used BetterDiscord token ****3456.")), "Console line was not captured into the actual DebugLogs writer seam.");
    await api.fetch(release, {headers: {Authorization: "token dummy-supplied-token-7890"}});
    assert(lineCount() === 2 && text().includes("GitHub addon update used a supplied token ****7890."), "Caller token did not log safely.");
    await api.fetch(gitlab);
    assert(lineCount() === 3 && text().includes("GitLab addon update used BetterDiscord token ****."), "Short provider token was not fully hidden.");
    await api.fetch(`${gitlab}?access_token=dummy-query-token-2468`);
    assert(lineCount() === 4 && text().includes("GitLab addon update used a supplied token ****2468."), "Supported query token did not log safely.");
    await fetchAddonUpdate("https://api.github.com/gists/abc123", {headers: {Authorization: "Bearer dummy-gist-token-4567"}});
    assert(lineCount() === 5 && text().includes("a supplied token ****4567."), "Managed caller gist lost its independent purpose.");
    assert(events.every(event => Object.keys(event).sort().join(",") === "maskedToken,provider,source" && /^\*{4}(?:.{4})?$/.test(event.maskedToken)), "Usage event exposed an unsafe field/value.");
    assert(!writes.join("").includes(longToken) && !text().includes("dummy-"), "Captured usage output leaked a credential.");

    configureProviderTokens({});
    await api.fetch(release);
    await api.fetch("https://api.github.com/rate_limit", {headers: {Authorization: "Bearer dummy-validation-1234"}});
    await api.fetch("https://gitlab.com/api/v4/user", {headers: {"PRIVATE-TOKEN": "dummy-validation-1234"}});
    await api.fetch(release, {headers: {Authorization: "Basic unsupported"}});
    await api.fetch(`${release}?access_token=unsupported`);
    assert(lineCount() === 5, "Anonymous, validation or unsupported credentials produced an update-use line.");

    configureProviderTokens({github: longToken});
    loggingEnabled = false;
    await api.fetch(release);
    assert(lineCount() === 5, "Reporter did not recheck the actual current debug setting.");
    loggingEnabled = true;
    holdDispatch = true;
    const inflight = api.fetch(release);
    loggingEnabled = false;
    await DebugLogs.disabled();
    pendingDispatches.splice(0).forEach(dispatch => dispatch());
    await inflight;
    holdDispatch = false;
    assert(lineCount() === 5 && !hasProviderTokenUseReporter(), "In-flight request logged after capture was disabled.");

    let finishOldEnable: (() => void) | undefined;
    DebugLogs.checkFilesize = () => new Promise<void>(resolve => {finishOldEnable = resolve;});
    loggingEnabled = true;
    const delayedEnable = DebugLogs.enabled();
    loggingEnabled = false;
    await DebugLogs.disabled();
    finishOldEnable!();
    await delayedEnable;
    assert(!hasProviderTokenUseReporter() && streamsCreated === 1, "Delayed enabled completion resurrected disabled capture.");

    loggingEnabled = true;
    const staleEnable = DebugLogs.enabled();
    loggingEnabled = false;
    await DebugLogs.disabled();
    DebugLogs.checkFilesize = originalCheckFilesize;
    loggingEnabled = true;
    await DebugLogs.enabled();
    finishOldEnable!();
    await staleEnable;
    assert(hasProviderTokenUseReporter() && streamsCreated === 2, "Stale enable completion replaced a newer capture.");
    await api.fetch(release);
    assert(lineCount() === 6 && writes.filter(value => value.includes("GitHub addon update used BetterDiscord token ****3456.")).length === 2, "Re-enabled capture duplicated or lost its report.");
}
finally {
    loggingEnabled = false;
    await DebugLogs.disabled();
    DebugLogs.checkFilesize = originalCheckFilesize;
    https.request = originalHttpsRequest;
    http.request = originalHttpRequest;
    console.debug = originalDebug;
}
