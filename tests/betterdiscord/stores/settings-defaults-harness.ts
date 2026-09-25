import {mock} from "bun:test";


type SettingsState = Record<string, Record<string, unknown>>;
type Scenario = "missing" | "missing-setting" | "saved-false" | "saved-true" | "reset";

const scenario = process.env.SETTINGS_DEFAULTS_SCENARIO as Scenario;
const stored: SettingsState | undefined = scenario === "missing"
    ? undefined
    : {store: scenario === "missing-setting" ? {} : {alwaysEnable: scenario === "saved-true"}};
const writes: SettingsState[] = [];

const jsonStore = {
    get: () => stored,
    set: (_file: "settings", value: SettingsState) => writes.push(structuredClone(value))
};

mock.module(import.meta.resolve("../../../src/betterdiscord/stores/json.ts"), () => ({"default": jsonStore}));
mock.module("@stores/config", () => ({"default": {isDevelopment: false, isCanary: false}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@common/logger", () => ({"default": {error: () => {}}}));
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("lucide-react", () => ({PaletteIcon: class {}, PlugIcon: class {}}));

const {default: Settings} = await import("../../../src/betterdiscord/stores/settings");

const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message);
};

Settings.initialize();

const value = Settings.get<boolean>("settings", "store", "alwaysEnable");
const setting = Settings.getSetting("settings", "store", "alwaysEnable");
assert(setting?.defaultValue === true, `Expected alwaysEnable defaultValue to be true, got ${String(setting?.defaultValue)}.`);

if (scenario === "reset") {
    assert(value === false, `Expected saved false before reset, got ${String(value)}.`);
    Settings.resetCollection("settings");
    assert(Settings.get<boolean>("settings", "store", "alwaysEnable") === true, "Reset did not restore alwaysEnable to true.");
    assert(writes.at(-1)?.store.alwaysEnable === true, "Reset did not persist alwaysEnable=true.");
}
else {
    const expected = scenario === "missing" || scenario === "missing-setting" || scenario === "saved-true";
    assert(value === expected, `Expected alwaysEnable=${String(expected)}, got ${String(value)}.`);
}
