import {expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {transformSync} from "esbuild";

// Execute the production initializer with inert Electron/preload boundaries.
const source = fs.readFileSync(path.join(import.meta.dir, "../../src/electron/preload/init.ts"), "utf8");
const compiled = transformSync(source, {loader: "ts", format: "cjs"}).code;
const backgroundChannel = "DISCORD_SETTINGS_UPDATE_BACKGROUND_COLOR";

function initialize(withOriginalPreload = false) {
    const events: string[] = [];
    const calls: Array<{receiver: unknown; args: unknown[]}> = [];
    const result = {sent: true};
    const failure = new Error("send failed");
    const originalKill = () => false;
    const fakeProcess = {env: {BD_DISCORD_PRELOAD: withOriginalPreload ? "original-preload" : undefined}, kill: originalKill};
    const ipc = {
        send(this: unknown, ...args: unknown[]) {
            calls.push({receiver: this, args});
            events.push(`send:${args[0]}`);
            if (args[0] === "THROW") throw failure;
            return result;
        }
    };
    const module = {exports: {} as {default: () => void}};
    vm.runInNewContext(compiled, {
        module,
        exports: module.exports,
        __dirname: "/test/bd",
        process: fakeProcess,
        require(id: string) {
            if (id === "electron") {
                return {
                    ipcRenderer: ipc,
                    webFrame: {top: {
                        executeJavaScript(code: string) {
                            events.push("early-renderer");
                            expect(code).toContain("early fixture");
                            return Promise.resolve();
                        }
                    }}
                };
            }
            if (id === "fs") return {readFileSync: () => "/* early fixture */"};
            if (id === "path") return path;
            if (id === "@common/constants/ipcevents") return {REGISTER_PRELOAD: "REGISTER_PRELOAD"};
            if (id === "original-preload") {
                events.push("original-preload");
                expect(fakeProcess.kill()).toBe(true);
                ipc.send(backgroundChannel, "#123456", "original caller");
                return {};
            }
            throw new Error(`Unexpected preload dependency: ${id}`);
        }
    });
    module.exports.default();
    return {ipc, events, calls, result, failure, fakeProcess, originalKill};
}

test("rewrites only the exact background channel and preserves receiver, arguments and return value", () => {
    const {ipc, calls, result} = initialize();
    const receiver = {window: "fixture"};
    const extra = {retained: true};
    expect(ipc.send.call(receiver, backgroundChannel, "#123456", extra)).toBe(result);
    expect(calls[0]).toEqual({receiver, args: [backgroundChannel, "#00000000", extra]});
    expect(calls[0].args[2]).toBe(extra);
    ipc.send("UNRELATED", "#abcdef", extra);
    ipc.send(`${backgroundChannel}_OTHER`, "#abcdef");
    expect(calls[1]).toEqual({receiver: ipc, args: ["UNRELATED", "#abcdef", extra]});
    expect(calls[2].args).toEqual([`${backgroundChannel}_OTHER`, "#abcdef"]);
});

test("preserves original IPC errors", () => {
    const {ipc, failure} = initialize();
    expect(() => ipc.send("THROW")).toThrow(failure);
});

test("installs before original preload while preserving registration, early renderer and kill restoration", () => {
    const {events, calls, fakeProcess, originalKill} = initialize(true);
    expect(events).toEqual(["early-renderer", "send:REGISTER_PRELOAD", "original-preload", `send:${backgroundChannel}`]);
    expect(calls[0].args).toEqual(["REGISTER_PRELOAD", "original-preload"]);
    expect(calls[1].args).toEqual([backgroundChannel, "#00000000", "original caller"]);
    expect(fakeProcess.kill).toBe(originalKill);
});
