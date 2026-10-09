import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import path from "node:path";
import React from "react";
import parseJsDoc from "../../../src/common/utils/jsdoc";
import type {Plugin} from "@modules/pluginmanager";

const files = new Map<string, string>();
const errors: Error[] = [];
const loggedErrors: string[] = [];
const eventNames: string[] = [];
const handlers = new Map<string, Set<(...args: any[]) => void>>();
const editorCloses: string[] = [];
const savedStates: Array<Record<string, boolean>> = [];
const observers: CountedObserver[] = [];
let counters: {evaluations: number; constructions: number; starts: number; stops: number; removed: string[]; meta: any[]; order: string[]; mutations: string[]; switches: string[]};

class CountedObserver {
    disconnected = false;
    target?: Node;
    options?: MutationObserverInit;
    constructor(private callback: MutationCallback) {
        observers.push(this);
        counters.order.push("observer:create");
    }
    observe(target: Node, options: MutationObserverInit) {this.target = target; this.options = options; counters.order.push("observer:observe");}
    disconnect() {this.disconnected = true; counters.order.push("observer:disconnect");}
    emit(...mutations: MutationRecord[]) {this.callback(mutations, this as unknown as MutationObserver);}
}
Object.assign(globalThis, {MutationObserver: CountedObserver});

mock.module("fs", () => ({"default": {
    readFileSync: (filename: string) => files.get(path.basename(filename)),
    statSync: () => ({atimeMs: 1, mtimeMs: 2, size: 3}),
    existsSync: (filename: string) => files.has(path.basename(filename))
}}));
mock.module("@stores/config", () => ({"default": {get: () => "/virtual/plugins"}}));
mock.module("@common/logger", () => ({"default": {
    log: () => {},
    debug: () => {},
    warn: () => {},
    stacktrace: (_scope: string, message: string) => {loggedErrors.push(message);}
}}));
mock.module("@stores/toasts", () => ({"default": {show: () => {}, success: () => {}, warning: () => {}, error: () => {}}}));
mock.module("@stores/settings", () => ({"default": {get: () => false, registerAddonPanel: () => {}}}));
mock.module("@stores/json", () => ({"default": {get: () => undefined, set: (_file: string, state: Record<string, boolean>) => {savedStates.push({...state});}}}));
mock.module("@common/i18n", () => ({t: (key: string, options?: {method?: string}) => options?.method ?? key}));
mock.module("@common/utils", () => ({parseJsDoc}));
mock.module("@ui/modals", () => ({"default": {showAddonError: (error: Error) => {errors.push(error);}}}));
mock.module("@ui/misc/addoneditor", () => ({"default": () => null}));
mock.module("@ui/floatingwindows", () => ({"default": {isOpened: () => false, close: () => {}}}));
mock.module("@polyfill/remote", () => ({"default": {editor: {close: (_type: string, filename: string) => {editorCloses.push(filename);}}}}));
mock.module(import.meta.resolve("../../../src/betterdiscord/modules/ipc"), () => ({"default": {}}));
mock.module(import.meta.resolve("../../../src/betterdiscord/modules/react"), () => ({"default": React}));
mock.module(import.meta.resolve("../../../src/betterdiscord/modules/emitter"), () => ({"default": {
    on: (event: string, callback: (...args: any[]) => void) => {
        const listeners = handlers.get(event) ?? new Set();
        listeners.add(callback);
        handlers.set(event, listeners);
    },
    emit: (event: string, ...args: any[]) => {
        eventNames.push(event);
        for (const callback of handlers.get(event) ?? []) callback(...args);
    }
}}));

// Only filesystem/UI/runtime services are mocked. Parsing and all manager state/lifecycle methods are real.
const {default: singleton} = await import("../../../src/betterdiscord/modules/pluginmanager");
const {default: AddonAPI} = await import("../../../src/betterdiscord/api/addonapi");
let manager: typeof singleton;
const Manager = singleton.constructor as new () => typeof singleton;

