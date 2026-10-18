import {expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {runInNewContext} from "node:vm";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
const settingReads: string[] = [];
const patches: Array<{owner: string; method: string; callback: (...args: any[]) => void; active: boolean;}> = [];
const disabled: string[] = [];
const enabled: string[] = [];
const notifications: any[] = [];
const toasts: string[] = [];
const actions: string[] = [];
const translations: string[] = [];
let failRegistrationMethod: string | null = null;
let failTransition = false;
let resolvedAddonName = "Example";
let nativeLayers: any = null;
let tooltip: any = null;
let clipboardPromise: Promise<void> = Promise.resolve();
let clipboardText = "";

const context = React.createContext({reducedMotion: {enabled: false}});
function Layer({children}: any) {return <div data-layer="native">{children}</div>;}
Layer.displayName = "AppLayerProvider";
function LayerContainer() {return <div data-layer-container="native"/>;}
LayerContainer.displayName = "AppLayerContainer";
function Tooltip({children}: any) {return <>{children({})}</>;}

mock.module("@common/logger", () => ({"default": {log: () => {}, error: () => {}}}));
mock.module("@stores/settings", () => ({"default": {
    get: (_collection: string, _category: string, id: string) => {settingReads.push(id); return false;}
}}));
mock.module("@modules/commandmanager", () => ({"default": {}}));
mock.module("@modules/patcher", () => ({"default": {
    after: (owner: string, _object: object, method: string, callback: (...args: any[]) => void) => {
        if (failRegistrationMethod === method) throw new Error(`registration failed: ${method}`);
        patches.push({owner, method, callback, active: true});
    },
    unpatchAll: (owner: string) => {for (const patch of patches) if (patch.owner === owner) patch.active = false;}
}}));
mock.module("@webpack", () => ({
    getByPrototypes: () => class {render() {} componentDidCatch() {}},
    getProxy: () => (route: string) => {actions.push(`route:${route}`); if (failTransition) throw new Error("transition unavailable");},
    Filters: {byStrings: () => ({})}
}));
mock.module("@modules/discordmodules", () => ({"default": {
    Dispatcher: {dispatch: ({type}: {type: string}) => {actions.push(type);}},
    get LayerProvider() {return nativeLayers;},
    get AccessibilityContext() {return nativeLayers?.accessibility;},
    get Tooltip() {return tooltip;}
}}));
mock.module("@common/i18n", () => ({t: (key: string) => {translations.push(key); return key;}}));
mock.module("@stores/toasts", () => ({"default": {show: (message: string) => toasts.push(message)}}));
mock.module("@modules/pluginmanager", () => ({"default": {
    resolveAddon: () => ({name: resolvedAddonName, source: "https://github.com/example/plugin", invite: "https://discord.gg/example", version: "1.0.0"}),
    disableAddon: (id: string) => {disabled.push(id); actions.push(`disable:${id}`);},
    enableAddon: (id: string) => enabled.push(id),
    disableAllAddons: () => {actions.push("disable-all");},
    addonList: []
}}));
mock.module("@modules/ipc", () => ({"default": {relaunch: async () => {actions.push("relaunch");}}}));
mock.module("@ui/modals", () => ({"default": {
    ModalActions: {closeAllModals: () => {actions.push("close-all");}},
    showGuildJoinModal: async (invite: string) => {actions.push(`support:${invite}`);}
}}));
mock.module("@stores/notifications", () => ({"default": {show: (notification: any) => notifications.push(notification)}}));
mock.module("@stores/config", () => ({"default": {isCanary: false}}));
mock.module("@ui/logo", () => ({Logo: () => null}));
mock.module("@structs/markdown", () => ({"default": {parseToReact: (text: string) => text}}));
const FlexMock: any = ({children, ...props}: any) => <div {...props}>{children}</div>;
FlexMock.Align = {CENTER: "center"};
mock.module("@ui/base/flex", () => ({"default": FlexMock}));
mock.module("lucide-react", () => ({
    Check: () => <span>check</span>,
    ChevronDown: () => <span>down</span>,
    ChevronRightIcon: () => <span>right</span>,
    Copy: () => <span>copy</span>,
    GithubIcon: (props: any) => <span {...props}>github</span>,
    MessageCircleWarningIcon: () => <span>suspect</span>,
    Server: (props: any) => <span {...props}>server</span>
}));
mock.module("@ui/base/button", () => ({
    "default": ({children, color: _color, ...props}: any) => <button {...props}>{children}</button>
}));

const {default: Recovery} = await import("../../../src/betterdiscord/builtins/developer/recovery");
const {default: SettingsConfig} = await import("../../../src/betterdiscord/data/settings");
const Events = (await import("../../../src/betterdiscord/modules/emitter")).default;

function activePatches(method?: string) {
    return patches.filter(patch => patch.active && (!method || patch.method === method));
}

function runPatch(method: string, instance: any, args: any[], result?: any) {
    for (const patch of activePatches(method)) patch.callback(instance, args, result);
}

function boundary(stack = "betterdiscord://betterdiscord/plugins/Example.plugin.js") {
    const states: any[] = [];
    return {state: {error: {stack}, info: {componentStack: "example component stack"}}, setState: (value: any) => states.push(value), states};
}

function mutableAction() {
    const action = {...React.createElement("div"), props: {children: [] as any[]}};
    return {props: {action}};
}

async function renderRecovery(stack?: string) {
    const instance = boundary(stack);
    const returned: any = mutableAction();
    runPatch("render", instance, [], returned);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<>{returned.props.action}</>));
    return {instance, returned, container, root, cleanup: async () => {await act(async () => root.unmount()); container.remove();}};
}

