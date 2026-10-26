import {mock} from "bun:test";
import {dryReadableStream, type DriedRequest} from "@common/native-fetch";
import {configureProviderTokens} from "@common/provider-auth";
import {getAddonUpdateContentHash, getAddonUpdateUrlFingerprint} from "@utils/addonupdatestate";

const restart = process.argv[2] === "restart";
const token = "dummy-updater-github-1234";
const gitlabToken = "dummy-updater-gitlab-5678";
let now = 1_800_000_000_000;
Date.now = () => now;
const calls: DriedRequest[] = [];
const failures: string[] = [];
let persisted: any = {version: 1, addons: {}, urls: {}, origins: {}};
const pluginManager = {addonList: [] as any[], addonFolder: "unused"};
const themeManager = {addonList: [] as any[], addonFolder: "unused"};
const handlers = new Map<string,(request: DriedRequest) => Response | Promise<Response>>();
const githubUrl = "https://api.github.com/repos/example/addons/contents/Quota.plugin.js";
const fingerprint = (value: string) => getAddonUpdateContentHash(new TextEncoder().encode(value));
const body = (name: string, url: string, version = "2.0.0") => `/**\n * @name ${name}\n * @author Test Author\n * @version ${version}\n * @updateUrl ${url}\n */\nmodule.exports = {};\n`;
function addon(name: string, url: string) {
    return {name, filename: `${name}.plugin.js`, version: "1.0.0", author: "Test Author", updateUrl: url, fileContent: body(name, url, "1.0.0")};
}
function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}
async function waitFor(predicate: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await Bun.sleep(0);
    }
    throw new Error("Expected request did not start.");
}
function limited() {return new Response("throttled", {status: 429, headers: {"Retry-After": "3600"}});}
const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);
mock.module("@common/logger", () => ({"default": {debug() {}, info() {}, warn() {}, stacktrace: (_module: string, message: string) => failures.push(message)}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@stores/settings", () => ({"default": {get: (_category: string, id: string) => id === "updateInterval" ? 4 : id === "checkForUpdates"}}));
mock.module("@stores/json", () => ({"default": {get: () => persisted, set: (_file: string, value: unknown) => {persisted = structuredClone(value);}}}));
mock.module("@stores/toasts", () => ({"default": {success() {}}}));
mock.module("@stores/notifications", () => ({"default": {show() {}, hide() {}}}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal() {}}}));
mock.module("@ui/settings", () => ({"default": {openSettingsPage() {}}}));
mock.module("@ui/logo", () => ({Logo: () => null}));
mock.module("@polyfill/remote", () => ({"default": {
    filesystem: {readFileSnapshotAsync() {throw new Error("Unexpected file read");}, writeFileAsync() {throw new Error("Unexpected file write");}},
    nativeFetch: async (request: DriedRequest) => {
        calls.push(request);
        const handler = handlers.get(request.url);
        if (!handler) throw new Error("Unexpected transport request");
        const response = await handler(request);
        return {
            body: response.body ? dryReadableStream(response.body) : null,
            url: response.url || request.url,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            redirected: false
        };
    }
}}));
mock.module(modulePath("react.ts"), () => ({"default": {createElement: () => null}}));
mock.module(modulePath("emitter.ts"), () => ({"default": {on() {}, emit() {}}}));
mock.module(modulePath("pluginmanager.ts"), () => ({"default": pluginManager}));
mock.module(modulePath("thememanager.ts"), () => ({"default": themeManager}));
const store = {lastSuccessfulRequestAt: now, getAddons: () => [], updaterRequestAddons: async () => {store.lastSuccessfulRequestAt = now; return true;}};
mock.module(modulePath("addonstore.ts"), () => ({"default": store}));
Object.assign(globalThis, {window: {navigator: {onLine: true}, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {}}});

pluginManager.addonList.push(addon("Quota", githubUrl));
if (restart) {
    configureProviderTokens({github: token});
    persisted.origins["https://api.github.com"] = {
        blockedUntil: now + 100_000,
        failureCount: 2,
        authenticated: {credentialFingerprint: fingerprint(token), blockedUntil: now + 200_000, failureCount: 1}
    };
}
const {AddonUpdateCoordinator, PluginUpdater} = await import("../../../src/betterdiscord/modules/addonupdater");
AddonUpdateCoordinator.initialize();
if (restart) {
    await AddonUpdateCoordinator.checkManually();
    assert(calls.length === 0, "Matching authenticated backoff was discarded on restart.");
    assert(persisted.origins["https://api.github.com"].authenticated.blockedUntil === now + 200_000, "Authenticated reset window changed during restart.");
    assert(persisted.origins["https://api.github.com"].blockedUntil === now + 100_000, "Anonymous reset window changed during restart.");
}
else {
    handlers.set(githubUrl, () => limited());
    assert(await AddonUpdateCoordinator.checkManually(), "Initial manual check did not run.");
    assert(calls.length === 1 && !calls[0].providerAuthorization, "Initial request did not use anonymous transport.");
    const anonymousBlockedUntil = persisted.origins["https://api.github.com"].blockedUntil;
    configureProviderTokens({github: token});
    assert(!await AddonUpdateCoordinator.checkManually() && calls.length === 1, "Token edit bypassed the manual cooldown.");
    now += 60_001;
    handlers.set(githubUrl, () => new Response(body("Quota", githubUrl)));
    assert(await AddonUpdateCoordinator.checkManually(), "Manual check did not resume after cooldown.");
    assert(calls.length === 2 && calls[1].providerAuthorization?.token === token, "Anonymous quota/target retry blocked the new token.");
    assert(PluginUpdater.getUpdateCandidate("Quota.plugin.js")?.version === "2.0.0", "Authenticated source did not produce a candidate.");
    assert(persisted.origins["https://api.github.com"].blockedUntil === anonymousBlockedUntil, "Authenticated success erased anonymous backoff.");

    const rawUrl = "https://gitlab.com/example/addons/-/raw/main/Raw.plugin.js";
    const apiUrl = "https://gitlab.com/api/v4/projects/1/repository/files/Api.plugin.js/raw";
    pluginManager.addonList.push(addon("Raw", rawUrl));
    handlers.set(rawUrl, () => limited());
    await AddonUpdateCoordinator.checkAutomatic("scheduled");
    const rawBlockedUntil = persisted.origins["https://gitlab.com"].blockedUntil;
    pluginManager.addonList.push(addon("Api", apiUrl));
    configureProviderTokens({github: token, gitlab: gitlabToken});
    handlers.set(apiUrl, () => new Response(body("Api", apiUrl)));
    await AddonUpdateCoordinator.checkAutomatic("scheduled");
    assert(calls.filter(call => call.url === rawUrl).length === 1, "GitLab token reset legitimate anonymous raw throttling.");
    assert(calls.find(call => call.url === apiUrl)?.providerAuthorization?.token === gitlabToken, "GitLab API did not use its independent authenticated bucket.");
    assert(persisted.origins["https://gitlab.com"].blockedUntil === rawBlockedUntil, "API success cleared GitLab raw backoff.");
    handlers.set(apiUrl, () => limited());
    await PluginUpdater.checkAll(false);
    assert(persisted.origins["https://gitlab.com"].authenticated.blockedUntil > now, "Authenticated API throttle was not persisted separately.");
    assert(persisted.origins["https://gitlab.com"].blockedUntil === rawBlockedUntil, "Authenticated API throttle replaced anonymous state.");

    const delayedUrl = "https://api.github.com/repos/example/addons/contents/Delayed.plugin.js";
    const delayed = addon("Delayed", delayedUrl);
    pluginManager.addonList.push(delayed);
    const old429 = Promise.withResolvers<Response>();
    let delayedCalls = 0;
    handlers.set(delayedUrl, () => ++delayedCalls === 1 ? old429.promise : new Response(body("Delayed", delayedUrl, "3.0.0")));
    const oldCheck = AddonUpdateCoordinator.checkAutomatic("scheduled");
    await waitFor(() => delayedCalls === 1);
    configureProviderTokens({github: "dummy-updater-rotated-2345", gitlab: gitlabToken});
    await AddonUpdateCoordinator.checkAutomatic("scheduled");
    assert(delayedCalls === 2 && PluginUpdater.getUpdateCandidate("Delayed.plugin.js")?.version === "3.0.0", "New generation joined old target/raw work.");
    let oldResponseCancellations = 0;
    old429.resolve(new Response(new ReadableStream({cancel() {oldResponseCancellations++;}}), {status: 429, headers: {"Retry-After": "3600"}}));
    await oldCheck;
    assert(oldResponseCancellations === 1, "Superseded response body was left transferring.");
    assert(!persisted.origins["https://api.github.com"].authenticated.blockedUntil, "Delayed old-generation 429 restored authenticated backoff.");
    assert(PluginUpdater.getUpdateCandidate("Delayed.plugin.js")?.version === "3.0.0", "Delayed completion replaced the current candidate.");
    const movedUrl = delayedUrl.replace("/example/", "/moved/");
    delayed.updateUrl = movedUrl;
    delayed.fileContent = body("Delayed", movedUrl, "1.0.0");
    handlers.set(movedUrl, () => new Response(body("Delayed", movedUrl, "4.0.0")));
    await AddonUpdateCoordinator.checkAutomatic("scheduled");
    assert(PluginUpdater.getUpdateCandidate("Delayed.plugin.js")?.version === "4.0.0", "Old completion restored a per-addon retry that hid a changed URL.");

    const gistUrl = "https://gist.github.com/example/abc123";
    const descriptorUrl = "https://api.github.com/gists/abc123";
    const oldRaw = "https://gist.githubusercontent.com/example/abc123/raw/old/Gist.plugin.js";
    const newRaw = oldRaw.replace("/old/", "/new/");
    const descriptorBody = Promise.withResolvers<void>();
    let descriptorCalls = 0;
    handlers.set(descriptorUrl, request => {
        assert(request.providerAuthorization?.purpose === "managed-addon-update", "Descriptor did not enter the managed transport lane.");
        if (++descriptorCalls > 1) return Response.json({files: {"Gist.plugin.js": {filename: "Gist.plugin.js", raw_url: newRaw}}});
        return new Response(new ReadableStream({async start(controller) {
            await descriptorBody.promise;
            controller.enqueue(new TextEncoder().encode(JSON.stringify({files: {"Gist.plugin.js": {filename: "Gist.plugin.js", raw_url: oldRaw}}})));
            controller.close();
        }}));
    });
    handlers.set(newRaw, () => new Response(body("Gist", gistUrl)));
    pluginManager.addonList.push(addon("Gist", gistUrl));
    const oldDescriptorCheck = AddonUpdateCoordinator.checkAutomatic("scheduled");
    await waitFor(() => descriptorCalls === 1);
    configureProviderTokens({github: "dummy-updater-latest-3456", gitlab: gitlabToken});
    const currentDescriptorCheck = AddonUpdateCoordinator.checkAutomatic("scheduled");
    descriptorBody.resolve();
    await Promise.all([oldDescriptorCheck, currentDescriptorCheck]);
    assert(descriptorCalls === 2 && !calls.some(call => call.url === oldRaw), "Old descriptor body restored a superseded raw resolution.");
    assert(persisted.addons["plugin:Gist.plugin.js"].resolvedUrlFingerprint === getAddonUpdateUrlFingerprint(newRaw), "Current descriptor resolution was not persisted.");
    assert(calls.find(call => call.url === newRaw)?.providerAuthorization === undefined, "Descriptor raw download acquired API authentication.");

    const slowbroUrl = "https://git.slowb.ro/owner/repo/raw/branch/main/Slowbro.plugin.js";
    const slowbroToken = "dummy-updater-slowbro-7890";
    pluginManager.addonList.push(addon("Slowbro", slowbroUrl));
    handlers.set(slowbroUrl, () => limited());
    await AddonUpdateCoordinator.checkAutomatic("scheduled");
    const slowbroAnonymousLimit = persisted.origins["https://git.slowb.ro"].blockedUntil;
    assert(slowbroAnonymousLimit > now, "Slowbro's anonymous rate limit was not retained.");
    configureProviderTokens({github: "dummy-updater-latest-3456", gitlab: gitlabToken, slowbro: slowbroToken});
    handlers.set(slowbroUrl, () => new Response(body("Slowbro", slowbroUrl)));
    await AddonUpdateCoordinator.checkAutomatic("scheduled");
    assert(calls.filter(call => call.url === slowbroUrl).length === 2, "New Slowbro authentication did not invalidate anonymous target retry.");
    assert(calls.filter(call => call.url === slowbroUrl).at(-1)?.providerAuthorization?.token === slowbroToken, "Managed Forgejo raw updates did not acquire the matching provider token.");
    assert(PluginUpdater.getUpdateCandidate("Slowbro.plugin.js")?.version === "2.0.0", "Authenticated Slowbro update did not produce its candidate.");
    handlers.set(slowbroUrl, () => limited());
    await PluginUpdater.checkAll(false);
    assert(persisted.origins["https://git.slowb.ro"].authenticated.credentialFingerprint === fingerprint(slowbroToken), "Slowbro authenticated requests were placed in the anonymous bucket.");
    assert(persisted.origins["https://git.slowb.ro"].authenticated.blockedUntil > now, "Slowbro authenticated throttling was not persisted.");
    assert(persisted.origins["https://git.slowb.ro"].blockedUntil === slowbroAnonymousLimit, "Slowbro authenticated throttling overwrote its anonymous state.");
    configureProviderTokens({github: "dummy-updater-latest-3456", gitlab: gitlabToken, slowbro: "dummy-updater-slowbro-rotated-8901"});
    handlers.set(slowbroUrl, () => new Response(body("Slowbro", slowbroUrl, "3.0.0")));
    await AddonUpdateCoordinator.checkAutomatic("scheduled");
    assert(PluginUpdater.getUpdateCandidate("Slowbro.plugin.js")?.version === "3.0.0", "Slowbro generation changes did not reconcile stale authenticated limits/target state.");
    assert(failures.length === 0, "Superseded work escaped as an unexpected failure.");
}
const serialized = JSON.stringify(persisted);
assert(!serialized.includes(token) && !serialized.includes(gitlabToken) && !serialized.includes("dummy-updater"), "A raw credential leaked into persisted updater state.");
process.stdout.write(`addon-updater-provider-auth-${restart ? "restart" : "lifecycle"}: ok\n`);
