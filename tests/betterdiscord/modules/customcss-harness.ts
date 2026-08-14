import {mock} from "bun:test";
import nodeFs from "node:fs";
import path from "node:path";

const webpackPath = import.meta.resolve("../../../src/betterdiscord/webpack/index.ts");
const modulesPath = import.meta.resolve("../../../src/betterdiscord/modules/discordmodules.ts");

type FileEntry = {
    content: string;
    mtime: number;
};

type FloatingWindowConfig = {
    children?: {
        props?: {
            openNative?: () => Promise<void>;
        };
    };
};

type Listener = (...args: unknown[]) => void;
type WatchEventType = "change" | "rename";
type WatchOptions = {
    persistent?: boolean;
};
type WatchCallback = (eventType: WatchEventType, filename?: string | Buffer | null) => void;

const file = path.join("/tmp/bd-customcss-tests", "custom.css");
const initialCSS = "/*initial*/ body { background: red; }";
const insertedCss: string[] = [];
const toastErrors: string[] = [];
const fsFiles: Map<string, FileEntry> = new Map();
const floatingWindowsOpen: FloatingWindowConfig[] = [];
const floatingWindowsClose: string[] = [];
const settings = {
    customcss: process.env.CUSTOMCSS_INITIAL_ENABLED === "1",
    liveUpdate: true,
    openAction: "internal" as const
};
const eventListeners = new Map<string, Set<Listener>>();
const initialCustomcssEnabled = settings.customcss;

let openPathBehavior: "ok" | "error" | "reject" = "ok";
let watchCount = 0;
let closeWatchCount = 0;
let activeWatcherCount = 0;
let maxActivePanelCount = 0;
let maxWatcherCount = 0;
let activePanelCount = 0;
let activePanelCalls = 0;
let removePanelCalls = 0;
let writeFileCallCount = 0;
let refreshCount = 0;
let settingsOpenCalls = 0;
let settingsCloseCalls = 0;
let mtime = 1;

const nextMtime = () => ++mtime;

const emitSettingUpdated = (collection: string, category: string, id: string, value: boolean): void => {
    const listeners = eventListeners.get("setting-updated");
    if (!listeners) return;

    for (const listener of listeners) listener(collection, category, id, value);
};

type CustomCSSSettings = typeof settings;

const setSetting = <K extends keyof CustomCSSSettings>(key: K, value: CustomCSSSettings[K]): void => {
    settings[key] = value;
};

const waitForSettled = async (): Promise<void> => {
    await Bun.sleep(0);
};

const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message);
};

const webpackGenericNoop = () => undefined;
const webpackFiltersMock = new Proxy({}, {
    get: () => webpackGenericNoop
});
const webpackMock = new Proxy({
    getByProps: webpackGenericNoop,
    getByKeys: webpackGenericNoop,
    getByName: webpackGenericNoop,
    getBySource: webpackGenericNoop,
    getByStrings: webpackGenericNoop,
    getByDisplayName: webpackGenericNoop,
    getByRegex: webpackGenericNoop,
    getById: webpackGenericNoop,
    getAllModules: () => [],
    getModule: webpackGenericNoop,
    getStore: webpackGenericNoop,
    getAllByKeys: () => [],
    getAllBySource: () => [],
    getWithKey: () => [],
    getModuleByProps: webpackGenericNoop,
    getMangled: () => ({}),
    getBulk: () => [],
    getBySourceLazy: webpackGenericNoop,
    getAllByProps: () => [],
    getLazy: webpackGenericNoop,
    lazy: webpackGenericNoop,
    Filters: webpackFiltersMock,
    webpackRequire: {},
    Stores: {},
    findModuleId: webpackGenericNoop,
    getDefault: webpackGenericNoop
}, {
    get: (target, property) => {
        return Reflect.get(target, property) ?? webpackGenericNoop;
    }
});

