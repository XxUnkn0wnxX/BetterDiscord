import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {flushSync} from "react-dom";
import {readFileSync} from "node:fs";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@common/logger", () => ({"default": {warn: () => {}, error: () => {}}}));
mock.module("@modules/discordmodules", () => ({"default": {Tooltip: ({children}: any) => children({})}}));
mock.module("@modules/ipc", () => ({"default": {openPath: () => undefined}}));
mock.module("@stores/settings", () => ({"default": {get: () => false}}));
mock.module("@stores/json", () => ({"default": {get: () => ({}), set: () => undefined}}));
const MockButton = Object.assign(({children, onClick, ...props}: any) => <button onClick={onClick} {...props}>{children}</button>, {
    Sizes: {LARGE: "large", NONE: "none"},
    Looks: {BLANK: "blank"}
});
mock.module("@ui/base/button", () => ({"default": MockButton}));
const MockText = Object.assign(({children, ...props}: any) => <span {...props}>{children}</span>, {Colors: {HEADER_PRIMARY: "primary", HEADER_SECONDARY: "secondary"}});
mock.module("@ui/base/text", () => ({"default": MockText}));
mock.module("@ui/blankslates/empty", () => ({"default": ({title, children}: any) => <div data-empty-slate>{title}{children}</div>}));
mock.module("@ui/blankslates/noresults", () => ({"default": () => <div data-no-results />}));
mock.module("@ui/errorboundary", () => ({"default": ({children}: any) => <>{children}</>}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: () => undefined}}));
mock.module("@ui/settings/components/dropdown", () => ({"default": () => <div />}));
mock.module("@ui/settings/components/search", () => ({"default": () => <input />}));
mock.module("@ui/hooks", () => ({useStateFromStores: (_store: unknown, selector: () => unknown) => selector()}));
const SettingsTitleContext = React.createContext((value: React.ReactNode) => value);
mock.module("@ui/settings", () => ({SettingsTitleContext}));
mock.module("@ui/settings/title", () => ({
    "default": ({text, children}: any) => <>{text}{children}</>,
    "SettingsTitlePublisher": ({title}: any) => title
}));
mock.module("lucide-react", () => {
    const ChevronRightIcon = () => <svg data-chevron />;
    const Icon = () => <svg />;
    return {
        BadgeCheckIcon: Icon,
        CheckIcon: Icon,
        ChevronRightIcon,
        FolderIcon: Icon,
        LayoutGridIcon: Icon,
        StoreIcon: Icon,
        StretchHorizontalIcon: Icon,
        XIcon: Icon
    };
});
mock.module(import.meta.resolve("../../../src/betterdiscord/ui/settings/addoncard.tsx"), () => ({"default": () => null}));

mock.module(import.meta.resolve("../../../src/betterdiscord/ui/settings/addonstore.tsx"), () => ({
    "default": () => {
        const {toggleStore} = React.useContext(addonContext);
        return <div data-store-page>
            <AddonHeader count={0} searching={false}><input /></AddonHeader>
            <button data-store-back onClick={toggleStore}>Back to addons</button>
        </div>;
    }
}));

const {default: DOMManager} = await import("@modules/dommanager");
const domAddedCalls: string[] = [];
const actualOnAdded = DOMManager.onAdded.bind(DOMManager);
DOMManager.onAdded = (selector, callback) => {
    domAddedCalls.push(selector);
    // HappyDOM currently mis-matches the upstream :where(A, B) selector; normalize only this exact selector and keep the real observer/callback path.
    const testSelector = selector === ":where(.bd-store-card, .bd-addon-title > :nth-child(3))"
        ? ".bd-store-card, .bd-addon-title > :nth-child(3)"
        : selector;
    return actualOnAdded(testSelector, callback);
};
const {addonContext, AddonHeader} = await import("@ui/settings/addonshared");
const {default: AddonPage} = await import("@ui/settings/addonpage");

const settingsSource = readFileSync(new URL("../../../src/betterdiscord/ui/settings.tsx", import.meta.url), "utf8");
function compile(source: string, parameters: string[], values: unknown[]) {
    const compiled = new Bun.Transpiler({loader: "tsx", tsconfig: {compilerOptions: {jsx: "react"}}}).transformSync(source);
    // Execute the production source unchanged, following the existing settings-menu harness convention.
    // eslint-disable-next-line no-new-func
    return new Function(...parameters, compiled)(...values);
}

const declaration = settingsSource.slice(settingsSource.indexOf("const UserSettings ="), settingsSource.indexOf("const closeUserSettings =")).trim();
const openSettingsStart = settingsSource.indexOf("    public openSettingsPage(key: string) {");
const openSettingsEnd = settingsSource.indexOf("\n    public closeUserSettingsModal()", openSettingsStart);
const openSettingsMethod = settingsSource.slice(openSettingsStart, openSettingsEnd).trim().replace(/^public /, "");
const openCategoryStart = settingsSource.indexOf("function openCategory(id: string) {");
const openCategoryEnd = settingsSource.indexOf("\nfunction useCollectionMenu(", openCategoryStart);
const openCategorySource = settingsSource.slice(openCategoryStart, openCategoryEnd);
const useAddonMenuStart = settingsSource.indexOf("function useAddonMenu(manager: AddonManager) {");
const useAddonMenuEnd = settingsSource.indexOf("\nexport default SettingsRenderer;", useAddonMenuStart);
const useAddonMenuSource = settingsSource.slice(useAddonMenuStart, useAddonMenuEnd);