const removedMethods = ["load", "getName", "getAuthor", "getDescription", "getVersion"].map(name => `${name}() {c.removed.push("${name}"); throw new Error("removed method was invoked");}`);
function body({factory = false, start = "", stop = "", observe = false, callbacksThrow = false} = {}) {
    const methods = [
        `start() {c.starts++; c.order.push("start:" + meta.name); ${start}}`,
        `stop() {c.stops++; c.order.push("stop:" + meta.name); ${stop}}`,
        ...removedMethods,
        observe ? `observer(m) {c.mutations.push(meta.name); ${callbacksThrow ? "throw new Error('observer failed');" : ""}}` : "",
        `onSwitch() {c.switches.push(meta.name); ${callbacksThrow ? "throw new Error('switch failed');" : ""}}`
    ].filter(Boolean).join(factory ? ",\n" : "\n");
    return `const c = window.__pluginLifecycle; c.evaluations++;
module.exports = ${factory
    ? `(meta) => {c.constructions++; c.meta.push(meta); return {${methods}};}`
    : `class {constructor(meta) {c.constructions++; c.meta.push(meta); this.meta = meta;}
        ${methods.replaceAll("meta.name", "this.meta.name")}}`};`;
}
function read(name: string, code = body(), {filename = `${name}.plugin.js`, minimal = false, runAt = "connection"} = {}) {
    files.set(filename, `/**\n * @name ${name}\n${minimal ? "" : " * @author Header Author\n * @description Header Description\n * @version 1.0.0\n"} * @runAt ${runAt}\n */\n${code}`);
    expect(manager.readAddon(filename)).toBe(true);
    return manager.resolveAddon(filename)!;
}

beforeEach(() => {
    files.clear(); errors.length = 0; loggedErrors.length = 0; eventNames.length = 0; handlers.clear(); editorCloses.length = 0; savedStates.length = 0;
    counters = {evaluations: 0, constructions: 0, starts: 0, stops: 0, removed: [], meta: [], order: [], mutations: [], switches: []};
    (window as any).__pluginLifecycle = counters;
    observers.length = 0;
    manager = new Manager();
});
afterEach(() => {
    for (const addon of manager.addonList) if (manager.state[addon.id]) manager.disableAddon(addon);
    expect(observers.every(observer => observer.disconnected)).toBe(true);
});

