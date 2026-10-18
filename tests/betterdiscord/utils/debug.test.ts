import {describe, expect, mock, test} from "bun:test";

const coreValues: {version?: string; commit?: string;} = {};
const pluginManager = {
    addonList: [
        {id: "enabled", name: "Example Plugin", version: "1.2.3"},
        {id: "disabled", name: "Disabled Plugin", version: "4.5.6"}
    ],
    isEnabled: (id: string) => id === "enabled"
};
const themeManager = {
    addonList: [{id: "theme", name: "Example Theme", version: "7.8.9"}],
    isEnabled: () => false
};
mock.module("@stores/config", () => ({"default": {isCanary: false, get: (key: string) => coreValues[key as keyof typeof coreValues]}}));
mock.module("@modules/discordmodules", () => ({"default": {
    RemoteModule: {releaseChannel: "stable", version: [1, 2, 3], architecture: "arm64", buildNumber: 47, parsedOSRelease: [23, 0, 0]},
    UserAgentInfo: {os: {toString: () => "macOS 14.4"}}
}}));
mock.module("@modules/pluginmanager", () => ({"default": pluginManager}));
mock.module("@modules/thememanager", () => ({"default": themeManager}));
mock.module("@webpack", () => ({
    webpackRequire: {m: {
        client: "releaseChannel:window.GLOBAL_ENV.RELEASE_CHANNEL,buildNumber:\"2042\",versionHash:\"1234567890abcdef\""
    }},
    getByKeys: () => null
}));

const {default: getDebugInfo, getAddonList, getCoreInfo} = await import("@utils/debug");
type AddonManagerLike = Parameters<typeof getAddonList>[0];
type AddonManagerFixture = {
    addonList: Array<{id: string; name: string; version: string}>;
    isEnabled: (id: string) => boolean;
};
const asAddonManager = (fixture: AddonManagerFixture) => fixture as unknown as AddonManagerLike;

describe("debug information", () => {
    test("keeps the ordinary Settings/command debug output byte-for-byte unchanged", () => {
        const originalVersion = coreValues.version;
        const originalCommit = coreValues.commit;
        const originalClipboard = Object.getOwnPropertyDescriptor(window, "DiscordNative");
        coreValues.version = "1.14.3";
        coreValues.commit = "abcdef1234567890";
        Object.defineProperty(window, "DiscordNative", {configurable: true, value: {os: {release: "14.4.1"}}});

        try {
            expect(getDebugInfo()).toBe(
                "## Discord Info\nStable 2042 (1234567)\nHost 1.2.3 arm64 (47)\nmacOS 14.4 (14.4.1)\n\n## BetterDiscord\nStable 1.14.3 (abcdef1)\n\n### 2 Plugins (1 Enabled):\n- Example Plugin (1.2.3) (Enabled)\n- Disabled Plugin (4.5.6)\n\n### 1 Themes (0 Enabled):\n- Example Theme (7.8.9)\n"
            );
        }
        finally {
            if (originalVersion) coreValues.version = originalVersion;
            else delete coreValues.version;
            if (originalCommit) coreValues.commit = originalCommit;
            else delete coreValues.commit;
            if (originalClipboard) Object.defineProperty(window, "DiscordNative", originalClipboard);
            else Reflect.deleteProperty(window, "DiscordNative");
        }
    });

    test("keeps collapsed recovery debug information limited to the client and BetterDiscord", () => {
        const originalVersion = coreValues.version;
        const originalCommit = coreValues.commit;
        const originalClipboard = Object.getOwnPropertyDescriptor(window, "DiscordNative");
        coreValues.version = "1.14.3";
        coreValues.commit = "abcdef1234567890";
        Object.defineProperty(window, "DiscordNative", {configurable: true, value: {os: {release: "14.4.1"}}});

        try {
            const output = getDebugInfo({collapsible: true});
            expect(output.match(/<details>/g)).toHaveLength(1);
            expect(output.match(/<\/details>/g)).toHaveLength(1);
            expect(output).not.toContain("<details open");
            expect(output).toContain("<summary>Client Info</summary>");
            expect(output).toContain("## Discord Info\n\nStable 2042 (1234567)\nHost 1.2.3 arm64 (47)\nmacOS 14.4 (14.4.1)");
            expect(output).toContain("## BetterDiscord\n\nStable 1.14.3 (abcdef1)");
            expect(output).not.toContain("Plugins");
            expect(output).not.toContain("Themes");
            expect(output).not.toContain("Example Plugin");
            expect(output).not.toContain("Disabled Plugin");
            expect(output).not.toContain("Example Theme");
        }
        finally {
            if (originalVersion) coreValues.version = originalVersion;
            else delete coreValues.version;
            if (originalCommit) coreValues.commit = originalCommit;
            else delete coreValues.commit;
            if (originalClipboard) Object.defineProperty(window, "DiscordNative", originalClipboard);
            else Reflect.deleteProperty(window, "DiscordNative");
        }
    });

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
