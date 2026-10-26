import {mock} from "bun:test";
import type {DriedRequest} from "@common/native-fetch";
import {configureProviderTokens, setProviderTokenUseReporter} from "@common/provider-auth";

const calls: DriedRequest[] = [];
const token = "dummy-renderer-token-1357";
let rejectionToken: string | undefined;
mock.module("../../../src/betterdiscord/polyfill/remote", () => ({"default": {
    nativeFetch: async (request: DriedRequest) => {
        calls.push(request);
        if (rejectionToken) throw new Error(`remote failed ${rejectionToken}`);
        return {body: null, status: 401, statusText: "Unauthorized", headers: {}, url: request.url, redirected: false};
    }
}}));

const {default: Net} = await import("../../../src/betterdiscord/api/net");
const {fetchAddonUpdate, setProviderTokenFailureHandler} = await import("../../../src/betterdiscord/modules/net");
const api = new Net();
function check(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function last() {return calls[calls.length - 1];}
const release = "https://api.github.com/repos/XxUnkn0wnxX/JustOptimize-return-ShowHiddenChannels/releases/tags/Nightly-Fork";
configureProviderTokens({github: token, gitlab: "dummy-renderer-gitlab-5791", slowbro: "dummy-renderer-slowbro-9753"});
let reports = 0;
let failures = 0;
setProviderTokenUseReporter(() => {reports++;});
setProviderTokenFailureHandler(async () => {failures++;});

for (const [provider, url, credential] of [
    ["github", release, {Authorization: "Bearer plugin-token"}],
    ["gitlab", "https://gitlab.com/api/v4/projects/1/releases", {"PRIVATE-TOKEN": "plugin-token"}],
    ["slowbro", "https://git.slowb.ro/owner/repo/raw/branch/main/Test.plugin.js", {Authorization: "token plugin-token"}]
] as const) {
    const headerCases: Array<Record<string, string>> = [{Accept: "application/json"}, {Authorization: "Bearer ", Accept: "application/json"}, credential];
    for (const headers of headerCases) {
        const result = await api.fetch(url, {headers});
        check(result.status === 401, `${provider}: public response changed`);
        check(!last().providerAuthorization && !last().providerTokenUsage, `${provider}: public fetch joined managed authentication or diagnostics`);
        check(JSON.stringify(last().headers) === JSON.stringify(Object.fromEntries(new Headers(headers))), `${provider}: caller headers changed`);
    }
}
check(failures === 0 && reports === 0, "Public 401 invoked token maintenance or diagnostics");
for (const url of ["https://api.github.com/user", "https://api.github.com/gists/abc123", "https://gitlab.com/api/v4/projects/1/snippets/123"]) {
    await api.fetch(url);
    check(!last().providerAuthorization && !last().providerTokenUsage, "Public metadata request joined managed authentication or diagnostics");
}
await api.fetch(release, {rejectUnauthorized: false});
check(!last().providerAuthorization && !last().providerTokenUsage, "Public disabled-TLS call acquired managed context");
await api.fetch(new Request(release, {method: "HEAD"}));
check(!last().providerAuthorization && !last().providerTokenUsage && last().method === "HEAD", "Public Request input lost its method or acquired managed context");

await fetchAddonUpdate("https://api.github.com/gists/abc123", undefined, "Initiating.plugin.js");
check(last().providerAuthorization?.purpose === "managed-addon-update", "managed gist did not acquire private context");
check(last().providerTokenUsage?.addon === "Initiating.plugin.js", "Private managed caller context did not reach the native observer");
// Bun 1.1 does not honor eval sourceURL stack names; inject the V8 source-frame shape.
const OriginalError = globalThis.Error;
globalThis.Error = class extends OriginalError {
    constructor() {super(); this.stack = "Error\n at call (betterdiscord://betterdiscord/plugins/ActualCaller.plugin.js:2:1)";}
} as ErrorConstructor;
let pluginRequest: Promise<Response>;
try {pluginRequest = fetchAddonUpdate(release);}
finally {globalThis.Error = OriginalError;}
await pluginRequest;
check(last().providerTokenUsage?.addon === "ActualCaller.plugin.js", "The private renderer did not capture its plugin source frame before the async boundary");
await fetchAddonUpdate("https://gitlab.com/api/v4/projects/group%2Frepo/snippets/123");
check(last().providerAuthorization?.provider === "gitlab", "managed snippet did not select matching provider");
await fetchAddonUpdate(release, {headers: {Authorization: "Bearer "}});
check(last().providerAuthorization?.token === token, "Private managed request lost blank-credential fallback");

for (const [secret, init, masked] of [
    [token, undefined, "****1357"],
    ["dummy-unconfigured-caller-8642", {headers: {Authorization: "Bearer dummy-unconfigured-caller-8642"}}, "****8642"]
] as const) {
    rejectionToken = secret;
    try {
        await api.fetch(release, init);
        throw new Error("expected remote rejection");
    }
    catch (error) {
        check(error instanceof Error && error.message === `remote failed ${masked}` && !error.stack?.includes(secret), "Public remote rejection was not censored without an observer");
        check(!last().providerTokenUsage, "Public secret censorship acquired an observer");
    }
}
configureProviderTokens({});
rejectionToken = undefined;
await fetchAddonUpdate(release);
check(!last().providerAuthorization, "cleared token is still active in managed updates");
setProviderTokenUseReporter();
process.stdout.write("provider-auth-net: ok\n");
