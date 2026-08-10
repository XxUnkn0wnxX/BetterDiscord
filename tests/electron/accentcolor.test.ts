import {describe, expect, test} from "bun:test";

import {createAccentColorController, createAccentColorChangeSubscription, resolveAccentColor, DEFAULT_ACCENT_COLOR} from "../../src/electron/main/accentcolor";

type AccentColorChangeListener = (event: unknown, accentColor: string) => void;

type Deferred = {
    promise: Promise<string>;
    resolve: (value: string) => void;
    reject: (reason: unknown) => void;
};

function createDeferred(): Deferred {
    let resolve: (value: string) => void = () => {};
    let reject: (reason: unknown) => void = () => {};

    const promise = new Promise<string>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return {promise, resolve, reject};
}

class FakeAccentSource {
    private listeners = new Set<AccentColorChangeListener>();

    on(listener: AccentColorChangeListener) {
        this.listeners.add(listener);
    }

    off(listener: AccentColorChangeListener) {
        this.listeners.delete(listener);
    }

    emit(accentColor: string) {
        [...this.listeners].forEach(listener => listener({}, accentColor));
    }

    get listenerCount() {
        return this.listeners.size;
    }
}

class FakeWebContents {
    public insertCalls: string[] = [];
    public removeCalls: string[] = [];

    private destroyedState = false;
    private pendingInserts: Array<Deferred & {styleKey: string}> = [];
    private domReadyHandlers = new Set<() => void>();
    private destroyedHandlers = new Set<() => void>();
    private insertCounter = 0;
    private removeFail = false;
    public nextInsertReject = false;
    public autoResolveInsert = true;

    isDestroyed() {
        return this.destroyedState;
    }

    on(event: "dom-ready" | "destroyed", listener: () => void) {
        if (event === "destroyed") {
            this.destroyedHandlers.add(listener);
            return;
        }

        this.domReadyHandlers.add(listener);
    }

    removeListener(event: "dom-ready" | "destroyed", listener: () => void) {
        if (event === "destroyed") {
            this.destroyedHandlers.delete(listener);
            return;
        }

        this.domReadyHandlers.delete(listener);
    }

    emitDomReady() {
        for (const handler of [...this.domReadyHandlers]) {
            handler();
        }
    }

    destroy() {
        if (this.destroyedState) return;

        this.destroyedState = true;
        for (const handler of [...this.destroyedHandlers]) {
            handler();
        }
    }

    insertCSS(css: string) {
        this.insertCalls.push(css);

        if (this.nextInsertReject) {
            this.nextInsertReject = false;
            return Promise.reject(new Error("insert-css-rejected"));
        }

        const deferred = createDeferred();
        const styleKey = `accent-${++this.insertCounter}`;
        this.pendingInserts.push({...deferred, styleKey});

        if (this.autoResolveInsert) {
            deferred.resolve(styleKey);
        }

        return deferred.promise;
    }

    removeInsertedCSS(styleKey: string) {
        this.removeCalls.push(styleKey);

        if (this.removeFail) {
            this.removeFail = false;
            return Promise.reject(new Error("remove-css-rejected"));
        }

        return Promise.resolve();
    }

    resolveNextInsert() {
        const pending = this.pendingInserts.shift();
        if (!pending) throw new Error("No pending insert to resolve");
        pending.resolve(pending.styleKey);
    }

    failNextRemove() {
        this.removeFail = true;
    }
}

type AccentNotificationListener = () => void;

class FakeSystemPreferences {
    private eventListeners = new Set<AccentColorChangeListener>();
    private notificationListeners = new Map<number, AccentNotificationListener>();
    private notificationId = 1;
    private notificationName: string | null = null;
    private subscribedIds: number[] = [];
    private unsubscribedIds: number[] = [];
    public notificationSubscribeError = false;

    on(event: "accent-color-changed", listener: AccentColorChangeListener) {
        if (event === "accent-color-changed") this.eventListeners.add(listener);
    }

    removeListener(event: "accent-color-changed", listener: AccentColorChangeListener) {
        if (event === "accent-color-changed") this.eventListeners.delete(listener);
    }

    subscribeNotification(name: string, listener: AccentNotificationListener) {
        if (this.notificationSubscribeError) throw new Error("notification-subscribe-failed");

        const subscriptionId = this.notificationId++;
        this.notificationName = name;
        this.subscribedIds.push(subscriptionId);
        this.notificationListeners.set(subscriptionId, listener);
        return subscriptionId;
    }

