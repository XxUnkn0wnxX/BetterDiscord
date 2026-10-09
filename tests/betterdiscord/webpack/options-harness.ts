import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import type {Webpack} from "@typed/discord";

const moduleCache: Record<string, Webpack.Module> = {};
const sources: Record<string, Webpack.RawModule> = {};
const lazyListeners = new Set<Webpack.ModuleFilter>();
const cachedIds = new Map<string, string>();
const validationErrors: unknown[][] = [];
const webpackRequire = {c: moduleCache, m: sources};

mock.module(import.meta.resolve("../../../src/betterdiscord/webpack/require"), () => ({webpackRequire, lazyListeners}));
mock.module(import.meta.resolve("../../../src/betterdiscord/webpack/cache"), () => ({"default": {
    get: (id: string) => cachedIds.get(id),
    set: (id: string, moduleId: string) => cachedIds.set(id, moduleId),
    getIdFromStack: () => undefined
}}));
mock.module("@common/logger", () => ({"default": {warn: () => {}, error: (...args: unknown[]) => {validationErrors.push(args);}}}));
mock.module("@utils/react", () => ({getType: (value: unknown) => value}));

// Real matching, mapping, filters, lazy batching and legacy helpers; no Discord startup or disk cache.
const searching = await import("../../../src/betterdiscord/webpack/searching");
const utilities = await import("../../../src/betterdiscord/webpack/utilities");
const lazy = await import("../../../src/betterdiscord/webpack/lazy");
const Filters = await import("../../../src/betterdiscord/webpack/filter");
mock.module("@webpack", () => ({...searching, ...utilities, ...lazy, Filters, modules: sources, Stores: {}, getStore: () => undefined}));
const {default: WebpackAPI} = await import("../../../src/betterdiscord/api/webpack");
const api = new WebpackAPI();
const noMatch = () => false;
const target = () => "webpack-option-target";
const mapper = {target: (value: unknown) => value === target};

function add(id: string, exports: any, declarations: Record<string, unknown> = {}) {
    const module: Webpack.Module = {id, exports, declarations, loaded: true};
    moduleCache[id] = module;
    sources[id] = (() => "webpack-option-source") as unknown as Webpack.RawModule;
    return module;
}

function publish(module: Webpack.Module) {
    for (const listener of lazyListeners) listener(module.exports, module, module.id);
}

async function flush() {
    // Let the queued lookup and its listener-install continuation both complete.
    for (let i = 0; i < 4; i++) await Promise.resolve();
}

beforeEach(() => {
    for (const id of Object.keys(moduleCache)) delete moduleCache[id];
    for (const id of Object.keys(sources)) delete sources[id];
    cachedIds.clear();
    validationErrors.length = 0;
});
afterEach(() => {
    expect(lazyListeners.size).toBe(0);
    expect(lazy.isFromLazySearch()).toBe(false);
});

