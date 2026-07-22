import {mock} from "bun:test";


const warnings: string[] = [];
const errors: string[] = [];
const infos: string[] = [];
const successToasts: string[] = [];
const notifications: any[] = [];
const writes: Array<{filename: string; body: Uint8Array; expected?: {modified: number; fileContent: string;};}> = [];
let catalogueRequests = 0;
let notificationsEnabled = true;
let persistedState: Record<string, unknown> = {};

const pluginManager = {addonFolder: "/tmp/bd-addon-updater-test", addonList: [] as any[]};
const themeManager = {addonFolder: "/tmp/bd-addon-updater-test", addonList: [] as any[]};
const installedSources = new Map<string, string>();
const catalogue: any[] = [];
let fetchImplementation: (url: string, init?: any) => Promise<Response>;
const runtimeNavigator = {onLine: true};
const onlineListeners = new Set<() => void>();
const addonStoreMock = {
    error: null,
    lastSuccessfulRequestAt: 0,
    getAddons: () => catalogue.slice(),
    updaterRequestAddons: async () => {
        catalogueRequests++;
        addonStoreMock.lastSuccessfulRequestAt = Date.now();
        return true;
    }
};

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);

mock.module("@common/logger", () => ({"default": {
    debug: () => {},
    info: (_category: string, message: string) => infos.push(message),
    warn: (_category: string, message: string) => warnings.push(message),
    stacktrace: (_category: string, message: string) => errors.push(message)
}}));
mock.module("@common/i18n", () => ({t: (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`}));
mock.module("@stores/settings", () => ({"default": {
    get: (category: string, id: string) => {
        if (category !== "addons") return false;
        if (id === "checkForUpdates") return true;
        if (id === "addonUpdateNotifications") return notificationsEnabled;
        if (id === "updateInterval") return 4;
        return false;
    }
}}));
mock.module("@stores/json", () => ({"default": {
    get: (file: string) => file === "addon-updater" ? persistedState : {},
    set: (file: string, value: Record<string, unknown>) => {
        if (file === "addon-updater") persistedState = structuredClone(value);
    }
}}));
mock.module("@stores/toasts", () => ({"default": {
    success: (message: string) => successToasts.push(message)
}}));
mock.module("@ui/notifications", () => ({"default": {
    show: (notification: any) => notifications.push(notification),
    hide: (id: string) => {
        const index = notifications.findIndex(notification => notification.id === id);
        if (index >= 0) notifications.splice(index, 1);
    }
}}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: () => {}}}));
mock.module("@ui/settings", () => ({"default": {openSettingsPage: () => {}}}));
mock.module("@ui/logo", () => ({Logo: () => null}));
mock.module("@polyfill/remote", () => ({"default": {filesystem: {
    readFileSnapshotAsync: async (filename: string) => {
        const basename = filename.slice(filename.lastIndexOf("/") + 1);
        const addon = [...pluginManager.addonList, ...themeManager.addonList].find(entry => entry.filename === basename);
        const fileContent = installedSources.get(basename) ?? addon?.fileContent;
        if (!addon || typeof fileContent !== "string") throw new Error(`Missing test snapshot for ${basename}`);
        return {modified: addon.modified, fileContent};
    },
    writeFileAsync: async (filename: string, body: Uint8Array, expected?: {modified: number; fileContent: string;}) => {
        writes.push({filename, body, expected});
    }
}}}));
mock.module(modulePath("react.ts"), () => ({"default": {createElement: () => null}}));
mock.module(modulePath("emitter.ts"), () => ({"default": {on: () => {}, emit: () => {}}}));
mock.module(modulePath("pluginmanager.ts"), () => ({"default": pluginManager}));
mock.module(modulePath("thememanager.ts"), () => ({"default": themeManager}));
mock.module(modulePath("net.ts"), () => ({fetch: (url: string, init?: any) => fetchImplementation(url, init)}));
mock.module(modulePath("addonstore.ts"), () => ({"default": addonStoreMock}));

Object.assign(globalThis, {
    window: {
        navigator: runtimeNavigator,
        setTimeout: () => 1,
        clearTimeout: () => {},
        addEventListener: (event: string, listener: () => void) => {
            if (event === "online") onlineListeners.add(listener);
        },
        removeEventListener: (event: string, listener: () => void) => {
            if (event === "online") onlineListeners.delete(listener);
        }
    }
});

const {
    AddonUpdateCoordinator,
    PluginUpdater
} = await import("../../../src/betterdiscord/modules/addonupdater");

const declaredUrl = "https://raw.githubusercontent.com/XxUnkn0wnxX/BDPlugins/main/JumpToTop.plugin.js?token=private-test-value";
const declaredBody = `/**
 * @name JumpToTop
 * @author openAI
 * @authorId 361510310504562699
 * @version 2.1.0
 * @source https://github.com/XxUnkn0wnxX/BDPlugins/tree/main
 * @updateUrl ${declaredUrl}
 */
module.exports = {};
`;

const installedBody = declaredBody.replace("@version 2.1.0", "@version 2.0.2");
const noPathBody = `/**
 * @name NoPath
 * @author Local Author
 * @version 1.0.0
 */
module.exports = {};
`;

pluginManager.addonList = [{
    filename: "JumpToTop.plugin.js",
    name: "JumpToTop",
    version: "2.0.2",
    author: "openAI",
    authorId: "361510310504562699",
    source: "https://github.com/XxUnkn0wnxX/BDPlugins/tree/main",
    updateUrl: declaredUrl,
    modified: 1,
    fileContent: installedBody
}, {
    filename: "NoPath.plugin.js",
    name: "NoPath",
    version: "1.0.0",
    author: "Local Author",
    modified: 1,
    fileContent: noPathBody
}];

catalogue.push({
    name: "JumpToTop",
    filename: "JumpToTop.plugin.js",
    type: "plugin",
    version: "9.0.0",
    latestSourceUrl: "https://raw.githubusercontent.com/snappycreeper/BetterDiscordPlugins/main/JumpToTop/JumpToTop.plugin.js",
    _addon: {author: {
        discord_snowflake: "1031925360239058974",
        github_name: "snappycreeper",
        display_name: "SnappyC",
        discord_name: "SnappyC"
    }}
});

let fetchCalls = 0;
const fetchGate = Promise.withResolvers<void>();
fetchImplementation = async (url, init) => {
    fetchCalls++;
    if (url !== declaredUrl) throw new Error(`Unexpected source request: ${url}`);
    if (init?.maxResponseBytes !== 16 * 1024 * 1024 || init?.httpsOnly !== true) {
        throw new Error("Updater response guards were not passed to native fetch.");
    }
    await fetchGate.promise;
    return new Response(declaredBody, {status: 200, headers: {ETag: "test-etag"}});
};

AddonUpdateCoordinator.initialize();
const firstManualPromise = AddonUpdateCoordinator.checkManually();
for (let attempt = 0; attempt < 100; attempt++) {
    if (fetchCalls) break;
    await Bun.sleep(0);
}
if (!fetchCalls) throw new Error("The initiating manual source check did not start.");
const joinedManualPromise = AddonUpdateCoordinator.checkManually();
fetchGate.resolve();
const [firstManual, joinedManual] = await Promise.all([firstManualPromise, joinedManualPromise]);
const secondManual = await AddonUpdateCoordinator.checkManually();

if (!firstManual || joinedManual || secondManual) {
    throw new Error("Only the initiating manual check should pass the active-join and 60-second cooldown gate.");
}
if (catalogueRequests !== 1 || fetchCalls !== 1) throw new Error("Manual check joining/cooldown produced duplicate requests.");
if (PluginUpdater.pending.join(",") !== "JumpToTop.plugin.js") throw new Error("The declared JumpToTop update was not selected.");

const candidate = PluginUpdater.getUpdateCandidate("JumpToTop.plugin.js") as any;
if (candidate?.source !== "update-url" || candidate.version !== "2.1.0") {
    throw new Error("The mismatched, higher Store row won over the declared update URL.");
}
if (!warnings.some(message => message.includes("repository and author identity do not match"))) {
    throw new Error("The Store collision was not logged.");
}
if (warnings.some(message => message.includes("NoPath.plugin.js"))) {
    throw new Error("An addon with no update path produced warning noise.");
}

const serializedState = JSON.stringify(persistedState);
if (serializedState.includes(declaredUrl) || serializedState.includes("private-test-value")) {
    throw new Error("A raw or token-bearing update URL leaked into persisted state.");
}
if (!(persistedState as any).addons?.["plugin:JumpToTop.plugin.js"]?.lastCheckedAt
    || !(persistedState as any).addons?.["plugin:NoPath.plugin.js"]?.lastCheckedAt) {
    throw new Error("Per-addon completion timestamps were not persisted.");
}

// Enabled plugins/themes discard their in-memory source after initialization. The updater must
// snapshot the installed file through preload instead of rejecting this ordinary loaded state.
installedSources.set("JumpToTop.plugin.js", installedBody);
delete pluginManager.addonList[0].fileContent;
PluginUpdater.showUpdateNotice();
if (!notifications.some(notification => notification.id === "addon-updates-plugin")) {
    throw new Error("The available-update notification was not shown.");
}
if (!await PluginUpdater.updateAddon("JumpToTop.plugin.js")) throw new Error("The validated declared update failed to install.");
if (notifications.some(notification => notification.id === "addon-updates-plugin")) {
    throw new Error("The available-update notification stayed stale after its last update was installed.");
}
if (fetchCalls !== 1) throw new Error("Install did not reuse the exact checked bytes from memory.");
if (writes.length !== 1 || new TextDecoder().decode(writes[0].body) !== declaredBody) {
    throw new Error("Install wrote bytes other than the validated body.");
}
if (writes[0].expected?.fileContent !== installedBody) {
    throw new Error("Install did not pass the checked local source into the final atomic replacement guard.");
}
if (successToasts.length !== 1) throw new Error("Successful updates did not respect the enabled notification setting.");

const eligibleIdentity = {
    status: "eligible",
    matchedBy: ["author"],
    repository: "unknown",
    authorId: "unknown",
    author: "match",
    installedRepositories: [],
    candidateRepositories: []
};
pluginManager.addonList.push({
    filename: "Failure.plugin.js",
    name: "Failure",
    version: "1.0.0",
    author: "Tester",
    modified: 1,
    fileContent: noPathBody.replace("NoPath", "Failure")
});
PluginUpdater.setCandidates("Failure.plugin.js", "1.0.0", [{
    source: "update-url",
    version: "2.0.0",
    identity: eligibleIdentity,
    data: {
        filename: "Failure.plugin.js",
        name: "Failure",
        fetchUrl: "https://updates.example.test/Failure.plugin.js",
        provider: "generic",
        repositoryIdentity: null
    }
}] as any);
fetchImplementation = async () => {throw new Error("Request timed out");};

await PluginUpdater.updateAll(["Failure.plugin.js"]);
const failureCard = notifications.at(-1);
if (failureCard?.duration !== Infinity || failureCard?.actions?.[0]?.label?.split(":")[0] !== "Updater.viewFailures") {
    throw new Error("Update All did not create one persistent batch failure card with a View action.");
}
if (!PluginUpdater.pending.includes("Failure.plugin.js")) throw new Error("A failed update was removed from pending state.");
if (!warnings.some(message => message.includes("Failed to update 'Failure.plugin.js'"))) {
    throw new Error("The terminal addon failure was not logged.");
}

notificationsEnabled = false;
const notificationCount = notifications.length;
await PluginUpdater.updateAll(["Failure.plugin.js"]);
if (notifications.length !== notificationCount) throw new Error("The disabled notification setting still created a failure card.");
if (!warnings.some(message => message.includes("Failure.plugin.js"))) throw new Error("Disabling cards also suppressed console diagnostics.");

pluginManager.addonList.push({
    filename: "WrongName.plugin.js",
    name: "WrongName",
    version: "1.0.0",
    author: "Tester",
    modified: 1,
    fileContent: noPathBody.replace("NoPath", "WrongName")
});
PluginUpdater.setCandidates("WrongName.plugin.js", "1.0.0", [{
    source: "update-url",
    version: "2.0.0",
    identity: eligibleIdentity,
    data: {
        filename: "WrongName.plugin.js",
        name: "WrongName",
        fetchUrl: "https://updates.example.test/WrongName.plugin.js",
        provider: "generic",
        repositoryIdentity: null
    }
}] as any);
fetchImplementation = async () => new Response(
    "/**\n * @name AnotherAddon\n * @author Tester\n * @version 2.0.0\n */\nmodule.exports = {};\n",
    {status: 200}
);
if (await PluginUpdater.updateAddon("WrongName.plugin.js")) throw new Error("A same-author wrong addon name was allowed to overwrite the installed addon.");
if (writes.length !== 1) throw new Error("Rejected wrong-name source bytes reached the filesystem bridge.");

let rateFetches = 0;
for (let index = 1; index <= 4; index++) {
    const name = `Rate${index}`;
    const updateUrl = `https://rate.example.test/${name}.plugin.js`;
    pluginManager.addonList.push({
        filename: `${name}.plugin.js`,
        name,
        version: "1.0.0",
        author: "Rate Tester",
        updateUrl,
        fileContent: `/**\n * @name ${name}\n * @author Rate Tester\n * @version 1.0.0\n * @updateUrl ${updateUrl}\n */\nmodule.exports = {};\n`
    });
}
fetchImplementation = async (url) => {
    if (url === declaredUrl) return new Response(declaredBody, {status: 200});
    if (url.startsWith("https://rate.example.test/")) {
        rateFetches++;
        return new Response("rate limited", {status: 429, headers: {"Retry-After": "60"}});
    }
    throw new Error(`Unexpected rate-test request: ${url}`);
};

await PluginUpdater.checkAll(false);
if (rateFetches !== 2) throw new Error(`Queued same-origin requests were not stopped after rate limiting (${rateFetches} transports).`);
if (!(persistedState as any).origins?.["https://rate.example.test"]?.blockedUntil) {
    throw new Error("Provider rate-limit state was not persisted by origin.");
}
if (warnings.filter(message => message.includes("https://rate.example.test") && message.includes("rate limited")).length !== 1) {
    throw new Error("One provider rate-limit burst did not produce exactly one console warning.");
}

const offlineUrl = "https://offline.example.test/Offline.plugin.js";
const offlineBody = `/**
 * @name Offline
 * @author Offline Tester
 * @version 2.0.0
 * @updateUrl ${offlineUrl}
 */
module.exports = {};
`;
pluginManager.addonList.push({
    filename: "Offline.plugin.js",
    name: "Offline",
    version: "1.0.0",
    author: "Offline Tester",
    updateUrl: offlineUrl,
    fileContent: offlineBody.replace("@version 2.0.0", "@version 1.0.0")
});
const offlineGate = Promise.withResolvers<void>();
let offlineFetches = 0;
fetchImplementation = async (url) => {
    if (url === declaredUrl) return new Response(declaredBody, {status: 200});
    if (url === offlineUrl) {
        offlineFetches++;
        if (offlineFetches === 1) {
            await offlineGate.promise;
            throw new Error("Request timed out");
        }
        return new Response(offlineBody, {status: 200});
    }
    throw new Error(`Unexpected offline-test request: ${url}`);
};

const interruptedCheck = PluginUpdater.checkAll(false);
for (let attempt = 0; attempt < 100; attempt++) {
    if (offlineFetches > 0) break;
    await Bun.sleep(0);
}
if (!offlineFetches) throw new Error("The mid-flight offline test did not start its source request.");
runtimeNavigator.onLine = false;
offlineGate.resolve();
await interruptedCheck;
if (!onlineListeners.size || !infos.some(message => message.includes("deferring plugin and theme update requests"))) {
    throw new Error("A connection drop during raw-source checks did not arm reconnect recovery.");
}

runtimeNavigator.onLine = true;
for (const listener of [...onlineListeners]) listener();
for (let attempt = 0; attempt < 100 && !PluginUpdater.pending.includes("Offline.plugin.js"); attempt++) await Bun.sleep(0);
if (offlineFetches !== 2 || !PluginUpdater.pending.includes("Offline.plugin.js")) {
    throw new Error("Reconnect did not promptly resume the interrupted addon check.");
}
if (rateFetches !== 2) throw new Error("Reconnect bypassed a provider rate-limit transport guard.");
if (!infos.some(message => message.includes("Connection restored"))) throw new Error("Reconnect recovery was not logged.");

const cacheUrl = "https://cache.example.test/CacheRelease.plugin.js";
const cacheBody = `/**
 * @name CacheRelease
 * @author Cache Tester
 * @version 2.0.0
 * @updateUrl ${cacheUrl}
 */
module.exports = {};
`;
const cacheAddon = {
    filename: "CacheRelease.plugin.js",
    name: "CacheRelease",
    version: "1.0.0",
    author: "Cache Tester",
    updateUrl: cacheUrl,
    modified: 1,
    fileContent: cacheBody.replace("@version 2.0.0", "@version 1.0.0")
};
const cacheCandidate = {
    source: "update-url",
    version: "2.0.0",
    identity: eligibleIdentity,
    data: {
        filename: cacheAddon.filename,
        name: cacheAddon.name,
        fetchUrl: cacheUrl,
        provider: "generic",
        repositoryIdentity: null
    }
} as any;
pluginManager.addonList.push(cacheAddon);
let cacheFetches = 0;
fetchImplementation = async (url) => {
    if (url !== cacheUrl) throw new Error(`Unexpected cache-release request: ${url}`);
    cacheFetches++;
    return new Response(cacheBody, {status: 200});
};
PluginUpdater.setCandidates(cacheAddon.filename, cacheAddon.version, [cacheCandidate]);
if (!await PluginUpdater.updateAddon(cacheAddon.filename)) throw new Error("The first cache-release install failed.");
PluginUpdater.setCandidates(cacheAddon.filename, cacheAddon.version, [cacheCandidate]);
if (!await PluginUpdater.updateAddon(cacheAddon.filename)) throw new Error("The repeated cache-release install failed.");
if (cacheFetches !== 2) throw new Error("A materialized addon body remained in the shared cache after its attempt settled.");

process.stdout.write("addon-updater-integration: ok\n");
