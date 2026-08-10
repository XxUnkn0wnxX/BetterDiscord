import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import Logger from "@common/logger.ts";

type WebpackRequire = ((id: PropertyKey) => unknown) & {
    m: Record<PropertyKey, unknown>;
    e(id: PropertyKey): Promise<unknown>;
    p: string;
    u: (id: string) => string;
};

const requirePath = import.meta.resolve("../../../src/betterdiscord/webpack/require");
const searchingPath = import.meta.resolve("../../../src/betterdiscord/webpack/searching");
const utilitiesPath = import.meta.resolve("../../../src/betterdiscord/webpack/utilities");
const lazyPath = import.meta.resolve("../../../src/betterdiscord/webpack/lazy");
if (typeof (globalThis as any).window.BetterDiscordPreload !== "function") {
    (globalThis as any).window.BetterDiscordPreload = () => ({}) as any;
}

const modules = Object.create(null) as Record<string, unknown>;
let chunkLoadCalls: string[] = [];
let fetchCalls: string[] = [];
let moduleRequireCalls: string[] = [];
let moduleRequireHandler: (id: string) => void = () => {};
let fetchResponses = new Map<string, string | Error>();
let chunkLoadHandler: (id: string) => Promise<unknown> = () => Promise.resolve();
const chunkPaths = new Map<string, string>();

const webpackRequire: WebpackRequire = ((id: string) => {
    moduleRequireCalls.push(String(id));
    moduleRequireHandler(String(id));
    return modules[id];
}) as WebpackRequire;

webpackRequire.m = modules;
webpackRequire.p = "/assets/";
webpackRequire.u = (id: string) => chunkPaths.get(id) ?? `${id}.js`;
webpackRequire.e = async (id: string) => {
    chunkLoadCalls.push(String(id));
    return chunkLoadHandler(String(id));
};

mock.module(requirePath, () => ({
    webpackRequire,
    lazyListeners: new Set()
}));
mock.module(searchingPath, () => ({
    getModule: () => undefined
}));
mock.module(utilitiesPath, () => ({
    getBulk: () => []
}));

const {getOrInsertComputedCompat, loadEntry} = await import(lazyPath);

type NOOP = (...args: unknown[]) => unknown;
const UpstreamChunkIdRegex = /.{1}\.e\("(\d+)"\)/g;
const UpstreamLazyChunkRegex = /Promise\.all\(\[((?:\w\.e\("?\d+"?\),?)+)\]\)\.then\(\w(?:\.\w)?\.bind\(\w,\s*"?(\d+)"?\)\)/g;
const upstreamStrip = (str: string) => str.replace(/\s+/g, "");

