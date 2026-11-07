import {expect, mock, test} from "bun:test";

mock.module("../../src/betterdiscord/modules/discordmodules", () => ({"default": {}}));
mock.module("@webpack", () => ({getByKeys: () => null}));
mock.module("../../src/betterdiscord/webpack/searching", () => ({getModule: () => null}));

const scenario = process.env.BD_QUEUE_SCENARIO;
const webpack: any[] = [];
const rspack: any[] = [];
const otherSentinel = [["other"], {}];
let rendererRuns = 0;
const idleCallbacks: Array<() => void> = [];
const win: any = {BetterDiscordRunRenderer() {rendererRuns++;}};
if (scenario === "webpack" || scenario === "shared" || scenario === "distinct") win.webpackChunkdiscord_app = webpack;
if (scenario === "rspack" || scenario === "distinct") win.rspackChunkdiscord_app = rspack;
if (scenario === "shared") win.rspackChunkdiscord_app = webpack;
if (scenario === "distinct") webpack.push(otherSentinel);
(globalThis as any).window = win;
(globalThis as any).requestIdleCallback = (callback: () => void) => idleCallbacks.push(callback);
if (!(Promise as any).withResolvers) (Promise as any).withResolvers = () => {let resolve: any, reject: any; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};

const cachedFactory = function() {};
const req: any = Object.assign(() => {}, {b: "base", m: {cached: cachedFactory}, c: {cached: {}}, e: () => Promise.resolve(), l: () => {}});
let forwardedThis: any;
const received: any[] = [];
const runtimePush = function(this: any, chunk: any) {
    // The runtime push receiver is part of the queue contract.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    forwardedThis = this;
    received.push(chunk);
    Object.assign(req.m, chunk[1]);
    chunk[2]?.(req);
    return 7;
};
if (scenario === "rspack") rspack.push = runtimePush;
const early = await import("../../src/electron/preload/early/index");
void early;
const selected = win.rspackChunkdiscord_app;
const earlyThroughInstalledPush = scenario === "rspack" && received.length === 1 && forwardedThis === rspack && typeof req.d === "function";
if (scenario !== "rspack") selected[0][2](req);
selected.push = runtimePush;
const renderer = await import("../../src/betterdiscord/webpack/require");
const Patcher = (await import("../../src/betterdiscord/modules/patcher")).default;
const {byKeys, bySource} = await import("../../src/betterdiscord/webpack/filter");

test("queue lifecycle and lazy module delivery", () => {
    if (scenario === "rspack") expect(earlyThroughInstalledPush).toBe(true);
    expect(renderer.webpackRequire).toBe(req);
    expect(req.m.cached).toBe(cachedFactory);
    expect(forwardedThis).toBe(selected);
    if (scenario === "distinct") expect(webpack).toEqual([otherSentinel]);
    else expect(win.webpackChunkdiscord_app === selected || scenario === "rspack").toBe(true);
    const listener = mock((_exports: any, _module: any, _id: any) => {});
    renderer.lazyListeners.add(listener);
    const factory = function(module: any) {module.exports.answer = 42;};
    expect(selected.push([[1], {123: factory}])).toBe(7);
    expect(forwardedThis).toBe(selected);
    const module: any = {exports: {}};
    req.c[123] = module;
    req.m[123](module, module.exports, req);
    expect(req.c[123]).toBe(module);
    expect(module.id).toBe("123");
    expect(module.exports.answer).toBe(42);
    expect(bySource("answer")(module.exports, module, module.id)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][2]).toBe("123");
    expect(req.m[123].__raw_module__()).toBeFunction();
    expect(String(req.m[123])).toBe(String(factory));
    renderer.lazyListeners.delete(listener);
    let replacementReceiver: any;
    selected.push = function(chunk: any) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        replacementReceiver = this;
        received.push(chunk);
        Object.assign(req.m, chunk[1]);
        return 11;
    };
    expect(selected.push([[9], {}])).toBe(11);
    expect(replacementReceiver).toBe(selected);
});

