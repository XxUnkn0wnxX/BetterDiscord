import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import findInTree from "../../../src/common/utils/findintree";
import {createMessageGroupingStore} from "@utils/messagegrouping";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

const needle = "SUMMARIES_UNREAD_BAR_VIEWED,{num_unread_summaries";

type AfterCallback = (thisObject: object, args: any[], returnValue: any) => void;
type PatchRecord = {object: object; functionName: string; callback: AfterCallback;};
type MangledCall = {
    source: string;
    mapper: {key: (value: unknown) => boolean;};
    options: Record<string, unknown>;
};
type ChatItem = {
    key: string;
    groupId: string;
    message: {id?: unknown; author?: {id: string; username: string; discriminator: string; bot: boolean;};};
    domId: string;
};

const patches: PatchRecord[] = [];
const filterCalls: string[][] = [];
const mangledCalls: MangledCall[] = [];
const renderCounts = new Map<string, number>();

let messageHook: unknown;
let messageComponentModule: unknown;
let container: HTMLDivElement;
let root: Root;

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

async function installRuntimePatches() {
    messageHook = {key: matchingMessageHookKey};
    messageComponentModule = {A: {type: function MessageComponent() {}}};
    await ThemeAttributes.patchMessageHook();
    await ThemeAttributes.patchMessage();
}

function messageTypePatch() {
    const patch = patches.find(({functionName}) => functionName === "type");
    if (!patch) throw new Error("MessageComponent type patch was not registered");
    return patch;
}

const ThemeMessage = React.memo(function ThemeMessage({domId, message}: Pick<ChatItem, "domId" | "groupId" | "message">) {
    const messageId = typeof message.id === "string" ? message.id : "missing";
    renderCounts.set(messageId, (renderCounts.get(messageId) ?? 0) + 1);

    const returnValue = <li id={domId} className="messageListItem" />;
    messageTypePatch().callback({}, [{message}], returnValue);
    return returnValue;
});

function ChatList({items, malformed = false, onMarkup}: {items: ChatItem[]; malformed?: boolean; onMarkup?(markup: React.ReactNode[]): void;}) {
    const patch = messageHookPatch();
    if (malformed) {
        patch.callback({}, [], {props: {children: [null, {props: {children: [null]}}]}});
        return null;
    }

    const markup: React.ReactNode[] = items.map(chatItem => (
        <ThemeMessage key={chatItem.key} groupId={chatItem.groupId} message={chatItem.message} domId={chatItem.domId} />
    ));
    const result = {props: {children: [{"data-list-id": "chat-messages", "children": [markup]}]}};
    patch.callback({}, [], result);
    onMarkup?.(markup);
    return <>{markup}</>;
}

function item(id: string, groupId: string, domId = id): ChatItem {
    return {
        key: id,
        groupId,
        domId,
        message: {
            id
        }
    };
}

async function renderList(items: ChatItem[], options?: {malformed?: boolean; onMarkup?(markup: React.ReactNode[]): void;}) {
    await act(async () => root.render(<ChatList items={items} {...options} />));
}

function grouping(domId: string) {
    const node = container.querySelector<HTMLLIElement>(`#${domId}`);
    if (!node) throw new Error(`message ${domId} did not render`);
    return {
        first: node.getAttribute("data-message-group-start"),
        last: node.getAttribute("data-message-group-end")
    };
}

