import {afterEach, beforeEach, describe, expect, test, mock} from "bun:test";
import React, {act, type HTMLAttributes, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

type FlexProps = HTMLAttributes<HTMLDivElement> & {
    align?: string;
    direction?: string;
    justify?: string;
};

const MockFlex = Object.assign(
    ({children, align: _align, direction: _direction, justify: _justify, ...props}: FlexProps) => <div {...props}>{children}</div>,
    {
        Align: {CENTER: "center"},
        Direction: {VERTICAL: "vertical"},
        Justify: {BETWEEN: "between"}
    }
);
const MockText = ({children, ...props}: HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>;
const MockButton = ({children, ...props}: HTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>;
const MockFooter = MockFlex;
const MockModalRoot = ({children, className, size: _size, transitionState: _transitionState, ...props}: FlexProps & {size?: string; transitionState?: number}) => (
    <div className={className} {...props}>{children}</div>
);
const MockCheckBox = ({value, onChange, label}: {value: boolean; onChange(value: boolean): void; label: ReactNode;}) => (
    <label>
        <input type="checkbox" checked={value} onChange={(event) => onChange(event.currentTarget.checked)} />
        {label}
    </label>
);
const MockSpinner = Object.assign((_props: {type?: string}) => <span />, {Type: {PULSING_ELLIPSIS: "pulsing-ellipsis"}});
const MockIcon = (_props: {size?: string}) => <span />;
const MockFlowerStar = (_props: {size?: number}) => <span />;

let alwaysEnable = false;
const eventListeners = new Map<string, Set<() => void>>();
const Events = {
    on(event: string, listener: () => void) {
        const listeners = eventListeners.get(event) ?? new Set<() => void>();
        listeners.add(listener);
        eventListeners.set(event, listeners);
    },
    off(event: string, listener: () => void) {
        eventListeners.get(event)?.delete(listener);
    }
};

const emitEvent = (event: string) => {
    for (const listener of eventListeners.get(event) ?? []) listener();
};

const MockTooltip = ({children}: {children: ReactNode | ((props: Record<string, never>) => ReactNode);}) => (
    typeof children === "function" ? children({}) : children
);

mock.module("@modules/discordmodules", () => ({"default": {Tooltip: MockTooltip}}));
mock.module("@modules/localemanager", () => ({"default": {discordLocale: "en-US"}}));
mock.module("@stores/settings", () => ({"default": {get: () => alwaysEnable}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@data/web", () => ({"default": {resources: {thumbnail: () => "about:blank"}}}));
mock.module("@modules/emitter", () => ({"default": Events}));
mock.module("@ui/base/button", () => ({"default": MockButton}));
mock.module("@ui/base/flex", () => ({"default": MockFlex}));
mock.module("@ui/base/text", () => ({"default": Object.assign(MockText, {Sizes: {SIZE_20: "20", SIZE_12: "12"}, Colors: {HEADER_PRIMARY: "header-primary", MUTED: "muted"}})}));
mock.module("@ui/modals/footer", () => ({"default": MockFooter}));
mock.module("@ui/modals/root", () => ({"default": Object.assign(MockModalRoot, {Sizes: {SMALL: "small"}})}));
mock.module("@ui/settings/components/checkbox", () => ({"default": MockCheckBox}));
mock.module("@ui/spinner", () => ({"default": MockSpinner}));
mock.module("@ui/settings/addonshared", () => ({FlowerStar: MockFlowerStar}));
mock.module("lucide-react", () => ({
    CircleHelpIcon: MockIcon,
    ClockIcon: MockIcon,
    GithubIcon: MockIcon,
    InfoIcon: MockIcon,
    TagIcon: MockIcon,
    UserIcon: MockIcon
}));

const {default: InstallModal} = await import("@ui/modals/installmodal");

type MockAddon = {
    avatar: string;
    author: string;
    description: string;
    filename: string;
    guild: null;
    isInstalled(): boolean;
    lastModified: Date;
    name: string;
    openAuthorPage(): void;
    openSourceCode(): void;
    thumbnail: null;
    type: "plugin";
    version: string;
};

const makeAddon = (isInstalled: () => boolean): MockAddon => ({
    avatar: "about:blank",
    author: "Test Author",
    description: "Test addon",
    filename: "TestAddon.plugin.js",
    guild: null,
    isInstalled,
    lastModified: new Date("2026-01-01T00:00:00.000Z"),
    name: "Test Addon",
    openAuthorPage: () => {},
    openSourceCode: () => {},
    thumbnail: null,
    type: "plugin",
    version: "1.0.0"
});

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    alwaysEnable = false;
    eventListeners.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    eventListeners.clear();
    container.remove();
});

async function renderModal(addon: MockAddon, install: (shouldEnable: boolean) => Promise<void>, onClose: () => void) {
    await act(async () => {
        root.render(
            <InstallModal
                addon={addon as never}
                transitionState={1}
                install={install}
                onClose={onClose}
            />
        );
    });
    return container.querySelector<HTMLButtonElement>("button")!;
}

describe("InstallModal close ownership", () => {
    test("closes once after a disabled install settles", async () => {
        const deferred = createDeferred<void>();
        const installArguments: boolean[] = [];
        let closeCalls = 0;
        const button = await renderModal(
            makeAddon(() => false),
            (shouldEnable) => {
                installArguments.push(shouldEnable);
                return deferred.promise;
            },
            () => {closeCalls++;}
        );

        await act(async () => button.click());
        expect(installArguments).toEqual([false]);

        await act(async () => {
            deferred.resolve(undefined);
            await deferred.promise;
        });
        expect(closeCalls).toBe(1);
    });

    test("keeps the loaded-event and install settlement race to one close", async () => {
        alwaysEnable = true;
        const deferred = createDeferred<void>();
        const installArguments: boolean[] = [];
        let installed = false;
        let closeCalls = 0;
        const button = await renderModal(
            makeAddon(() => installed),
            (shouldEnable) => {
                installArguments.push(shouldEnable);
                return deferred.promise;
            },
            () => {closeCalls++;}
        );

        await act(async () => button.click());
        installed = true;
        await act(async () => emitEvent("plugin-loaded"));
        expect(closeCalls).toBe(1);

        await act(async () => {
            deferred.resolve(undefined);
            await deferred.promise;
        });
        expect(installArguments).toEqual([true]);
        expect(closeCalls).toBe(1);
    });

    test("closes once for a rejected install without an unhandled rejection", async () => {
        const deferred = createDeferred<void>();
        let closeCalls = 0;
        let unhandledRejection: unknown;
        const onUnhandledRejection = (reason: unknown) => {unhandledRejection = reason;};
        process.on("unhandledRejection", onUnhandledRejection);
        try {
            const button = await renderModal(
                makeAddon(() => false),
                () => deferred.promise,
                () => {closeCalls++;}
            );
            await act(async () => button.click());
            await act(async () => {
                deferred.reject(new Error("install failed"));
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            });
        }
        finally {
            process.off("unhandledRejection", onUnhandledRejection);
        }

        expect(closeCalls).toBe(1);
        expect(unhandledRejection).toBeUndefined();
    });
});