const electronModule = {
    "ipcRenderer": {},
    "shell": {
        openPath: async (): Promise<string> => {
            if (openPathBehavior === "ok") return "";
            if (openPathBehavior === "error") return "open failed";
            throw new Error("open rejected");
        }
    },
    "default": {
        shell: {
            openPath: async (): Promise<string> => {
                if (openPathBehavior === "ok") return "";
                if (openPathBehavior === "error") return "open failed";
                throw new Error("open rejected");
            }
        }
    }
};

const fsModule = {
    existsSync: (filename: string) => fsFiles.has(filename),
    mkdirSync: () => {},
    writeFileSync: (filename: string, data: string) => {
        fsFiles.set(filename, {content: String(data), mtime: nextMtime()});
        writeFileCallCount++;
    },
    readFileSync: (filename: string) => {
        const fileEntry = fsFiles.get(filename);
        if (!fileEntry) throw new Error("ENOENT");
        return Buffer.from(fileEntry.content);
    },
    statSync: (filename: string) => {
        const fileEntry = fsFiles.get(filename);
        if (!fileEntry) throw Object.assign(new Error("ENOENT"), {code: "ENOENT"});
        return {mtimeMs: fileEntry.mtime};
    },
    watch: (filename: string, options: WatchOptions, callback: WatchCallback) => {
        void filename;
        void options;
        void callback;

        watchCount++;
        activeWatcherCount++;
        maxWatcherCount = Math.max(maxWatcherCount, activeWatcherCount);
        return {
            close: () => {
                if (activeWatcherCount === 0) return;
                activeWatcherCount--;
                closeWatchCount++;
            }
        };
    }
};

// Bun 1.1.20 does not consistently route built-in default imports through
// mock.module(). This harness runs in an isolated subprocess, so replacing the
// shared fs methods here cannot leak into the main test process.
Object.assign(nodeFs as unknown as Record<string, unknown>, fsModule);

mock.module("@stores/config", () => ({"default": {get: (key: string) => key === "channelPath" ? "/tmp/bd-customcss-tests" : ""}}));
mock.module("@modules/emitter", () => ({
    "default": {
        on: (event: string, listener: Listener) => {
            const listeners = eventListeners.get(event) ?? new Set();
            listeners.add(listener);
            eventListeners.set(event, listeners);
            return () => {listeners.delete(listener);};
        },
        emit: (...args: unknown[]) => {
            const [event, ...rest] = args as [string, ...unknown[]];
            const listeners = eventListeners.get(event) ?? new Set();
            for (const listener of listeners) {
                listener(...rest);
            }
        }
    }
}));
mock.module("@modules/patcher", () => ({"default": {
    before: () => () => {},
    instead: () => () => {},
    after: () => () => {},
    unpatchAll: () => {}
}}));
mock.module("@modules/commandmanager", () => ({"default": {
    registerCommand: () => () => {}
}}));
mock.module("@modules/dommanager", () => ({"default": {updateCustomCSS: (css: string) => insertedCss.push(css)}}));
mock.module("@stores/toasts", () => ({"default": {error: (message: string) => toastErrors.push(String(message))}}));
mock.module("@common/logger", () => ({"default": {debug: () => {}, info: () => {}, log: () => {}, warn: () => {}, stacktrace: () => {}, err: () => {}}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@common/utils", () => ({
    clone: (value: Record<string, unknown>) => value,
    cloneObject: (value: Record<string, unknown>) => value,
    getKeys: () => [],
    formatString: () => "",
    getNestedProp: () => undefined,
    parseJsDoc: () => ({}),
    extend: (a: unknown, b: unknown) => ({...a as Record<string, unknown>, ...b as Record<string, unknown>}),
    debounce: (callback: () => unknown) => callback,
    memoize: (callback: () => unknown) => callback,
    findInTree: () => null
}));
mock.module("@ui/settings/title", () => ({
    "default": () => ({}),
    "SettingsTitlePublisher": () => ({})
}));
mock.module("@ui/settings", () => ({
    "default": {
        openSettingsPage: () => settingsOpenCalls++,
        closeUserSettingsModal: () => settingsCloseCalls++
    },
    "SettingsTitleContext": {}
}));
mock.module("@ui/floatingwindows", () => ({
    "default": {
        open: (config: FloatingWindowConfig) => floatingWindowsOpen.push(config),
        close: (id: string) => floatingWindowsClose.push(id)
    }
}));
mock.module("@ui/customcss/csseditor", () => ({"default": class {}}));
mock.module("@polyfill/remote", () => ({"default": {editor: {open: () => {}}}}));
mock.module("electron", () => electronModule);
mock.module("node:electron", () => electronModule);
mock.module("fs", () => ({...fsModule, "default": fsModule}));
mock.module("node:fs", () => ({...fsModule, "default": fsModule}));
mock.module("@webpack", () => webpackMock);
mock.module(webpackPath, () => webpackMock);
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module(modulesPath, () => ({"default": {}}));
mock.module(modulesPath.replace(/\.ts$/, ""), () => ({"default": {}}));
mock.module("@stores/settings", () => ({
    "default": {
        get: (collection: string, category: string, id: string) => {
            if (collection !== "settings" || category !== "customcss") return false;
            if (id === "customcss" || id === "liveUpdate" || id === "openAction") {
                return settings[id as keyof typeof settings];
            }

            return false;
        },
        on: () => () => {},
        registerPanel: (id: string) => {
            activePanelCount++;
            activePanelCalls++;
            maxActivePanelCount = Math.max(maxActivePanelCount, activePanelCount);
            void id;
        },
        removePanel: (id: string) => {
            activePanelCount = Math.max(0, activePanelCount - 1);
            removePanelCalls++;
            void id;
        }
    }
}));