if (scenario === "empty") {
    test("declarations, third-party bypass and listener cleanup after failure", () => {
        // eslint-disable-next-line no-eval
        const factory = (0, eval)("(function(module,exports,require){let marker=123;module.exports=marker})");
        selected.push([[2], {456: factory}]);
        const wrapped = req.m[456];
        const module: any = {exports: {}};
        wrapped(module, module.exports, req);
        expect(module.id).toBe("456");
        expect(module.exports).toBe(123);
        expect(module.declarations.marker).toBe(123);
        expect(wrapped.__raw_module__()).toBe(wrapped.__raw_module__());

        // eslint-disable-next-line no-eval
        const thirdParty = (0, eval)("(function(module){const WEBPACK_IMPORTED_MODULE_1__=8;module.exports=WEBPACK_IMPORTED_MODULE_1__})");
        selected.push([[3], {789: thirdParty}]);
        expect(req.m[789].__raw_module__()).toBe(thirdParty);

        // eslint-disable-next-line no-eval
        const oneArgumentClassFactory = (0, eval)("({83978(e){e.exports={kL:'container_pog62O',Pl:'guilds_pog62O',E3:'base_pog62O'}}})[83978]");
        selected.push([[5], {83978: oneArgumentClassFactory}]);
        const guildStyles: any = {exports: {}};
        req.m[83978](guildStyles, guildStyles.exports, req);
        expect(guildStyles.exports.kL).toBe("container_pog62O");
        expect(guildStyles.exports.Pl).toBe("guilds_pog62O");
        expect(guildStyles.exports.E3).toBe("base_pog62O");
        expect(byKeys(["guilds", "base"])(guildStyles.exports)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(guildStyles.exports, "guilds")).toEqual({value: "guilds_pog62O", enumerable: true, configurable: false, writable: false});
        expect(Object.getOwnPropertyDescriptor(guildStyles.exports, "Pl")).toEqual({value: "guilds_pog62O", enumerable: false, configurable: true, writable: true});
        expect(guildStyles.exports[Symbol.for("BetterDiscord.Polyfilled.class")]).toBe(true);
        expect(Object.getOwnPropertyDescriptor(guildStyles.exports, Symbol.for("BetterDiscord.Polyfilled.class"))?.enumerable).toBe(false);

        // eslint-disable-next-line no-eval
        const threeArgumentClassFactory = (0, eval)("({964306(n,t,r){n.exports={Xs:'iconItem_Wx6SnQ iconBase_Wx6SnQ',gE:'actionIcon_Wx6SnQ'}}})[964306]");
        selected.push([[8], {964306: threeArgumentClassFactory}]);
        const contextMenuStyles: any = {exports: {}};
        req.m[964306](contextMenuStyles, contextMenuStyles.exports, req);
        expect(contextMenuStyles.exports.Xs).toBe("iconItem_Wx6SnQ iconBase_Wx6SnQ");
        expect(contextMenuStyles.exports.gE).toBe("actionIcon_Wx6SnQ");
        expect(byKeys(["iconItem", "actionIcon"])(contextMenuStyles.exports)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(contextMenuStyles.exports, "iconItem")?.enumerable).toBe(true);
        expect(Object.getOwnPropertyDescriptor(contextMenuStyles.exports, "Xs")).toEqual({value: "iconItem_Wx6SnQ iconBase_Wx6SnQ", enumerable: false, configurable: true, writable: true});
        expect(contextMenuStyles.exports[Symbol.for("BetterDiscord.Polyfilled.class")]).toBe(true);

        const beforeReactDiscovery = idleCallbacks.length;
        selected.push([[7], {903: function(reactFactoryModule: any) {reactFactoryModule.exports.createElement = () => null;}}]);
        const reactModule: any = {exports: {}};
        req.m[903](reactModule, reactModule.exports, req);
        expect(idleCallbacks.length).toBe(beforeReactDiscovery + 1);
        idleCallbacks.pop()!();
        expect(rendererRuns).toBe(1);

        const unparseable = (function(target: any) {target.exports = 17;}).bind(null);
        selected.push([[6], {902: unparseable}]);
        expect(req.m[902].__raw_module__()).toBe(unparseable);
        const fallbackModule: any = {exports: {}};
        req.m[902](fallbackModule, fallbackModule.exports, req);
        expect(fallbackModule.exports).toBe(17);

        const failing = function() {throw new Error("factory failure");};
        const listener = mock((_exports: any, _module: any, _id: any) => {});
        renderer.lazyListeners.add(listener);
        selected.push([[4], {900: failing}]);
        const failedModule: any = {exports: {}};
        expect(() => req.m[900](failedModule, failedModule.exports, req)).toThrow("factory failure");
        expect(listener).toHaveBeenCalledTimes(1);
        expect(req.m[900].__BD__).toBeUndefined();
        renderer.lazyListeners.delete(listener);
    });

    test("live getters, patching, values and definition errors", () => {
        const receiverGetters = {receiver: function(this: any) {return this;}};
        const receiverExports: any = {};
        req.d(receiverExports, receiverGetters);
        expect(receiverExports.receiver).toBe(receiverGetters);
        const exports: any = {};
        let current = () => 4;
        const getters = {fn: () => current};
        const originalGetter = getters.fn;
        req.d(exports, getters, {value: 9, immediate: () => 3, fn: "ignored"});
        const unpatchImmediate = Patcher.after("test", exports, "immediate", (_: any, __: any, value: number) => value + 1);
        expect(exports.immediate()).toBe(4);
        if (!unpatchImmediate) throw new Error("Immediate value patch was not installed");
        unpatchImmediate();
        expect(exports.immediate()).toBe(3);
        expect(exports.fn()).toBe(4);
        current = () => 5;
        expect(exports.fn()).toBe(5);
        const unpatch = Patcher.after("test", exports, "fn", (_: any, __: any, value: number) => value + 10);
        expect(exports.fn()).toBe(15);
        if (!unpatch) throw new Error("Patch was not installed");
        unpatch();
        expect(exports.fn()).toBe(5);
        const unpatchAgain = Patcher.after("test", exports, "fn", (_: any, __: any, value: number) => value + 20);
        expect(exports.fn()).toBe(25);
        if (!unpatchAgain) throw new Error("Second patch was not installed");
        unpatchAgain();
        expect(exports.fn()).toBe(5);
        expect(getters.fn).not.toBe(originalGetter);
        expect(getters.fn()()).toBe(5);
        expect(Object.getOwnPropertyDescriptor(exports, "value")).toEqual({value: 9, enumerable: true, configurable: true, writable: true});
        const inherited = Object.create({inherited: () => 1}); inherited.own = () => 2;
        const target: any = {own: 3}; req.d(target, inherited); expect(target).toEqual({own: 3});
        expect(() => req.d(Object.preventExtensions({}), {bad: () => 1, next: () => 2})).toThrow();
    });
}
