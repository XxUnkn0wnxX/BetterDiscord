import {mock} from "bun:test";

const persisted: Record<string, any> = {};
if (process.env.PROVIDER_TOKEN_SETTINGS_SCENARIO === "saved") persisted.settings = {accessTokens: {github: "gh-saved-dummy-token", gitlab: ""}};
let assertAuthBeforeWrite: (() => void) | undefined;
const jsonStore = {
    get: (file: string) => persisted[file],
    set: (file: string, value: unknown) => {
        assertAuthBeforeWrite?.();
        persisted[file] = structuredClone(value);
    }
};
mock.module(import.meta.resolve("../../../src/betterdiscord/stores/json.ts"), () => ({"default": jsonStore}));
mock.module("@stores/config", () => ({"default": {isDevelopment: false, isCanary: false}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@common/logger", () => ({"default": {error: () => {}}}));
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("lucide-react", () => ({PaletteIcon: class {}, PlugIcon: class {}}));

const {default: Settings} = await import("../../../src/betterdiscord/stores/settings");
const {default: Events} = await import("../../../src/betterdiscord/modules/emitter");
const {selectProviderAuthorization} = await import("../../../src/common/provider-auth");
const githubUrl = "https://api.github.com/repos/example/project/releases/latest";
const gitlabUrl = "https://gitlab.com/api/v4/projects/example%2Fproject/releases/permalink/latest";
const slowbroUrl = "https://git.slowb.ro/owner/repo/raw/branch/main/Test.plugin.js";
const assert = (condition: boolean, message: string) => {if (!condition) throw new Error(message);};
assertAuthBeforeWrite = () => {
    if (process.env.PROVIDER_TOKEN_SETTINGS_SCENARIO === "saved") {
        assert(selectProviderAuthorization(githubUrl)?.token === "gh-saved-dummy-token", "Saved token must be synchronized before initial settings persistence.");
    }
    else {
        assert(selectProviderAuthorization(githubUrl) === undefined, "Empty defaults must be synchronized before initial settings persistence.");
    }
};
Settings.initialize();
assertAuthBeforeWrite = undefined;

assert(Settings.getSetting("settings", "accessTokens", "github")?.value === "", "GitHub token default should be empty.");
if (process.env.PROVIDER_TOKEN_SETTINGS_SCENARIO === "saved") {
    assert(selectProviderAuthorization(githubUrl)?.token === "gh-saved-dummy-token", "Saved token should be active immediately after settings load.");
}
else {
    assert(selectProviderAuthorization(githubUrl) === undefined, "Missing token must disable provider authorization.");
}
let authorizedDuringSubscriber = false;
Settings.on("settings", "accessTokens", "github", () => {
    authorizedDuringSubscriber = selectProviderAuthorization(githubUrl)?.token === "gh-dummy-token-123456";
});
Settings.set("settings", "accessTokens", "github", "gh-dummy-token-123456");
assert(authorizedDuringSubscriber, "Provider token must be active before setting subscribers run.");
assert(selectProviderAuthorization(gitlabUrl) === undefined, "Changing GitHub must not authorize GitLab.");
Settings.set("settings", "accessTokens", "gitlab", "gl-dummy-token-abcdef");
assert(selectProviderAuthorization(githubUrl)?.token === "gh-dummy-token-123456", "Changing GitLab must preserve GitHub.");
assert(selectProviderAuthorization(gitlabUrl)?.token === "gl-dummy-token-abcdef", "GitLab token should authorize its provider.");
assert(persisted.settings.accessTokens.github === "gh-dummy-token-123456", "GitHub token should persist in settings.");
assert(Settings.getSetting("settings", "accessTokens", "slowbro")?.value === "", "Slowbro should have an empty optional default.");
Settings.set("settings", "accessTokens", "slowbro", "forgejo-dummy-token-7890");
assert(selectProviderAuthorization(slowbroUrl)?.token === "forgejo-dummy-token-7890", "Saving Slowbro should synchronize its raw update requests.");
assert(persisted.settings.accessTokens.slowbro === "forgejo-dummy-token-7890", "Slowbro token should persist with channel settings.");
assert(selectProviderAuthorization(githubUrl)?.token === "gh-dummy-token-123456" && selectProviderAuthorization(gitlabUrl)?.token === "gl-dummy-token-abcdef", "Changing Slowbro must preserve the other providers.");
Settings.set("settings", "accessTokens", "github", "");
assert(selectProviderAuthorization(githubUrl) === undefined, "Clearing a token must disable provider authorization.");
Settings.set("settings", "accessTokens", "gitlab", "");
let resetNotifications = 0;
const onProviderTokensReset = () => {resetNotifications++;};
Events.on("provider-tokens-reset", onProviderTokensReset);
Settings.resetCollection("settings");
Events.off("provider-tokens-reset", onProviderTokensReset);
assert(selectProviderAuthorization(gitlabUrl) === undefined, "Reset should clear token authorization.");
assert(persisted.settings.accessTokens.gitlab === "", "Reset should persist empty token defaults.");
assert(selectProviderAuthorization(slowbroUrl) === undefined && persisted.settings.accessTokens.slowbro === "", "Reset should persist Slowbro's empty default and disable authentication.");
assert(resetNotifications === 1, "Settings reset should notify dirty drafts even when committed token values already match defaults.");

persisted.settings = {accessTokens: {github: "gh-reloaded-token-123", gitlab: "gl-reloaded-token-456"}};
assertAuthBeforeWrite = () => {
    assert(selectProviderAuthorization(githubUrl)?.token === "gh-reloaded-token-123", "Direct reload must synchronize GitHub before writing settings.");
    assert(selectProviderAuthorization(gitlabUrl)?.token === "gl-reloaded-token-456", "Direct reload must synchronize GitLab before writing settings.");
};
Settings.loadCollection("settings");
assertAuthBeforeWrite = undefined;
assert(selectProviderAuthorization(githubUrl)?.token === "gh-reloaded-token-123", "Direct reload should activate new GitHub value.");
assert(selectProviderAuthorization(gitlabUrl)?.token === "gl-reloaded-token-456", "Direct reload should activate new GitLab value.");