const {default: CustomCSS} = await import(path.join(import.meta.dir, "../../../src/betterdiscord/builtins/customcss"));

fsFiles.set(file, {content: initialCSS, mtime: nextMtime()});

await CustomCSS.initialize();
CustomCSS.addChangeListener(() => refreshCount++);

await waitForSettled();

assert(CustomCSS.file === file, "The CustomCSS file path came from configured channelPath.");

if (initialCustomcssEnabled) {
    assert(activePanelCount === 1, "Initially enabled should register one settings panel.");
    assert(watchCount === 1, "Initially enabled should start one watcher.");
    assert(activeWatcherCount === 1, "Initially enabled should have one active watcher.");
    assert(insertedCss.includes(initialCSS), "Initially enabled should load CSS from file.");
}
else {
    assert(activePanelCount === 0, "Initially disabled should not have registered its settings panel.");
    assert(watchCount === 0, "Initially disabled should not start a file watcher.");
    assert(insertedCss.length === 0, "Initially disabled should not apply CSS.");
}

if (!initialCustomcssEnabled) {
    setSetting("customcss", true);
    emitSettingUpdated("settings", "customcss", "customcss", true);
    await waitForSettled();
    assert(activePanelCount === 1, "Enable should register one settings panel.");
    assert(activePanelCalls === 1, "Enable should call SettingsStore.registerPanel once.");
    assert(watchCount === 1, "Enable should start one watcher.");
    assert(activeWatcherCount === 1, "Enable should have one active watcher.");
    assert(insertedCss.includes(initialCSS), "Enable should load CSS from file.");
}

const refreshAfterEnable = refreshCount;
setSetting("customcss", false);
emitSettingUpdated("settings", "customcss", "customcss", false);
await waitForSettled();
assert(refreshCount > refreshAfterEnable, "Setting updates should emit refresh notifications.");
assert(activePanelCount === 0, "Disable should unregister the settings panel.");
assert(removePanelCalls === 1, "Disable should call SettingsStore.removePanel once.");
assert(activeWatcherCount === 0, "Disable should close the watcher.");
assert(closeWatchCount === 1, "Disable should close the active watcher.");
assert(insertedCss.at(-1) === "", "Disable should clear applied CSS.");