describe("PluginManager supported lifecycle", () => {
    test("keeps disabled ordinary, BDFDB and Zeres plugins metadata-only and honors load points", () => {
        const disabled = ["Ordinary.plugin.js", "0BDFDB.plugin.js", "0PluginLibrary.plugin.js"].map(filename => read(filename, body(), {filename}));
        const idle = read("Idle", body(), {runAt: "idle"});
        manager.state[idle.id] = true;
        manager.startAddons("connection");
        expect(counters.evaluations).toBe(0);
        expect(disabled.every(addon => !addon.instance && !addon.exports && Boolean(addon.fileContent))).toBe(true);
        expect(observers).toHaveLength(0);
        manager.startAddons("idle");
        expect(counters.starts).toBe(1);
        expect(manager.hasInitialized).toBe(true);
        expect(manager.enableAddon(disabled[0])).toBe(true);
        expect(counters.evaluations).toBe(2);
        expect(counters.constructions).toBe(2);
        expect(counters.removed).toEqual([]);
    });

    test("constructs class/factory exports with parsed metadata and never invokes removed methods", () => {
        for (const factory of [false, true]) {
            const addon = read(factory ? "Factory" : "Class", body({factory}));
            expect(manager.enableAddon(addon)).toBe(true);
            const meta = counters.meta.at(-1);
            expect(meta).not.toBe(addon);
            expect("exports" in meta).toBe(false);
            expect([addon.name, addon.author, addon.description, addon.version]).toEqual([factory ? "Factory" : "Class", "Header Author", "Header Description", "1.0.0"]);
        }
        const fallback = read("Fallback", body(), {minimal: true});
        expect(manager.enableAddon(fallback)).toBe(true);
        expect([fallback.author, fallback.description, fallback.version]).toEqual(["Addons.unknownAuthor", "Addons.noDescription", "???"]);
        const api = new AddonAPI(manager);
        const typedPlugin: Plugin | undefined = api.get("Fallback");
        expect(typedPlugin).toBe(fallback);
        expect(api.getAll()).toContain(fallback);
        expect(counters.removed).toEqual([]);
        expect(errors).toEqual([]);
    });

    test("rejects non-callable lifecycle shapes through the real partial/state path", () => {
        for (const methods of ["start: true, stop() {}", "start() {}, stop: 'truthy'"]) {
            const addon = read(methods.startsWith("start:") ? "BadStart" : "BadStop", `module.exports = () => ({${methods}});`);
            expect(manager.enableAddon(addon)).toBe(false);
            expect(addon.partial).toBe(true);
            expect(manager.state[addon.id]).toBe(false);
            expect(addon.instance).toBeUndefined();
        }
        expect(errors.map(error => error.message)).toEqual(["Missing start or stop function.", "Missing start or stop function."]);
        expect(observers).toHaveLength(0);
    });

    test("a failed start disables the plugin without acquiring observation", () => {
        const addon = read("FailStart", body({observe: true, start: "throw new Error('start failed');"}));
        expect(manager.enableAddon(addon)).toBe(false);
        expect(addon.instance).toBeDefined();
        expect(manager.state[addon.id]).toBe(false);
        expect(addon.hasObserver).toBeUndefined();
        expect(observers).toHaveLength(0);
        expect(eventNames).not.toContain("plugin-started");
        expect(errors.map(error => error.message)).toEqual(["start()"]);
        expect(savedStates.at(-1)?.FailStart).toBe(false);
    });

    test("disable/re-enable retains the instance while real reload evaluates and constructs a replacement", () => {
        const addon = read("Lifetime");
        expect(manager.enableAddon(addon)).toBe(true);
        const instance = addon.instance;
        expect(manager.disableAddon(addon)).toBe(true);
        expect(manager.enableAddon(addon)).toBe(true);
        expect(addon.instance).toBe(instance);
        expect(counters.evaluations).toBe(1);
        expect(counters.constructions).toBe(1);
        expect(counters.starts).toBe(2);
        expect(counters.stops).toBe(1);
        files.set(addon.filename, files.get(addon.filename)!.replace("@version 1.0.0", "@version 2.0.0"));
        expect(manager.reloadAddon(addon)).toBe(true);
        const replacement = manager.resolveAddon("Lifetime")!;
        expect(replacement).not.toBe(addon);
        expect(replacement.instance).not.toBe(instance);
        expect(replacement.version).toBe("2.0.0");
        expect(manager.state.Lifetime).toBe(true);
        expect(counters.evaluations).toBe(2);
        expect(counters.constructions).toBe(2);
        expect(counters.starts).toBe(3);
        expect(counters.stops).toBe(2);
        expect(editorCloses).toEqual([addon.filename]);
        expect(eventNames).toContain("plugin-unloaded");
    });

    test("acquires after start, shares two users and releases the last observer before a throwing stop", () => {
        const first = read("First", body({start: "this.observer = () => {};"}));
        const second = read("Second", body({observe: true, stop: "throw new Error('stop failed');"}));
        expect(observers).toHaveLength(0);
        expect(manager.enableAddon(first)).toBe(true);
        expect(counters.order).toEqual(["start:First", "observer:create", "observer:observe"]);
        expect(first.hasObserver).toBe(true);
        expect(observers[0].target).toBe(document);
        expect(observers[0].options).toEqual({childList: true, subtree: true});
        expect(manager.enableAddon(second)).toBe(true);
        expect(observers).toHaveLength(1);
        expect(manager.disableAddon(first)).toBe(true);
        expect(observers[0].disconnected).toBe(false);
        expect(manager.disableAddon(second)).toBe(false);
        expect(observers[0].disconnected).toBe(true);
        expect(counters.order.slice(-2)).toEqual(["observer:disconnect", "stop:Second"]);
        expect(manager.state.Second).toBe(false);
        expect(errors.map(error => error.message)).toEqual(["stop()"]);
        expect(manager.enableAddon(first)).toBe(true);
        expect(observers).toHaveLength(2);
    });

    test("observer and navigation callback exceptions do not prevent delivery to enabled peers", () => {
        const bad = read("Bad", body({observe: true, callbacksThrow: true}));
        const good = read("Good", body({observe: true}));
        read("Disabled", body({observe: true}));
        manager.enableAddon(bad);
        manager.enableAddon(good);
        manager.setupFunctions();
        const mutation = {type: "childList"} as MutationRecord;
        observers[0].emit(mutation, mutation);
        for (const callback of handlers.get("navigate")!) callback();
        expect(counters.mutations).toEqual(["Bad", "Good", "Bad", "Good"]);
        expect(counters.switches).toEqual(["Bad", "Good"]);
        expect(loggedErrors.filter(message => message.startsWith("Unable to fire observer"))).toHaveLength(2);
        expect(loggedErrors.filter(message => message.startsWith("Unable to fire onSwitch"))).toHaveLength(1);
    });
});
