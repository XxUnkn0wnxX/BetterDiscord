import {describe, expect, test} from "bun:test";
import {EventEmitter} from "node:events";
import {runInNewContext} from "node:vm";
import type {WebContents} from "electron";

import {inspectElement, openDevtoolsSource, waitForDevTools} from "../../src/electron/main/modules/devtools";

const source = "betterdiscord://betterdiscord/webpack-modules/patched/0/192.js";

class FakeWebContents extends EventEmitter {
    destroyed = false;
    opened = false;
    openCalls = 0;
    devToolsWebContents: FakeWebContents | null = null;
    scripts: string[] = [];
    calls: unknown[][] = [];
    api: Record<string, (...args: unknown[]) => void> = {
        revealSourceLine: (...args) => {this.calls.push(args);},
        enterInspectElementMode: (...args) => {this.calls.push(args);}
    };
    onOpen: () => void = () => {this.becomeReady();};
    execute: (script: string) => Promise<unknown> = async script => runInNewContext(script, {DevToolsAPI: this.api});

    isDestroyed() {return this.destroyed;}
    isDevToolsOpened() {return this.opened;}
    openDevTools() {
        this.openCalls++;
        this.onOpen();
    }
    executeJavaScript(script: string) {
        this.scripts.push(script);
        return this.execute(script);
    }
    becomeReady() {
        this.opened = true;
        this.devToolsWebContents = new FakeWebContents();
        this.emit("devtools-opened");
        return this.devToolsWebContents;
    }
}

const webContents = (value: FakeWebContents) => value as unknown as WebContents;
const expectNoWaiters = (sender: FakeWebContents) => {
    for (const event of ["devtools-opened", "devtools-closed", "destroyed"]) expect(sender.listenerCount(event)).toBe(0);
};

describe("DevTools operation readiness", () => {
    test("supports synchronously opened and already open DevTools without leaking listeners", async () => {
        const sender = new FakeWebContents();
        expect(await waitForDevTools(webContents(sender))).toBe(webContents(sender.devToolsWebContents!));
        expect(sender.openCalls).toBe(1);
        expect(await waitForDevTools(webContents(sender))).toBe(webContents(sender.devToolsWebContents!));
        expect(sender.openCalls).toBe(1);
        expectNoWaiters(sender);
    });

    test("waits for the owner event when DevTools opens asynchronously", async () => {
        const sender = new FakeWebContents();
        sender.onOpen = () => {};
        const pending = waitForDevTools(webContents(sender));
        expect(sender.listenerCount("devtools-opened")).toBe(1);
        const contents = sender.becomeReady();
        expect(await pending).toBe(webContents(contents));
        expectNoWaiters(sender);
    });

    test("settles and removes listeners on close, owner destruction, timeout and open failure", async () => {
        for (const event of ["devtools-closed", "destroyed"]) {
            const sender = new FakeWebContents();
            sender.onOpen = () => {};
            const pending = waitForDevTools(webContents(sender));
            sender.emit(event);
            await expect(pending).rejects.toThrow("closed before becoming ready");
            expectNoWaiters(sender);
        }

        const stalled = new FakeWebContents();
        stalled.onOpen = () => {};
        await expect(waitForDevTools(webContents(stalled), 5)).rejects.toThrow("Timed out");
        expectNoWaiters(stalled);

        const failed = new FakeWebContents();
        failed.onOpen = () => {throw new Error("open failed");};
        await expect(waitForDevTools(webContents(failed))).rejects.toThrow("open failed");
        expectNoWaiters(failed);

        const destroyed = new FakeWebContents();
        destroyed.destroyed = true;
        await expect(waitForDevTools(webContents(destroyed))).rejects.toThrow("window has closed");
        expect(destroyed.openCalls).toBe(0);
        expectNoWaiters(destroyed);
    });

    test("does not execute in a closed or replaced DevTools owner after readiness", async () => {
        const sender = new FakeWebContents();
        const contents = sender.becomeReady();
        const operation = openDevtoolsSource(webContents(sender), source, 1, 2);
        sender.devToolsWebContents = null;
        await expect(operation).rejects.toThrow("closed before the operation");
        expect(contents.scripts).toHaveLength(0);
    });
});

describe("DevTools source IPC boundary", () => {
    test("passes only canonical source URL and numeric coordinates as data", async () => {
        const sender = new FakeWebContents();
        await openDevtoolsSource(webContents(sender), `${source}?line=7#8:9`, 2, 20);
        expect(sender.devToolsWebContents!.calls).toEqual([[source, 2, 20]]);
        await inspectElement(webContents(sender));
        expect(sender.devToolsWebContents!.calls).toEqual([[source, 2, 20], []]);
        expect(sender.openCalls).toBe(1);
        expectNoWaiters(sender);
    });

    test("rejects malformed IPC values before opening DevTools or executing source", async () => {
        const sender = new FakeWebContents();
        for (const coordinate of ["0); throw new Error(42); //", {}, null, undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            await expect(openDevtoolsSource(webContents(sender), source, coordinate, 0)).rejects.toThrow("safe integers");
            await expect(openDevtoolsSource(webContents(sender), source, 0, coordinate)).rejects.toThrow("safe integers");
        }
        for (const url of [undefined, {}, "https://example.com", "betterdiscord://store/42"]) {
            await expect(openDevtoolsSource(webContents(sender), url, 0, 0)).rejects.toThrow("source URL");
        }
        expect(sender.openCalls).toBe(0);
        expect(sender.devToolsWebContents).toBeNull();
    });

    test("reports missing internal DevTools API and execution rejection", async () => {
        const sender = new FakeWebContents();
        const contents = sender.becomeReady();
        contents.api = {};
        await expect(openDevtoolsSource(webContents(sender), source, 0, 0)).rejects.toThrow("does not support revealSourceLine");
        await expect(inspectElement(webContents(sender))).rejects.toThrow("does not support enterInspectElementMode");
        contents.execute = async () => {throw new Error("execution rejected");};
        await expect(openDevtoolsSource(webContents(sender), source, 0, 0)).rejects.toThrow("execution rejected");
    });

    test("awaits command execution before completing the IPC operation", async () => {
        const sender = new FakeWebContents();
        const contents = sender.becomeReady();
        let complete!: (value: unknown) => void;
        contents.execute = () => new Promise(resolve => {complete = resolve;});
        let settled = false;
        const operation = openDevtoolsSource(webContents(sender), source, 0, 0).then(() => {settled = true;});
        await Promise.resolve();
        expect(settled).toBe(false);
        complete(true);
        await operation;
        expect(settled).toBe(true);
    });
});
