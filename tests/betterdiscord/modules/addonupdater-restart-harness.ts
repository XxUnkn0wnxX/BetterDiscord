import {mock} from "bun:test";

import {getAddonUpdateContentHash, getAddonUpdateUrlFingerprint} from "../../../src/betterdiscord/utils/addonupdatestate";


const notifications: any[] = [];
const eventListeners = new Map<string, Set<(...args: any[]) => void>>();
const onlineListeners = new Set<() => void>();
let networkCalls = 0;
const now = Date.now();

const directUrl = "https://raw.githubusercontent.com/example/direct/main/Direct.plugin.js";
const gistUrl = "https://gist.github.com/example/1234567890abcdef";
const gistRawUrl = "https://gist.githubusercontent.com/example/1234567890abcdef/raw/revision/Gist.plugin.js";
const deletedUrl = "https://updates.example.test/Deleted.plugin.js";

const directBody = `/**
 * @name Direct
 * @author Direct Author
 * @version 2.0.0
 * @source https://github.com/example/direct
 * @updateUrl ${directUrl}
 */
module.exports = {};
`;
const gistBody = `/**
 * @name Gist
 * @author Gist Author
 * @version 2.0.0
 * @updateUrl ${gistUrl}
 */
module.exports = {};
`;

const directFingerprint = getAddonUpdateUrlFingerprint(directUrl);
const gistDeclaredFingerprint = getAddonUpdateUrlFingerprint(gistUrl);
const gistResolvedFingerprint = getAddonUpdateUrlFingerprint(gistRawUrl);
const deletedFingerprint = getAddonUpdateUrlFingerprint(deletedUrl);

const persistedState: Record<string, unknown> = {
    version: 1,
    addons: {
        "plugin:Direct.plugin.js": {
            lastCheckedAt: now,
            urlFingerprint: directFingerprint,
            resolvedUrlFingerprint: directFingerprint
        },
        "plugin:Gist.plugin.js": {
            lastCheckedAt: now,
            urlFingerprint: gistDeclaredFingerprint,
            resolvedUrlFingerprint: gistResolvedFingerprint
        },
        "plugin:StoreOnly.plugin.js": {lastCheckedAt: now},
        "plugin:Deleted.plugin.js": {
            lastCheckedAt: now,
            urlFingerprint: deletedFingerprint,
            resolvedUrlFingerprint: deletedFingerprint
        }
    },
    urls: {
        [directFingerprint]: {
            lastCheckedAt: now,
            contentHash: getAddonUpdateContentHash(new TextEncoder().encode(directBody)),
            metadata: {
                type: "plugin",
                filename: "Direct.plugin.js",
                name: "Direct",
                version: "2.0.0",
                author: "Direct Author",
                repositoryIdentity: "github.com/example/direct"
            }
        },
        [gistResolvedFingerprint]: {
            lastCheckedAt: now,
            contentHash: getAddonUpdateContentHash(new TextEncoder().encode(gistBody)),
            metadata: {
                type: "plugin",
                filename: "Gist.plugin.js",
                name: "Gist",
                version: "2.0.0",
                author: "Gist Author"
            }
        },
        [deletedFingerprint]: {
            lastCheckedAt: now,
            metadata: {
                type: "plugin",
                filename: "Deleted.plugin.js",
                name: "Deleted",
                version: "2.0.0",
                author: "Deleted Author"
            }
        }
    },
    origins: {},
    catalogueLastCheckedAt: now
};
let savedState: Record<string, any> | null = null;
const getSavedState = () => savedState as Record<string, any> | null;
const emitEvent = (event: string, ...args: any[]) => {
    for (const listener of eventListeners.get(event) ?? []) listener(...args);
};

const pluginManager = {
    addonFolder: "/tmp/bd-addon-restart-test",
    addonList: [{
        filename: "Direct.plugin.js",
        name: "Direct",
        version: "1.0.0",
        author: "Direct Author",
        source: "https://github.com/example/direct",
        updateUrl: directUrl,
        modified: 1,
        fileContent: directBody.replace("@version 2.0.0", "@version 1.0.0")
    }, {
        filename: "Gist.plugin.js",
        name: "Gist",
        version: "1.0.0",
        author: "Gist Author",
        updateUrl: gistUrl,
        modified: 1,
        fileContent: gistBody.replace("@version 2.0.0", "@version 1.0.0")
    }, {
        filename: "StoreOnly.plugin.js",
        name: "StoreOnly",
        version: "1.0.0",
        author: "Store Author",
        source: "https://github.com/example/store-only",
        modified: 1,
        fileContent: "/**\n * @name StoreOnly\n * @author Store Author\n * @version 1.0.0\n * @source https://github.com/example/store-only\n */\nmodule.exports = {};"
    }] as any[]
};
const themeManager = {addonFolder: "/tmp/bd-addon-restart-test", addonList: [] as any[]};
const catalogue = [{
    name: "StoreOnly",
    filename: "StoreOnly.plugin.js",
    type: "plugin",
    version: "2.0.0",
    latestSourceUrl: "https://raw.githubusercontent.com/example/store-only/main/StoreOnly.plugin.js",
    _addon: {author: {
        discord_snowflake: "",
        github_name: "Store Author",
        display_name: "Store Author",
        discord_name: "Store Author"
    }}
}];

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);

