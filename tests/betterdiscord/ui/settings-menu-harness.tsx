import {afterEach, beforeEach, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {readFileSync} from "node:fs";
import type {SettingsCategory} from "@data/settings";
import type {SettingsCollection} from "@stores/settings";
import {useStateFromStores} from "../../../src/betterdiscord/ui/hooks";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

let language = "translated";
const mutations: Array<[string, string, string, unknown]> = [];
mock.module(import.meta.resolve("../../../src/betterdiscord/stores/json.ts"), () => ({"default": {get: () => undefined, set: () => {}}}));
mock.module("@stores/config", () => ({"default": {isCanary: false, isDevelopment: false}}));
mock.module("@common/logger", () => ({"default": {error: () => {}}}));
mock.module("@common/i18n", () => ({t: (key: string) => `${language}:${key}`}));
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("lucide-react", () => ({PaletteIcon: class {}, PlugIcon: class {}}));

const {default: Settings} = await import("../../../src/betterdiscord/stores/settings");
const Events = (await import("../../../src/betterdiscord/modules/emitter")).default;
Events.on("setting-updated", (collection, category, id, value) => mutations.push([collection, category, id, value]));

type MenuProps = {id: string; label?: string; children?: React.ReactNode; disabled?: boolean; checked?: boolean; group?: string; action?: () => void;};
const ContextMenu = {
    Item: ({id, label, children, disabled, action}: MenuProps) => (
        <fieldset data-menu={id} disabled={disabled}>
            <legend><button onClick={action}>{label}</button></legend>
            {children}
        </fieldset>
    ),
    Group: ({id, children}: MenuProps) => <div data-group={id}>{children}</div>,
    RadioItem: ({id, label, checked, group, action}: MenuProps) => (
        <label><input id={id} type="radio" name={group} checked={checked} onChange={action} />{label}</label>
    ),
    CheckboxItem: ({id, label, disabled, checked, action}: MenuProps) => (
        <label><input id={id} type="checkbox" disabled={disabled} checked={checked} onChange={action} />{label}</label>
    )
};
const opened: string[] = [];

// Execute the private production hook unchanged while isolating unrelated Settings renderer discovery.
const source = readFileSync(new URL("../../../src/betterdiscord/ui/settings.tsx", import.meta.url), "utf8");
const hookSource = source.slice(source.indexOf("function useCollectionMenu("), source.indexOf("function useAddonMenu("));
const compiled = new Bun.Transpiler({loader: "tsx", tsconfig: {compilerOptions: {jsx: "react"}}}).transformSync(hookSource);
// eslint-disable-next-line no-new-func
const useCollectionMenu = new Function("React", "Settings", "useStateFromStores", "ContextMenu", "openCategory", `${compiled}\nreturn useCollectionMenu;`)(
    React, Settings, useStateFromStores, ContextMenu, (id: string) => opened.push(id)
) as (collection: SettingsCollection) => React.ReactNode;

const categories: SettingsCategory[] = [{
    type: "category",
    id: "menu",
    name: "Menu",
    collapsible: false,
    shown: true,
    settings: [
        {type: "switch", id: "enabled", value: false},
        {type: "switch", id: "dependent", value: true, enableWith: "enabled"},
        {type: "dropdown", id: "choice", value: "first", enableWith: "enabled", options: [{label: "First", value: "first"}, {label: "Second", value: "second"}]},
        {type: "dropdown", id: "hidden-choice", hidden: true, value: "first", options: [{label: "First", value: "first"}]},
        {type: "switch", id: "hidden-switch", hidden: true, value: true},
        {type: "text", id: "text", value: "hello"}
    ]
}];
Settings.registerCollection("menu-test", "Test", categories);
const collection = Settings.collections.find(c => c.id === "menu-test")!;
function Menu() {return useCollectionMenu(collection);}

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
    Settings.set("menu-test", "menu", "enabled", false);
    Settings.set("menu-test", "menu", "choice", "first");
    language = "translated";
    mutations.length = 0;
    opened.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Menu />));
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

test("shows switches and dropdown radio groups with translated options and hides unsupported/hidden controls", () => {
    expect(container.querySelector("#enabled")).toBeTruthy();
    expect(container.querySelector("[data-menu='choice'] [data-group='choice']")).toBeTruthy();
    expect(container.querySelectorAll("input[type='radio']").length).toBe(2);
    expect(container.textContent).toContain("translated:Collections.menu-test.menu.choice.options.second");
    expect(container.querySelector("#hidden-switch")).toBeNull();
    expect(container.querySelector("[data-menu='hidden-choice']")).toBeNull();
    expect(container.querySelector("#text")).toBeNull();
    expect(container.querySelector<HTMLInputElement>("#choice-first")!.checked).toBe(true);
});

test("enables dependencies live and makes one Settings mutation for each selection or switch click", async () => {
    expect(container.querySelector<HTMLFieldSetElement>("[data-menu='choice']")!.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#dependent")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>("#enabled")!.click());
    expect(mutations).toEqual([["menu-test", "menu", "enabled", true]]);
    expect(container.querySelector<HTMLFieldSetElement>("[data-menu='choice']")!.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>("#dependent")!.disabled).toBe(false);
    mutations.length = 0;
    await act(async () => container.querySelector<HTMLInputElement>("#choice-second")!.click());
    expect(mutations).toEqual([["menu-test", "menu", "choice", "second"]]);
    expect(Settings.get<string>("menu-test", "menu", "choice")).toBe("second");
    expect(container.querySelector<HTMLInputElement>("#choice-second")!.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#choice-first")!.checked).toBe(false);
    mutations.length = 0;
    await act(async () => container.querySelector<HTMLInputElement>("#enabled")!.click());
    expect(mutations).toEqual([["menu-test", "menu", "enabled", false]]);
    expect(container.querySelector<HTMLFieldSetElement>("[data-menu='choice']")!.disabled).toBe(true);
});

test("reflects external selection and translated option updates without remounting", async () => {
    language = "updated";
    await act(async () => Settings.set("menu-test", "menu", "choice", "second"));
    expect(container.querySelector<HTMLInputElement>("#choice-second")!.checked).toBe(true);
    expect(container.textContent).toContain("updated:Collections.menu-test.menu.choice.options.second");
});

test("category action retains the collection navigation target", async () => {
    await act(async () => container.querySelector<HTMLButtonElement>("[data-menu='menu'] > legend button")!.click());
    expect(opened).toEqual(["menu-test"]);
    expect(mutations).toEqual([]);
});
