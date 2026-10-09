import {afterEach, beforeEach, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {readFileSync} from "node:fs";
import Store from "../../../src/betterdiscord/stores/base";
import Events from "../../../src/betterdiscord/modules/emitter";
import {useStateFromStores} from "../../../src/betterdiscord/ui/hooks";
import {watchAddonSettingsUnload, type AddonSettingsModalIdentity} from "../../../src/betterdiscord/utils/addonsettingsmodal";
import type {Addon} from "@typed/addon";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
const roots: Root[] = [];
const opened: Array<{name: string; panel: React.ReactNode; identity: AddonSettingsModalIdentity; closes: number; root: Root}> = [];
const warnings: string[] = [];
const toasts = {warning: (message: string) => {warnings.push(message);}, show: (message: string) => {warnings.push(message);}};
const t = (key: string) => key;

function compile(source: string, parameters: string[], values: unknown[]) {
    const compiled = new Bun.Transpiler({loader: "tsx", tsconfig: {compilerOptions: {jsx: "react"}}}).transformSync(source);
    // Execute production hooks unchanged, following the existing settings-menu harness convention.
    // eslint-disable-next-line no-new-func
    return new Function(...parameters, compiled)(...values);
}
const modalSource = readFileSync(new URL("../../../src/betterdiscord/ui/modals.ts", import.meta.url), "utf8");
const lifecycleSource = modalSource.slice(modalSource.indexOf("function AddonSettingsModalLifecycle("), modalSource.indexOf("export default class Modals"));
const Lifecycle = compile(`${lifecycleSource}\nreturn AddonSettingsModalLifecycle;`, ["React", "watchAddonSettingsUnload"], [React, watchAddonSettingsUnload]);
const Modals = {
    showAddonSettingsModal(name: string, panel: React.ReactNode, identity: AddonSettingsModalIdentity) {
        const root = createRoot(document.body.appendChild(document.createElement("div")));
        roots.push(root);
        const record = {name, panel, identity, closes: 0, root};
        opened.push(record);
        root.render(<Lifecycle identity={identity} onClose={() => {record.closes++;}}>{panel}</Lifecycle>);
    }
};
mock.module("@ui/modals", () => ({"default": Modals}));
mock.module("@stores/toasts", () => ({"default": toasts}));
mock.module("@common/logger", () => ({"default": {stacktrace: () => {}}}));
mock.module("@common/i18n", () => ({t}));
mock.module("@structs/markdown", () => ({"default": {parseToReact: (value: string) => value}}));
mock.module("@webpack", () => ({getByKeys: () => undefined}));
mock.module("@modules/discordmodules", () => ({"default": {
    Tooltip: ({children}: {children: (props: object) => React.ReactNode}) => children({}), Dispatcher: {dispatch: () => {}}
}}));
mock.module(import.meta.resolve("../../../src/betterdiscord/ui/settings/components/switch"), () => ({"default": () => null}));
const {default: AddonCard} = await import("../../../src/betterdiscord/ui/settings/addoncard");

const ContextMenu = {
    CheckboxItem: ({label, action}: {label: string; action: React.MouseEventHandler}) => <button data-addon-menu onClick={action}>{label}</button>,
    Item: () => null,
    Group: ({children}: {children: React.ReactNode}) => <>{children}</>
};
const settingsSource = readFileSync(new URL("../../../src/betterdiscord/ui/settings.tsx", import.meta.url), "utf8");
const menuSource = settingsSource.slice(settingsSource.indexOf("function useAddonMenu("), settingsSource.indexOf("export default SettingsRenderer;"));
const useAddonMenu = compile(`${menuSource}\nreturn useAddonMenu;`, ["React", "useStateFromStores", "ContextMenu", "toasts", "t", "Modals", "openCategory"], [React, useStateFromStores, ContextMenu, toasts, t, Modals, () => {}]);

function addon(id: string): Addon {
    return {id, name: "Header Name", filename: `${id}.plugin.js`, author: "Author", description: "Description", version: "1.0.0", added: 1, modified: 1, size: 1, slug: id, format: "jsdoc"};
}
class MenuManager extends Store {
    prefix = "plugin";
    addonList: any[] = [];
    enabled = true;
    toggles = 0;
    resolveAddon(name: string) {return this.addonList.find(item => item.name === name);}
    isEnabled() {return this.enabled;}
    toggleAddon() {this.toggles++;}
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    opened.length = 0; warnings.length = 0;
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    roots.push(root);
});
afterEach(async () => {
    await act(async () => {for (const active of roots) active.unmount();});
    roots.length = 0;
    document.body.replaceChildren();
    expect(Events.listenerCount("plugin-unloaded")).toBe(0);
    expect(Events.listenerCount("theme-unloaded")).toBe(0);
});

