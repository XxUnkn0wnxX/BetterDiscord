import {beforeEach, describe, expect, mock, test} from "bun:test";
import React from "react";

import findInTree from "../../../src/common/utils/findintree";

const needle = "SUMMARIES_UNREAD_BAR_VIEWED,{num_unread_summaries";

type AfterCallback = (thisObject: object, args: any[], returnValue: any) => void;
type PatchRecord = {object: object; functionName: string; callback: AfterCallback;};
type MangledCall = {
    source: string;
    mapper: {key: (value: unknown) => boolean;};
    options: Record<string, unknown>;
};

const patches: PatchRecord[] = [];
const filterCalls: string[][] = [];
const mangledCalls: MangledCall[] = [];

let messageHook: unknown;
let messageComponentModule: unknown;

class MockBuiltin {
    after(object: object | undefined, functionName: string, callback: AfterCallback) {
        if (object) patches.push({object, functionName, callback});
    }

    unpatchAll() {}
}

const mockBuiltin = () => ({"default": MockBuiltin});
const builtinPath = import.meta.resolve("../../../src/betterdiscord/structs/builtin");
mock.module("@structs/builtin", mockBuiltin);
mock.module(builtinPath, mockBuiltin);

const mockFilters = {
    byStrings(...strings: string[]) {
        filterCalls.push(strings);
        return (value: unknown) => typeof value === "function" && strings.every((string) => String(value).includes(string));
    }
};

const getMangledLazy = async (source: string, mapper: MangledCall["mapper"], options: Record<string, unknown>) => {
    mangledCalls.push({source, mapper, options});
    return messageHook;
};

const mockWebpack = () => ({
    Filters: mockFilters,
    getLazy: async () => undefined,
    getLazyBySource: async () => messageComponentModule,
    getLazyByStrings: async () => undefined,
    getMangledLazy,
    Stores: {UserStore: {}}
});
const webpackPath = import.meta.resolve("../../../src/betterdiscord/webpack");
mock.module("@webpack", mockWebpack);
mock.module(webpackPath, mockWebpack);

const commonUtilsPath = import.meta.resolve("../../../src/common/utils");
mock.module("@common/utils", () => ({findInTree}));
mock.module(commonUtilsPath, () => ({findInTree}));

const {default: ThemeAttributes} = await import("@builtins/general/themeattributes");

const matchingMessageHookKey = function matchingMessageHookKey() {
    return "SUMMARIES_UNREAD_BAR_VIEWED,{num_unread_summaries";
};

function messageHookPatch() {
    const patch = patches.find(({functionName}) => functionName === "key");
    if (!patch) throw new Error("messageHook key patch was not registered");
    return patch;
}

async function installMessageHookPatch() {
    messageHook = {key: matchingMessageHookKey};
    await ThemeAttributes.patchMessageHook();
    return messageHookPatch();
}

function providerValue(element: React.ReactElement) {
    return (element.props as {value: {first: boolean; last: boolean;}}).value;
}

beforeEach(() => {
    patches.length = 0;
    filterCalls.length = 0;
    mangledCalls.length = 0;
    messageHook = {key: matchingMessageHookKey};
    messageComponentModule = undefined;
});

describe("ThemeAttributes", () => {
    test("uses the semantic message hook filter and patches only callable key", async () => {
        await ThemeAttributes.patchMessageHook();

        expect(mangledCalls).toHaveLength(1);
        expect(mangledCalls[0].source).toBe(needle);
        expect(filterCalls).toEqual([[needle]]);
        expect(mangledCalls[0].options).toEqual({
            cacheId: "core-themeattributes-messageHook",
            mapDeclarations: true
        });

        const mapper = mangledCalls[0].mapper.key;
        expect(mapper(matchingMessageHookKey)).toBe(true);
        expect(mapper(() => "wrong source")).toBe(false);
        expect(mapper({type: matchingMessageHookKey})).toBe(false);
        expect(mapper(null)).toBe(false);

        expect(patches).toHaveLength(1);
        expect(patches[0].object).toBe(messageHook as object);
        expect(patches[0].functionName).toBe("key");
    });

    test("handles null and constrained props-children trees without mutation", async () => {
        const patch = await installMessageHookPatch();
        const trees = [
            null,
            undefined,
            {props: {children: [null, {props: {children: [null]}}]}}
        ];

        for (const tree of trees) {
            const before = tree === null || typeof tree === "undefined" ? tree : structuredClone(tree);
            expect(() => patch.callback({}, [], tree)).not.toThrow();
            expect(tree).toEqual(before);
        }
    });

    test("wraps grouped React elements while preserving non-React entries", async () => {
        const patch = await installMessageHookPatch();
        const firstA = React.createElement("div", {groupId: "a", id: "first-a"});
        const lastA = React.createElement("div", {groupId: "a", id: "last-a"});
        const firstB = React.createElement("div", {groupId: "b", id: "first-b"});
        const untouched = {id: "non-react"};
        const baseChannelStreamMarkup: unknown[] = [firstA, lastA, untouched, firstB];
        const result = {props: {children: [{"data-list-id": "chat-messages", "children": [baseChannelStreamMarkup]}]}};

        patch.callback({}, [], result);

        expect(baseChannelStreamMarkup[2]).toBe(untouched);
        expect(providerValue(baseChannelStreamMarkup[0] as React.ReactElement)).toEqual({first: true, last: false});
        expect(providerValue(baseChannelStreamMarkup[1] as React.ReactElement)).toEqual({first: false, last: true});
        expect(providerValue(baseChannelStreamMarkup[3] as React.ReactElement)).toEqual({first: true, last: true});
        expect((baseChannelStreamMarkup[0] as React.ReactElement<any, any>).props.children).toBe(firstA);
    });

    test("patches the inner MessageComponent export", async () => {
        const type = () => React.createElement("div");
        const inner = {type};
        const wrapper = {A: inner};
        messageComponentModule = wrapper;

        await ThemeAttributes.patchMessage();

        expect(patches).toHaveLength(1);
        expect(patches[0].object).toBe(inner);
        expect(patches[0].object).not.toBe(wrapper);
        expect(patches[0].functionName).toBe("type");
    });

    test("does not patch a non-callable MessageComponent type", async () => {
        messageComponentModule = {A: {type: "not callable"}};

        await ThemeAttributes.patchMessage();

        expect(patches).toHaveLength(0);
    });

    test("does not patch missing or non-callable messageHook keys", async () => {
        for (const value of [{}, {key: "not callable"}]) {
            patches.length = 0;
            messageHook = value;

            await ThemeAttributes.patchMessageHook();

            expect(patches).toHaveLength(0);
        }
    });
});
