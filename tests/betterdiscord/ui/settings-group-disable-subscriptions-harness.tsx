import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import type {GroupOnChange} from "@ui/settings/group";


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
if (typeof (globalThis as any).window.BetterDiscordPreload !== "function") {
    (globalThis as any).window.BetterDiscordPreload = () => ({});
}


type StoreListener = () => void;

const storeListeners = new Set<StoreListener>();
const storeState = {
    disabled: true
};

mock.module("@stores/settings", () => ({
    "default": {
        addChangeListener: (listener: StoreListener) => {
            storeListeners.add(listener);
        },
        removeChangeListener: (listener: StoreListener) => {
            storeListeners.delete(listener);
        },
        get: (_collection: string, _category: string, id: string) => {
            if (id === "dependent-toggle") return false;
            return undefined;
        },
        getSetting: (_collection: string, _category: string, id?: string) => {
            if (id === "dependent-toggle") return {disabled: storeState.disabled};
            return {disabled: false};
        }
    }
}));
mock.module("@ui/settings/components/file", () => ({"default": () => <div data-file-setting />}));
const noopFunction = () => undefined;

mock.module("@polyfill/remote", () => ({
    "default": {
        filesystem: {
            readFile: noopFunction,
            writeFile: noopFunction,
            readDirectory: noopFunction,
            createDirectory: noopFunction,
            deleteDirectory: noopFunction,
            exists: noopFunction,
            getStats: noopFunction,
            renameSync: noopFunction,
            rmSync: noopFunction,
            getRealPath: noopFunction,
            unlinkSync: noopFunction,
            watch: noopFunction,
            createWriteStream: noopFunction
        },
        editor: {
            open: noopFunction
        },
        openExternal: noopFunction,
        app: {
            openPath: noopFunction
        }
    }
}));
mock.module("@stores/config", () => ({
    "default": {
        data: {
            branch: "main",
            commit: "test",
            build: "test",
            version: "0.0.0",
            appPath: "",
            userData: "",
            bdPath: "",
            dataPath: "",
            pluginsPath: "",
            themesPath: "",
            channelPath: "stable"
        },
        isDevelopment: false,
        isCanary: false
    }
}));
mock.module("@ui/settings/components/dropdown", () => ({"default": () => <div data-setting="dropdown" />}));
mock.module("@ui/settings/components/number", () => ({"default": () => <div data-setting="number" />}));
mock.module("@ui/settings/components/textbox", () => ({"default": () => <div data-setting="textbox" />}));
mock.module("@ui/settings/components/slider", () => ({"default": () => <div data-setting="slider" />}));
mock.module("@ui/settings/components/radio", () => ({"default": () => <div data-setting="radio" />}));
mock.module("@ui/settings/components/keybind", () => ({"default": () => <div data-setting="keybind" />}));
mock.module("@ui/settings/components/color", () => ({"default": () => <div data-setting="color" />}));
mock.module("@ui/settings/components/position", () => ({"default": () => <div data-setting="position" />}));

const {default: Group} = await import("@ui/settings/group");


function emitStoreChange() {
    for (const listener of [...storeListeners]) {
        listener();
    }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    storeState.disabled = true;
    storeListeners.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    storeListeners.clear();
});

describe("Group with collection-backed controls", () => {
    const settings = [
        {type: "switch", id: "dependent-toggle", name: "Dependent", defaultValue: false, disabled: true},
        {type: "button", id: "manual-action", name: "Manual Action", disabled: true, children: "Blocked"},
        {type: "switch", id: "other", name: "Other", defaultValue: false}
    ];

    test("uses store-driven disable updates via context without rerendering Group", async () => {
        const callbacks: Array<{category: string; setting: string; value: boolean}> = [];
        function onChange(setting: string, value: boolean): void;
        function onChange(category: string, setting: string, value: boolean): void;
        function onChange(categoryOrSetting: string, settingOrValue: string | boolean, value?: boolean): void {
            if (value === undefined) {
                callbacks.push({category: "category", setting: categoryOrSetting, value: settingOrValue as boolean});
                return;
            }

            callbacks.push({category: categoryOrSetting, setting: String(settingOrValue), value});
        }
        const onChangeAdapter: GroupOnChange = onChange;

        await act(async () => {
            root.render(
                <Group
                    id="category"
                    name="Settings"
                    collection="collection"
                    settings={settings}
                    onChange={onChangeAdapter}
                />
            );
        });

        const dependentInput = container.querySelector<HTMLInputElement>("input[type='checkbox']");
        expect(dependentInput).toBeTruthy();
        expect(dependentInput!.disabled).toBe(true);

        storeState.disabled = false;
        await act(async () => emitStoreChange());
        expect(dependentInput!.disabled).toBe(false);

        await act(async () => dependentInput!.click());
        expect(callbacks).toEqual([{category: "category", setting: "dependent-toggle", value: true}]);
    });

    test("does not strip disabled on non-context settings", async () => {
        await act(async () => {
            root.render(
                <Group
                    id="category"
                    name="Settings"
                    collection="collection"
                    settings={settings}
                    onChange={() => {}}
                />
            );
        });

        const manualButton = container.querySelector<HTMLButtonElement>("button.bd-button");
        expect(manualButton).toBeTruthy();
        expect(manualButton!.disabled).toBe(true);
    });
});
