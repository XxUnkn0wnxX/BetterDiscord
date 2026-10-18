import {afterAll, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {runInNewContext} from "node:vm";
import {getRecoveryReportSource} from "../../../src/betterdiscord/utils/recoveryreport";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
const settingReads: string[] = [];
const patches: Array<{owner: string; method: string; callback: (...args: any[]) => void; active: boolean;}> = [];
const disabled: string[] = [];
const enabled: string[] = [];
const notifications: any[] = [];
const toasts: string[] = [];
const actions: string[] = [];
const translations: string[] = [];
const opened: Array<{url: string; target: string; features: string;}> = [];
let failRegistrationMethod: string | null = null;
let failTransition = false;
let resolvedAddonName = "Example";
let resolvedAddonSource: string | null = "https://github.com/example/plugin";
let isCanary = false;
let nativeLayers: any = null;
let tooltip: any = null;
let clipboardPromise: Promise<void> = Promise.resolve();
let clipboardText = "";
let nativeClipboardPromise: Promise<void> = Promise.resolve();
let nativeClipboardText = "";
let failDebugInfo = false;
let debugInfoCalls = 0;
const DEBUG_INFO = "<details>\n<summary>Discord &amp; BetterDiscord</summary>\n\n## Discord Info\nStable 2042 (1234567)\nHost 1.2.3 arm64 (47)\nmacOS 14.4 (14.4.1)\n\n## BetterDiscord\nStable 1.14.3 (abcdef1)\n\n</details>";

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
mock.module("@utils/debug", () => ({"default": (options: {collapsible?: boolean;}) => {
    debugInfoCalls++;
    if (!options.collapsible) throw new Error("Recovery must request collapsed debug output");
    if (failDebugInfo) throw new Error("debug info unavailable");
    return DEBUG_INFO;
}}));
mock.module("@common/i18n", () => ({t: (key: string) => {translations.push(key); return key;}}));
mock.module("@stores/toasts", () => ({"default": {show: (message: string) => toasts.push(message)}}));
mock.module("@modules/pluginmanager", () => ({"default": {
    resolveAddon: () => ({name: resolvedAddonName, source: resolvedAddonSource, invite: "https://discord.gg/example", version: "1.0.0"}),
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
mock.module("@stores/config", () => ({"default": {get isCanary() {return isCanary;}}}));
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
    GithubIcon: (props: any) => <svg {...props} data-github-icon="true" aria-hidden="true"/>,
    MessageCircleWarningIcon: () => <span>suspect</span>,
    Server: (props: any) => <span {...props}>server</span>
}));
mock.module("@ui/base/button", () => ({
    "default": ({children, color: _color, ...props}: any) => <button {...props}>{children}</button>
}));

const {default: Recovery} = await import("../../../src/betterdiscord/builtins/developer/recovery");
const {default: SettingsConfig} = await import("../../../src/betterdiscord/data/settings");
const Events = (await import("../../../src/betterdiscord/modules/emitter")).default;
const originalWindowOpen = window.open;
window.open = ((url: string | URL, target?: string, features?: string) => {
    opened.push({url: String(url), target: target ?? "", features: features ?? ""});
    return null;
}) as typeof window.open;
afterAll(() => {window.open = originalWindowOpen;});

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
    isCanary = true;
    try {
        runPatch("componentDidCatch", boundary(), [{stack: "betterdiscord://plugins/Example.plugin.js"}]);
        expect(disabled.at(-1)).toBe("Resolved Display Name");
        expect(notifications.at(-1).content).toContain("Resolved Display Name v1.0.0");
        expect(notifications.at(-1).actions).toHaveLength(1);
        expect(notifications.at(-1).actions[0].dontClose).toBe(true);
        notifications.at(-1).actions[0].onClick();
        expect(enabled.at(-1)).toBe("Resolved Display Name");
    }
    finally {
        resolvedAddonName = "Example";
        isCanary = false;
    }
});