// Exact upstream 8e3078b4 loadEntry flow, run with a local test-only Map shim
// because this pinned renderer/toolchain predates the native method.
const createUpstreamLoadEntry = () => {
    const ContentCache = new Map<string, Promise<boolean>>() as Map<string, Promise<boolean>> & {
        getOrInsertComputed(key: string, callback: (key: string) => Promise<boolean>): Promise<boolean>;
    };
    ContentCache.getOrInsertComputed = function (key, callback) {
        if (this.has(key)) return this.get(key) as Promise<boolean>;
        const value = callback(key);
        this.set(key, value);
        return value;
    };

    return async function upstreamLoadEntry(string: NOOP | string) {
        if (!string) return null;

        const start = String(string);
        if (!start) return null;

        const end = upstreamStrip(start);

        const chunks = Array.from(end.matchAll(UpstreamLazyChunkRegex));
        if (chunks.length === 0) return null;

        const entries: string[] = [];

        await Promise.all(chunks.map(async ([, rawChunkIds, entryPoint]) => {
            const chunkIds = Array.from(rawChunkIds.matchAll(UpstreamChunkIdRegex), m => m[1]);
            if (chunkIds.length === 0) return;

            await Promise.all(chunkIds.map(async id => {
                const path = webpackRequire.u(id);
                if (path == null || path.includes("undefined.js")) return;

                try {
                    const isWorker = await ContentCache.getOrInsertComputed(id, () => {
                        return fetch(webpackRequire.p + path)
                            .then(r => r.text())
                            .then(text => /importScripts\(|self\.postMessage/.test(text));
                    });

                    if (isWorker) return;

                    await webpackRequire.e(id);
                }
                catch (e) {
                    Logger.error((e as string));
                }
            }));

            if (webpackRequire.m[entryPoint]) {
                webpackRequire(entryPoint);
                entries.push(entryPoint);
            }
        }));

        return entries.map(x => webpackRequire(x));
    };
};

const originalFetch = globalThis.fetch;
const originalLoggerError = Logger.error;
const buildChunks = (chunks: Array<number | string>, quoted = true) => chunks.map(chunk => quoted ? JSON.stringify(String(chunk)) : String(chunk)).join(",");
const buildSource = (chunks: Array<number | string>, entryPoint: number | string, quotedEntry = true) => {
    const chunkArgument = buildChunks(chunks);
    return `Promise.all([a.e(${chunkArgument})]).then(a.b.bind(a, ${quotedEntry ? `"${entryPoint}"` : entryPoint}))`;
};
const createFetchMock = () => {
    const mockedFetch = ((url: string | URL | Request) => {
        const target = String(url);
        fetchCalls.push(target);
        const response = fetchResponses.get(target);
        if (response instanceof Error) return Promise.reject(response);
        return Promise.resolve(new Response(response ?? "", {status: 200}));
    }) as typeof fetch;

    mockedFetch.preconnect = () => Promise.resolve();

    return mockedFetch;
};

let loggerErrors: string[] = [];

beforeEach(() => {
    chunkLoadCalls = [];
    fetchCalls = [];
    moduleRequireCalls = [];
    moduleRequireHandler = () => {};
    fetchResponses = new Map();
    chunkLoadHandler = () => Promise.resolve();
    chunkPaths.clear();
    for (const key in modules) delete modules[key];
    loggerErrors = [];
    Logger.error = (...message: any[]) => {
        loggerErrors.push(message.join(" "));
    };

    globalThis.fetch = createFetchMock();

});

afterEach(() => {
    Logger.error = originalLoggerError;
    globalThis.fetch = originalFetch;
});

describe("loadEntry", () => {
    test("returns null for no source or unmatched source", async () => {
        expect(await loadEntry(null)).toBeNull();
        expect(await loadEntry("return 1;")).toBeNull();
        expect(fetchCalls).toEqual([]);
    });

    test("loads entries from quoted and unquoted ids and preserves order", async () => {
        modules["100"] = {label: "quoted-entry"};
        modules["101"] = {label: "unquoted-entry"};
        chunkPaths.set("10", "chunk10.js");
        chunkPaths.set("11", "chunk11.js");

        fetchResponses.set("/assets/chunk10.js", "function()");
        fetchResponses.set("/assets/chunk11.js", "function()");

        const source = `${buildSource([10], 100, true)};${buildSource([11], 101, false)}`;
        const results = await loadEntry(source);

        expect(results).toEqual([{label: "quoted-entry"}, {label: "unquoted-entry"}]);
        expect(fetchCalls).toEqual(["/assets/chunk10.js", "/assets/chunk11.js"]);
        expect(chunkLoadCalls).toEqual(["10", "11"]);
        expect(results[0]).toBe(modules["100"]);
        expect(results[1]).toBe(modules["101"]);
    });

    test("accepts a function source", async () => {
        modules["104"] = {label: "function-source"};
        chunkPaths.set("14", "chunk14.js");
        fetchResponses.set("/assets/chunk14.js", "function()");
        const a = {
            e: (_id: string) => Promise.resolve(),
            b: (_entry: string) => {}
        };
        function lazyFunction() {
            return Promise.all([a.e("14")]).then(a.b.bind(a, "104"));
        }

        const results = await loadEntry(lazyFunction);

        expect(results).toEqual([{label: "function-source"}]);
        expect(fetchCalls).toEqual(["/assets/chunk14.js"]);
        expect(chunkLoadCalls).toEqual(["14"]);
    });

    test("uses legacy cache with cached rejected lookup result across concurrent calls", async () => {
        modules["300"] = {label: "rejected-reuse"};
        chunkPaths.set("30", "chunk30.js");
        fetchResponses.set("/assets/chunk30.js", new Error("fetch failed"));

        const source = buildSource([30], 300);
        const [first, second] = await Promise.all([loadEntry(source), loadEntry(source)]);

        expect(first).toEqual([{label: "rejected-reuse"}]);
        expect(second).toEqual([{label: "rejected-reuse"}]);
        expect(fetchCalls).toEqual(["/assets/chunk30.js"]);
        expect(loggerErrors).toHaveLength(2);
        expect(chunkLoadCalls).toEqual([]);
    });

    test("uses a callable native computed insert with the map as its receiver", () => {
        const nativeMap = new Map<string, string>() as Map<string, string> & {
            getOrInsertComputed(key: string, callback: (key: string) => string): string;
        };
        let callbackKey: string | undefined;

        nativeMap.getOrInsertComputed = function (key, callback) {
            expect(this).toBe(nativeMap);
            const value = callback(key);
            this.set(key, value);
            return value;
        };

        const result = getOrInsertComputedCompat(nativeMap, "native", (key: string) => {
            callbackKey = key;
            return "value";
        });

        expect(result).toBe("value");
        expect(callbackKey).toBe("native");
        expect(nativeMap.get("native")).toBe("value");
    });

    test("matches insert-if-absent cache semantics on legacy maps", () => {
        const cache = new Map<string, Promise<string> | undefined>();
        let calls = 0;

        cache.set("undefined", undefined);
        expect(getOrInsertComputedCompat(cache, "undefined", () => {
            calls += 1;
            return Promise.resolve("wrong");
        })).toBeUndefined();

        const fulfilled = Promise.resolve("fulfilled");
        const first = getOrInsertComputedCompat(cache, "fulfilled", () => {
            calls += 1;
            return fulfilled;
        });
        const second = getOrInsertComputedCompat(cache, "fulfilled", () => {
            calls += 1;
            return Promise.resolve("wrong");
        });
        expect(first).toBe(fulfilled);
        expect(second).toBe(fulfilled);

        const rejected = Promise.reject(new Error("cached rejection"));
        void rejected.catch(() => {});
        const rejectedFirst = getOrInsertComputedCompat(cache, "rejected", () => {
            calls += 1;
            return rejected;
        });
        const rejectedSecond = getOrInsertComputedCompat(cache, "rejected", () => {
            calls += 1;
            return Promise.resolve("wrong");
        });
        expect(rejectedFirst).toBe(rejected);
        expect(rejectedSecond).toBe(rejected);

        const thrown = new Error("synchronous");
        expect(() => getOrInsertComputedCompat(cache, "throw", () => {
            calls += 1;
            throw thrown;
        })).toThrow(thrown);
        expect(cache.has("throw")).toBeFalse();
        expect(calls).toBe(3);
    });

    test("returns entries in upstream completion order", async () => {
        modules["900"] = {label: "slow-first"};
        modules["901"] = {label: "fast-second"};
        chunkPaths.set("90", "slow.js");
        chunkPaths.set("91", "fast.js");
        fetchResponses.set("/assets/slow.js", "function slow() {}");
        fetchResponses.set("/assets/fast.js", "function fast() {}");

        let releaseSlow = () => {};
        const slowChunk = new Promise<void>((resolve) => {
            releaseSlow = resolve;
        });
        let reportFastEntry = () => {};
        const fastEntryRequired = new Promise<void>((resolve) => {
            reportFastEntry = resolve;
        });
        moduleRequireHandler = (id) => {
            if (id === "901") reportFastEntry();
        };
        chunkLoadHandler = (id) => id === "90" ? slowChunk : Promise.resolve();

        const pending = loadEntry(`${buildSource([90], 900)};${buildSource([91], 901)}`);
        await fastEntryRequired;
        releaseSlow();
        const result = await pending;

        expect(result).toEqual([{label: "fast-second"}, {label: "slow-first"}]);
        expect(chunkLoadCalls).toEqual(["90", "91"]);
        expect(moduleRequireCalls).toEqual(["901", "900", "901", "900"]);
    });

    test("matches upstream 8e3078b4 calls, results, errors, and cache behavior", async () => {
        const source = [
            buildSource([710], 810),
            buildSource([711], 811),
            buildSource([712], 812),
            buildSource([713], 813)
        ].join(";");

        const configureScenario = () => {
            modules["810"] = {label: "normal"};
            modules["811"] = {label: "worker"};
            modules["812"] = {label: "rejected"};
            modules["813"] = {label: "undefined-path"};
            chunkPaths.set("710", "normal.js");
            chunkPaths.set("711", "worker.js");
            chunkPaths.set("712", "rejected.js");
            chunkPaths.set("713", "undefined.js");
            fetchResponses.set("/assets/normal.js", "function normal() {}");
            fetchResponses.set("/assets/worker.js", "self.postMessage('worker')");
            fetchResponses.set("/assets/rejected.js", new Error("reference rejection"));
        };
        const capture = async (loader: (source: string) => Promise<unknown[] | null>) => {
            const first = await loader(source);
            const second = await loader(source);
            return {
                first,
                second,
                fetchCalls: [...fetchCalls],
                chunkLoadCalls: [...chunkLoadCalls],
                moduleRequireCalls: [...moduleRequireCalls],
                loggerErrors: [...loggerErrors]
            };
        };
        const resetScenario = () => {
            chunkLoadCalls = [];
            fetchCalls = [];
            moduleRequireCalls = [];
            moduleRequireHandler = () => {};
            fetchResponses = new Map();
            chunkPaths.clear();
            for (const key in modules) delete modules[key];
            loggerErrors = [];
        };

        configureScenario();
        const upstream = await capture(createUpstreamLoadEntry());

        resetScenario();
        configureScenario();
        const adapted = await capture(loadEntry);

        expect(adapted).toEqual(upstream);
    });

    test("skips worker and undefined chunks but still includes resolved entries", async () => {
        modules["400"] = {label: "worker-and-undefined"};
        modules["500"] = {label: "undefined-entry"};
        chunkPaths.set("40", "worker.js");
        chunkPaths.set("41", "undefined.js");
        fetchResponses.set("/assets/worker.js", "importScripts('worker')");

        const workerSource = buildSource([40], 400);
        const undefinedSource = buildSource([41], 500);
        const workerResult = await loadEntry(workerSource);
        const undefinedResult = await loadEntry(undefinedSource);

        expect(workerResult).toEqual([{label: "worker-and-undefined"}]);
        expect(undefinedResult).toEqual([{label: "undefined-entry"}]);
        expect(fetchCalls).toEqual(["/assets/worker.js"]);
        expect(chunkLoadCalls).toEqual([]);
    });

    test("logs and swallows chunk errors while preserving invocation order", async () => {
        modules["1"] = {label: "first"};
        modules["2"] = {label: "second"};
        chunkPaths.set("1", "chunk1.js");
        chunkPaths.set("2", "chunk2.js");
        fetchResponses.set("/assets/chunk1.js", "function()");
        fetchResponses.set("/assets/chunk2.js", "function()");
        chunkLoadHandler = () => Promise.reject(new Error("chunk-load"));

        const source = `${buildSource([1], "1", false)};${buildSource([2], "2", false)}`;
        const result = await loadEntry(source);

        expect(result).toEqual([{label: "first"}, {label: "second"}]);
        expect(loggerErrors).toHaveLength(2);
        expect(chunkLoadCalls).toEqual(["1", "2"]);
    });

    test("does not swallow entry require errors", async () => {
        modules["600"] = {label: "throws"};
        chunkPaths.set("60", "chunk60.js");
        fetchResponses.set("/assets/chunk60.js", "function()");
        moduleRequireHandler = (id) => {
            if (id === "600") throw new Error("entry require failed");
        };

        await expect(loadEntry(buildSource([60], 600))).rejects.toThrow("entry require failed");
        expect(loggerErrors).toEqual([]);
    });
});
