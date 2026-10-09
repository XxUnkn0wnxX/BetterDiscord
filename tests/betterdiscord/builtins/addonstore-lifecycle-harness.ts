import {mock} from "bun:test";

const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
};
const protocolList = ["discord:", "mailto:"];
const settingListeners: string[] = [];
const baseListeners: string[] = [];
const patchOwners: string[] = [];
const requested: string[] = [];
const downloaded: string[] = [];
let oldSettingReads = 0;
let protocolListeners = 0;
let beforeCalls = 0;
let openerLookups = 0;
const openerTargets: Array<[unknown, string]> = [];
let afterCalls = 0;
let addonEmbeds = false;
let unpatchOwner = "";
let handleProtocol!: (url: string) => void;
let renderEmbeds!: (target: unknown, args: unknown[], result: unknown[]) => unknown;
class MessageAccessories {renderEmbeds() {return [];}}
const opener = {open: () => {}};
let resolveEmbeds!: (module: typeof MessageAccessories) => void;
let resolveOpener!: (module: [typeof opener, string]) => void;
const lazyEmbeds = new Promise<typeof MessageAccessories>(resolve => {resolveEmbeds = resolve;});
const lazyOpener = new Promise<[typeof opener, string]>(resolve => {resolveOpener = resolve;});

mock.module("@common/logger", () => ({"default": {
    debug: () => {},
    info: () => {},
    warn: () => {},
    log: () => {},
    err: () => {},
    stacktrace: (_category: string, message: string, error: Error) => {throw new Error(`${message}: ${error.message}`);}
}}));
mock.module("@modules/addonstore", () => ({"default": {requestAddon: async (id: string) => {
    requested.push(id);
    return {download: () => {downloaded.push(id);}};
}}}));
mock.module("@modules/emitter", () => ({"default": {on: (event: string) => {baseListeners.push(event);}}}));
mock.module("@modules/commandmanager", () => ({"default": {registerCommand: () => () => {}}}));
mock.module("@modules/patcher", () => ({"default": {
    before: (owner: string, target: unknown, key: string) => {beforeCalls++; patchOwners.push(owner); openerTargets.push([target, key]);},
    after: (owner: string, _object: unknown, _key: string, callback: typeof renderEmbeds) => {
        afterCalls++;
        patchOwners.push(owner);
        renderEmbeds = callback;
    },
    unpatchAll: (owner: string) => {unpatchOwner = owner;}
}}));
mock.module("@stores/base", () => ({"default": class {emitChange() {}}}));
mock.module("@stores/settings", () => ({"default": {
    get: (_collection: string, _category: string, id: string) => {
        if (id === "bdAddonStore") oldSettingReads++;
        return id === "addonEmbeds" && addonEmbeds;
    },
    on: (collection: string, category: string, id: string) => {settingListeners.push(`${collection}/${category}/${id}`);}
}}));
mock.module("react", () => ({"default": {createElement: (component: unknown, props: unknown, child: unknown) => ({component, props, child})}}));
mock.module("@ui/misc/storeembed", () => ({"default": class {}}));
mock.module("@ui/errorboundary", () => ({"default": class {}}));
mock.module("@data/web", () => ({"default": {hostname: "betterdiscord.app", getReleaseChannelType: () => null}}));
mock.module("@polyfill/remote", () => ({"default": {addProtocolListener: (callback: typeof handleProtocol) => {
    protocolListeners++;
    handleProtocol = callback;
    queueMicrotask(() => callback("betterdiscord://plugin/Launch%20addon"));
}}}));
const webpack = {
    Filters: {byPrototypeKeys: () => () => true},
    getLazy: () => lazyEmbeds,
    getLazyByStrings: (sources: readonly string[], options: {searchExports?: boolean; withKey?: boolean}) => {
        openerLookups++;
        assert(sources.join() === ".trackAnnouncementMessageLinkClicked(" && options.searchExports === true && options.withKey === true, "Store link lookup lost its source/member/tuple options.");
        return lazyOpener;
    },
    getBySource: () => protocolList
};
mock.module("@webpack", () => webpack);
mock.module(import.meta.resolve("../../../src/betterdiscord/webpack"), () => webpack);
mock.module("@common/utils", () => ({findInTree: () => undefined}));
mock.module("@utils/react", () => ({getInternalInstance: () => null, getOwnerInstance: () => null}));
Object.assign(globalThis, {document: {querySelectorAll: () => []}});

