import {mock} from "bun:test";
import type {Addon as InstalledAddon} from "../../../src/betterdiscord/types/addon";

const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
};
const mode = process.env.BD_STORE_LIFECYCLE_MODE ?? "online";
const cachedAddon = {
    id: 17,
    name: "Cached plugin",
    type: "plugin",
    file_name: "Cached.plugin.js",
    initial_release_date: "2026-01-01",
    latest_release_date: "2026-01-02",
    author: {github_id: "1", display_name: "Author"},
    tags: [],
    downloads: 2,
    likes: 1,
    version: "1.0.0",
    description: "Cached",
    latest_source_url: "https://example.test/cached"
};
const freshAddon = {...cachedAddon, id: 18, name: "Fresh plugin", file_name: "Fresh.plugin.js"};
const stored = {addons: {"cached.plugin.js": cachedAddon}, known: "malformed", version: "test"};
let cacheReads = 0;
let settingsListeners = 0;
let clockNow = 100_000;
Date.now = () => clockNow;
let nextTimer = 0;
const timers = new Map<number, {callback:() => void; delay: number}>();
const listeners = new Map<string, Set<() => void>>();
const navigator = {onLine: mode !== "offline"};
const requests: Array<{
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    timeout: number;
}> = [];
const installedAddon = {
    filename: "Installed.plugin.js",
    name: "Installed",
    author: "Author",
    version: "1.0.0",
    modified: 1,
    updateUrl: "https://example.test/Installed.plugin.js",
    fileContent: "/** @name Installed */"
} as InstalledAddon;
const pluginManager = {addonFolder: "", addonList: [installedAddon]};
let installedSourceReads = 0;
const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);

