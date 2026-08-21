import {describe, expect, mock, test} from "bun:test";

mock.module("@stores/config", () => ({
    "default": {
        isCanary: false,
        get: () => undefined
    }
}));
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("@modules/pluginmanager", () => ({"default": {}}));
mock.module("@modules/thememanager", () => ({"default": {}}));
mock.module("@webpack", () => ({webpackRequire: {m: {}}, getByKeys: () => null}));

const {getAddonList, getCoreInfo} = await import("@utils/debug");
type AddonManagerLike = Parameters<typeof getAddonList>[0];
type AddonManagerFixture = {
    addonList: Array<{id: string; name: string; version: string}>;
    isEnabled: (id: string) => boolean;
};
const asAddonManager = (fixture: AddonManagerFixture) => fixture as unknown as AddonManagerLike;

describe("debug information", () => {
    test("includes the version and one enabled suffix for enabled addons", () => {
        const manager = asAddonManager({
            addonList: [{id: "enabled", name: "Example Plugin", version: "1.2.3"}],
            isEnabled: (id: string) => id === "enabled"
        });

        expect(getAddonList(manager)).toBe("- Example Plugin (1.2.3) (Enabled)");
    });

    test("includes the version without a trailing space for disabled addons", () => {
        const manager = asAddonManager({
            addonList: [{id: "disabled", name: "Example Theme", version: "4.5.6"}],
            isEnabled: () => false
        });

        expect(getAddonList(manager)).toBe("- Example Theme (4.5.6)");
    });

    test("retains the missing version and commit fallback", () => {
        expect(getCoreInfo()).toBe("Stable unknown\n");
    });
});
