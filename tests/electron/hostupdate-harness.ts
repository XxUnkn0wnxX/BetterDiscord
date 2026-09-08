import assert from "node:assert/strict";
import {mock} from "bun:test";
import {EventEmitter} from "events";
import fs from "fs";
import os from "os";
import path from "path";


async function run() {
    const scenario = process.argv[2];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "betterdiscord-host-update-"));

    try {
        const platform = scenario === "darwin" ? "darwin" : scenario === "unsupported" ? "aix" : "linux";
        const plainVersion = scenario === "plain-version";
        const currentDirectoryName = plainVersion ? "1.0.0" : "app-1.0.0";
        const latestDirectoryName = plainVersion ? "2.0.0" : "app-2.0.0";
        const currentBase = path.join(root, currentDirectoryName);
        const currentResources = path.join(currentBase, "resources");
        const latestResources = path.join(root, latestDirectoryName, "resources");
        const userData = path.join(root, "user-data");
        const marker = {
            schema: 1,
            owner: "betterdiscord",
            style: "app-wrapper",
            channel: "stable",
            mode: "release",
            loader: "index.js",
            payload: "../betterdiscord.app.asar",
            bdPath: "/fixture/betterdiscord.asar",
            installationId: "test-installation",
        } as const;

        fs.mkdirSync(path.join(currentResources, "app"), {recursive: true});
        fs.writeFileSync(path.join(currentResources, "app", ".betterdiscord-inject.json"), `${JSON.stringify(marker)}\n`);
        fs.writeFileSync(path.join(currentResources, "app", "index.js"), "// __betterdiscord_inject_meta__\nmodule.exports = require(\"../betterdiscord.app.asar\");\n");
        fs.writeFileSync(path.join(currentResources, "betterdiscord.app.asar"), "existing BetterDiscord payload");
        fs.mkdirSync(latestResources, {recursive: true});

        if (scenario === "foreign-layout") {
            fs.mkdirSync(path.join(latestResources, "app"));
            fs.writeFileSync(path.join(latestResources, "app", "foreign.js"), "foreign Discord app");
        }
        else {
            fs.writeFileSync(path.join(latestResources, "app.asar"), "fresh Discord payload");
            if (scenario === "ambiguous-layout") fs.mkdirSync(path.join(latestResources, "app"));
        }

        if (scenario === "migration-failure") {
            fs.rmSync(path.join(currentResources, "app", "index.js"));
            fs.mkdirSync(path.join(currentResources, "app", "index.js"));
        }

        const appListeners = new Map<string, Array<() => void>>();
        const app = {
            getPath(name: string) {
                assert.equal(name, "userData");
                return userData;
            },
            on(name: string, listener: () => void) {
                const listeners = appListeners.get(name) ?? [];
                listeners.push(listener);
                appListeners.set(name, listeners);
                return app;
            },
        };
        const autoUpdater = {on: () => autoUpdater};

        mock.module("electron", () => ({app, autoUpdater}));
        Object.defineProperty(process, "platform", {configurable: true, value: platform});
        Object.defineProperty(process, "resourcesPath", {configurable: true, value: currentResources});
        Object.defineProperty(process, "execPath", {configurable: true, value: path.join(currentBase, "Discord")});

        const originalEmit = EventEmitter.prototype.emit;
        await import("../../src/electron/main/migrator");

        if (platform !== "linux") {
            assert.equal(EventEmitter.prototype.emit, originalEmit);
            if (platform === "darwin") {
                assert.equal(appListeners.get("before-quit")?.length, 1);
                assert.equal(autoUpdater.on instanceof Function, true);
            }
            return;
        }

        assert.notEqual(EventEmitter.prototype.emit, originalEmit);
        const emitter = new EventEmitter();
        let listenerCalls = 0;
        const received: unknown[] = [];
        emitter.on("host-updated", (...args) => {
            listenerCalls++;
            received.push(...args);
        });
        const targetApp = path.join(latestResources, "app");
        const emitHostUpdated = () => emitter.emit("host-updated", "payload", 7);

        if (scenario === "failed-publish") {
            const writableFs = fs as unknown as {writeFileSync: (...args: unknown[]) => unknown};
            const originalWriteFileSync = writableFs.writeFileSync;
            writableFs.writeFileSync = (...args) => {
                if (String(args[0]).includes(".betterdiscord-app-") && String(args[0]).endsWith(`${path.sep}index.js`)) {
                    throw new Error("publish failed");
                }
                return Reflect.apply(originalWriteFileSync, fs, args);
            };
            try {assert.equal(emitHostUpdated(), true);}
            finally {writableFs.writeFileSync = originalWriteFileSync;}
        }
        else {
            assert.equal(emitHostUpdated(), true);
        }
        assert.equal(listenerCalls, 1);
        assert.deepEqual(received, ["payload", 7]);

        if (scenario === "migration-failure") return;

        if (scenario === "failed-publish") {
            assert.equal(fs.existsSync(path.join(latestResources, "app.asar")), true);
            assert.equal(fs.existsSync(path.join(latestResources, "betterdiscord.app.asar")), false);
            assert.equal(fs.existsSync(targetApp), false);
            return;
        }

        if (scenario === "foreign-layout" || scenario === "ambiguous-layout") {
            assert.equal(fs.existsSync(path.join(latestResources, "app.asar")), scenario === "ambiguous-layout");
            assert.equal(fs.existsSync(path.join(latestResources, "betterdiscord.app.asar")), false);
            assert.equal(fs.existsSync(path.join(targetApp, scenario === "foreign-layout" ? "foreign.js" : "")), true);
            return;
        }

        if (scenario === "repeat-and-before-quit") {
            const firstWrapper = fs.readFileSync(path.join(targetApp, "index.js"), "utf8");
            emitter.emit("host-updated");
            assert.equal(fs.readFileSync(path.join(targetApp, "index.js"), "utf8"), firstWrapper);
            const beforeQuit = appListeners.get("before-quit") ?? [];
            assert.equal(beforeQuit.length, 1);
            beforeQuit[0]();
            assert.equal(fs.readFileSync(path.join(targetApp, "index.js"), "utf8"), firstWrapper);
            assert.equal(fs.existsSync(path.join(latestResources, "app.asar")), false);
            assert.equal(fs.existsSync(path.join(latestResources, "betterdiscord.app.asar")), true);
            return;
        }

        assert.equal(fs.existsSync(path.join(targetApp, "index.js")), true);
        assert.equal(fs.existsSync(path.join(targetApp, ".betterdiscord-inject.json")), true);
        assert.equal(fs.existsSync(path.join(latestResources, "betterdiscord.app.asar")), true);
        assert.equal(fs.existsSync(path.join(latestResources, "app.asar")), false);
    }
    finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
}

await run();