const lookupOptions = {firstId: 840065, cacheId: "core-settings-usersettings"};
type Candidate = {openUserSettings: (...args: any[]) => void; USER_SETTINGS_MODAL_KEY?: string;};
function selectUserSettings(candidates: Candidate[], lookups: string[][]) {
    const getByKeys = (keys: string[], options: unknown) => {
        expect(options).toEqual(lookupOptions);
        lookups.push(keys);
        return candidates.find(candidate => keys.every(key => Object.hasOwn(candidate, key)));
    };
    return compile(declaration + "\nreturn UserSettings;", ["getByKeys"], [getByKeys]);
}

let navigationOrder: string[] = [];
const ContextMenu = {
    close() {navigationOrder.push("close");},
    Group: ({children}: any) => <div>{children}</div>,
    CheckboxItem: ({label, action}: any) => <button data-addon-toggle onClick={action}>{label}</button>,
    Item: ({id, label, action}: any) => <button data-store-menu={id} onClick={action}>{label}</button>
};
const useStateFromStores = (_store: unknown, selector: () => unknown) => selector();
const toasts = {warning: () => undefined};
const t = (key: string) => key;
const Modals = {showAddonSettingsModal: () => undefined};

function makeManager(prefix: "plugin" | "theme", addonList: any[] = []) {
    return {
        prefix,
        addonList,
        state: {},
        addonFolder: "/" + prefix + "s",
        resolveAddon: (name: string) => addonList.find(addon => addon.name === name),
        isEnabled: () => false,
        toggleAddon: () => undefined,
        enableAllAddons: () => undefined,
        disableAllAddons: () => undefined
    } as any;
}

