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
    disabled: true,
    providerDisabled: false,
    providerToken: "gh-dummy-token-123456"
};
type ValidationResult = {status: "valid"} | {status: "invalid"} | {status: "unavailable"; reason: "permission" | "rate-limit" | "network" | "response"; missingPermission?: "read:user" | "read:repository" | "user-read"};
type PendingValidation = {provider: string; candidate: string; signal: AbortSignal; resolve(result: ValidationResult): void;};
const validationRequests: PendingValidation[] = [];
let nativeInputAvailable = false;
let modernNativeInputOnly = false;
type ValidationListener = (...args: any[]) => void;
type ScheduledTimer = {at: number; callback: (...args: any[]) => void; args: any[];};
const validationListeners = new Map<string, Set<ValidationListener>>();
const validateProviderToken = (provider: string, candidate: string, signal: AbortSignal) => new Promise<ValidationResult>(resolve => {
    validationRequests.push({provider, candidate, signal, resolve});
});
function NativeTextInput(props: {id: string; value: string; type: string; error?: string; disabled?: boolean; maxLength: number; autoComplete: string; spellCheck: boolean; inputRef: React.Ref<HTMLInputElement>; onChange(value: string, name?: string): void;}) {
    return <div data-native-text-input>
        <input id={props.id} type={props.type} value={props.value} disabled={props.disabled} maxLength={props.maxLength} autoComplete={props.autoComplete} spellCheck={props.spellCheck} ref={props.inputRef} onChange={event => props.onChange(event.currentTarget.value, props.id)} />
        {props.error && <div data-native-error>{props.error}</div>}
    </div>;
}

mock.module("@modules/emitter", () => ({"default": {
    on: (name: string, listener: (...args: any[]) => void) => {
        if (!validationListeners.has(name)) validationListeners.set(name, new Set());
        validationListeners.get(name)!.add(listener);
    },
    off: (name: string, listener: (...args: any[]) => void) => validationListeners.get(name)?.delete(listener),
    dispatch: (name: string, ...args: any[]) => {for (const listener of validationListeners.get(name) ?? []) listener(...args);}
}}));
mock.module("@modules/provider-token-validation", () => ({validateProviderToken}));
mock.module("@webpack", () => ({getByStrings: (strings: string[]) => {
    if (!nativeInputAvailable || modernNativeInputOnly && !strings.includes("data-mana-component")) return undefined;
    return NativeTextInput;
}}));

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
            if (id === "github" || id === "gitlab" || id === "slowbro") return storeState.providerToken;
            return undefined;
        },
        getSetting: (_collection: string, _category: string, id?: string) => {
            if (id === "dependent-toggle") return {disabled: storeState.disabled};
            if (id === "github") return {disabled: storeState.providerDisabled};
            return {disabled: false};
        }
    }
}));
mock.module("@ui/settings/components/file", () => ({"default": () => <div data-file-setting />}));
// Preserve the real Button while isolating its new Discord-backed Spinner dependency.
mock.module("@ui/spinner", () => ({
    "default": () => null,
    "SpinnerType": {PULSING_ELLIPSIS: "pulsing-ellipsis"}
}));
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
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@ui/settings/components/slider", () => ({"default": () => <div data-setting="slider" />}));
mock.module("@ui/settings/components/radio", () => ({"default": () => <div data-setting="radio" />}));
mock.module("@ui/settings/components/keybind", () => ({"default": () => <div data-setting="keybind" />}));
mock.module("@ui/settings/components/color", () => ({"default": () => <div data-setting="color" />}));
mock.module("@ui/settings/components/position", () => ({"default": () => <div data-setting="position" />}));

const {default: Group} = await import("@ui/settings/group");
const {default: Notifications} = await import("@stores/notifications");


function emitStoreChange() {
    for (const listener of [...storeListeners]) {
        listener();
    }
}

let container: HTMLDivElement;
let root: Root;
let fakeTimersEnabled = false;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let fakeTime = 0;
let nextTimerId = 0;
const fakeTimers = new Map<number, ScheduledTimer>();

function enableFakeTimers() {
    fakeTimersEnabled = true;
    fakeTime = 0;
    fakeTimers.clear();
    (globalThis as any).setTimeout = (callback: (...args: any[]) => void, delay = 0, ...args: any[]) => {
        const id = ++nextTimerId;
        fakeTimers.set(id, {at: fakeTime + Math.max(0, Number(delay) || 0), callback, args});
        return id;
    };
    (globalThis as any).clearTimeout = (id: number) => {fakeTimers.delete(id);};
}

function resetFakeTimers() {
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
    fakeTimers.clear();
    fakeTimersEnabled = false;
}

async function advanceTimers(ms: number) {
    await act(async () => {
        fakeTime += ms;
        while (true) {
            const due = [...fakeTimers.entries()].filter(([, timer]) => timer.at <= fakeTime).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            fakeTimers.delete(due[0]);
            due[1].callback(...due[1].args);
        }
        await Promise.resolve();
        await Promise.resolve();
    });
}

function changeNativeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", {bubbles: true}));
    input.dispatchEvent(new Event("change", {bubbles: true}));
}

function dispatchPrivateEvent(name: string, ...args: any[]) {
    for (const listener of validationListeners.get(name) ?? []) listener(...args);
}

beforeEach(() => {
    storeState.disabled = true;
    storeState.providerDisabled = false;
    storeState.providerToken = "gh-dummy-token-123456";
    nativeInputAvailable = true;
    modernNativeInputOnly = false;
    validationRequests.length = 0;
    validationListeners.clear();
    storeListeners.clear();
    for (const notification of Notifications.notifications) Notifications.hide(notification);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    if (fakeTimersEnabled) {
        resetFakeTimers();
    }
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

    test("validates private native token drafts before save and cancels stale work", async () => {
        const callbacks: unknown[][] = [];
        enableFakeTimers();
        const onChange = (...args: unknown[]) => {
            callbacks.push(args);
            if (args.length === 3 && args[1] === "github") {
                storeState.providerToken = String(args[2]);
                emitStoreChange();
            }
        };
        await act(async () => root.render(
            <Group id="accessTokens" collection="settings" settings={[
                {type: "text", id: "github", name: "GitHub Token", value: "gh-dummy-token-123456"}
            ]} onChange={onChange as any} />
        ));

        const input = container.querySelector<HTMLInputElement>("input#github");
        expect(input?.type).toBe("password");
        expect(input?.value).toBe("gh-dummy-token-123456");
        expect(validationRequests).toHaveLength(0);
        const toggle = container.querySelector<HTMLButtonElement>("button[aria-label='ProviderTokens.show']");
        expect(toggle).toBeTruthy();
        await act(async () => toggle!.click());
        expect(input?.type).toBe("text");
        expect(callbacks).toHaveLength(0);
        const hideToggle = container.querySelector<HTMLButtonElement>("button[aria-label='ProviderTokens.hide']");
        expect(hideToggle).toBeTruthy();
        await act(async () => hideToggle!.click());
        expect(input?.type).toBe("password");
        expect(callbacks).toHaveLength(0);
        await act(async () => toggle!.click());
        expect(input?.type).toBe("text");
        expect(validationRequests).toHaveLength(0);

        await act(async () => changeNativeInput(input!, "gh-updated-dummy-token"));
        expect(callbacks).toHaveLength(0);
        await advanceTimers(749);
        expect(validationRequests).toHaveLength(0);
        await advanceTimers(1);
        expect(validationRequests.map(request => request.candidate)).toEqual(["gh-updated-dummy-token"]);
        await act(async () => validationRequests[0].resolve({status: "valid"}));
        expect(callbacks).toEqual([["accessTokens", "github", "gh-updated-dummy-token"]]);

        await act(async () => changeNativeInput(input!, "gh-invalid-draft"));
        await advanceTimers(750);
        await act(async () => validationRequests[1].resolve({status: "invalid"}));
        expect(container.querySelector("[data-native-error]")?.textContent).toBe("ProviderTokens.invalid");
        expect(storeState.providerToken).toBe("gh-updated-dummy-token");
        expect(container.querySelector(".bd-provider-token-retry")).toBeNull();
        expect(callbacks).toHaveLength(1);

        await act(async () => changeNativeInput(input!, "gh-temporary-draft"));
        await advanceTimers(750);
        await act(async () => validationRequests[2].resolve({status: "unavailable", reason: "network"}));
        expect(storeState.providerToken).toBe("gh-updated-dummy-token");
        expect(callbacks).toHaveLength(1);
        const retryButton = container.querySelector<HTMLButtonElement>(".bd-provider-token-retry");
        expect(retryButton).toBeTruthy();
        await act(async () => retryButton!.click());
        await advanceTimers(0);
        expect(validationRequests[3].candidate).toBe("gh-temporary-draft");
        await act(async () => validationRequests[3].resolve({status: "valid"}));
        expect(storeState.providerToken).toBe("gh-temporary-draft");
        expect(callbacks).toHaveLength(2);

        await act(async () => changeNativeInput(input!, "gh-stale-draft"));
        await advanceTimers(750);
        const staleRequest = validationRequests[4];
        await act(async () => changeNativeInput(input!, "gh-newer-draft"));
        expect(staleRequest.signal.aborted).toBe(true);
        await act(async () => staleRequest.resolve({status: "valid"}));
        expect(callbacks).toHaveLength(2);

        await act(async () => changeNativeInput(input!, "  "));
        expect(callbacks).toEqual([
            ["accessTokens", "github", "gh-updated-dummy-token"],
            ["accessTokens", "github", "gh-temporary-draft"],
            ["accessTokens", "github", ""]
        ]);
        expect(storeState.providerToken).toBe("");

        await act(async () => changeNativeInput(input!, "gh-reset-draft"));
        await advanceTimers(750);
        const resetRequest = validationRequests[5];
        await act(async () => dispatchPrivateEvent("provider-tokens-reset"));
        expect(resetRequest.signal.aborted).toBe(true);
        expect(input!.value).toBe("");
        await act(async () => resetRequest.resolve({status: "valid"}));
        expect(callbacks).toHaveLength(3);

        await act(async () => changeNativeInput(input!, "gh-disabled-draft"));
        await advanceTimers(750);
        const disabledRequest = validationRequests[6];
        storeState.providerDisabled = true;
        await act(async () => emitStoreChange());
        expect(disabledRequest.signal.aborted).toBe(true);
        expect(input!.disabled).toBe(true);
        await act(async () => disabledRequest.resolve({status: "valid"}));
        expect(callbacks).toHaveLength(3);

        storeState.providerDisabled = false;
        await act(async () => emitStoreChange());
        await act(async () => changeNativeInput(input!, "gh-unmounted-draft"));
        await advanceTimers(750);
        const unmountedRequest = validationRequests[7];
        await act(async () => root.unmount());
        expect(unmountedRequest.signal.aborted).toBe(true);
        await act(async () => unmountedRequest.resolve({status: "valid"}));
        expect(callbacks).toHaveLength(3);
    });

    test("external token removal clears and re-masks only its field and blocks a late save", async () => {
        const callbacks: unknown[][] = [];
        enableFakeTimers();
        await act(async () => root.render(<Group id="accessTokens" collection="settings" settings={[
            {type: "text", id: "github", name: "GitHub", value: storeState.providerToken},
            {type: "text", id: "gitlab", name: "GitLab", value: storeState.providerToken}
        ]} onChange={((...args: unknown[]) => callbacks.push(args)) as any} />));
        const input = container.querySelector<HTMLInputElement>("input#github")!;
        const other = container.querySelector<HTMLInputElement>("input#gitlab")!;
        await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='ProviderTokens.show']")!.click());
        await act(async () => changeNativeInput(input, "pending-dummy-replacement"));
        await advanceTimers(750);
        const pending = validationRequests[0];
        storeState.providerToken = "";
        await act(async () => dispatchPrivateEvent("provider-token-cleared", "github"));
        expect(input.value).toBe("");
        expect(input.type).toBe("password");
        expect(other.value).toBe("gh-dummy-token-123456");
        expect(pending.signal.aborted).toBe(true);
        await act(async () => pending.resolve({status: "valid"}));
        expect(callbacks).toHaveLength(0);
    });

    test("current setup permission failures show persistent warnings while stale results stay silent", async () => {
        const callbacks: unknown[][] = [];
        enableFakeTimers();
        await act(async () => root.render(<Group id="accessTokens" collection="settings" settings={[
            {type: "text", id: "slowbro", name: "Slowbro", value: storeState.providerToken}
        ]} onChange={((...args: unknown[]) => callbacks.push(args)) as any} />));
        const input = container.querySelector<HTMLInputElement>("input#slowbro")!;
        await act(async () => changeNativeInput(input, "missing-scope-dummy"));
        await advanceTimers(750);
        await act(async () => validationRequests[0].resolve({status: "unavailable", reason: "permission", missingPermission: "read:repository"}));
        expect(callbacks).toHaveLength(0);
        expect(storeState.providerToken).toBe("gh-dummy-token-123456");
        expect(Notifications.notifications).toHaveLength(1);
        expect(Notifications.notifications[0].id).toBe("provider-token-permissions-slowbro");
        expect(Notifications.notifications[0].duration).toBe(Infinity);
        expect(Notifications.notifications[0].type).toBe("warning");
        Notifications.hide("provider-token-permissions-slowbro");
        await act(async () => changeNativeInput(input, "stale-scope-dummy"));
        await advanceTimers(750);
        const stale = validationRequests[1];
        await act(async () => changeNativeInput(input, "newer-dummy-token"));
        await act(async () => stale.resolve({status: "unavailable", reason: "permission", missingPermission: "read:user"}));
        expect(Notifications.notifications).toHaveLength(0);
        await advanceTimers(750);
        const unmounted = validationRequests[2];
        await act(async () => root.unmount());
        await act(async () => unmounted.resolve({status: "unavailable", reason: "permission", missingPermission: "read:user"}));
        expect(Notifications.notifications).toHaveLength(0);
        expect(callbacks).toHaveLength(0);
    });

    test("uses the native alternative when the legacy input is unavailable", async () => {
        modernNativeInputOnly = true;
        await act(async () => root.render(<Group id="accessTokens" collection="settings" settings={[
            {type: "text", id: "github", name: "GitHub Token", value: storeState.providerToken}
        ]} />));
        expect(container.querySelector<HTMLInputElement>("input#github")?.type).toBe("password");
        expect(validationRequests).toHaveLength(0);
    });

    test("ordinary plugin text setting keeps its textbox renderer", async () => {
        await act(async () => root.render(<Group id="plugin-settings" collection="plugin:test" settings={[
            {type: "text", id: "ordinary", value: "plain"}
        ]} />));
        expect(container.querySelector("[data-setting='textbox']")).toBeTruthy();
    });
});