    unsubscribeNotification(id: number) {
        this.unsubscribedIds.push(id);
        this.notificationListeners.delete(id);
    }

    emitEvent(accentColor: string) {
        for (const listener of [...this.eventListeners]) {
            listener({}, accentColor);
        }
    }

    emitNotification() {
        for (const listener of [...this.notificationListeners.values()]) {
            listener();
        }
    }

    get eventListenerCount() {
        return this.eventListeners.size;
    }

    get subscribedNotificationName() {
        return this.notificationName;
    }

    get subscribedNotificationId() {
        return this.subscribedIds.at(-1);
    }

    get unsubscribedNotificationIds() {
        return this.unsubscribedIds;
    }
}

function createController({
    webContents,
    accentSource,
    getSystemAccentColor,
    getEnvironmentAccentColor,
}: {
    webContents: FakeWebContents;
    accentSource: FakeAccentSource;
    getSystemAccentColor: () => string;
    getEnvironmentAccentColor?: () => string;
}) {
    return createAccentColorController({
        webContents,
        subscribeAccentColorChanges: listener => {
            accentSource.on(listener);
            return () => accentSource.off(listener);
        },
        getEnvironmentAccentColor: getEnvironmentAccentColor ?? (() => ""),
        getSystemAccentColor,
    });
}

describe("resolveAccentColor", () => {
    test("uses non-empty BD_ACCENT_COLOR first", () => {
        expect(resolveAccentColor({
            getEnvironmentAccentColor: () => "aa11ff",
            getSystemAccentColor: () => "00ff00",
        })).toBe("#aa11ff");
        expect(resolveAccentColor({
            getEnvironmentAccentColor: () => "#bb22cc",
            getSystemAccentColor: () => "00ff00",
        })).toBe("#bb22cc");
    });

    test("accepts OS accent color with and without #", () => {
        expect(resolveAccentColor({
            getEnvironmentAccentColor: () => "",
            getSystemAccentColor: () => "ff00aa",
        })).toBe("#ff00aa");
        expect(resolveAccentColor({
            getEnvironmentAccentColor: () => "",
            getSystemAccentColor: () => "#11aacc",
        })).toBe("#11aacc");
    });

    test("falls back for empty or broken OS accent lookup", () => {
        expect(resolveAccentColor({
            getEnvironmentAccentColor: () => "",
            getSystemAccentColor: () => "",
        })).toBe(DEFAULT_ACCENT_COLOR);
        expect(resolveAccentColor({
            getEnvironmentAccentColor: () => "",
            getSystemAccentColor: () => {throw new Error("bad accent lookup");},
        })).toBe(DEFAULT_ACCENT_COLOR);
    });
});

