import {mock} from "bun:test";


const platform = process.env.WINDOW_PLATFORM ?? process.platform;
Object.defineProperty(process, "platform", {value: platform, configurable: true});

const initialMinimumSize = process.env.WINDOW_START_MINIMUM_SIZE === "true";
const storedSettings = {window: {removeMinimumSize: initialMinimumSize, inAppTrafficLights: false}};
const minimumSizes: Array<[number, number]> = [];
const vibrancies: unknown[] = [];
const backgroundMaterials: unknown[] = [];
const modals: Array<{options: {onConfirm?: () => unknown}}> = [];
const stacktraces: Array<[string, string, Error]> = [];
const frameClassChanges: string[] = [];
let rejectVibrancy = false;
let rejectBackgroundMaterial = false;
let relaunches = 0;

mock.module("@common/logger", () => ({"default": {
    debug: () => {},
    info: () => {},
    warn: () => {},
    log: () => {},
    err: () => {},
    stacktrace: (name: string, message: string, error: Error) => stacktraces.push([name, message, error])
}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@stores/config", () => ({"default": {isDevelopment: false, isCanary: false}}));
mock.module("@stores/json", () => ({"default": {
    get: () => structuredClone(storedSettings),
    set: () => undefined
}}));
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("@modules/patcher", () => ({"default": {
    before: () => () => {},
    after: () => () => {},
    instead: () => () => {},
    unpatchAll: () => {}
}}));
mock.module("@modules/commandmanager", () => ({"default": {registerCommand: () => () => {}}}));
mock.module("lucide-react", () => ({PaletteIcon: class {}, PlugIcon: class {}}));
mock.module("@ui/modals", () => ({"default": {
    showConfirmationModal: (_title: string, _body: string, options: {onConfirm?: () => unknown}) => modals.push({options})
}}));
mock.module("@modules/ipc", () => ({"default": {
    relaunch: () => {relaunches++;},
    setMinimumSize: (width: number, height: number) => minimumSizes.push([width, height]),
    setVibrancy: (value: unknown) => {
        vibrancies.push(value);
        return rejectVibrancy ? Promise.reject(new Error("vibrancy failed")) : Promise.resolve();
    },
    setBackgroundMaterial: (value: unknown) => {
        backgroundMaterials.push(value);
        return rejectBackgroundMaterial ? Promise.reject(new Error("material failed")) : Promise.resolve();
    }
}}));

const {default: Settings} = await import("../../../src/betterdiscord/stores/settings");
const {default: Events} = await import("../../../src/betterdiscord/modules/emitter");
const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
};

await Settings.initialize();

const getSetting = (id: string) => Settings.getSetting("settings", "window", id);
const platformDefaults = () => {
    const darwin = platform === "darwin";
    const windows = platform === "win32";
    assert(getSetting("inAppTrafficLights") === undefined, "The removed traffic-lights setting is still registered.");
    assert(getSetting("removeMinimumSize")?.defaultValue === false, "Minimum-size setting default changed.");
    assert(getSetting("frame")?.enableWith === "roundedCorners", "Native frame no longer depends on rounded-corners support.");
    assert(getSetting("roundedCorners")?.disableWith === "frame", "Rounded corners no longer depend on native frame state.");
    assert(getSetting("roundedCorners")?.hidden === darwin, "Rounded-corners platform visibility is incorrect.");
    assert(getSetting("acceptFirstMouse")?.hidden === !darwin, "First-mouse platform visibility is incorrect.");
    assert(getSetting("vibrancy")?.hidden === !darwin && getSetting("visualEffectState")?.hidden === !darwin, "macOS window effect visibility is incorrect.");
    assert(getSetting("backgroundMaterial")?.hidden === !windows, "Windows background-material visibility is incorrect.");
    assert((getSetting("vibrancy") as any)?.options.map((option: any) => option.value).join(",") === "none,titlebar,selection,menu,popover,sidebar,header,sheet,window,hud,fullscreen-ui,tooltip,content,under-window,under-page", "Vibrancy options differ from upstream.");
    assert((getSetting("backgroundMaterial") as any)?.options.map((option: any) => option.value).join(",") === "auto,none,mica,acrylic,tabbed", "Background-material options differ from upstream.");

    Settings.set("settings", "window", "roundedCorners", false);
    assert(getSetting("frame")?.disabled === true, "Frame was not disabled with rounded corners off.");
    Settings.set("settings", "window", "frame", true);
    assert(getSetting("roundedCorners")?.disabled === true, "Rounded corners were not disabled with frame on.");
    Settings.set("settings", "window", "frame", false);
    assert(getSetting("roundedCorners")?.disabled === false, "Rounded corners did not re-enable after frame was turned off.");
};

platformDefaults();

const mode = process.env.WINDOW_TEST_MODE ?? "defaults";
if (mode === "live") {
    const {default: NativeFrame} = await import("../../../src/betterdiscord/builtins/window/nativeframe");
    const {default: RemoveMinimumSize} = await import("../../../src/betterdiscord/builtins/window/removeminimumsize");
    const {default: ExtraWindowHandlers} = await import("../../../src/betterdiscord/builtins/window/handler");

    Object.assign(globalThis, {document: {body: {classList: {
        add: (name: string) => frameClassChanges.push(`add:${name}`),
        remove: (name: string) => frameClassChanges.push(`remove:${name}`)
    }}}});
    await NativeFrame.initialize();
    await RemoveMinimumSize.initialize();
    await ExtraWindowHandlers.initialize();
    await ExtraWindowHandlers.initialize();

    const listenerCount = Events.listenerCount("setting-updated");
    assert(listenerCount === 8, `Expected eight total setting listeners and one handler registration, got ${listenerCount}.`);

    const modalCountBeforeMinimumSizeChanges = modals.length;
    Settings.set("settings", "window", "removeMinimumSize", true);
    Settings.set("settings", "window", "removeMinimumSize", false);
    Settings.set("settings", "window", "removeMinimumSize", true);
    assert(minimumSizes.slice(-3).map(size => size.join(",")).join(";") === "0,0;800,500;0,0", "Minimum-size toggle sequence was incorrect.");
    assert(modals.length === modalCountBeforeMinimumSizeChanges, "Minimum-size changes still show a restart prompt.");

    const nativeFramePromptBaseline = modals.length;
    Settings.set("settings", "window", "frame", true);
    Settings.set("settings", "window", "frame", false);
    assert(frameClassChanges.join() === "add:bd-frame,remove:bd-frame", "Native-frame setting did not update the body class.");
    assert(modals.length === nativeFramePromptBaseline + 2, "Native-frame enable/disable did not request restart.");
    await modals.at(-1)!.options.onConfirm?.();
    assert(relaunches === 1, "Native-frame restart confirmation did not relaunch.");

    Settings.set("settings", "window", "vibrancy", "titlebar");
    Settings.set("settings", "window", "backgroundMaterial", "mica");
    await Promise.resolve();
    assert(vibrancies.join() === "titlebar" && backgroundMaterials.join() === "mica", "Native window effect settings were not forwarded.");

    const promptBaseline = modals.length;
    Settings.set("settings", "window", "visualEffectState", "active");
    Settings.set("settings", "window", "acceptFirstMouse", true);
    Settings.set("settings", "window", "roundedCorners", false);
    assert(modals.length === promptBaseline + 3, "Restart-required effect settings did not prompt once each.");
    await modals.at(-1)!.options.onConfirm?.();
    assert(relaunches === 2, "Restart confirmation did not invoke the relaunch callback.");

    const promptBaselineForLegacySetting = modals.length;
    Events.dispatch("setting-updated", "settings", "window", "inAppTrafficLights", true);
    assert(modals.length === promptBaselineForLegacySetting, "The removed traffic-light setting still prompts for restart.");

    rejectVibrancy = true;
    rejectBackgroundMaterial = true;
    Settings.set("settings", "window", "vibrancy", "menu");
    Settings.set("settings", "window", "backgroundMaterial", "acrylic");
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    assert(stacktraces.some(([name, message, error]) => name === "ExtraWindowHandlers" && message.includes("vibrancy") && error.message === "vibrancy failed"), "Rejected vibrancy IPC was not handled through builtin stacktrace.");
    assert(stacktraces.some(([name, message, error]) => name === "ExtraWindowHandlers" && message.includes("background material") && error.message === "material failed"), "Rejected background-material IPC was not handled through builtin stacktrace.");
}
else if (mode === "startup") {
    const {default: RemoveMinimumSize} = await import("../../../src/betterdiscord/builtins/window/removeminimumsize");
    await RemoveMinimumSize.initialize();
    const expected = initialMinimumSize ? "0,0" : "";
    assert(minimumSizes.map(size => size.join(",")).join() === expected, `Startup minimum-size behavior was incorrect: ${minimumSizes.map(size => size.join(","))}.`);
}

process.stdout.write(`window-options: ${mode} ${platform} ok\n`);
