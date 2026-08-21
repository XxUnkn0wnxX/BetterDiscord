import {mock} from "bun:test";
import nodeFs from "node:fs";
import path from "node:path";


type RequestResponse = {
    error: Error | null;
    request: {aborted: boolean; statusMessage: string;};
    text: string;
};

type InstallProps = {
    install: (shouldEnable: boolean) => Promise<void>;
};

type ModalOptions = {
    onCloseCallback: () => void;
    onCloseRequest: () => void;
};

type ActiveModal = {
    props: InstallProps;
    options: ModalOptions;
};

const writes: Array<{filename: string; text: string;}> = [];
const stacktraces: string[] = [];
const toasts: Array<{message: string; type: string;}> = [];
const pluginManager = {
    addonFolder: "/virtual/betterdiscord/plugins",
    addonList: [] as unknown[],
    state: {} as Record<string, boolean>,
    saveStateCalls: 0,
    isLoaded: () => false,
    saveState: () => {pluginManager.saveStateCalls++;}
};
const themeManager = {
    addonFolder: "/virtual/betterdiscord/themes",
    addonList: [] as unknown[],
    state: {} as Record<string, boolean>,
    saveState: () => {}
};

let activeModal: ActiveModal | null = null;
let closeModalCalls = 0;
let requestResponse: RequestResponse = {
    error: null,
    request: {aborted: false, statusMessage: "OK"},
    text: ""
};
let parsedJsDocName = "";

const modulePath = (filename: string) => import.meta.resolve(`../../../src/betterdiscord/modules/${filename}`);
const fsModule = {
    writeFileSync: (filename: string, text: string) => writes.push({filename, text})
};

