import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import findInTree from "../../../src/common/utils/findintree";


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

type AfterCallback = (thisObject: object, args: unknown[], returnValue: unknown) => unknown;
const patcherErrors: unknown[][] = [];
const mockLogger = {
    debug: () => {},
    info: () => {},
    log: () => {},
    warn: () => {},
    error: () => {},
    stacktrace: () => {},
    err: (...args: unknown[]) => patcherErrors.push(args)
};

mock.module("@common/logger", () => ({"default": mockLogger}));

class DynamicBuiltin {
    after(object: object | undefined, functionName: string, callback: AfterCallback) {
        if (!object) return;
        return Patcher.after("ThemeAttributes", object as any, functionName as never, callback as never);
    }

    unpatchAll() {
        Patcher.unpatchAll("ThemeAttributes");
    }
}

const mockBuiltin = () => ({"default": DynamicBuiltin});
const builtinPath = import.meta.resolve("../../../src/betterdiscord/structs/builtin");
mock.module("@structs/builtin", mockBuiltin);
mock.module(builtinPath, mockBuiltin);

type MessageHook = {key: () => null};
type MessageComponentModule = {A: {type: (props: {message: {id: string;};}) => React.ReactElement}};

let messageHook: MessageHook;
let messageComponentModule: MessageComponentModule;
let queuedMessageHooks: MessageHook[] = [];
let resolveMessageHook: ((module: MessageHook) => void) | undefined;
let deferMessageHook = false;

const mockWebpack = () => ({
    Filters: {byStrings: () => () => true},
    getByKeys: () => undefined,
    getLazy: async () => undefined,
    getLazyBySource: async () => messageComponentModule,
    getLazyByStrings: async () => undefined,
    getMangledLazy: async () => {
        const hook = queuedMessageHooks.shift() ?? messageHook;
        if (!deferMessageHook) return hook;
        return await new Promise<typeof messageHook>(resolve => resolveMessageHook = resolve);
    },
    Stores: {UserStore: {}}
});
const webpackPath = import.meta.resolve("../../../src/betterdiscord/webpack");
mock.module("@webpack", mockWebpack);
mock.module(webpackPath, mockWebpack);

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);
const mockDiscordModules = () => ({"default": {}});
mock.module("@modules/discordmodules", mockDiscordModules);
mock.module(modulePath("discordmodules.ts"), mockDiscordModules);
mock.module(modulePath("discordmodules"), mockDiscordModules);
mock.module("../../../src/betterdiscord/modules/discordmodules", mockDiscordModules);

const {default: Patcher} = await import("@modules/patcher");

const commonUtilsPath = import.meta.resolve("../../../src/common/utils");
mock.module("@common/utils", () => ({findInTree}));
mock.module(commonUtilsPath, () => ({findInTree}));

const themeAttributesModule = process.env.THEME_ATTRIBUTES_TEST_MODULE ?? "@builtins/general/themeattributes";
const {default: ThemeAttributes} = await import(themeAttributesModule);

let container: HTMLDivElement;
let root: Root;

function createMessageHook() {
    return {
        key() {
            React.useState(0);
            return null;
        }
    };
}

function createMessageComponentModule(): MessageComponentModule {
    return {
        A: {
            type() {
                React.useState(0);
                return <li className="messageListItem" />;
            }
        }
    };
}

function RetainedHookOwner({generation, messageKey = messageHook.key}: {generation: number, messageKey?: MessageHook["key"]}) {
    React.useState(0);
    React.useLayoutEffect(() => {}, [generation]);
    messageKey();
    return <div data-generation={generation} />;
}

function RetainedMessageOwner({generation, messageType = messageComponentModule.A.type}: {generation: number, messageType?: MessageComponentModule["A"]["type"]}) {
    React.useState(0);
    React.useLayoutEffect(() => {}, [generation]);
    return messageType({message: {id: "message"}});
}

async function render(generation: number, messageKey?: MessageHook["key"]) {
    await act(async () => root.render(<RetainedHookOwner generation={generation} messageKey={messageKey} />));
}

async function renderMessage(generation: number, messageType?: MessageComponentModule["A"]["type"]) {
    await act(async () => root.render(<RetainedMessageOwner generation={generation} messageType={messageType} />));
}

beforeEach(() => {
    Patcher.unpatchAll("ThemeAttributes");
    patcherErrors.length = 0;
    deferMessageHook = false;
    resolveMessageHook = undefined;
    messageHook = createMessageHook();
    messageComponentModule = createMessageComponentModule();
    queuedMessageHooks = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    ThemeAttributes.unpatchAll();
    Patcher.unpatchAll("ThemeAttributes");
    await act(async () => root.unmount());
    container.remove();
});

describe("ThemeAttributes runtime patch lifecycle", () => {
    test("keeps a mounted hook owner valid across off-on-off-on cycles", async () => {
        await render(0);

        for (const generation of [1, 3]) {
            await ThemeAttributes.patchMessageHook();
            await render(generation);

            await ThemeAttributes.disabled();
            await render(generation + 1);
        }

        expect(container.querySelector("div")?.dataset.generation).toBe("4");
        expect(patcherErrors.map(([, , error]) => error instanceof Error ? error.message : String(error))).toEqual([]);
    });

    test("keeps an initially enabled hook owner valid when the patch is removed", async () => {
        await ThemeAttributes.patchMessageHook();
        const retainedKey = messageHook.key;
        await render(0, retainedKey);

        await ThemeAttributes.disabled();
        await render(1, retainedKey);

        expect(container.querySelector("div")?.dataset.generation).toBe("1");
    });

    test("keeps an initially enabled MessageComponent owner valid when the patch is removed", async () => {
        await ThemeAttributes.patchMessage();
        const retainedType = messageComponentModule.A.type;
        await renderMessage(0, retainedType);

        await ThemeAttributes.disabled();
        await renderMessage(1, retainedType);

        expect(container.querySelector("li")).not.toBeNull();
    });

    test("does not install a delayed message-hook patch after disable", async () => {
        await render(0);
        deferMessageHook = true;
        const originalKey = messageHook.key;

        await ThemeAttributes.enabled();
        await ThemeAttributes.disabled();
        resolveMessageHook?.(messageHook);
        await Promise.resolve();
        await Promise.resolve();

        await render(1);
        expect(messageHook.key).toBe(originalKey);
        expect(container.querySelector("div")?.dataset.generation).toBe("1");
    });

    test("allows only the current enabled generation to register after a stale lookup settles", async () => {
        const stale = createMessageHook();
        const current = createMessageHook();
        const staleKey = stale.key;
        const currentKey = current.key;
        queuedMessageHooks = [stale];
        deferMessageHook = true;

        await ThemeAttributes.enabled();
        await ThemeAttributes.disabled();

        deferMessageHook = false;
        queuedMessageHooks = [current];
        await ThemeAttributes.enabled();
        await Promise.resolve();
        await Promise.resolve();

        resolveMessageHook?.(stale);
        await Promise.resolve();
        await Promise.resolve();

        expect(stale.key).toBe(staleKey);
        expect(current.key).not.toBe(currentKey);
    });
});