describe("Webpack options", () => {
    test("returns actual export, member and guarded single-read declaration owners", () => {
        const exports = {member: target};
        const module = add("1", exports);
        const whole = api.getModule<Webpack.ModuleWithKey>(value => value === exports, {withKey: true, cacheId: null})!;
        const member = api.getByStrings<Webpack.ModuleWithKey>("webpack-option-target", {withKey: true, searchExports: true, cacheId: null})!;
        expect(whole[0]).toBe(module);
        expect(whole[1]).toBe("exports");
        expect(member[0]).toBe(exports);
        expect(member[1]).toBe("member");

        let reads = 0;
        const declarations = Object.create(null, {
            bad: {enumerable: true, get() {throw new ReferenceError("declaration not initialized");}},
            good: {enumerable: true, get() {reads++; return target;}}
        });
        module.declarations = declarations;
        const pair = api.getModule<any>(value => value === exports, {declarationFilter: value => value === target, withKey: true, raw: true, map: mapper, cacheId: null}) as Webpack.ModuleWithKey;
        expect(pair[0]).toBe(declarations);
        expect(pair[1]).toBe("good");
        expect(reads).toBe(1);
        const all = api.getModules<Webpack.ModuleWithKey[]>(value => value === exports, {declarationFilter: value => value === target, withKey: true})!;
        expect(all[0][0]).toBe(declarations);
        const bulk = api.getBulk<[Webpack.ModuleWithKey]>({filter: value => value === exports, declarationFilter: value => value === target, withKey: true, cacheId: null});
        expect(bulk[0][0]).toBe(declarations);
        expect(reads).toBe(3);
    });

    test("maps live properties and retains getter/setter guards for exports and declarations", () => {
        let throwGetter = false;
        let current: unknown = target;
        const exports = Object.create(null, {
            bad: {enumerable: true, get() {throw new Error("uninitialized");}},
            good: {enumerable: true, get() {if (throwGetter) throw new Error("later getter"); return current;}, set(value) {current = value;}},
            readonly: {enumerable: true, get() {return "readonly";}}
        });
        const module = add("1", exports, {hidden: target});
        const mapped = api.getModule<any>(value => value === exports, {map: {...mapper, missing: noMatch, readonly: value => value === "readonly"}, withKey: true, raw: true, cacheId: null}) as any;
        expect(mapped.target).toBe(target);
        mapped.target = "replacement";
        expect(exports.good).toBe("replacement");
        exports.good = target;
        expect(mapped.target).toBe(target);
        throwGetter = true;
        expect(mapped.target).toBeUndefined();
        expect(() => {mapped.readonly = "ignored";}).not.toThrow();
        expect(mapped.readonly).toBe("readonly");
        expect(mapped.missing).toBeUndefined();
        const declared = api.getModule<any>(value => value === exports, {map: mapper, mapDeclarations: true, raw: true, cacheId: null}) as any;
        declared.target = "new declaration";
        expect(module.declarations.hidden).toBe("new declaration");
    });

    test("preserves default, raw, mapping and member-search precedence", () => {
        for (const key of ["A", "Ay", "default"]) {
            const exports = {[key]: {nested: target}, __esModule: key === "default"};
            const module = add("1", exports, {declared: target});
            const filter = (value: unknown) => value === exports[key];
            expect(api.getModule<any>(filter, {defaultExport: false, withKey: true, cacheId: null})).toEqual([module, "exports"]);
            expect(api.getModule<any>(filter, {defaultExport: false, raw: true, withKey: true, cacheId: null})).toBe(module);
            // All-result searches use defaultExport before raw; single-result searches use raw first.
            expect(api.getModules(filter, {defaultExport: false, raw: true, withKey: true})).toEqual([[module, "exports"]]);
            expect((api.getModule<any>(filter, {defaultExport: false, map: mapper, cacheId: null}) as any).target).toBe(target);
            expect((api.getModules(filter, {defaultExport: false, map: mapper}) as any)[0].target).toBeUndefined();
            // For member mapping, raw selects exports before mapDeclarations.
            expect((api.getModule<any>(filter, {map: mapper, mapDeclarations: true, raw: true, cacheId: null}) as any).target).toBeUndefined();
            expect((api.getModule<any>(filter, {map: mapper, mapDeclarations: true, cacheId: null}) as any).target).toBe(target);
            expect(api.getModule<any>(filter, {searchExports: true, defaultExport: false, withKey: true, cacheId: null})).toEqual([exports, key]);
        }
    });

    test("uses firstId, cached matches and scanning for shared single and bulk matching", () => {
        const first = add("1", {member: target});
        const second = add("2", {member: target});
        const filter = (value: unknown) => value === target;
        const options = {filter, searchExports: true, withKey: true, cacheId: "lookup"};
        cachedIds.set("lookup", "1");
        expect(api.getModule<any>(filter, {...options, firstId: 2})).toEqual([second.exports, "member"]);
        expect(api.getBulk({...options, firstId: 2})).toEqual([[second.exports, "member"]]);
        expect(api.getModule<any>(filter, options)).toEqual([first.exports, "member"]);
        expect(api.getBulk(options)).toEqual([[first.exports, "member"]]);
        cachedIds.set("lookup", "missing");
        expect(api.getModule<any>(filter, options)).toEqual([first.exports, "member"]);
        expect(cachedIds.get("lookup")).toBe("1");
        delete moduleCache["1"];
        expect(api.getBulk(options)).toEqual([[second.exports, "member"]]);
        expect(cachedIds.get("lookup")).toBe("2");
    });

    test("preserves all-result shapes, synchronous bulk miss defaults and fatal failures", () => {
        const first = add("1", {member: target});
        const second = add("2", {member: target});
        const filter = (value: unknown) => value === target;
        expect(api.getModules(filter, {searchExports: true, withKey: true})).toEqual([[first.exports, "member"], [second.exports, "member"]]);
        expect(api.getBulk({filter, searchExports: true, withKey: true, all: true, cacheId: null})).toEqual([[[first.exports, "member"], [second.exports, "member"]]]);
        const wholeOrMember = (value: unknown) => value === first.exports || value === target;
        expect(api.getModule<any>(wholeOrMember, {first: false, searchExports: true, withKey: true})).toEqual([[first, "exports"], [first.exports, "member"], [second.exports, "member"]]);
        // Bulk all collects one match per module, while getAllModules includes matching members too.
        expect(api.getBulk({filter: wholeOrMember, searchExports: true, withKey: true, all: true, cacheId: null})).toEqual([[[first, "exports"], [second.exports, "member"]]]);
        expect((api.getBulk({filter, searchExports: true, map: {fn: value => value === target}, all: true, cacheId: null}) as any)[0].map((item: any) => item.fn)).toEqual([undefined, undefined]);
        expect(api.getBulk({filter: noMatch, map: mapper}, {filter: noMatch, all: true})).toEqual([{}, []]);
        expect(api.getModules(noMatch)).toEqual([]);
        expect(() => api.getModule<any>(noMatch, {fatal: true})).toThrow("Module search failed!");
        expect(() => api.getModules(noMatch, {fatal: true})).toThrow("Module search failed!");
        for (const options of [{}, {all: true}, {map: mapper}]) {
            expect(() => api.getBulk({filter: noMatch, fatal: true, ...options})).toThrow("Module search failed!");
        }
    });

    test("supports immediate lazy tuples and leaves batched mapped misses pending for late matches", async () => {
        const module = add("1", {member: target}, {hidden: target});
        expect(await api.waitForModule<any>(value => value === target, {searchExports: true, withKey: true})).toEqual([module.exports, "member"]);
        expect((await api.waitForModule<any>(value => value === module.exports, {map: mapper, mapDeclarations: true}))!.target).toBe(target);
        let settled = false;
        const pending = api.waitForModule<any>(value => value?.late === true, {map: mapper});
        void pending!.then(() => {settled = true;});
        const latePair = api.waitForModule<any>(value => value?.late === true, {withKey: true});
        const lateDeclarations = api.waitForModule<any>(value => value?.late === true, {map: mapper, mapDeclarations: true});
        await flush();
        expect(settled).toBe(false);
        expect(lazyListeners.size).toBe(3);
        const late = add("2", {late: true, member: target}, {hidden: target});
        publish(late);
        const mapped = await pending;
        expect(mapped.target).toBe(target);
        mapped.target = "written through late lookup";
        expect(late.exports.member).toBe("written through late lookup");
        expect(await latePair).toEqual([late, "exports"]);
        const declared = (await lateDeclarations)!;
        expect(declared.target).toBe(target);
        declared.target = "written through late declaration";
        expect(late.declarations.hidden).toBe("written through late declaration");
    });

    test("late declaration matching keeps a missing declaration pending and returns its owner", async () => {
        const pending = api.waitForModule<any>(value => value?.late === true, {declarationFilter: value => value === target, withKey: true});
        await flush();
        publish(add("1", {late: true}));
        expect(lazyListeners.size).toBe(1);
        const module = add("2", {late: true}, {declared: target});
        publish(module);
        expect(await pending).toEqual([module.declarations, "declared"]);
    });

    test("settles pre-aborted, queued and late cancellation with upstream fatal behavior", async () => {
        for (const phase of ["pre", "queued", "late"]) {
            for (const fatal of [false, true]) {
                const controller = new AbortController();
                if (phase === "pre") controller.abort();
                const pending = api.waitForModule<any>(noMatch, {signal: controller.signal, fatal})!;
                const checked = pending.then(value => ({value, error: undefined}), error => ({value: undefined, error}));
                if (phase === "late") {await flush(); expect(lazyListeners.size).toBe(1);}
                controller.abort();
                const result = await checked;
                if (fatal) {expect(result.error?.message).toBe("Module search failed!");}
                else {expect(result.error).toBeUndefined(); expect(result.value).toBeUndefined();}
                await flush();
                expect(lazyListeners.size).toBe(0);
            }
        }
    });

    test("keeps deprecated public helpers, lazy helper and validation operational", async () => {
        const module = add("1", {member: target}, {declared: target});
        expect([...api.getWithKey(value => value === target, {cacheId: null})!]).toEqual([module.exports, "member"]);
        expect((api.getMangled("webpack-option-source", mapper, {cacheId: null}) as any).target).toBe(target);
        expect((api.getMangledProxy("webpack-option-source", mapper, {cacheId: null}) as any).target).toBe(target);
        expect((await utilities.getMangledLazy("webpack-option-source", mapper, {mapDeclarations: true})).target).toBe(target);
        expect(api.getWithKey(noMatch, {first: true} as any)).toBeUndefined();
        expect(api.getMangled(noMatch, {}, {raw: "invalid"} as any)).toBeUndefined();
        expect(api.getMangledProxy(noMatch, {}, {fatal: "invalid"} as any)).toBeUndefined();
        expect(validationErrors).toHaveLength(3);
    });
});