Object.assign(nodeFs as unknown as Record<string, unknown>, fsModule);
mock.module("fs", () => ({...fsModule, "default": fsModule}));
mock.module("node:fs", () => ({...fsModule, "default": fsModule}));
mock.module("@polyfill/request", () => ({
    "default": (_url: string, _options: unknown, callback: (error: Error | null, request: RequestResponse["request"], text: string) => void) => {
        queueMicrotask(() => callback(requestResponse.error, requestResponse.request, requestResponse.text));
    }
}));
mock.module("@common/logger", () => ({"default": {
    debug: () => {},
    info: () => {},
    warn: () => {},
    stacktrace: (_category: string, message: string, error?: Error) => stacktraces.push(`${message} ${error?.message ?? ""}`)
}}));
mock.module("@stores/toasts", () => ({"default": {
    show: (message: string, options: {type: string}) => toasts.push({message, type: options.type})
}}));
mock.module("@stores/json", () => ({"default": {get: () => ({}), set: () => {}}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@common/utils", () => ({parseJsDoc: () => ({name: parsedJsDocName})}));
mock.module("react", () => ({"default": {
    createElement: (_component: unknown, props: InstallProps) => ({props})
}}));
mock.module(modulePath("pluginmanager.ts"), () => ({"default": pluginManager}));
mock.module(modulePath("thememanager.ts"), () => ({"default": themeManager}));
mock.module(modulePath("addonmanager.ts"), () => ({"default": class {}}));
mock.module("@ui/modals", () => ({"default": {
    showConfirmationModal: () => {},
    ModalActions: {
        openModal: (render: (props: Record<string, unknown>) => {props: InstallProps}, options: ModalOptions) => {
            activeModal = {props: render({}).props, options};
            return "test-addon-store-modal";
        },
        closeModal: () => {closeModalCalls++;}
    }
}}));
mock.module("@ui/modals/installmodal", () => ({"default": class {}}));
mock.module("@stores/settings", () => ({"default": {get: () => false, on: () => () => {}}}));
mock.module("@data/web", () => ({"default": {
    API_VERSION: "test",
    resources: {thumbnail: (url: string | null) => url},
    redirects: {github: (id: string) => `https://github.example.test/${id}`},
    store: {addons: "https://store.example.test/addons", addon: (id: string) => id}
}}));
mock.module("@stores/base", () => ({"default": class {emitChange() {}}}));
mock.module("@utils/addonupdatestate", () => ({
    getAddonUpdateRateLimitDelay: () => ({blockedUntil: 0, nextFailureCount: 0}),
    isAddonUpdateRateLimitResponse: () => false
}));
mock.module(modulePath("net.ts"), () => ({fetch: async () => new Response("[]", {status: 200})}));

const {Addon} = await import("../../../src/betterdiscord/modules/addonstore");

const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message);
};

const makeAddon = (id: number, name: string, filename: string) => Addon.from({
    id,
    name,
    type: "plugin",
    thumbnail_url: null,
    author: {github_id: "1", display_name: "Test Author", guild: null},
    guild: null,
    description: "Test addon",
    tags: [],
    downloads: 0,
    version: "1.0.0",
    file_name: filename,
    latest_source_url: `https://source.example.test/${filename}`,
    initial_release_date: "2026-01-01T00:00:00.000Z",
    latest_release_date: "2026-01-02T00:00:00.000Z"
} as never);

const reset = () => {
    writes.length = 0;
    stacktraces.length = 0;
    toasts.length = 0;
    pluginManager.state = {};
    pluginManager.saveStateCalls = 0;
    activeModal = null;
    closeModalCalls = 0;
};

const runConfirmedInstall = async (addon: ReturnType<typeof makeAddon>, shouldEnable: boolean, response: RequestResponse) => {
    reset();
    requestResponse = response;
    parsedJsDocName = addon.name;

    const downloadPromise = addon.download();
    const modal = activeModal;
    if (!modal) throw new Error("Confirmed download did not open the install modal.");

    const installPromise = modal.props.install(shouldEnable);
    await installPromise;
    assert(closeModalCalls === 0, "Addon.download directly closed the modal from the install callback.");

    modal.options.onCloseCallback();
    await downloadPromise;
    assert(addon._download === undefined, "The modal-owned onClose callback did not clear _download.");
};

const enabledAddon = makeAddon(1001, "Enabled Download", "EnabledDownload.plugin.js");
await runConfirmedInstall(enabledAddon, true, {
    error: null,
    request: {aborted: false, statusMessage: "OK"},
    text: "enabled source"
});
assert(pluginManager.state[enabledAddon.name] === true, "Enabled install did not restore the manager state.");
assert(pluginManager.saveStateCalls === 1, "Enabled install did not save manager state.");
assert(writes.length === 1
    && writes[0].filename === path.join(pluginManager.addonFolder, enabledAddon.filename)
    && writes[0].text === "enabled source", "Enabled install did not write the downloaded source.");
assert(enabledAddon.downloads === 1, "Enabled install did not increment downloads.");
assert(toasts.some(toast => toast.type === "success" && toast.message === "Addons.successfullyDownload"), "Enabled install did not show a success toast.");

const disabledAddon = makeAddon(1002, "Disabled Download", "DisabledDownload.plugin.js");
await runConfirmedInstall(disabledAddon, false, {
    error: null,
    request: {aborted: false, statusMessage: "OK"},
    text: "disabled source"
});
assert(Object.keys(pluginManager.state).length === 0, "Disabled install unexpectedly enabled the addon.");
assert(pluginManager.saveStateCalls === 0, "Disabled install unexpectedly saved manager state.");
assert(writes.length === 1
    && writes[0].filename === path.join(pluginManager.addonFolder, disabledAddon.filename)
    && writes[0].text === "disabled source", "Disabled install did not write the downloaded source.");
assert(disabledAddon.downloads === 1, "Disabled install did not increment downloads.");
assert(toasts.some(toast => toast.type === "success" && toast.message === "Addons.successfullyDownload"), "Disabled install did not show a success toast.");

const failedAddon = makeAddon(1003, "Failed Download", "FailedDownload.plugin.js");
await runConfirmedInstall(failedAddon, true, {
    error: null,
    request: {aborted: false, statusMessage: "Bad Gateway"},
    text: "not installed"
});
assert(pluginManager.saveStateCalls === 0, "Failed install unexpectedly saved manager state.");
assert(writes.length === 0, "Failed install wrote a source file.");
assert(failedAddon.downloads === 0, "Failed install incremented downloads.");
assert(stacktraces.some(message => message.includes("Failed to fetch addon 'FailedDownload.plugin.js':")), "Failed install did not log the handled request/status error.");
assert(toasts.some(toast => toast.type === "error" && toast.message === "Addons.failedToDownload"), "Failed install did not show an error toast.");

const skipConfirmFailedAddon = makeAddon(1004, "Skip Confirm Failed Download", "SkipConfirmFailedDownload.plugin.js");
reset();
requestResponse = {
    error: null,
    request: {aborted: false, statusMessage: "Bad Gateway"},
    text: "not installed"
};
const skipConfirmDownloadPromise = skipConfirmFailedAddon.download(true).then(() => true);
assert(activeModal === null, "Skip-confirm download unexpectedly opened the install modal.");
assert(closeModalCalls === 0, "Skip-confirm download unexpectedly closed a modal.");
assert(await skipConfirmDownloadPromise, "Skip-confirm download did not resolve after a handled failure.");
assert(activeModal === null, "Skip-confirm download opened the install modal.");
assert(closeModalCalls === 0, "Skip-confirm download called ModalActions.closeModal.");
assert(pluginManager.state[skipConfirmFailedAddon.name] !== true && Object.keys(pluginManager.state).length === 0, "Skip-confirm failed install changed manager state.");
assert(pluginManager.saveStateCalls === 0, "Skip-confirm failed install unexpectedly saved manager state.");
assert(writes.length === 0, "Skip-confirm failed install wrote a source file.");
assert(skipConfirmFailedAddon.downloads === 0, "Skip-confirm failed install incremented downloads.");
assert(stacktraces.some(message => message.includes("Failed to fetch addon 'SkipConfirmFailedDownload.plugin.js':")), "Skip-confirm failed install did not log the handled request/status error.");
assert(toasts.some(toast => toast.type === "error" && toast.message === "Addons.failedToDownload"), "Skip-confirm failed install did not show an error toast.");
assert(skipConfirmFailedAddon._download === undefined, "Skip-confirm failed install did not clear _download.");

process.stdout.write("addon-store-download: ok\n");