test("renders upstream recovery controls and reports failed/successful recovery outcomes", async () => {
    const rendered = await renderRecovery();
    try {
        expect(rendered.container.querySelector(".bd-recovery-container")).not.toBeNull();
        expect(rendered.container.querySelector(".bd-recovery-suspect")?.textContent).toContain("Example");
        expect(rendered.container.textContent).toContain("Recovery.button");

        const details = rendered.container.querySelector<HTMLButtonElement>(".bd-recovery-toggle")!;
        expect(details.getAttribute("aria-expanded")).toBe("false");
        await act(async () => details.click());
        expect(details.getAttribute("aria-expanded")).toBe("true");
        expect(rendered.container.querySelector(".bd-recovery-details")?.textContent).toContain("example component stack");
        await act(async () => details.click());
        expect(details.getAttribute("aria-expanded")).toBe("false");
        expect(rendered.container.querySelector(".bd-recovery-details")).toBeNull();

        const originalReload = window.location.reload;
        window.location.reload = () => {actions.push("reload");};
        try {
            await act(async () => [...rendered.container.querySelectorAll("button")].find(button => button.textContent?.includes("Addons.reload"))!.click());
            expect(actions.at(-1)).toBe("reload");
        }
        finally {window.location.reload = originalReload;}

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
    const beforeRender = debugInfoCalls;
    const rendered = await renderRecovery();
    try {
        expect(debugInfoCalls).toBe(beforeRender);
        let resolveCopy!: () => void;
        clipboardPromise = new Promise<void>(resolve => {resolveCopy = resolve;});
        const copy = rendered.container.querySelector<HTMLButtonElement>(".bd-recovery-header button:not(.bd-recovery-toggle)")!;
        await act(async () => {copy.click(); await Promise.resolve();});
        expect(clipboardText).toContain("Suspected addon: Example v1.0.0");
        expect(clipboardText).toContain(DEBUG_INFO);
        expect(clipboardText).not.toMatch(/<summary>(?:Plugins|Themes)/);
        expect(clipboardText).toContain("example component stack");
        expect(debugInfoCalls).toBe(beforeRender + 1);
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

        Object.defineProperty(window, "DiscordNative", {configurable: true, value: {clipboard: {copy: (text: string) => {nativeClipboardText = text; return nativeClipboardPromise;}}}});
        const native = await renderRecovery();
        try {
            let resolveNativeCopy!: () => void;
            nativeClipboardPromise = new Promise<void>(resolve => {resolveNativeCopy = resolve;});
            const nativeCopy = native.container.querySelector<HTMLButtonElement>(".bd-recovery-header button:not(.bd-recovery-toggle)")!;
            await act(async () => {nativeCopy.click(); await Promise.resolve();});
            expect(nativeClipboardText).toContain("Suspected addon: Example v1.0.0");
            expect(nativeClipboardText).toContain(DEBUG_INFO);
            expect(nativeClipboardText).not.toMatch(/<summary>(?:Plugins|Themes)/);
            expect(nativeClipboardText).toContain("example component stack");
            expect(nativeCopy.textContent).toContain("Copy");
            await act(async () => {resolveNativeCopy(); await Promise.resolve();});
            expect(nativeCopy.textContent).toContain("Copied");
        }
        finally {await native.cleanup();}

        Object.defineProperty(window, "DiscordNative", {configurable: true, value: {clipboard: {copy: () => Promise.reject(new Error("native clipboard denied"))}}});
        const nativeRejected = await renderRecovery();
        try {
            const nativeCopy = nativeRejected.container.querySelector<HTMLButtonElement>(".bd-recovery-header button:not(.bd-recovery-toggle)")!;
            await act(async () => {nativeCopy.click(); await Promise.resolve();});
            expect(nativeCopy.textContent).toContain("Copy");
            expect(nativeCopy.textContent).not.toContain("Copied");
        }
        finally {await nativeRejected.cleanup();}
    }
    finally {
        clipboardPromise = Promise.resolve();
        nativeClipboardPromise = Promise.resolve();
        if (originalDiscordNative) Object.defineProperty(window, "DiscordNative", originalDiscordNative);
        else Reflect.deleteProperty(window, "DiscordNative");
        if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
        else Reflect.deleteProperty(navigator, "clipboard");
        await rendered.cleanup();
    }
});

test("accepts only the supported report hosts and canonicalizes their repository URLs", () => {
    const positive: Array<[string, "github" | "forgejo", string]> = [
        ["https://github.com/BetterDiscord/BetterDiscord", "github", "https://github.com/BetterDiscord/BetterDiscord"],
        ["http://www.github.com/Owner/Repo.git/blob/main/file.js?raw=1#L4", "github", "https://github.com/Owner/Repo"],
        ["git://github.com/Owner/Repo.git", "github", "https://github.com/Owner/Repo"],
        ["https://raw.githubusercontent.com/XxUnkn0wnxX/MessageLoggerV2-Remake/refs/heads/main/MessageLoggerV2.plugin.js", "github", "https://github.com/XxUnkn0wnxX/MessageLoggerV2-Remake"],
        ["https://git.slowb.ro/XxUnkn0wnxX/MessageLoggerV2-Remake/src/branch/main/MessageLoggerV2.plugin.js", "forgejo", "https://git.slowb.ro/XxUnkn0wnxX/MessageLoggerV2-Remake"],
        ["git+https://git.slowb.ro/Owner/Repo.git/src/branch/main/file.js", "forgejo", "https://git.slowb.ro/Owner/Repo"]
    ];
    for (const [source, provider, repoUrl] of positive) expect(getRecoveryReportSource(source)).toEqual({provider, repoUrl});

    const negative = [
        "https://github.com.evil.example/owner/repo",
        "https://user@github.com/owner/repo",
        "https://@github.com/owner/repo",
        "https://github.com:8443/owner/repo",
        "git://github.com:443/owner/repo",
        "file://github.com/owner/repo",
        "javascript://github.com/owner/repo",
        "https://github.com/owner",
        "https://github.com/owner/.git",
        "https://github.com/owner\\repo",
        "https://github.com/ow\nner/repo",
        "https://github.com/owner%2frepo/repo",
        "https://github.com/owner/repo/../other",
        "https://example.com/owner/repo"
    ];
    for (const source of negative) expect(getRecoveryReportSource(source), source).toBeNull();
});

test("GitHub and Forgejo report buttons open encoded issue forms on click only", async () => {
    const sources = [
        {source: "https://raw.githubusercontent.com/Owner/Repo/refs/heads/main/plugin.js", label: "Recovery.report", repo: "https://github.com/Owner/Repo", icon: "[data-github-icon='true']"},
        {source: "https://git.slowb.ro/XxUnkn0wnxX/MessageLoggerV2-Remake/src/branch/main/plugin.js", label: "Recovery.reportForgejo", repo: "https://git.slowb.ro/XxUnkn0wnxX/MessageLoggerV2-Remake", icon: "[data-forgejo-icon='true']"}
    ];
    const stack = "Error: bad [state]? & #value\n    at betterdiscord://plugins/Example.plugin.js";
    const name = "Example & [Audit]?";
    const originalName = resolvedAddonName;
    resolvedAddonName = name;
    try {
        for (const native of [false, true]) {
            nativeLayers = native ? {AppLayerProvider: Layer, AppLayerContainer: LayerContainer, accessibility: context} : null;
            tooltip = native ? Tooltip : null;
            for (const entry of sources) {
                resolvedAddonSource = entry.source;
                const beforeRender = opened.length;
                const debugCallsBeforeRender = debugInfoCalls;
                const rendered = await renderRecovery(stack);
                try {
                    expect(opened).toHaveLength(beforeRender);
                    expect(debugInfoCalls).toBe(debugCallsBeforeRender);
                    const report = rendered.container.querySelector<HTMLButtonElement>(`.bd-recovery-report[aria-label='${entry.label}']`)!;
                    expect(report.disabled).toBe(false);
                    expect(report.type).toBe("button");
                    expect(report.querySelector(entry.icon)).not.toBeNull();
                    const before = opened.length;
                    await act(async () => report.click());
                    expect(opened).toHaveLength(before + 1);
                    expect(debugInfoCalls).toBe(debugCallsBeforeRender + 1);
                    const openedReport = opened.at(-1)!;
                    const url = new URL(openedReport.url);
                    expect(`${url.origin}${url.pathname}`).toBe(`${entry.repo}/issues/new`);
                    expect(url.searchParams.get("title")).toBe(`[Bug Report] Plugin Crash - ${name} v1.0.0`);
                    const body = url.searchParams.get("body")!;
                    expect(body).toContain(`### Error Details\n\`\`\`js\n${stack}\n\`\`\``);
                    expect(body).toContain("### Component Stack\n```\nexample component stack\n```");
                    expect(body).toContain("<summary>Discord &amp; BetterDiscord</summary>");
                    expect(body).toContain(DEBUG_INFO);
                    expect(body).not.toMatch(/<summary>(?:Plugins|Themes)/);
                    expect(body).toContain("### Steps to Reproduce\n1.\n2.\n3.");
                    expect(body).toContain("### Additional Context");
                    expect(openedReport.target).toBe("_blank");
                    expect(openedReport.features).toBe("noopener,noreferrer");
                }
                finally {await rendered.cleanup();}
            }
        }
    }
    finally {
        nativeLayers = null;
        tooltip = null;
        resolvedAddonName = originalName;
        resolvedAddonSource = "https://github.com/example/plugin";
    }
});

test("copy and reports preserve the crash context when debug generation fails", async () => {
    const originalDiscordNative = Object.getOwnPropertyDescriptor(window, "DiscordNative");
    Object.defineProperty(window, "DiscordNative", {configurable: true, value: {clipboard: {copy: (text: string) => {nativeClipboardText = text;}}}});
    resolvedAddonSource = "https://github.com/example/plugin";
    failDebugInfo = true;
    try {
        const beforeRender = debugInfoCalls;
        const rendered = await renderRecovery("Error: click detail crash\n    at betterdiscord://plugins/Example.plugin.js");
        try {
            expect(debugInfoCalls).toBe(beforeRender);
            const copy = rendered.container.querySelector<HTMLButtonElement>(".bd-recovery-header button:not(.bd-recovery-toggle)")!;
            await act(async () => copy.click());
            expect(nativeClipboardText).toContain("Debug information unavailable.");
            expect(nativeClipboardText).toContain("Error: click detail crash");
            expect(nativeClipboardText).toContain("example component stack");
            expect(debugInfoCalls).toBe(beforeRender + 1);

            const report = rendered.container.querySelector<HTMLButtonElement>(".bd-recovery-report[aria-label='Recovery.report']")!;
            await act(async () => report.click());
            const body = new URL(opened.at(-1)!.url).searchParams.get("body")!;
            expect(body).toContain("Debug information unavailable.");
            expect(body).toContain("Error: click detail crash");
            expect(body).toContain("example component stack");
            expect(debugInfoCalls).toBe(beforeRender + 2);
        }
        finally {await rendered.cleanup();}
    }
    finally {
        failDebugInfo = false;
        if (originalDiscordNative) Object.defineProperty(window, "DiscordNative", originalDiscordNative);
        else Reflect.deleteProperty(window, "DiscordNative");
    }
});

test("missing, local, and invalid report sources show a disabled text button without an icon", async () => {
    const sources: Array<string | null> = [null, "file:///tmp/Example.plugin.js", "https://github.com.attacker.invalid/owner/repo"];
    const before = opened.length;
    for (const source of sources) {
        resolvedAddonSource = source;
        const rendered = await renderRecovery();
        try {
            const report = rendered.container.querySelector<HTMLButtonElement>(".bd-recovery-report-disabled")!;
            expect(report.textContent).toBe("Recovery.noReportRepo");
            expect(report.disabled).toBe(true);
            expect(report.querySelector("svg")).toBeNull();
            await act(async () => report.click());
            expect(opened).toHaveLength(before);
        }
        finally {await rendered.cleanup();}
    }
    resolvedAddonSource = "https://github.com/example/plugin";

    const unknown = await renderRecovery("Error: no plugin source in this stack");
    try {expect(unknown.container.querySelector(".bd-recovery-suspect")).toBeNull();}
    finally {await unknown.cleanup();}
});

test("uses native layers when complete and keeps support actions labelled when exports are missing or partial", async () => {
    nativeLayers = {AppLayerProvider: React.memo(Layer), AppLayerContainer: React.forwardRef(() => <LayerContainer/>), accessibility: context};
    tooltip = Tooltip;
    const full = await renderRecovery();
    try {
        expect(full.container.querySelector("[data-layer='native']")).not.toBeNull();
        expect(full.container.querySelector("[data-layer-container='native']")).not.toBeNull();
        const nativeReport = full.container.querySelector<HTMLButtonElement>(".bd-recovery-report[aria-label='Recovery.report']")!;
        expect(nativeReport.querySelector("[data-github-icon='true']")).not.toBeNull();
        const before = opened.length;
        await act(async () => nativeReport.click());
        expect(opened).toHaveLength(before + 1);
        expect(opened.at(-1)?.url).toStartWith("https://github.com/example/plugin/issues/new?");
        const nativeSupport = full.container.querySelector<HTMLButtonElement>(".bd-recovery-support[aria-label='Recovery.joinSupport']")!;
        await act(async () => nativeSupport.click());
        expect(actions.at(-1)).toBe("support:https://discord.gg/example");
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