const writesBeforeOnChange = writeFileCallCount;
CustomCSS.onChange("retained-change");
assert(writeFileCallCount === writesBeforeOnChange + 1, "onChange should still save while disabled when live update is enabled.");
assert(insertedCss.at(-1) === "", "onChange while disabled should not apply CSS.");

setSetting("customcss", true);
emitSettingUpdated("settings", "customcss", "customcss", true);
await waitForSettled();
assert(activePanelCount === 1, "Re-enable should result in one active settings panel.");
assert(activePanelCalls === 2, "Re-enable should register panel exactly once.");
assert(watchCount === 2, "Re-enable should start one new watcher.");
assert(closeWatchCount === 1, "Re-enable should not duplicate watcher close calls.");
assert(activeWatcherCount === 1, "Re-enable should have exactly one active watcher.");
assert(maxActivePanelCount === 1, "Panel registration should never exceed one active entry.");
assert(maxWatcherCount === 1, "Watcher count should never exceed one active entry.");
assert(insertedCss.at(-1) === "retained-change", "Re-enable should apply CSS saved while the main toggle was disabled.");

setSetting("liveUpdate", false);
const writesBeforeDisabledLiveUpdate = writeFileCallCount;
CustomCSS.onChange("ignored-live-update");
assert(insertedCss.at(-1) !== "ignored-live-update", "Live Update disabled should not apply edit changes.");
assert(writeFileCallCount === writesBeforeDisabledLiveUpdate, "Live Update disabled should not save edit changes.");

setSetting("liveUpdate", true);
CustomCSS.onChange(".changed {}");
assert(insertedCss.at(-1) === ".changed {}", "Live Update enabled should apply edit changes.");
assert(writeFileCallCount > writesBeforeOnChange, "Live Update enabled should save changed CSS.");

openPathBehavior = "ok";
assert(await CustomCSS.openNative(), "openNative should report success for empty Electron result.");
assert(toastErrors.length === 0, "Successful openPath should not show toasts.");

openPathBehavior = "error";
assert(!await CustomCSS.openNative(), "openNative should return false on non-empty Electron result.");
assert(toastErrors.includes("open failed"), "openNative non-empty result should surface a toast.");

openPathBehavior = "reject";
assert(!await CustomCSS.openNative(), "openNative should return false on rejected openPath.");
assert(toastErrors.at(-1) === "open rejected", "openNative rejection should toast the thrown message.");

CustomCSS.openDetached(".detached");
assert(floatingWindowsOpen.length === 1, "Detached open should open one floating window.");
const detachedOpenNative = floatingWindowsOpen[0]?.children?.props?.openNative;
assert(typeof detachedOpenNative === "function", "Detached open should provide openNative handler.");
openPathBehavior = "ok";
await detachedOpenNative!();
assert(floatingWindowsClose.includes("floating-editor-window"), "Detached openNative success should close the floating editor.");
const closeCountOnSuccess = floatingWindowsClose.length;
openPathBehavior = "error";
await detachedOpenNative!();
assert(floatingWindowsClose.length === closeCountOnSuccess, "Detached openNative failure should not close the floating editor.");
assert(settingsCloseCalls === 1, "Detached open should close settings.");
assert(settingsOpenCalls === 0, "Detached open should not open settings page.");

emitSettingUpdated("settings", "customcss", "customcss", false);
await waitForSettled();
assert(activePanelCount === 0, "Final disable should unregister remaining panel.");
assert(activeWatcherCount === 0, "Final disable should close remaining watcher.");

const result = {
    initial: initialCustomcssEnabled ? "enabled" : "disabled",
    panelCalls: {register: activePanelCalls, remove: removePanelCalls},
    watchers: {started: watchCount, closed: closeWatchCount},
    settingsRefreshes: refreshCount,
    toastErrors
};

process.stdout.write(`customcss-lifecycle: ok ${JSON.stringify(result)}\n`);