mock.module("@polyfill/request", () => ({"default": () => {throw new Error("Catalogue activity downloaded an addon.");}}));
mock.module("@common/logger", () => ({"default": {debug: () => {}, info: () => {}, warn: () => {}, stacktrace: () => {}}}));
mock.module("@stores/toasts", () => ({"default": {show: () => {}}}));
mock.module("@stores/json", () => ({"default": {
    get: (file: string) => {
        if (file !== "addon-store") return {};
        cacheReads++;
        return stored;
    },
    set: () => {}
}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("react", () => ({"default": {createElement: () => null}}));
mock.module(modulePath("pluginmanager.ts"), () => ({"default": pluginManager}));
mock.module(modulePath("thememanager.ts"), () => ({"default": {addonFolder: "", addonList: []}}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: () => {}}}));
mock.module("@ui/modals/installmodal", () => ({"default": class {}}));
mock.module("@stores/notifications", () => ({"default": {show: () => {throw new Error("Automatic addon-update notice with checks off.");}, hide: () => {}}}));
mock.module("@ui/settings", () => ({"default": {openSettingsPage: () => {}}}));
mock.module("@ui/logo", () => ({Logo: () => null}));
mock.module("@polyfill/remote", () => ({"default": {filesystem: {
    readFileSnapshotAsync: async () => {installedSourceReads++; throw new Error("Automatic addon source read with checks off.");},
    writeFileAsync: async () => {throw new Error("Catalogue activity installed an addon.");}
}}}));
mock.module(modulePath("react.ts"), () => ({"default": {createElement: () => null}}));
mock.module(modulePath("emitter.ts"), () => ({"default": {on: () => {}, emit: () => {}}}));
mock.module("@stores/settings", () => ({"default": {
    get: (...keys: string[]) => keys.at(-1) === "updateInterval" ? 4 : false,
    on: () => {settingsListeners++;}
}}));
mock.module("@data/web", () => ({"default": {API_VERSION: "test", store: {addons: "https://api.example.test/addons"}}}));
mock.module(modulePath("addonmanager.ts"), () => ({"default": class {}}));
mock.module("@stores/base", () => ({"default": class {emitChange() {}}}));
mock.module(modulePath("net.ts"), () => ({fetch: (_url: string, options: {signal: AbortSignal; timeout: number}) => (
    new Promise<Response>((resolve, reject) => requests.push({resolve, reject, ...options}))
)}));

Object.assign(globalThis, {window: {
    navigator,
    addEventListener: (name: string, callback: () => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(callback);
    },
    removeEventListener: (name: string, callback: () => void) => {listeners.get(name)?.delete(callback);},
    setTimeout: (callback: () => void, delay: number) => {
        timers.set(++nextTimer, {callback, delay});
        return nextTimer;
    },
    clearTimeout: (id: number) => {timers.delete(id);}
}});

const dispatch = (name: string) => {
    for (const callback of [...listeners.get(name) ?? []]) callback();
};
const listenerCount = (name: string) => listeners.get(name)?.size ?? 0;
const requestCount = () => requests.length;
const response = (rows: unknown = [freshAddon]) => new Response(JSON.stringify(rows), {status: 200});
const runTimer = (expectedDelay: number) => {
    assert(timers.size === 1, "Catalogue should own exactly one refresh timer.");
    const [id, timer] = [...timers.entries()][0];
    assert(timer.delay === expectedDelay, `Unexpected refresh delay: ${timer.delay}, expected ${expectedDelay}.`);
    timers.delete(id);
    clockNow += timer.delay;
    timer.callback();
};
const {default: Store} = await import("../../../src/betterdiscord/modules/addonstore");

Store.initialize();
Store.initialize();
assert(cacheReads === 1 && settingsListeners === 0, "Repeated initialization reloaded cache or registered obsolete setting listeners.");
assert(Store.hasDoneFirstRequest, "Permanent Store startup did not mark its first catalogue request.");
assert(Store.getState().addons.length === 1 && Store.getState().addons[0].id === 17, "Store-open consumer could not read the startup cache.");

if (mode === "offline") {
    assert(requestCount() === 0 && !Store.loading && Store.error, "Offline startup attempted a network request or remained loading.");
    await Store.requestAddons();
    assert(Store.getState().addons.length === 1 && listenerCount("online") === 1, "Offline startup duplicated cache rows or reconnect listeners.");
    navigator.onLine = true;
    dispatch("online");
}
assert(requestCount() === 1 && Store.loading, "Catalogue did not start with old Store false and automatic updates off.");
const startupPromise = Store.promise;
assert(Store.requestAddons() === startupPromise, "Store-open refresh did not share the startup transport promise.");
const updaterPromise = Store.updaterRequestAddons(false);
assert(requestCount() === 1 && Store.promise === startupPromise, "Updater did not share the Store request.");
assert(requests[0].timeout === 30_000, "Catalogue did not preserve its 30-second inactivity timeout.");
requests[0].resolve(response());
await startupPromise;
assert(await updaterPromise, "Shared updater consumer did not observe successful settlement.");
assert(Store.getState().addons.length === 1 && Store.getState().addons[0].id === 18 && !Store.loading && !Store.error, "Store-open consumer did not see the settled fresh catalogue.");
assert(listenerCount("offline") === 0 && listenerCount("online") === 0, "Successful request leaked network listeners.");
runTimer(4 * 60 * 60 * 1000);
assert(requestCount() === 2, "Permanent Store refresh timer did not request with automatic updates off.");

const interrupted = Store.promise;
navigator.onLine = false;
dispatch("offline");
assert(requests[1].signal.aborted && !Store.loading, "Going offline did not cancel and detach the active request.");
assert(Store.getState().addons.length === 1 && Store.getState().addons[0].id === 18, "Offline fallback lost the replacement cache.");
await Store.requestAddons();
assert(listenerCount("online") === 1 && timers.size === 0, "Offline activity duplicated reconnect listeners or retained refresh timers.");
navigator.onLine = true;
dispatch("online");
assert(requestCount() === 3 && Store.loading && listenerCount("online") === 0, "Reconnect did not request a fresh catalogue independently of automatic updates.");
const reconnected = Store.promise;
requests[1].resolve(response([cachedAddon]));
await interrupted;
assert(Store.loading && timers.size === 0, "Late cancelled completion changed the newer request's loading state or timer.");
requests[2].resolve(response());
await reconnected;
assert(Store.getState().addons[0].id === 18 && !Store.error, "A stale offline reply replaced the fresh catalogue.");

runTimer(4 * 60 * 60 * 1000);
const decoding = Store.promise;
let resolveDecoded!: (rows: unknown) => void;
requests[3].resolve({ok: true, json: () => new Promise(resolve => {resolveDecoded = resolve;})} as Response);
await Promise.resolve();
await Promise.resolve();
assert(resolveDecoded, "Response did not enter asynchronous JSON decoding.");
navigator.onLine = false;
dispatch("offline");
navigator.onLine = true;
dispatch("online");
const afterDecode = Store.promise;
requests[4].resolve(response());
await afterDecode;
resolveDecoded([cachedAddon]);
await decoding;
assert(Store.getState().addons[0].id === 18 && timers.size === 1, "Stale decoded JSON replaced the new catalogue or scheduled an extra timer.");

runTimer(4 * 60 * 60 * 1000);
requests[5].reject(new Error("Unexpected network failure"));
await Store.promise;
assert(Store.error && Store.getState().addons[0].id === 18, "Failed refresh did not retain cached rows.");
runTimer(5 * 60 * 1000);
requests[6].reject(Object.assign(new Error("connection reset"), {code: "ECONNRESET"}));
await Store.promise;
runTimer(30_000);
requests[7].resolve(response({unexpected: "shape"}));
await Store.promise;
assert(Store.error?.name === "AddonStoreDataError", "Invalid catalogue response shape was accepted.");
runTimer(5 * 60 * 1000);
requests[8].resolve(new Response("unavailable", {status: 503}));
await Store.promise;
assert(Store.error?.name === "AddonStoreHTTPError", "Non-success HTTP status was accepted.");
runTimer(5 * 60 * 1000);
requests[9].reject(new Error("Request timed out"));
await Store.promise;
assert(!Store.loading, "Inactivity timeout left the catalogue loading.");
runTimer(5 * 60 * 1000);
requests[10].resolve(new Response("rate limited", {status: 429, headers: {"Retry-After": "60"}}));
await Store.promise;
const rateLimitTimer = [...timers.values()][0];
assert(rateLimitTimer.delay >= 60_000 && rateLimitTimer.delay <= 65_000, "Rate-limit refresh ignored provider reset or jitter bounds.");
const rateLimitedCount = requestCount();
assert(!await Store.updaterRequestAddons(true) && requestCount() === rateLimitedCount, "Manual updater request bypassed the shared rate limit.");
assert(Store.getState().addons.length === 1 && timers.size === 1, "Rate-limit skip duplicated cache rows or timers.");
runTimer(rateLimitTimer.delay);
requests[11].resolve(response());
await Store.promise;
assert(!Store.error && !Store.loading && timers.size === 1, "Catalogue did not recover after its provider reset window.");

const {AddonUpdateCoordinator, PluginUpdater} = await import("../../../src/betterdiscord/modules/addonupdater");
const requestsBeforeUpdater = requestCount();
AddonUpdateCoordinator.initialize();
AddonUpdateCoordinator.configureSchedule();
AddonUpdateCoordinator.queueEventCheck(PluginUpdater, installedAddon);
await AddonUpdateCoordinator.checkAutomatic("startup");
await AddonUpdateCoordinator.checkAutomatic("scheduled");
assert(requestCount() === requestsBeforeUpdater && installedSourceReads === 0 && PluginUpdater.pending.length === 0,
    "Permanent catalogue activity bypassed the coordinator's automatic addon-check gate.");
assert(timers.size === 1, "Automatic checks off removed the Store refresh timer or added an updater timer.");
process.stdout.write(`addon-store-lifecycle: ${mode} ok\n`);
