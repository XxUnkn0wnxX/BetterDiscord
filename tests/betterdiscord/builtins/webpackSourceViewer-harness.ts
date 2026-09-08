import {mock} from "bun:test";

const settings: Record<string, boolean> = {
    devTools: true,
    webpackSourceViewer: true
};
const protocolListeners: Array<(link: string) => void> = [];
type SettingListener = {id: string; callback: (value: boolean) => void;};
const settingListeners: SettingListener[] = [];
const ipcCalls: Array<[string, number, number]> = [];
const stacktraces: string[] = [];
let retained = 0;
let released = 0;
let rejectIPC = false;

class MockBuiltin {
    get<T>(id: string) {
        return settings[id] as T;
    }

    stacktrace(message: string, error: Error) {
        stacktraces.push(`${message}: ${error.message}`);
    }

    async initialize() {
        settingListeners.push({
            id: "webpackSourceViewer",
            callback: (value: boolean) => {
                if (value) void this.enable();
                else void this.disable();
            }
        });

        if (settings.webpackSourceViewer) await this.enable();
    }

    async enable() {
        await this.enabled();
    }

    async disable() {
        await this.disabled();
    }

    async enabled() {}
    async disabled() {}
}

const builtinModule = () => ({"default": MockBuiltin});
const builtinPath = import.meta.resolve("../../../src/betterdiscord/structs/builtin");
mock.module("@structs/builtin", builtinModule);
mock.module(builtinPath, builtinModule);

mock.module("@polyfill/remote", () => ({"default": {
    addProtocolListener: (callback: (link: string) => void) => {
        protocolListeners.push(callback);
        process.nextTick(() => callback("betterdiscord://betterdiscord/webpack-modules/patched/0/192.js#1:2"));
    }
}}));
mock.module("@stores/settings", () => ({"default": {
    on: (_collection: string, _category: string, id: string, callback: (value: boolean) => void) => {
        settingListeners.push({id, callback});
        return () => {};
    }
}}));
mock.module("@modules/ipc", () => ({"default": {
    openDevtoolsSource: (url: string, line: number, column: number) => {
        ipcCalls.push([url, line, column]);
        if (rejectIPC) return Promise.reject(new Error("devtools unavailable"));
        return Promise.resolve();
    }
}}));
mock.module("@utils/betterdiscordprotocol", () => ({
    retainBetterDiscordProtocol: () => {
        retained++;
        let releasedThisOwner = false;
        return () => {
            if (releasedThisOwner) return;
            releasedThisOwner = true;
            released++;
        };
    }
}));

const {default: viewer} = await import("../../../src/betterdiscord/builtins/developer/webpackSourceViewer");

const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
};

const triggerSetting = async (id: string, value: boolean) => {
    settings[id] = value;
    const listeners = settingListeners.filter(listener => listener.id === id);
    assert(listeners.length === 1, `Expected one ${id} setting listener, found ${listeners.length}.`);
    for (const listener of listeners) listener.callback(value);
    await Promise.resolve();
};

await viewer.initialize();
await viewer.initialize();
assert(protocolListeners.length === 1, "Protocol listener was not registered exactly once.");
assert(settingListeners.filter(listener => listener.id === "devTools").length === 1, "DevTools listener was duplicated.");
assert(settingListeners.filter(listener => listener.id === "webpackSourceViewer").length === 1, "Base setting listener was duplicated.");
assert(retained === 1, "Startup did not acquire the protocol with both settings enabled.");

await new Promise<void>(resolve => process.nextTick(resolve));
assert(ipcCalls.length === 1 && ipcCalls[0][0] === "betterdiscord://betterdiscord/webpack-modules/patched/0/192.js"
    && ipcCalls[0][1] === 1 && ipcCalls[0][2] === 2, "Launch URL was not dispatched after initialization.");

protocolListeners[0]("betterdiscord://betterdiscord/webpack-modules/patched/0/192.js?line=2&column=20");
protocolListeners[0]("betterdiscord://store/192");
protocolListeners[0]("betterdiscord://betterdiscord/webpack-modules/original/0.js");
await Promise.resolve();
assert(ipcCalls.length === 2 && ipcCalls[1][0] === "betterdiscord://betterdiscord/webpack-modules/patched/0/192.js"
    && ipcCalls[1][1] === 2 && ipcCalls[1][2] === 20, "Viewer dispatched the wrong source request.");

await triggerSetting("devTools", false);
await triggerSetting("webpackSourceViewer", false);
assert(released === 1, "Turning both settings off did not release the protocol.");
const callsWhileOff = ipcCalls.length;
protocolListeners[0]("betterdiscord://betterdiscord/webpack-modules/patched/0/192.js#3:4");
await Promise.resolve();
assert(ipcCalls.length === callsWhileOff, "Viewer dispatched a link while both settings were off.");

await triggerSetting("devTools", true);
assert(retained === 1, "Viewer acquired the protocol while its setting was disabled.");
await triggerSetting("webpackSourceViewer", true);
assert(retained === 2, "Viewer did not reacquire the protocol after both settings were enabled.");

rejectIPC = true;
protocolListeners[0]("betterdiscord://betterdiscord/webpack-modules/patched/0/192.js#3:4");
await Promise.resolve();
await Promise.resolve();
assert(stacktraces.some(message => message.includes("devtools unavailable")), "IPC rejection was not handled through stacktrace.");

await triggerSetting("devTools", false);
assert(released === 2, "DevTools disable did not release the viewer protocol owner.");

process.stdout.write("webpack-source-viewer: ok\n");