describe("OS accent CSS controller", () => {
    test("inserts initial value after dom-ready", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();
        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "1a2b3c",
        });

        webContents.emitDomReady();
        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([":root {--os-accent-color: #1a2b3c;}"]);
        controller.dispose();
    });

    test("coalesces pre-dom ready events into first startup insert", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();
        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "111111",
        });

        accentSource.emit("eeff00");
        webContents.emitDomReady();
        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([":root {--os-accent-color: #eeff00;}"]);
        expect(accentSource.listenerCount).toBe(1);
        controller.dispose();
    });

    test("replaces accent css live with latest color", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();

        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "111111",
        });

        webContents.emitDomReady();
        await controller.waitForIdle();
        accentSource.emit("222222");
        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([
            ":root {--os-accent-color: #111111;}",
            ":root {--os-accent-color: #222222;}"
        ]);
        expect(webContents.removeCalls).toEqual(["accent-1"]);
        controller.dispose();
    });

    test("re-reads the current OS color for a wake-only mac notification", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();
        let systemAccentColor = "111111";
        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => systemAccentColor,
        });

        webContents.emitDomReady();
        await controller.waitForIdle();

        systemAccentColor = "445566";
        accentSource.emit("");
        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([
            ":root {--os-accent-color: #111111;}",
            ":root {--os-accent-color: #445566;}"
        ]);
        controller.dispose();
    });

    test("replaces only with latest in-flight event without dropping updates", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();
        webContents.autoResolveInsert = false;

        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "111111",
        });

        webContents.emitDomReady();
        accentSource.emit("222222");
        accentSource.emit("333333");

        webContents.resolveNextInsert();
        await Bun.sleep(0);
        webContents.resolveNextInsert();

        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([
            ":root {--os-accent-color: #111111;}",
            ":root {--os-accent-color: #333333;}"
        ]);
        expect(webContents.removeCalls).toEqual(["accent-1"]);
        controller.dispose();
    });

    test("recovers from insert/remove failure and keeps working", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();

        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "111111",
        });

        webContents.emitDomReady();
        await controller.waitForIdle();

        webContents.nextInsertReject = true;
        accentSource.emit("222222");
        await controller.waitForIdle();

        accentSource.emit("333333");
        webContents.failNextRemove();
        await controller.waitForIdle();

        accentSource.emit("444444");
        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([
            ":root {--os-accent-color: #111111;}",
            ":root {--os-accent-color: #222222;}",
            ":root {--os-accent-color: #333333;}",
            ":root {--os-accent-color: #444444;}",
        ]);
        expect(webContents.removeCalls).toEqual([
            "accent-1",
            "accent-1",
            "accent-2",
        ]);
        controller.dispose();
    });

    test("stops listening and blocks updates after dispose", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();

        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "111111",
        });

        controller.dispose();

        accentSource.emit("222222");
        webContents.emitDomReady();

        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([]);
        expect(accentSource.listenerCount).toBe(0);
    });

    test("reapplies accent css on every dom-ready", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();
        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "111111",
        });

        webContents.emitDomReady();
        await controller.waitForIdle();

        webContents.emitDomReady();
        await controller.waitForIdle();

        expect(webContents.insertCalls).toEqual([
            ":root {--os-accent-color: #111111;}",
            ":root {--os-accent-color: #111111;}"
        ]);
        expect(webContents.removeCalls).toEqual(["accent-1"]);
        controller.dispose();
    });

    test("resolves pending waiters when webContents is destroyed", async () => {
        const webContents = new FakeWebContents();
        const accentSource = new FakeAccentSource();
        webContents.autoResolveInsert = false;

        const controller = createController({
            webContents,
            accentSource,
            getSystemAccentColor: () => "111111",
        });

        webContents.emitDomReady();

        const pending = controller.waitForIdle();
        webContents.destroy();

        await pending;

        expect(accentSource.listenerCount).toBe(0);
        controller.dispose();

        expect(webContents.insertCalls).toEqual([":root {--os-accent-color: #111111;}"]);
    });
});

describe("platform accent-color subscription", () => {
    test("uses event-style subscription and cleanup on non-darwin", () => {
        const systemPreferences = new FakeSystemPreferences();

        const subscribeAccentColorChanges = createAccentColorChangeSubscription(systemPreferences, "win32");
        let accentColor = "";

        const unsubscribe = subscribeAccentColorChanges((_event, value) => {
            accentColor = value;
        });

        systemPreferences.emitEvent("aa11bb");
        expect(accentColor).toBe("aa11bb");
        expect(systemPreferences.eventListenerCount).toBe(1);

        unsubscribe();

        systemPreferences.emitEvent("cc22dd");
        expect(accentColor).toBe("aa11bb");
        expect(systemPreferences.eventListenerCount).toBe(0);
    });

    test("uses mac notification subscription and unsubscribes with returned id", () => {
        const systemPreferences = new FakeSystemPreferences();

        const subscribeAccentColorChanges = createAccentColorChangeSubscription(systemPreferences, "darwin");
        let accentColor = "";

        const unsubscribe = subscribeAccentColorChanges((_event, value) => {
            accentColor = value;
        });

        expect(systemPreferences.subscribedNotificationName).toBe("AppleColorPreferencesChangedNotification");
        expect(systemPreferences.subscribedNotificationId).toBeDefined();

        systemPreferences.emitNotification();
        expect(accentColor).toBe("");

        unsubscribe();
        expect(systemPreferences.unsubscribedNotificationIds).toEqual([systemPreferences.subscribedNotificationId!]);
    });

    test("falls back to the event subscription if the mac notification cannot be registered", () => {
        const systemPreferences = new FakeSystemPreferences();
        systemPreferences.notificationSubscribeError = true;

        const subscribeAccentColorChanges = createAccentColorChangeSubscription(systemPreferences, "darwin");
        let accentColor = "";

        const unsubscribe = subscribeAccentColorChanges((_event, value) => {
            accentColor = value;
        });

        systemPreferences.emitEvent("aa44dd");
        expect(accentColor).toBe("aa44dd");
        expect(systemPreferences.eventListenerCount).toBe(1);

        unsubscribe();
        expect(systemPreferences.eventListenerCount).toBe(0);
    });
});
