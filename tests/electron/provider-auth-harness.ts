import https from "https";
import http from "http";
import {EventEmitter} from "node:events";
import {nativeFetch} from "../../src/electron/preload/api/fetch";
import type {DriedRequest} from "@common/native-fetch";
import {configureProviderTokens, selectProviderAuthorization, type ProviderTokenSuccess} from "@common/provider-auth";

const token = "dummy-native-token-2468";
const origin = "https://api.github.com/repos/o/r/releases";
const calls: Array<{url: string; headers: Record<string, string>;}> = [];
const usageEvents: ProviderTokenSuccess[] = [];
interface Step {location?: string; throwOnRequest?: boolean; error?: boolean; status?: number; headers?: Record<string, string>;}
let steps: Step[] = [];
let response!: EventEmitter;
const originalRequest = https.request;
const originalHttpRequest = http.request;

// Exercise the real native transport and http.request construction without DNS/TLS/network.
https.request = ((url: string, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    calls.push({url, headers: {...options.headers as Record<string, string>}});
    const step = steps.shift() ?? {};
    if (step.throwOnRequest) throw new TypeError(`invalid request ${token}`);
    const request = new EventEmitter() as EventEmitter & {end(): void; destroy(error?: Error): void;};
    Object.assign(request, {destroyed: false});
    request.destroy = (error) => {Object.assign(request, {destroyed: true}); if (error) request.emit("error", error); request.emit("close");};
    request.end = () => queueMicrotask(() => {
        if (step.error) {request.emit("error", new Error(`request error ${token}`)); return;}
        request.emit("finish");
        const res = Object.assign(new EventEmitter(), {
            statusCode: step.location ? 302 : step.status ?? 200,
            statusMessage: "OK",
            headers: step.location ? {location: step.location} : step.headers ?? {},
            destroy() {}
        });
        response = res;
        callback(res as unknown as http.IncomingMessage);
    });
    return request;
}) as typeof https.request;
http.request = https.request;