test("retains initialize-once behavior and removes partial hooks before a retry", async () => {
    expect(SettingsConfig.find(category => category.id === "developer")!.settings.some(setting => setting.id === "recovery")).toBe(false);
    expect(SettingsConfig.find(category => category.id === Recovery.category)?.settings.some(setting => setting.id === Recovery.id) ?? false).toBe(false);
    failRegistrationMethod = "render";
    await expect(Recovery.initialize()).rejects.toThrow("registration failed: render");
    expect(Recovery.initialized).toBe(false);
    expect(activePatches()).toHaveLength(0);

    failRegistrationMethod = null;
    const first = Recovery.initialize();
    const second = Recovery.initialize();
    await Promise.all([first, second]);
    await Recovery.initialize();
    expect(activePatches().map(patch => patch.method)).toEqual(["componentDidCatch", "render"]);
    expect(activePatches().every(patch => patch.owner === "Recovery")).toBe(true);
    expect(Events.listenerCount("setting-updated")).toBe(1);
    expect(settingReads).not.toContain("devTools");
    expect(settingReads).not.toContain("recovery");
});

test("disables and notifies once when the crash is caught, with no render side effects", async () => {
    let caught: Error | undefined;
    // Bun 1.1.20 omits new Function sourceURL labels; vm filename creates the
    // same plugin-manager URL in a real engine-generated Error stack.
    try {runInNewContext("throw new Error('controlled plugin failure')", {}, {filename: "betterdiscord://betterdiscord/plugins/Example.plugin.js"});}
    catch (error) {caught = error as Error;}
    expect(caught?.stack).toContain("betterdiscord://betterdiscord/plugins/Example.plugin.js");
    const instance = boundary(caught!.stack);
    runPatch("render", instance, [], mutableAction());
    runPatch("render", instance, [], mutableAction());
    expect(disabled).toEqual([]);
    expect(notifications).toHaveLength(0);

    runPatch("componentDidCatch", instance, [caught]);
    // The historical short protocol alias remains accepted for old callers.
    runPatch("componentDidCatch", instance, [{stack: "betterdiscord://plugins/Example.plugin.js"}]);
    expect(disabled).toEqual(["Example", "Example"]);
    expect(notifications).toHaveLength(2);
    expect(notifications[0].content).toContain("Example");
    const rendered = await renderRecovery(caught!.stack);
    try {expect(rendered.container.querySelector(".bd-recovery-suspect")?.textContent).toContain("Example");}
    finally {await rendered.cleanup();}
    expect(notifications).toHaveLength(2);
});

test("uses the manager-resolved add-on name when the crash filename differs", () => {
    resolvedAddonName = "Resolved Display Name";
    try {
        runPatch("componentDidCatch", boundary(), [{stack: "betterdiscord://plugins/Example.plugin.js"}]);
        expect(disabled.at(-1)).toBe("Resolved Display Name");
        expect(notifications.at(-1).content).toContain("Resolved Display Name v1.0.0");
    }
    finally {resolvedAddonName = "Example";}
});

test("renders upstream recovery controls and reports failed/successful recovery outcomes", async () => {
    const rendered = await renderRecovery();
    try {
        expect(rendered.container.querySelector(".bd-recovery-container")).not.toBeNull();
        expect(rendered.container.querySelector(".bd-recovery-suspect")?.textContent).toContain("Example");
        expect(rendered.container.textContent).toContain("Recovery.button");
        expect(rendered.container.querySelector(".bd-error-github")).toBeNull();

        await act(async () => [...rendered.container.querySelectorAll("button")].find(button => button.textContent?.includes("Recovery.button"))!.click());
        expect(rendered.instance.states).toEqual([{info: null, error: null}]);
        expect(actions.slice(-5)).toEqual(["LAYER_POP_ALL", "MODAL_POP_ALL", "CONTEXT_MENU_CLOSE", "close-all", "route:/channels/@me"]);
    }
    finally {await rendered.cleanup();}
});

