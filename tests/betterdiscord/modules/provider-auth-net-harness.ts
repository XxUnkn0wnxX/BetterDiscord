import {mock} from "bun:test";
import type {DriedRequest} from "@common/native-fetch";
import {configureProviderTokens, setProviderTokenUseReporter} from "@common/provider-auth";

const calls: DriedRequest[] = [];
const token = "dummy-renderer-token-1357";
let rejectRequest = false;
mock.module("../../../src/betterdiscord/polyfill/remote", () => ({"default": {
    nativeFetch: async (request: DriedRequest) => {
        calls.push(request);
        if (rejectRequest) throw new Error(`remote failed ${token}`);
        return {body: null, status: 200, statusText: "OK", headers: {}, url: request.url, redirected: false};
    }
}}));

const {default: Net} = await import("../../../src/betterdiscord/api/net");
const {fetchAddonUpdate} = await import("../../../src/betterdiscord/modules/net");
const api = new Net();
function check(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function last() {return calls[calls.length - 1];}
const release = "https://api.github.com/repos/XxUnkn0wnxX/JustOptimize-return-ShowHiddenChannels/releases/tags/Nightly-Fork";
configureProviderTokens({github: token, gitlab: "dummy-renderer-gitlab-5791"});
setProviderTokenUseReporter(() => {});

await api.fetch(release);
check(last().providerTokenUsage?.addon === "unknown addon", "A direct caller without a plugin source frame was given a fabricated identity");
check(last().providerAuthorization?.token === token, "real BdApi Net release call did not capture configured token");
check(!last().headers.authorization && !last().headers.Authorization, "renderer permanently modified headers");
await api.fetch("https://api.github.com/user");
check(!last().providerAuthorization, "general API call acquired authentication");
await api.fetch("https://api.github.com/gists/abc123");
check(!last().providerAuthorization, "public gist call acquired authentication");
await fetchAddonUpdate("https://api.github.com/gists/abc123");
check(last().providerAuthorization?.purpose === "managed-addon-update", "managed gist did not acquire private context");
await fetchAddonUpdate("https://api.github.com/gists/abc123", undefined, "Initiating.plugin.js");
check(last().providerTokenUsage?.addon === "Initiating.plugin.js", "Private managed caller context did not reach the native observer");
// Bun 1.1 does not honor eval sourceURL stack names; inject the V8 source-frame shape.
const OriginalError = globalThis.Error;
globalThis.Error = class extends OriginalError {
    constructor() {super(); this.stack = "Error\n at call (betterdiscord://betterdiscord/plugins/ActualCaller.plugin.js:2:1)";}
} as ErrorConstructor;
let pluginRequest: Promise<Response>;
try {pluginRequest = api.fetch(release);}
finally {globalThis.Error = OriginalError;}
await pluginRequest;
check(last().providerTokenUsage?.addon === "ActualCaller.plugin.js", "The renderer did not capture its plugin source frame synchronously before the async boundary");
await fetchAddonUpdate("https://gitlab.com/api/v4/projects/group%2Frepo/snippets/123");
check(last().providerAuthorization?.provider === "gitlab", "managed snippet did not select matching provider");
await api.fetch(release, {headers: {Authorization: "Bearer plugin-token"}});
check(!last().providerAuthorization && last().headers.authorization === "Bearer plugin-token", "plugin credential precedence changed");
await api.fetch(release, {headers: {Authorization: "Bearer "}});
check(last().providerAuthorization?.token === token, "bare Bearer did not fall back");
await api.fetch(release, {rejectUnauthorized: false});
check(!last().providerAuthorization, "disabled TLS verification acquired a token");
await api.fetch(new Request(release, {method: "HEAD"}));
check(last().providerAuthorization?.token === token && last().method === "HEAD", "Request inputs lost token/method");
rejectRequest = true;
try {
    await api.fetch(release);
    throw new Error("expected remote rejection");
}
catch (error) {
    check(error instanceof Error && error.message === "remote failed ****1357" && !error.stack?.includes(token), "remote rejection was not censored");
}
configureProviderTokens({});
rejectRequest = false;
await api.fetch(release);
check(!last().providerAuthorization, "cleared token is still active");
setProviderTokenUseReporter();
process.stdout.write("provider-auth-net: ok\n");