const {retainBetterDiscordProtocol} = await import("../../../src/betterdiscord/utils/betterdiscordprotocol");
const viewerRelease = retainBetterDiscordProtocol();
const {default: StoreBuiltin} = await import("../../../src/betterdiscord/builtins/store/addonstore");
const initializing = StoreBuiltin.initialize();
await StoreBuiltin.initialize();
await Promise.resolve();
viewerRelease();
assert(protocolListeners === 1 && beforeCalls === 0 && afterCalls === 0, "Pending lazy patches blocked the launch listener or resolved unexpectedly.");
assert(protocolList.filter(value => value === "betterdiscord:").length === 1, "Pending lazy patches blocked permanent Store protocol ownership.");
assert(downloaded.join() === "Launch addon", "Pending lazy patches blocked the launch protocol download.");
resolveEmbeds(MessageAccessories);
resolveOpener([opener, "open"]);
await initializing;
await StoreBuiltin.initialize();
await Promise.resolve();
assert(StoreBuiltin.initialized && protocolListeners === 1, "Store builtin initialization duplicated or failed to register its launch listener.");
assert(beforeCalls === 1 && afterCalls === 1 && patchOwners.every(owner => owner === "AddonStore"), "Permanent Store patches lost their named owner or were installed twice.");
assert(settingListeners.join() === "settings/store/addonEmbeds" && baseListeners.length === 0 && oldSettingReads === 0, "Permanent Store retained a legacy setting gate or listener.");
assert(requested.join() === "Launch addon" && downloaded.join() === "Launch addon", "Launch protocol did not download while the old saved Store setting was false.");
assert(protocolList.filter(value => value === "betterdiscord:").length === 1, "Store did not independently retain shared protocol ownership.");

for (const kind of ["theme", "themes", "plugin", "plugins", "addon", "addons", "store"]) {
    handleProtocol(`betterdiscord://${kind}/Example%20${kind}`);
}
const priorRequests = requested.length;
handleProtocol("betterdiscord://betterdiscord/webpack-modules/patched/0/192.js");
handleProtocol("betterdiscord://editor/plugin/192");
await Promise.resolve();
assert(requested.length === priorRequests && downloaded.length === 8, "Store lost an addon alias or claimed source/editor routes.");

const original: unknown[] = [];
const message = {channel_id: "1", content: "<betterdiscord://addons/example>", messageReference: null};
assert(renderEmbeds(null, [message], original) === original, "Disabled addonEmbeds no longer gates embeds independently.");
addonEmbeds = true;
assert((renderEmbeds(null, [message], original) as unknown[]).length === 1, "Permanent Store did not retain its addonEmbeds setting category.");

await StoreBuiltin.patchLinkOpener();
await StoreBuiltin.patchLinkOpener();
assert(openerLookups === 1 && openerTargets.length === 3 && openerTargets.every(([target, key]) => target === opener && key === "open"), "Resolved link-opener tuple could not be reused or required a repeated lookup.");

await StoreBuiltin.disable();
assert(unpatchOwner === "AddonStore" && !protocolList.includes("betterdiscord:"), "Real builtin cleanup failed to remove patches or release the final protocol owner.");
await StoreBuiltin.disable();
assert(!protocolList.includes("betterdiscord:"), "Repeated cleanup restored or double-released protocol ownership.");
process.stdout.write("addon-store-builtin-lifecycle: ok\n");