mock.module("@common/logger", () => ({"default": {debug: () => {}, info: () => {}, warn: () => {}, stacktrace: () => {}}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@stores/settings", () => ({"default": {get: (_category: string, id: string) => id === "checkForUpdates" || id === "addonUpdateNotifications" || id === "updateInterval" ? (id === "updateInterval" ? 4 : true) : false}}));
mock.module("@stores/json", () => ({"default": {
    get: () => persistedState,
    set: (_file: string, value: Record<string, any>) => {savedState = structuredClone(value);}
}}));
mock.module("@stores/toasts", () => ({"default": {success: () => {}}}));
mock.module("@ui/notifications", () => ({"default": {
    show: (notification: any) => notifications.push(notification),
    hide: () => {}
}}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: () => {}}}));
mock.module("@ui/settings", () => ({"default": {openSettingsPage: () => {}}}));
mock.module("@ui/logo", () => ({Logo: () => null}));
mock.module("@polyfill/remote", () => ({"default": {filesystem: {writeFileAsync: async () => {}}}}));
mock.module(modulePath("react.ts"), () => ({"default": {createElement: () => null}}));
mock.module(modulePath("emitter.ts"), () => ({"default": {
    on: (event: string, listener: (...args: any[]) => void) => {
        const listeners = eventListeners.get(event) ?? new Set();
        listeners.add(listener);
        eventListeners.set(event, listeners);
    },
    emit: emitEvent
}}));
mock.module(modulePath("pluginmanager.ts"), () => ({"default": pluginManager}));
mock.module(modulePath("thememanager.ts"), () => ({"default": themeManager}));
mock.module(modulePath("net.ts"), () => ({fetch: async () => {
    networkCalls++;
    throw new Error("Restart hydration unexpectedly used the network.");
}}));
mock.module(modulePath("addonstore.ts"), () => ({"default": {
    lastSuccessfulRequestAt: now,
    getAddons: () => catalogue.slice(),
    updaterRequestAddons: async () => {
        networkCalls++;
        return false;
    }
}}));

const runtimeNavigator = {onLine: true};
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

const {AddonUpdateCoordinator, PluginUpdater} = await import("../../../src/betterdiscord/modules/addonupdater");
AddonUpdateCoordinator.initialize();

const expectedPending = ["Direct.plugin.js", "Gist.plugin.js", "StoreOnly.plugin.js"];
if (PluginUpdater.pending.slice().sort().join(",") !== expectedPending.slice().sort().join(",")) {
    throw new Error(`Restart hydration lost known updates: ${PluginUpdater.pending.join(",")}`);
}
if ((PluginUpdater.getUpdateCandidate("Gist.plugin.js") as any)?.data?.resolveDeclared !== true) {
    throw new Error("A restart-restored descriptor was not marked for safe re-resolution at install time.");
}
if (networkCalls !== 0) throw new Error("Restart hydration performed network traffic.");
if (!notifications.some(notification => notification.id === "addon-updates-plugin")) {
    throw new Error("Restart-restored updates did not show the normal availability notice.");
}
const startupState = getSavedState();
if (!startupState || startupState.addons?.["plugin:Deleted.plugin.js"] || startupState.urls?.[deletedFingerprint]) {
    throw new Error("Startup did not prune updater state for a plugin missing from the installed addon list.");
}
if (!startupState.addons?.["plugin:Direct.plugin.js"] || !startupState.addons?.["plugin:Gist.plugin.js"]) {
    throw new Error("State pruning removed an installed addon regardless of its enabled/disabled state.");
}

PluginUpdater.initialize();
const directAddon = pluginManager.addonList.find(addon => addon.filename === "Direct.plugin.js")!;
pluginManager.addonList.splice(pluginManager.addonList.indexOf(directAddon), 1);
emitEvent("plugin-unloaded", directAddon);
pluginManager.addonList.push(directAddon);
await Promise.resolve();
if (!getSavedState()?.addons?.["plugin:Direct.plugin.js"]) {
    throw new Error("A synchronous unload/re-read cycle was mistaken for permanent addon deletion.");
}

pluginManager.addonList.splice(pluginManager.addonList.indexOf(directAddon), 1);
emitEvent("plugin-unloaded", directAddon);
await Promise.resolve();
const runtimeState = getSavedState();
if (!runtimeState || runtimeState.addons?.["plugin:Direct.plugin.js"] || runtimeState.urls?.[directFingerprint]) {
    throw new Error("A runtime-removed plugin remained in persisted addon/URL freshness state.");
}

const transientAddon = {
    filename: "Transient.plugin.js",
    name: "Transient",
    version: "1.0.0",
    author: "Transient Author",
    modified: 1,
    fileContent: "/**\n * @name Transient\n * @author Transient Author\n * @version 1.0.0\n */\nmodule.exports = {};"
};
pluginManager.addonList = [transientAddon];
runtimeNavigator.onLine = false;
await PluginUpdater.checkAll(false);
if (!onlineListeners.size) throw new Error("The transient offline addon did not create deferred retry ownership.");
pluginManager.addonList.length = 0;
emitEvent("plugin-unloaded", transientAddon);
await Promise.resolve();
if (onlineListeners.size) throw new Error("A removed, never-persisted addon left an offline reconnect listener armed.");

process.stdout.write("addon-updater-restart-hydration: ok\n");
