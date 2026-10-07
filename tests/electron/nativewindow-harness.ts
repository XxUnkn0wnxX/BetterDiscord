import assert from "node:assert/strict";
import {mock} from "bun:test";
import fs from "fs";
import path from "path";
import {runInNewContext} from "node:vm";

import * as IPCEvents from "../../src/common/constants/ipcevents";

interface Scenario {
    mode: "ipc" | "constructor" | "preload" | "appSettings" | "security";
    platform?: NodeJS.Platform;
    release?: string;
    missing?: "vibrancy" | "material";
    target?: "null" | "destroyed";
    request?: "vibrancy" | "material" | "minimum";
    value?: string | null;
    throws?: boolean;
    applies?: boolean;
    dimensions?: [number, number];
    settings?: Record<string, unknown>;
    nativeFrame?: boolean;
    transparency?: boolean;
    effect?: "vibrancy" | "material";
}

const scenario: Scenario = JSON.parse(process.argv[2]);
Object.defineProperty(process, "platform", {configurable: true, value: scenario.platform ?? "darwin"});
let osReads = 0;
function release() {
    assert.equal(process.platform, "win32", "OS release should only be read on Windows");
    osReads++;
    return scenario.release ?? "10.0.22621";
}

function runSource(source: string, context: Record<string, unknown>) {
    const compiled = new Bun.Transpiler({loader: "ts", define: {__dirname: JSON.stringify(context.__dirname ?? "")}}).transformSync(source);
    return runInNewContext(compiled, context);
}

// Bun 1.1.20 cannot replace the built-in os module with mock.module. Execute the
// actual private helper with an isolated release getter instead.
const helperSource = fs.readFileSync(path.join(import.meta.dir, "../../src/electron/main/modules/nativewindow.ts"), "utf8")
    .replace(/^import .+;\r?\n/gm, "").replace(/^export /gm, "");
const native = {} as typeof import("../../src/electron/main/modules/nativewindow");
runSource(`${helperSource}\nObject.assign(native, {supportsVibrancy, supportsBackgroundMaterial});`, {native, process, release});
mock.module("../../src/electron/main/modules/nativewindow", () => native);

const calls: unknown[][] = [];
const handlers = new Map<string,(...args: any[]) => unknown>();
const listeners = new Map<string,(...args: any[]) => unknown>();
const settings = scenario.settings ?? {};
let allowPreloadOverride = false;
const betterDiscord = {
    getSetting: (_category: string, key: string) => settings[key],
    setup: (window: unknown) => {calls.push(["setup", window]);},
    clientModCompatibility: {
        shouldShow: () => false,
        allowPreloadOverride: () => allowPreloadOverride,
    }
};
const editor = {initialize: (window: unknown) => {calls.push(["editor", window]);}};
let lastWindow: FakeWindow;
class FakeWindow {
    background = "#123456";
    destroyed = false;
    closed = false;
    options: any;
    webContents = {
        setWindowOpenHandler: (_handler: unknown) => {},
        on: (event: string, handler: (...args: unknown[]) => void) => {this.events.set(event, handler);},
    };
    events = new Map<string,(...args: unknown[]) => void>();

    constructor(options: unknown) {
        this.options = options;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastWindow = this;
    }
    static fromWebContents() {
        if (scenario.target === "null") return null;
        return target;
    }
    isDestroyed() {return this.destroyed;}
    setMinimumSize(width: number, height: number) {calls.push(["minimum", width, height]);}
    setVibrancy(value: string | null, options: unknown) {
        calls.push(["vibrancy", value, options]);
        if (scenario.throws) throw new Error("native effect failed");
    }
    setBackgroundMaterial(value: string) {
        calls.push(["material", value]);
        if (scenario.throws) throw new Error("native effect failed");
    }
    setBackgroundColor(value: string) {
        calls.push(["background", value]);
        this.background = value;
    }
    close() {this.closed = true;}
    loadURL(_url: string) {this.events.get("did-navigate")?.({}, "https://example.com/close");}
}
if (scenario.missing === "vibrancy") Reflect.deleteProperty(FakeWindow.prototype, "setVibrancy");
if (scenario.missing === "material") Reflect.deleteProperty(FakeWindow.prototype, "setBackgroundMaterial");
const target = new FakeWindow({});
target.destroyed = scenario.target === "destroyed";
target.setMinimumSize = () => {throw new Error("Discord instance override should be bypassed");};
const electron = {
    BrowserWindow: FakeWindow,
    ipcMain: {
        on: (event: string, handler: (...args: any[]) => unknown) => {listeners.set(event, handler);},
        handle: (event: string, handler: (...args: any[]) => unknown) => {handlers.set(event, handler);},
    },
    app: {},
    dialog: {},
    shell: {},
};
mock.module("electron", () => ({"default": electron, ...electron}));
mock.module("../../src/electron/main/modules/betterdiscord", () => ({"default": betterDiscord}));
mock.module("../../src/electron/main/modules/editor", () => ({"default": editor}));

