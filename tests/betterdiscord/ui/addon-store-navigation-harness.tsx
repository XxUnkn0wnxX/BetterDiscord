import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@modules/discordmodules", () => ({"default": {Tooltip: ({children}: any) => children({})}}));
mock.module("@modules/ipc", () => ({"default": {openPath: () => undefined}}));
mock.module("@stores/settings", () => ({"default": {get: () => false}}));
mock.module("@stores/json", () => ({"default": {get: () => ({}), set: () => undefined}}));
const MockButton = Object.assign(({children, onClick, ...props}: any) => <button onClick={onClick} {...props}>{children}</button>, {
    Sizes: {LARGE: "large", NONE: "none"},
    Looks: {BLANK: "blank"}
});
mock.module("@ui/base/button", () => ({"default": MockButton}));
mock.module("@ui/blankslates/empty", () => ({
    "default": ({title, children}: any) => <div data-empty-slate>{title}{children}</div>
}));
mock.module("@ui/blankslates/noresults", () => ({"default": () => <div data-no-results />}));
mock.module("@ui/errorboundary", () => ({"default": ({children}: any) => <>{children}</>}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: () => undefined}}));
const MockText = Object.assign(({children}: any) => <span>{children}</span>, {Colors: {HEADER_PRIMARY: "primary", HEADER_SECONDARY: "secondary"}});
mock.module("@ui/base/text", () => ({"default": MockText}));
mock.module("@ui/settings/components/dropdown", () => ({"default": () => <div />}));
mock.module("@ui/settings/components/search", () => ({"default": () => <input />}));
mock.module("@ui/settings/title", () => ({
    "default": ({children}: any) => children,
    "SettingsTitlePublisher": ({title}: any) => title
}));
mock.module("@ui/settings", () => ({SettingsTitleContext: React.createContext(() => undefined)}));
mock.module("@ui/hooks", () => ({useStateFromStores: (_store: unknown, selector: () => unknown) => selector()}));
mock.module("lucide-react", () => ({
    BadgeCheckIcon: () => null,
    CheckIcon: () => null,
    ChevronRightIcon: () => null,
    FolderIcon: () => null,
    LayoutGridIcon: () => null,
    StoreIcon: () => null,
    StretchHorizontalIcon: () => null,
    XIcon: () => null
}));
mock.module(import.meta.resolve("../../../src/betterdiscord/ui/settings/addoncard.tsx"), () => ({"default": () => null}));
mock.module(import.meta.resolve("../../../src/betterdiscord/ui/settings/addonstore.tsx"), () => ({
    "default": () => {
        const {toggleStore} = React.useContext(addonContext);
        return <button data-store-page onClick={toggleStore}>Back to addons</button>;
    }
}));

const {addonContext} = await import("@ui/settings/addonshared");
const {"default": AddonPage} = await import("@ui/settings/addonpage");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

function makeManager(addonList: any[] = []) {
    return {
        prefix: "plugin",
        addonList,
        state: {},
        addonFolder: "/plugins",
        resolveAddon: () => undefined,
        isEnabled: () => false,
        toggleAddon: () => undefined,
        enableAllAddons: () => undefined,
        disableAllAddons: () => undefined
    } as any;
}

describe("Addon Store navigation", () => {
    test("opens Store initially with no addons even when the removed saved setting was false", async () => {
        await act(async () => root.render(<AddonPage title="Plugins" store={makeManager()} />));

        expect(container.querySelector("[data-store-page]")).not.toBeNull();
        expect(container.querySelector("[data-empty-slate]")).toBeNull();
    });

    test("shows Store navigation with installed addons and navigates in both directions", async () => {
        const addon = {id: "sample", name: "Sample", author: "Author", description: "Description", version: "1.0", added: 1, modified: 1};
        await act(async () => root.render(<AddonPage title="Plugins" store={makeManager([addon])} />));

        const storeCard = container.querySelector<HTMLElement>(".bd-store-card");
        expect(storeCard).not.toBeNull();
        expect(container.querySelector("[data-store-page]")).toBeNull();

        await act(async () => storeCard!.click());
        expect(container.querySelector("[data-store-page]")).not.toBeNull();

        await act(async () => container.querySelector<HTMLButtonElement>("[data-store-page]")!.click());
        expect(container.querySelector("[data-store-page]")).toBeNull();
        expect(container.querySelector(".bd-store-card")).not.toBeNull();
    });

    test("keeps the Store card and empty-state Store action available with no addons", async () => {
        await act(async () => root.render(<AddonPage title="Plugins" store={makeManager()} />));
        await act(async () => container.querySelector<HTMLButtonElement>("[data-store-page]")!.click());

        expect(container.querySelector("[data-empty-slate]")).not.toBeNull();
        expect(container.querySelector(".bd-store-card")).not.toBeNull();
        expect(container.textContent).toContain("Addons.openStore");
    });
});