function driedRequest(): DriedRequest {
    return {
        url: origin,
        headers: {Accept: "application/json"},
        body: null,
        signal: null,
        method: "GET",
        redirect: "follow",
        keepalive: false,
        timeout: 500,
        maxRedirects: 3,
        rejectUnauthorized: true,
        providerAuthorization: selectProviderAuthorization(origin),
        providerTokenUsage: {purpose: "recognized-self-update", addon: "Actual.plugin.js", report: event => usageEvents.push(event)}
    };
}
function check(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
async function rejected(promise: Promise<unknown>) {
    try {await promise;}
    catch (error) {
        check(error instanceof Error, "expected Error");
        check(!error.message.includes(token) && !error.stack?.includes(token), "credential escaped in native error");
        check(error.message.includes("****2468"), "masked suffix missing");
        return;
    }
    throw new Error("expected a rejection");
}

try {
    configureProviderTokens({github: token});
    const first = driedRequest();
    steps = [{location: "/repos/o/r/releases/latest"}, {}];
    const same = await nativeFetch(first);
    check(calls.length === 2 && calls.every(call => call.headers.Authorization === `Bearer ${token}`), "same-origin update redirect lost authentication");
    check(!("Authorization" in first.headers), "caller headers were mutated");
    check(usageEvents.length === 0, "Dispatch or response headers reported success before completion");
    response.emit("end");
    check(Number(usageEvents.length) === 1 && usageEvents[0].source === "betterdiscord" && usageEvents[0].maskedToken === "****2468" && usageEvents[0].addon === "Actual.plugin.js" && usageEvents[0].status === 200, "redirects did not report exactly one completed authenticated request");
    await same.body?.cancel();

    calls.length = 0;
    configureProviderTokens({gitlab: token});
    const gitlabUrl = "https://gitlab.com/api/v4/projects/1/releases";
    steps = [{}];
    const gitlabResult = await nativeFetch({
        ...driedRequest(),
        url: gitlabUrl,
        headers: {Authorization: "Bearer "},
        providerAuthorization: selectProviderAuthorization(gitlabUrl, {headers: {Authorization: "Bearer "}})
    });
    check(calls[0].headers["PRIVATE-TOKEN"] === token && !calls[0].headers.Authorization, "native GitLab fallback retained a competing empty header");
    await gitlabResult.body?.cancel();
    const slowbroUrl = "https://git.slowb.ro/owner/repo/raw/branch/main/Test.plugin.js";
    configureProviderTokens({slowbro: token});
    calls.length = 0;
    usageEvents.length = 0;
    steps = [{}];
    const slowbroResult = await nativeFetch({
        ...driedRequest(), url: slowbroUrl, headers: {}, providerAuthorization: selectProviderAuthorization(slowbroUrl)
    });
    check(calls[0].headers.Authorization === `token ${token}`, "Actual Forgejo raw transport did not send the PAT scheme");
    check(usageEvents.length === 0, "Forgejo headers were mistaken for completion");
    response.emit("end");
    check(Number(usageEvents.length) === 1 && usageEvents[0].provider === "slowbro" && usageEvents[0].source === "betterdiscord", "Actual Forgejo transport did not report its masked completed provider use");
    await slowbroResult.body?.cancel();
    calls.length = 0;
    steps = [{location: "https://codeberg.org/owner/repo/raw/branch/main/Test.plugin.js"}, {}];
    const slowbroRedirect = await nativeFetch({
        ...driedRequest(), url: slowbroUrl, headers: {}, providerAuthorization: selectProviderAuthorization(slowbroUrl)
    });
    check(calls.length === 2 && !calls[1].headers.Authorization, "Slowbro token escaped to another Forgejo host");
    await slowbroRedirect.body?.cancel();
    configureProviderTokens({github: token});

    for (const location of ["https://cdn.example.test/addon.plugin.js", "https://api.github.com/user", "http://api.github.com/repos/o/r/releases/latest"]) {
        calls.length = 0;
        usageEvents.length = 0;
        steps = [{location}, {}];
        const result = await nativeFetch(driedRequest());
        check(calls.length === 2 && !calls[1].headers.Authorization, "credential escaped on redirect");
        response.emit("end");
        check(usageEvents.length === 0, "An eligible intermediate hop was logged as a successful final authenticated request");
        await result.body?.cancel();
    }

    calls.length = 0;
    steps = [{}];
    const withQuery = {...driedRequest(), url: `${origin}?page=2`};
    steps = [{location: "latest"}, {}];
    const relative = await nativeFetch(withQuery);
    check(calls[1].url === "https://api.github.com/repos/o/r/latest?page=2", "existing relative/query forwarding changed");
    check(!calls[1].headers.Authorization, "downstream non-release endpoint received a token");
    await relative.body?.cancel();

    for (const status of [200, 204, 304, 401, 403, 429, 500]) {
        usageEvents.length = 0;
        steps = [{status}];
        const result = await nativeFetch(driedRequest());
        check(usageEvents.length === 0, "Request dispatch/headers logged a successful use");
        response.emit("end");
        response.emit("end");
        check(usageEvents.length === (status >= 200 && status < 300 || status === 304 ? 1 : 0), `Unexpected completed-request diagnostic for HTTP ${status}`);
        await result.body?.cancel();
    }

    for (const failure of ["cancel", "error", "aborted", "size"] as const) {
        usageEvents.length = 0;
        steps = [{}];
        const result = await nativeFetch({...driedRequest(), ...(failure === "size" ? {maxResponseBytes: 1} : {})});
        if (failure === "cancel") {await result.body?.cancel();}
        else {
            const read = result.body!.read();
            if (failure === "size") response.emit("data", Buffer.from("too large"));
            else response.emit(failure, failure === "error" ? new Error("body failed") : undefined);
            await read.catch(() => {});
        }
        response.emit("end");
        check(usageEvents.length === 0, `A ${failure} body produced a success diagnostic`);
    }

    usageEvents.length = 0;
    steps = [{throwOnRequest: true}];
    await rejected(nativeFetch(driedRequest()));
    check(usageEvents.length === 0, "construction failure reported credential use");
    steps = [{location: "/repos/o/r/releases/latest"}, {throwOnRequest: true}];
    await rejected(nativeFetch(driedRequest()));
    steps = [{error: true}];
    usageEvents.length = 0;
    await rejected(nativeFetch(driedRequest()));
    check(usageEvents.length === 0, "pre-finish failure reported credential use");

    steps = [{}];
    await rejected(nativeFetch({
        ...driedRequest(),
        signal: {
            aborted: () => true,
            reason: () => new Error(`pre-send abort ${token}`),
            addListener: listener => {listener(); return () => {};}
        }
    }));
    check(usageEvents.length === 0, "pre-send abort reported credential use");

    steps = [{}];
    const throwingReporter = await nativeFetch({
        ...driedRequest(),
        providerTokenUsage: {
            purpose: "recognized-self-update",
            report() {throw new Error("reporter unavailable");}
        }
    });
    response.emit("end");
    await throwingReporter.body?.cancel();

    steps = [{}];
    const disposedBridge = await nativeFetch({
        ...driedRequest(),
        signal: {
            aborted() {throw new Error("Disposed bridge");},
            reason: () => undefined,
            addListener: () => () => {}
        }
    });
    // A diagnostic-only bridged getter must not throw from the native end listener.
    response.emit("end");
    await disposedBridge.body?.cancel();

    steps = [{}];
    const delayed = await nativeFetch(driedRequest());
    check(delayed.body, "missing response body");
    for (let index = 0; index < 20; index++) configureProviderTokens({github: `replacement-native-token-${index}`});
    const read = delayed.body.read();
    response!.emit("error", new Error(`stream error ${token}`));
    await rejected(read);

    const callerToken = "dummy-native-caller-9087";
    steps = [{}];
    const callerResponse = await nativeFetch({...driedRequest(), headers: {Authorization: `Bearer ${callerToken}`}, providerAuthorization: undefined});
    check(callerResponse.body, "missing caller-auth response body");
    const callerRead = callerResponse.body.read();
    response!.emit("error", new Error(`caller stream error ${callerToken}`));
    try {
        await callerRead;
        throw new Error("expected caller stream rejection");
    }
    catch (error) {
        check(error instanceof Error && error.message === "caller stream error ****9087" && !error.stack?.includes(callerToken), "actual caller credential escaped in stream error");
    }
    process.stdout.write("provider-auth-native: ok\n");
}
finally {
    https.request = originalRequest;
    http.request = originalHttpRequest;
}