if (scenario.mode === "ipc" || scenario.mode === "security") {
    const {default: IPCMain} = await import("../../src/electron/main/modules/ipc");
    IPCMain.registerEvents();
    assert.equal(handlers.has(IPCEvents.EDITOR_CLOSE), true);
    assert.equal(handlers.has(IPCEvents.OPEN_DEVTOOLS_SOURCE), true);
    assert.equal(handlers.has(IPCEvents.SET_VIBRANCY), true);
    assert.equal(handlers.has(IPCEvents.SET_BACKGROUND_MATERIAL), true);
    const event = {sender: {}};

    if (scenario.mode === "security") {
        await handlers.get(IPCEvents.OPEN_WINDOW)!(event, "https://example.com", {
            closeOnUrl: "https://example.com/close",
            windowOptions: {
                width: 900,
                webPreferences: {
                    preload: "/unsafe/preload.js",
                    nodeIntegration: true,
                    nodeIntegrationInWorker: true,
                    nodeIntegrationInSubFrames: true,
                    contextIsolation: false,
                    sandbox: false,
                    webviewTag: true,
                    webSecurity: false,
                    allowRunningInsecureContent: true,
                }
            }
        });
        assert.equal(lastWindow!.closed, true);
        assert.equal(lastWindow!.options.width, 900);
        assert.deepEqual(lastWindow!.options.webPreferences, {
            preload: undefined,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            contextIsolation: true,
            sandbox: true,
            webviewTag: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
        });
        await assert.rejects(Promise.resolve(handlers.get(IPCEvents.OPEN_WINDOW)!(event, "file:///unsafe")));
    }
    else if (scenario.request === "minimum") {
        listeners.get(IPCEvents.MINIMUM_SIZE)!(event, ...(scenario.dimensions ?? [0, 0]));
        assert.deepEqual(calls, scenario.target ? [] : [["minimum", ...(scenario.dimensions ?? (process.platform === "darwin" ? [1, 1] : [0, 0]))]]);
    }
    else {
        const endpoint = scenario.request === "material" ? IPCEvents.SET_BACKGROUND_MATERIAL : IPCEvents.SET_VIBRANCY;
        const operation = Promise.resolve().then(() => handlers.get(endpoint)!(event, scenario.value));
        if (scenario.throws) await assert.rejects(operation, /native effect failed/);
        else await operation;

        const effectCall = scenario.request === "material"
            ? ["material", scenario.value]
            : ["vibrancy", scenario.value === "none" ? null : scenario.value, {animationDuration: 100}];
        assert.deepEqual(calls, scenario.throws ? [effectCall] : scenario.applies ? [effectCall, ["background", "#00000000"]] : []);
        assert.equal(target.background, scenario.applies && !scenario.throws ? "#00000000" : "#123456");
    }
}
else if (scenario.mode === "constructor") {
    const source = fs.readFileSync(path.join(import.meta.dir, "../../src/electron/main/modules/browserwindow.ts"), "utf8");
    const privateClass = source.slice(0, source.indexOf("\nObject.assign(BrowserWindow"))
        .replace(/^import .+;\r?\n/gm, "");
    const context = {
        electron,
        path,
        BetterDiscord: betterDiscord,
        Editor: editor,
        IPCEvents,
        isProxy: () => false,
        ...native,
        process,
        __dirname: "/fixture/main",
        result: {} as {PatchedBrowserWindow: new (options: any) => FakeWindow & {__originalPreload: string;};},
    };
    runSource(`${privateClass}\nresult.PatchedBrowserWindow = BrowserWindow;`, context);
    const options: any = {
        title: "Discord",
        frame: false,
        titleBarStyle: "hidden",
        trafficLightPosition: {x: 1, y: 2},
        backgroundColor: "#123456",
        webPreferences: {preload: "/discord/preload.js"},
    };
    const window = new context.result.PatchedBrowserWindow(options);
    assert.equal(window.options, options);
    assert.equal(window.__originalPreload, "/discord/preload.js");
    assert.equal(options.webPreferences.preload, "/fixture/main/preload.js");
    options.webPreferences.preload = "/other/preload.js";
    assert.equal(options.webPreferences.preload, "/fixture/main/preload.js");
    allowPreloadOverride = true;
    options.webPreferences.preload = "/allowed/preload.js";
    assert.equal(options.webPreferences.preload, "/allowed/preload.js");
    assert.equal(options.frame, scenario.nativeFrame ?? false);
    assert.equal(options.titleBarStyle, scenario.nativeFrame ? "default" : "hidden");
    assert.equal("trafficLightPosition" in options, !scenario.nativeFrame);
    assert.equal(process.env.BETTERDISCORD_NATIVE_FRAME, String(scenario.nativeFrame ?? false));
    assert.equal(process.env.BETTERDISCORD_IN_APP_TRAFFIC_LIGHTS, undefined);
    assert.equal(options.backgroundColor, scenario.effect || scenario.transparency ? "#00000000" : "#123456");
    assert.equal(options.transparent, scenario.transparency ? true : undefined);
    assert.equal(options.vibrancy, scenario.effect === "vibrancy" ? settings.vibrancy : undefined);
    assert.equal(options.visualEffectState, scenario.effect === "vibrancy" ? settings.visualEffectState || "followWindow" : undefined);
    assert.equal(options.backgroundMaterial, scenario.effect === "material" ? settings.backgroundMaterial : undefined);
    assert.equal(options.acceptFirstMouse, process.platform === "darwin" && settings.acceptFirstMouse ? true : undefined);
    assert.equal(options.roundedCorners, settings.roundedCorners === false ? false : undefined);
    assert.deepEqual(calls.map(call => call[0]), ["setup", "editor"]);
    if (settings.removeMinimumSize) {
        assert.equal(options.minWidth, 0);
        assert.equal(options.minHeight, 0);
        window.setMinimumSize(800, 500);
        assert.equal(calls.length, 2);
    }
    const untouched = {backgroundColor: "#abc"};
    const untouchedWindow = new context.result.PatchedBrowserWindow(untouched);
    assert.equal(untouchedWindow.options, untouched);
    assert.deepEqual(untouched, {backgroundColor: "#abc"});
    assert.equal(calls.length, 2);
}
else if (scenario.mode === "preload") {
    const exposed: unknown[][] = [];
    const source = fs.readFileSync(path.join(import.meta.dir, "../../src/electron/preload/discordnativepatch.ts"), "utf8");
    const bridgeSource = source.slice(0, source.indexOf("\nclass DiscordNativePatch"))
        .replace(/^import .+;\r?\n/gm, "");
    const context = {
        electron: {
            ipcRenderer: {sendSync: () => "/fixture/userData"},
            contextBridge: {exposeInMainWorld: (...args: unknown[]) => {exposed.push(args);}},
        },
        path,
        IPCEvents,
        process,
        require: () => ({developer: {devToolsWarning: false}}),
        result: {} as {bridge: {exposeInMainWorld: (key: string, api: unknown) => void;};},
    };
    runSource(`${bridgeSource}\nresult.bridge = contextBridge;`, context);
    for (const nativeLights of [true, false]) {
        let callbacks: Array<() => void> = [];
        const api = {window: {
            USE_OSX_NATIVE_TRAFFIC_LIGHTS: nativeLights,
            setDevtoolsCallbacks: (...args: Array<() => void>) => {callbacks = args;},
        }};
        context.result.bridge.exposeInMainWorld("DiscordNative", api);
        assert.equal(api.window.USE_OSX_NATIVE_TRAFFIC_LIGHTS, nativeLights);
        let opened = 0, closed = 0;
        api.window.setDevtoolsCallbacks(() => {opened++;}, () => {closed++;});
        callbacks[0]();
        callbacks[1]();
        assert.deepEqual([opened, closed], [1, 1]);
        assert.deepEqual(exposed.at(-1), ["DiscordNative", api]);
    }
}
else if (scenario.mode === "appSettings") {
    const source = fs.readFileSync(path.join(import.meta.dir, "../../src/electron/main/modules/betterdiscord.ts"), "utf8");
    const globalObject: {appSettings?: unknown;} = {};
    runSource(source.slice(source.indexOf("Object.defineProperty(global, \"appSettings\"")), {
        global: globalObject, BetterDiscord: betterDiscord,
    });
    const values = new Map<string, unknown>();
    globalObject.appSettings = {set: (name: string, value: unknown) => {values.set(name, value);}};
    assert.equal(values.get("MIN_WIDTH"), settings.removeMinimumSize ? 0 : 800);
    assert.equal(values.get("MIN_HEIGHT"), settings.removeMinimumSize ? 0 : 500);
    assert.equal(values.get("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING"), true);
}

if (process.platform !== "win32" || scenario.missing === "material" || scenario.target) assert.equal(osReads, 0);
