import {expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot} from "react-dom/client";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
const reads: string[] = [];
const settingState: Record<string, boolean> = {devTools: false, recovery: false};
const patches: Array<{owner: string; callback: (instance: any, args: any[], retValue: any) => void;}> = [];
const translations: string[] = [];
const disabled: string[] = [];
const dispatches: string[] = [];
let failRegistration = false;

mock.module("@common/logger", () => ({"default": {log: () => {}, error: () => {}}}));
mock.module("@stores/settings", () => ({"default": {
    get: (_collection: string, _category: string, id: string) => {reads.push(id); return settingState[id] ?? false;}
}}));
mock.module("@modules/commandmanager", () => ({"default": {}}));
mock.module("@modules/patcher", () => ({"default": {
    after: (owner: string, _object: object, _method: string, callback: (instance: any, args: any[], retValue: any) => void) => {
        if (failRegistration) throw new Error("registration failed");
        patches.push({owner, callback});
    }
}}));
mock.module("@webpack", () => ({
    getByPrototypes: () => class {render() {}},
    getByStrings: () => (route: string) => dispatches.push(route)
}));
mock.module("@modules/discordmodules", () => ({"default": {Dispatcher: {dispatch: ({type}: {type: string}) => dispatches.push(type)}}}));
mock.module("@common/i18n", () => ({t: (key: string) => {translations.push(key); return key;}}));
mock.module("@stores/toasts", () => ({"default": {show: () => {}}}));
mock.module("@modules/pluginmanager", () => ({"default": {
    resolveAddon: () => ({name: "Example", source: "https://github.com/example/plugin", version: "1.0.0"}),
    disableAddon: (id: string) => disabled.push(id),
    addonList: []
}}));
mock.module("@modules/ipc", () => ({"default": {relaunch: async () => {}}}));
mock.module("@ui/modals", () => ({"default": {ModalActions: {closeAllModals: () => dispatches.push("close-all")}}}));
mock.module("@stores/notifications", () => ({"default": {show: () => {}}}));
mock.module("@stores/config", () => ({"default": {isCanary: false}}));
mock.module("@ui/logo", () => ({Logo: () => null}));
mock.module("@structs/markdown", () => ({"default": {parseToReact: (text: string) => text}}));
mock.module("@ui/base/button", () => ({
    "default": ({children, color: _color, ...props}: any) => <button {...props}>{children}</button>,
    "ButtonColors": {YELLOW: "yellow", RED: "red"}
}));

const {default: Recovery} = await import("../../../src/betterdiscord/builtins/developer/recovery");
const {default: SettingsConfig} = await import("../../../src/betterdiscord/data/settings");
const Events = (await import("../../../src/betterdiscord/modules/emitter")).default;

test("retries an actual registration failure, then initializes exactly once with the distinct Recovery owner", async () => {
    expect(SettingsConfig.find(category => category.id === "developer")!.settings.some(setting => setting.id === "recovery")).toBe(false);
    failRegistration = true;
    await expect(Recovery.initialize()).rejects.toThrow("registration failed");
    expect(Recovery.initialized).toBe(false);
    failRegistration = false;
    const first = Recovery.initialize();
    const second = Recovery.initialize();
    await Promise.all([first, second]);
    await Recovery.initialize();
    expect(patches.length).toBe(1);
    expect(patches[0].owner).toBe("Recovery");
    expect(Events.listenerCount("setting-updated")).toBe(1);
    expect(reads).not.toContain("devTools");
    expect(reads).not.toContain("recovery");
});

test("renders translated recovery actions and executes recovery with DevTools and the old switch false", async () => {
    const states: unknown[] = [];
    const instance = {
        state: {error: {stack: "betterdiscord://plugins/Example.plugin.js"}, info: {componentStack: "example stack"}},
        setState: (state: unknown) => states.push(state)
    };
    // Discord's production React elements have mutable props; development React freezes them.
    const action = {...React.createElement("div"), props: {children: []}};
    const returned: any = {props: {action}};
    patches[0].callback(instance, [], returned);
    expect(disabled).toEqual(["Example"]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<>{returned.props.action}</>));
        expect(container.querySelector(".bd-button-recovery")!.textContent).toBe("Recovery.button");
        expect(container.querySelector(".bd-error-github")!.textContent).toBe("Recovery.report");
        expect(container.querySelector(".bd-error-safe-mode")!.textContent).toBe("Recovery.safeMode");
        await act(async () => container.querySelector<HTMLButtonElement>(".bd-button-recovery")!.click());
        expect(states).toEqual([{info: null, error: null}]);
        expect(dispatches).toEqual(["LAYER_POP_ALL", "MODAL_POP_ALL", "CONTEXT_MENU_CLOSE", "/channels/@me", "close-all"]);
        expect(translations.some(key => key.startsWith("Collections.settings.developer.recovery"))).toBe(false);
    }
    finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

test("legacy recovery and DevTools updates do not disable or register recovery again", async () => {
    Events.dispatch("setting-updated", "settings", "developer", "recovery", false);
    Events.dispatch("setting-updated", "settings", "developer", "devTools", false);
    const returned: any = {props: {action: {...React.createElement("div"), props: {children: []}}}};
    patches[0].callback({state: {error: null, info: null}}, [], returned);
    const action = Array.isArray(returned.props.action) ? returned.props.action[0] : returned.props.action;
    expect(action.props.children.length).toBe(1);
    await Recovery.initialize();
    expect(patches.length).toBe(1);
});