test("failure toast preserves the boundary and support opens only after successful recovery", async () => {
    const originalDispatch = (await import("@modules/discordmodules")).default.Dispatcher;
    originalDispatch.dispatch = ({type}: any) => {actions.push(type); if (type === "LAYER_POP_ALL") throw new Error("failed");};
    failTransition = true;
    const rendered = await renderRecovery();
    try {
        await act(async () => [...rendered.container.querySelectorAll("button")].find(button => button.textContent?.includes("Recovery.button"))!.click());
        expect(rendered.instance.states).toEqual([]);
        expect(toasts).toContain("Toasts.recoveryFailed");
        const before = actions.length;
        await act(async () => rendered.container.querySelector<HTMLButtonElement>(".bd-recovery-link-fallback[aria-label='Recovery.joinSupport']")?.click());
        expect(actions.slice(before)).not.toContain("support:https://discord.gg/example");
    }
    finally {
        failTransition = false;
        originalDispatch.dispatch = ({type}: any) => {actions.push(type);};
        await rendered.cleanup();
    }

    const support = await renderRecovery();
    try {
        await act(async () => support.container.querySelector<HTMLButtonElement>(".bd-recovery-link-fallback[aria-label='Recovery.joinSupport']")!.click());
        expect(actions.slice(-6)).toEqual(["LAYER_POP_ALL", "MODAL_POP_ALL", "CONTEXT_MENU_CLOSE", "close-all", "route:/channels/@me", "support:https://discord.gg/example"]);
        expect(support.instance.states).toEqual([{info: null, error: null}]);
    }
    finally {await support.cleanup();}
});

test("safe mode disables all add-ons before relaunch", async () => {
    const rendered = await renderRecovery();
    try {
        await act(async () => [...rendered.container.querySelectorAll("button")].find(button => button.textContent?.includes("Recovery.safeMode"))!.click());
        expect(actions.slice(-2)).toEqual(["disable-all", "relaunch"]);
    }
    finally {await rendered.cleanup();}
});

test("copy waits for clipboard success and leaves the button unchanged on rejection", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const originalDiscordNative = Object.getOwnPropertyDescriptor(window, "DiscordNative");
    Object.defineProperty(window, "DiscordNative", {configurable: true, value: null});
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText: (text: string) => {clipboardText = text; return clipboardPromise;}}});
    const rendered = await renderRecovery();
    try {
        let resolveCopy!: () => void;
        clipboardPromise = new Promise<void>(resolve => {resolveCopy = resolve;});
        const copy = rendered.container.querySelector<HTMLButtonElement>(".bd-recovery-header button:not(.bd-recovery-toggle)")!;
        await act(async () => {copy.click(); await Promise.resolve();});
        expect(clipboardText).toContain("Suspected addon: Example v1.0.0");
        expect(copy.textContent).toContain("Copy");
        await act(async () => {resolveCopy(); await Promise.resolve();});
        expect(copy.textContent).toContain("Copied");

        const rejected = await renderRecovery();
        try {
            clipboardPromise = Promise.reject(new Error("clipboard denied"));
            const rejectedCopy = rejected.container.querySelector<HTMLButtonElement>(".bd-recovery-header button:not(.bd-recovery-toggle)")!;
            await act(async () => {rejectedCopy.click(); await Promise.resolve();});
            expect(rejectedCopy.textContent).toContain("Copy");
            expect(rejectedCopy.textContent).not.toContain("Copied");
        }
        finally {await rejected.cleanup();}
    }
    finally {
        clipboardPromise = Promise.resolve();
        if (originalDiscordNative) Object.defineProperty(window, "DiscordNative", originalDiscordNative);
        else Reflect.deleteProperty(window, "DiscordNative");
        if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
        else Reflect.deleteProperty(navigator, "clipboard");
        await rendered.cleanup();
    }
});

test("uses native layers when complete and keeps support actions labelled when exports are missing or partial", async () => {
    nativeLayers = {AppLayerProvider: React.memo(Layer), AppLayerContainer: React.forwardRef(() => <LayerContainer/>), accessibility: context};
    tooltip = Tooltip;
    const full = await renderRecovery();
    try {
        expect(full.container.querySelector("[data-layer='native']")).not.toBeNull();
        expect(full.container.querySelector("[data-layer-container='native']")).not.toBeNull();
    }
    finally {await full.cleanup();}

    const cases = [
        null,
        {AppLayerProvider: Layer, AppLayerContainer: {}, accessibility: context},
        {AppLayerProvider: {$$typeof: Symbol.for("react.forward_ref"), render: null}, AppLayerContainer: LayerContainer, accessibility: context},
        {AppLayerProvider: Layer, AppLayerContainer: LayerContainer, accessibility: {Provider: {}}}
    ];
    for (const candidate of cases) {
        nativeLayers = candidate;
        tooltip = () => {throw new Error("Native tooltips require the missing layer capabilities");};
        const fallback = await renderRecovery();
        try {
            expect(fallback.container.querySelector(".bd-recovery-container")).not.toBeNull();
            expect(fallback.container.querySelector("[aria-label='Recovery.report']")?.getAttribute("title")).toBe("Recovery.report");
            expect(fallback.container.querySelector("[aria-label='Recovery.joinSupport']")?.getAttribute("title")).toBe("Recovery.joinSupport");
        }
        finally {await fallback.cleanup();}
    }
    nativeLayers = null;
    tooltip = null;
});
