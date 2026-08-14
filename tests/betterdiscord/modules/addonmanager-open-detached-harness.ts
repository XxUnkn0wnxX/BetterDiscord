import {mock} from "bun:test";
import fs from "node:fs";
import path from "node:path";

import type {Addon} from "@typed/addon";

const elementNodeType = 1;
const detachedTarget = {nodeType: elementNodeType} as Element;
let activeElement: Element | null = detachedTarget;
Object.assign(globalThis, {
    Node: {ELEMENT_NODE: elementNodeType},
    document: {
        get activeElement() {return activeElement;}
    }
});

type FloatingWindowConfig = {
    id?: string;
    children?: {
        props?: {
            autoFocusAfterElementRemoved?: Element | null;
        };
    };
};
type SettingsValues = {
    editAction: "system" | "detached" | "external";
};
type EventTag = "floating-open" | "floating-close" | "settings-close" | "system-open" | "external-open";

const events: EventTag[] = [];
const settingsValues: SettingsValues = {editAction: "detached"};
let floatingOpenCount = 0;
let floatingOpenConfigs: FloatingWindowConfig[] = [];
let systemOpenCalls = 0;
let externalOpenCalls = 0;
let systemEditOpened = false;
let externalEditOpened = false;

const testDir = path.join("/tmp", `bd-addonmanager-open-detached-tests-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
const addonFile = "test-addon.test.js";
const systemAddonFile = "system-open.test.js";
const externalAddonFile = "external-open.test.js";
const defaultAddonFile = "default-open.test.js";

const clearState = () => {
    events.length = 0;
    floatingOpenCount = 0;
    floatingOpenConfigs = [];
    systemOpenCalls = 0;
    externalOpenCalls = 0;
};

const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message);
};

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);
mock.module(modulePath("react.ts"), () => ({
    "default": {
        createRef: () => ({current: undefined}),
        createElement: (_: unknown, props?: unknown) => ({props})
    }
}));
mock.module(modulePath("emitter.ts"), () => ({
    "default": {
        on: () => () => {},
        emit: () => {},
        dispatch: () => {}
    }
}));
mock.module("@common/logger", () => ({"default": {debug: () => {}, info: () => {}, log: () => {}, warn: () => {}, stacktrace: () => {}, err: () => {}}}));
mock.module("@stores/json", () => ({"default": {get: () => undefined, set: () => {}}}));
mock.module("@stores/toasts", () => ({"default": {show: () => {}}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module(modulePath("ipc.ts"), () => ({
    "default": {
        openPath: (filename: string) => {
            if (filename === path.join(testDir, systemAddonFile)) systemOpenCalls++;
            return filename;
        }
    }
}));
mock.module("@polyfill/remote", () => ({
    "default": {
        editor: {
            open: (_prefix: "plugin" | "theme", filename: string) => {
                if (filename === externalAddonFile) externalOpenCalls++;
                return {filename};
            }
        }
    }
}));
mock.module("@ui/floatingwindows", () => ({
    "default": {
        open: (config: FloatingWindowConfig) => {
            events.push("floating-open");
            floatingOpenCount++;
            floatingOpenConfigs.push(config);
        },
        close: (id: string) => {
            events.push("floating-close");
            void id;
        }
    }
}));
mock.module("@ui/misc/addoneditor", () => ({"default": () => null}));
mock.module("@ui/modals", () => ({"default": {showAddonError: () => {}}}));
mock.module("@common/utils", () => ({
    parseJsDoc: () => ({}),
    clone: (value: Record<string, unknown>) => value,
    cloneObject: (value: Record<string, unknown>) => value,
    getKeys: () => [],
    formatString: () => "",
    getNestedProp: () => undefined,
    extend: (a: unknown, b: unknown) => ({...a as Record<string, unknown>, ...b as Record<string, unknown>}),
    debounce: (callback: () => unknown) => callback,
    memoize: (callback: () => unknown) => callback,
    findInTree: () => null
}));
mock.module("@stores/settings", () => ({
    "default": {
        get: (collection: string, _category: string, id: string) => {
            if (collection !== "settings") return false;
            if (id === "addons" || id === "editAction") {
                return id === "editAction" ? settingsValues.editAction : false;
            }
            return false;
        },
        registerAddonPanel: () => {}
    }
}));

const {default: AddonManager} = await import("../../../src/betterdiscord/modules/addonmanager");

const writeFile = (filename: string, contents: string) => fs.writeFileSync(path.join(testDir, filename), contents);
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, {recursive: true});

const createManager = () => {
    clearState();
    class TestAddonManager extends AddonManager<Addon> {
        name = "TestAddonManager";
        extension = ".test.js";
        duplicatePattern = /\.test\s?\([0-9]+\)\.js/;
        addonFolder = testDir;
        language = "javascript";
        prefix = "plugin" as const;
        order = 1;
        initAddon = () => true;

        startAddon(_idOrAddon: string | Addon) {
            void _idOrAddon;
            return true;
        }

        stopAddon(_idOrAddon: string | Addon) {
            void _idOrAddon;
            return true;
        }
    }

    return new TestAddonManager();
};

writeFile(addonFile, "console.log('primary')");
writeFile(systemAddonFile, "console.log('system')");
writeFile(externalAddonFile, "console.log('external')");
writeFile(defaultAddonFile, "console.log('default')");

const makeAddon = (filename: string): Addon => ({
    added: 1,
    author: "Unit Test",
    authorId: "1",
    authorLink: "",
    description: "Test addon",
    filename,
    fileContent: "",
    id: filename,
    format: "javascript",
    modified: 1,
    name: filename,
    size: 1,
    slug: filename.replace(".test.js", ""),
    version: "1.0.0"
});

const primaryAddon = makeAddon(addonFile);
const systemAddon = makeAddon(systemAddonFile);
const externalAddon = makeAddon(externalAddonFile);
const defaultAddon = makeAddon(defaultAddonFile);

const detachedManager = createManager();
const onSettingsClose = () => {
    events.push("settings-close");
};

try {
    activeElement = detachedTarget;

    detachedManager.openDetached(primaryAddon, onSettingsClose);
    assert(events[0] === "floating-open", "Detached editor open should call FloatingWindows.open first.");
    assert(events[1] === "settings-close", "Detached editor open should close settings immediately after opening.");
    assert(floatingOpenConfigs[0]?.id === "bd-floating-window-test-addon.test.js", "Detached editor open should use a stable floating-window id.");
    assert(floatingOpenConfigs[0]?.children?.props?.autoFocusAfterElementRemoved === detachedTarget, "Detached open with settings callback should pass active element.");

    detachedManager.openDetached(primaryAddon, onSettingsClose);
    assert(floatingOpenCount === 1, "Duplicate detached open should not reopen a floating window.");
    assert(events.length === 2, "Duplicate detached open should perform neither floating open nor settings close.");

    const callbackDetachedManager = createManager();
    callbackDetachedManager.openDetached(systemAddon, onSettingsClose);
    assert(floatingOpenConfigs[0]?.children?.props?.autoFocusAfterElementRemoved === detachedTarget, "Callback-based detached open should capture focused element from onDetachedOpen context.");

    const detachedManagerNoCallback = createManager();
    detachedManagerNoCallback.openDetached(systemAddon);
    assert(floatingOpenConfigs[0]?.children?.props?.autoFocusAfterElementRemoved === undefined, "openDetached without onDetachedOpen should use immediate autofocus mode.");

    const systemManager = createManager();
    systemManager.editAddon(systemAddon, "system", onSettingsClose);
    assert(systemOpenCalls === 1, "System mode should still call ipc.openPath.");
    assert(events.every(event => event !== "settings-close"), "System mode should not close the settings modal.");
    assert(floatingOpenCount === 0, "System mode should not open a floating window.");
    systemEditOpened = systemOpenCalls === 1;

    const externalManager = createManager();
    externalManager.editAddon(externalAddon, "external", onSettingsClose);
    assert(externalOpenCalls === 1, "External mode should still call remote editor launcher.");
    assert(events.every(event => event !== "settings-close"), "External mode should not close the settings modal.");
    assert(floatingOpenCount === 0, "External mode should not open a floating window.");
    externalEditOpened = externalOpenCalls === 1;

    settingsValues.editAction = "detached";
    const defaultManager = createManager();
    defaultManager.editAddon(defaultAddon, undefined, onSettingsClose);
    assert(floatingOpenCount === 1, "Default edit action that resolves to detached should open one floating editor.");
    assert(events.at(-1) === "settings-close", "Detached default edit action should close settings after opening.");

    process.stdout.write(`addonmanager-open-detached: ok ${JSON.stringify({
        primaryOrder: events.slice(0, 2),
        duplicateCallsBlocked: floatingOpenCount === 1 && systemEditOpened && externalEditOpened
    })}\n`);
}
finally {
    if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, {recursive: true, force: true});
    }
}