async function unload(identity: AddonSettingsModalIdentity, record = opened.at(-1)!) {
    await act(async () => {
        Events.emit(`${identity.type === "plugin" ? "theme" : "plugin"}-unloaded`, {id: identity.id});
        Events.emit(`${identity.type}-unloaded`, {id: "Other"});
    });
    expect(record.closes).toBe(0);
    await act(async () => {Events.emit(`${identity.type}-unloaded`, {id: identity.id}); Events.emit(`${identity.type}-unloaded`, {id: identity.id});});
    expect(record.closes).toBe(1);
}

test("Settings shift action calls the instance receiver and passes addon ID/type to real unload lifecycle", async () => {
    const panel = <span>Panel</span>;
    const instance = {panel, calls: 0, getSettingsPanel() {expect(this).toBe(instance); this.calls++; return this.panel;}};
    const manager = new MenuManager();
    manager.addonList = [{...addon("MenuID"), instance}];
    function Menu() {return useAddonMenu(manager);}
    await act(async () => root.render(<Menu />));
    await act(async () => container.querySelector("button")!.dispatchEvent(new MouseEvent("click", {bubbles: true})));
    expect(manager.toggles).toBe(1);
    expect(opened).toHaveLength(0);
    await act(async () => container.querySelector("button")!.dispatchEvent(new MouseEvent("click", {bubbles: true, shiftKey: true})));
    expect(instance.calls).toBe(1);
    expect(opened[0].name).toBe("Header Name");
    expect(opened[0].panel).toBe(panel);
    expect(opened[0].identity).toEqual({id: "MenuID", type: "plugin"});
    await unload(opened[0].identity);
    manager.enabled = false;
    await act(async () => manager.emitChange());
    await act(async () => container.querySelector("button")!.dispatchEvent(new MouseEvent("click", {bubbles: true, shiftKey: true})));
    expect(opened).toHaveLength(1);
    expect(warnings).toEqual(["Addons.isDisabled"]);
});

test("AddonCard callback refreshes for ID/type changes and keeps unload/manual-close ownership", async () => {
    const panel = <span>Card Panel</span>;
    const getSettingsPanel = () => panel;
    const renderCard = (id: string, type: "plugin" | "theme", enabled = true) => root.render(<AddonCard addon={addon(id)} type={type} enabled={enabled} hasSettings getSettingsPanel={getSettingsPanel} onChange={() => {}} editAddon={() => {}} deleteAddon={() => {}} store={undefined as any} />);
    for (const [id, type] of [["CardA", "plugin"], ["CardB", "plugin"], ["CardB", "theme"]] as const) {
        await act(async () => renderCard(id, type));
        await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Addons.addonSettings']")!.click());
        const record = opened.at(-1)!;
        expect(record.identity).toEqual({id, type});
        expect(record.panel).toBe(panel);
        await unload(record.identity, record);
    }
    await act(async () => renderCard("CardB", "theme", false));
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Addons.addonSettings']")!.click());
    expect(opened).toHaveLength(3);
    await act(async () => renderCard("CardB", "theme"));
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Addons.addonSettings']")!.click());
    const manual = opened.at(-1)!;
    await act(async () => manual.root.unmount());
    await act(async () => Events.emit("theme-unloaded", {id: "CardB"}));
    expect(manual.closes).toBe(0);
});
