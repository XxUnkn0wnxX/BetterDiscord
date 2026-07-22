import {mock} from "bun:test";


const storeEnabled = false;
let automaticUpdatesEnabled = true;
let fetchCalls = 0;
const getFetchCalls = () => fetchCalls;

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);

mock.module("@polyfill/request", () => ({"default": async () => ({})}));
mock.module("@common/logger", () => ({"default": {debug: () => {}, info: () => {}, warn: () => {}, stacktrace: () => {}}}));
mock.module("@stores/toasts", () => ({"default": {show: () => {}}}));
mock.module("@stores/json", () => ({"default": {get: () => ({}), set: () => {}}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("react", () => ({"default": {createElement: () => null}}));
mock.module(modulePath("pluginmanager.ts"), () => ({"default": {addonFolder: "", addonList: []}}));
mock.module(modulePath("thememanager.ts"), () => ({"default": {addonFolder: "", addonList: []}}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: () => {}}}));
mock.module("@ui/modals/installmodal", () => ({"default": class {}}));
mock.module("@stores/settings", () => ({"default": {
    get: (_collection: string, category: string, id: string) => {
        if (category === "store" && id === "bdAddonStore") return storeEnabled;
        if (category === "addons" && id === "checkForUpdates") return automaticUpdatesEnabled;
        if (category === "addons" && id === "updateInterval") return 4;
        return false;
    },
    on: () => {}
}}));
mock.module("@data/web", () => ({"default": {
    API_VERSION: "test",
    store: {addons: "https://api.example.test/addons"}
}}));
mock.module(modulePath("addonmanager.ts"), () => ({"default": class {}}));
mock.module("@stores/base", () => ({"default": class {emitChange() {}}}));
mock.module(modulePath("net.ts"), () => ({fetch: async () => {
    fetchCalls++;
    return new Response("[]", {status: 200, headers: {"Content-Type": "application/json"}});
}}));

Object.assign(globalThis, {
    window: {
        navigator: {onLine: true},
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: () => 1,
        clearTimeout: () => {}
    }
});

const {default: AddonStore} = await import("../../../src/betterdiscord/modules/addonstore");

if (!await AddonStore.updaterRequestAddons(false) || getFetchCalls() !== 1) {
    throw new Error("Disabling the Addon Store UI impaired automatic plugin/theme catalogue access.");
}

automaticUpdatesEnabled = false;
if (await AddonStore.updaterRequestAddons(false) || getFetchCalls() !== 1) {
    throw new Error("A disabled background updater unexpectedly bypassed the catalogue consumer gate.");
}

if (!await AddonStore.updaterRequestAddons(true) || getFetchCalls() !== 2) {
    throw new Error("Manual plugin/theme refresh could not bypass the disabled Store/background gate.");
}

process.stdout.write("addon-store-updater-gates: ok\n");