beforeEach(() => {
    patches.length = 0;
    filterCalls.length = 0;
    mangledCalls.length = 0;
    renderCounts.clear();
    messageHook = {key: matchingMessageHookKey};
    messageComponentModule = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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

    test("handles null and constrained props-children trees through an effect-safe no-op", async () => {
        await installMessageHookPatch();
        function HookOwner({tree}: {tree: unknown;}) {
            messageHookPatch().callback({}, [], tree);
            return null;
        }

        const trees = [
            null,
            undefined,
            {props: {children: [null, {props: {children: [null]}}]}}
        ];

        for (const tree of trees) {
            const before = tree === null || typeof tree === "undefined" ? tree : structuredClone(tree);
            await act(async () => root.render(<HookOwner tree={tree} />));
            expect(tree).toEqual(before);
        }
    });

    test("preserves non-message stream entries while wrapping only grouped messages", async () => {
        await installMessageHookPatch();
        const first = React.createElement("div", {groupId: "a", message: {id: "first"}});
        const untouched = {kind: "unread-marker"};
        const last = React.createElement("div", {groupId: "a", message: {id: "last"}});
        const markup: unknown[] = [first, untouched, last];
        const result = {props: {children: [{"data-list-id": "chat-messages", "children": [markup]}]}};

        function HookOwner() {
            messageHookPatch().callback({}, [], result);
            return null;
        }

        await act(async () => root.render(<HookOwner />));
        expect(markup[1]).toBe(untouched);
        expect((markup[0] as React.ReactElement<{children: unknown;}>).props.children).toBe(first);
        expect((markup[2] as React.ReactElement<{children: unknown;}>).props.children).toBe(last);
    });

    test("keeps missing IDs untouched while retaining their boundary and updates group attributes without rerendering a stable message", async () => {
        await installRuntimePatches();
        const missing = item("missing", "a");
        missing.message.id = undefined;
        const first = item("first", "a");
        const middle = item("middle", "a");
        const last = item("last", "b");
        let markup: React.ReactNode[] = [];

        await renderList([missing, first, middle, last], {onMarkup: value => markup = value});
        expect((markup[0] as React.ReactElement).type).toBe(ThemeMessage);
        expect(grouping("missing")).toEqual({first: null, last: null});
        expect(grouping("first")).toEqual({first: "false", last: "false"});
        expect(grouping("middle")).toEqual({first: "false", last: "true"});
        expect(grouping("last")).toEqual({first: "true", last: "true"});
        expect(renderCounts.get("middle")).toBe(1);

        await renderList([missing, {...first, groupId: "c"}, middle, last]);
        expect(grouping("middle")).toEqual({first: "true", last: "true"});
        expect(renderCounts.get("middle")).toBe(1);
    });

    test("prunes removed messages after invalidation, cleans up an unmounted owner, and updates replacement DOM identities", async () => {
        await installRuntimePatches();
        const first = item("first", "a", "first-before");
        const second = item("second", "a");

        await renderList([first, second]);
        expect(grouping("first-before")).toEqual({first: "true", last: "false"});
        expect(grouping("second")).toEqual({first: "false", last: "true"});

        await renderList([{...first, domId: "first-after"}, second]);
        expect(container.querySelector("#first-before")).toBeNull();
        expect(grouping("first-after")).toEqual({first: "true", last: "false"});

        await renderList([second]);
        expect(grouping("second")).toEqual({first: "true", last: "true"});

        await renderList([], {malformed: true});
        expect(container.childElementCount).toBe(0);

        await act(async () => root.render(null));
        await renderList([item("second", "fresh", "second-reused")]);
        expect(grouping("second-reused")).toEqual({first: "true", last: "true"});
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

        messageComponentModule = undefined;
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

describe("message grouping store", () => {
    test("does not let a late subscription consume another subscriber's pending update", () => {
        const store = createMessageGroupingStore();
        const initial = store.createRender();
        const subscribe = initial.createSubscriber("message", {first: true, last: false});
        const early: Array<{first: boolean, last: boolean}> = [];

        store.commit(initial);
        const stopEarly = subscribe(state => early.push(state));
        expect(early).toEqual([{first: true, last: false}]);

        const pending = store.createRender();
        const subscribeLate = pending.createSubscriber("message", {first: false, last: true});
        const late: Array<{first: boolean, last: boolean}> = [];
        const stopLate = subscribeLate(state => late.push(state));

        expect(late).toEqual([{first: true, last: false}]);
        store.commit(pending);
        expect(early).toEqual([{first: true, last: false}, {first: false, last: true}]);
        expect(late).toEqual([{first: true, last: false}, {first: false, last: true}]);

        stopEarly();
        stopLate();
    });

    test("keeps aborted renders from pruning committed entries and prunes committed invalidation", () => {
        const store = createMessageGroupingStore();
        const initial = store.createRender();
        const subscribe = initial.createSubscriber("message", {first: true, last: false});
        store.commit(initial);

        const received: Array<{first: boolean, last: boolean}> = [];
        subscribe(state => received.push(state));

        const aborted = store.createRender();
        aborted.createSubscriber("other", {first: true, last: true});

        const retained = store.createRender();
        retained.createSubscriber("message", {first: true, last: false});
        store.commit(retained);
        expect(received).toEqual([{first: true, last: false}]);

        store.commit(store.createRender());
        const reused = store.createRender();
        const subscribeReused = reused.createSubscriber("message", {first: false, last: true});
        const reusedReceived: Array<{first: boolean, last: boolean}> = [];
        subscribeReused(state => reusedReceived.push(state));
        expect(reusedReceived).toEqual([]);
        store.commit(reused);
        expect(reusedReceived).toEqual([{first: false, last: true}]);

        store.dispose();
    });
});