function sampleAddon() {
    return {id: "sample", name: "Sample", author: "Author", description: "Description", version: "1.0", added: 1, modified: 1};
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    navigationOrder = [];
    domAddedCalls.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

function renderMenu(manager: any, action: (...args: any[]) => void) {
    const useAddonMenu = compile(useAddonMenuSource + "\nreturn useAddonMenu;", [
        "React", "useStateFromStores", "ContextMenu", "toasts", "t", "Modals", "openCategory", "DOMManager"
    ], [React, useStateFromStores, ContextMenu, toasts, t, Modals, action, DOMManager]);
    return () => useAddonMenu(manager);
}

function settingsRenderer(userSettings: Candidate) {
    return compile("return ({" + openSettingsMethod + "});", ["UserSettings"], [userSettings]);
}

function categoryOpener(renderer: unknown) {
    return compile(openCategorySource + "\nreturn openCategory;", ["ContextMenu", "SettingsRenderer"], [ContextMenu, renderer]);
}

async function mountMenuAndNavigate(options: {prefix: "plugin" | "theme"; addons?: any[]; candidates: Candidate[]; delayed?: boolean;}) {
    const {prefix, addons = [sampleAddon()], candidates, delayed = false} = options;
    const manager = makeManager(prefix, addons);
    const lookups: string[][] = [];
    const calls: Array<{receiver: Candidate; target: string; options: {section: string};}> = [];
    const userSettings = selectUserSettings(candidates, lookups) as Candidate;
    const renderPage = (section: string) => {
        const pagePrefix = section === "themes" ? "theme" : "plugin";
        const pageManager = pagePrefix === prefix ? manager : makeManager(pagePrefix, addons);
        const page = <AddonPage title={pagePrefix === "theme" ? "Themes" : "Plugins"} store={pageManager} />;
        if (delayed) setTimeout(() => flushSync(() => root.render(page)), 0);
        else flushSync(() => root.render(page));
    };
    const opener = userSettings.openUserSettings;
    userSettings.openUserSettings = function (this: Candidate, target: string, routeOptions: {section: string}) {
        calls.push({receiver: this, target, options: routeOptions});
        navigationOrder.push("open");
        opener.call(this, target, routeOptions);
        renderPage(routeOptions.section);
    };
    const renderer = settingsRenderer(userSettings);
    const openCategory = categoryOpener(renderer);
    const useMenu = renderMenu(manager, openCategory);
    function Menu() {return useMenu();}
    await act(async () => root.render(<Menu />));
    return {
        lookups,
        calls,
        userSettings,
        openButton: () => container.querySelector<HTMLButtonElement>("[data-store-menu=\"" + prefix + "-store\"]")!
    };
}

describe("Addon Store navigation", () => {
    test("opens Store initially with no addons even when the removed saved setting was false", async () => {
        await act(async () => root.render(<AddonPage title="Plugins" store={makeManager("plugin")} />));
        expect(container.querySelector("[data-store-page]")).not.toBeNull();
        expect(container.querySelector("[data-empty-slate]")).toBeNull();
    });

    test("shows Store navigation with installed addons and navigates in both directions", async () => {
        await act(async () => root.render(<AddonPage title="Plugins" store={makeManager("plugin", [sampleAddon()])} />));
        const storeCard = container.querySelector<HTMLElement>(".bd-store-card");
        expect(storeCard).not.toBeNull();
        expect(container.querySelector("[data-store-page]")).toBeNull();

        await act(async () => storeCard!.click());
        expect(container.querySelector("[data-store-page]")).not.toBeNull();
        await act(async () => container.querySelector<HTMLButtonElement>("[data-store-back]")!.click());
        expect(container.querySelector("[data-store-page]")).toBeNull();
        expect(container.querySelector(".bd-store-card")).not.toBeNull();
    });

    test("keeps the Store card and empty-state Store action available with no addons", async () => {
        await act(async () => root.render(<AddonPage title="Plugins" store={makeManager("plugin")} />));
        await act(async () => container.querySelector<HTMLButtonElement>("[data-store-back]")!.click());
        expect(container.querySelector("[data-empty-slate]")).not.toBeNull();
        expect(container.querySelector(".bd-store-card")).not.toBeNull();
        expect(container.textContent).toContain("Addons.openStore");
    });

    test("plugin menu uses opener-only fallback and clicks the Store card after delayed page mount", async () => {
        const events: string[] = [];
        const openerOnly: Candidate = {openUserSettings(this: Candidate, target: string, options: {section: string}) {
            expect(this).toBe(openerOnly);
            events.push(target + ":" + options.section);
        }};
        const setup = await mountMenuAndNavigate({prefix: "plugin", candidates: [openerOnly], delayed: true});
        expect(setup.lookups).toEqual([["openUserSettings", "USER_SETTINGS_MODAL_KEY"], ["openUserSettings"]]);

        await act(async () => {
            setup.openButton().click();
        });
        await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
        await act(async () => Promise.resolve());

        expect(navigationOrder).toEqual(["close", "open"]);
        expect(events).toEqual(["betterdiscord_plugins_panel:plugins"]);
        expect(setup.calls).toHaveLength(1);
        expect(setup.calls[0].receiver).toBe(setup.userSettings);
        expect(setup.calls[0].target).toBe("betterdiscord_plugins_panel");
        expect(setup.calls[0].options).toEqual({section: "plugins"});
        expect(domAddedCalls).toEqual([":where(.bd-store-card, .bd-addon-title > :nth-child(3))"]);
        expect(container.querySelector("[data-store-page]")).not.toBeNull();
    });

    test("theme menu prefers combined exports and opens Store from the mounted Store card", async () => {
        const openerOnly: Candidate = {openUserSettings() {}};
        const combined: Candidate = {
            USER_SETTINGS_MODAL_KEY: "USER_SETTINGS_MODAL_KEY",
            openUserSettings(this: Candidate, target: string, routeOptions: {section: string}) {
                expect(this.USER_SETTINGS_MODAL_KEY).toBe("USER_SETTINGS_MODAL_KEY");
                expect(target).toBe("betterdiscord_themes_panel");
                expect(routeOptions).toEqual({section: "themes"});
            }
        };
        const setup = await mountMenuAndNavigate({prefix: "theme", candidates: [openerOnly, combined]});
        expect(setup.lookups).toEqual([["openUserSettings", "USER_SETTINGS_MODAL_KEY"]]);
        await act(async () => setup.openButton().click());

        expect(navigationOrder).toEqual(["close", "open"]);
        expect(setup.calls[0].receiver).toBe(combined);
        await act(async () => Promise.resolve());
        expect(domAddedCalls).toEqual([":where(.bd-store-card, .bd-addon-title > :nth-child(3))"]);
        expect(container.querySelector("[data-store-page]")).not.toBeNull();
        expect(container.querySelector(".bd-addon-title")?.textContent).toContain("Addons.store");
        expect(container.querySelector(".bd-addon-title > :nth-child(2)[data-chevron]")).not.toBeNull();
        expect(container.querySelector(".bd-addon-title > :nth-child(3)")?.textContent).toBe("Addons.store");
    });

    test("leaves an initially empty Store open when its menu target is already visible", async () => {
        const candidate: Candidate = {USER_SETTINGS_MODAL_KEY: "USER_SETTINGS_MODAL_KEY", openUserSettings() {}};
        const setup = await mountMenuAndNavigate({prefix: "plugin", addons: [], candidates: [candidate]});
        await act(async () => setup.openButton().click());

        expect(setup.calls[0].target).toBe("betterdiscord_plugins_panel");
        expect(container.querySelector("[data-store-page]")).not.toBeNull();
        expect(container.querySelector("[data-store-back]")).not.toBeNull();
        expect(container.querySelector("[data-empty-slate]")).toBeNull();
    });
});
