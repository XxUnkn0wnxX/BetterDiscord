import {mock} from "bun:test";
import {dryReadableStream, type DriedRequest, type DriedResponse} from "@common/native-fetch";
import {setProviderTokenUseReporter, type ProviderTokenDiagnostic} from "@common/provider-auth";

const persisted: Record<string, any> = {};
const calls: DriedRequest[] = [];
let writes = 0;
let updateStatus = 401;
let updateFinalUrl: string | undefined;
let probeStatus = 401;
let delayProbe: Promise<DriedResponse> | undefined;
let delayUpdate: Promise<DriedResponse> | undefined;
const release = "https://api.github.com/repos/owner/repo/releases/latest";
const slowbro = "https://git.slowb.ro/owner/repo/raw/branch/main/Test.plugin.js";
function response(url: string, status: number, data: unknown = {}): DriedResponse {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    return {
        url,
status,
statusText: "test",
redirected: false,
headers: {"content-type": "application/json"},
        body: dryReadableStream(new ReadableStream({start(controller) {controller.enqueue(bytes); controller.close();}}))
    };
}
mock.module("@polyfill/remote", () => ({"default": {nativeFetch: async (request: DriedRequest) => {
    calls.push(request);
    if (request.url === release || request.url === slowbro) return delayUpdate ?? response(updateFinalUrl ?? request.url, updateStatus);
    if (delayProbe) return delayProbe;
    return response(request.url, probeStatus, request.url.includes("/rate_limit")
        ? {resources: {core: {limit: 5000, remaining: 20, reset: 123}}}
        : {id: 123, login: "dummy"});
}}}));
mock.module("@stores/json", () => ({"default": {
    get: (key: string) => persisted[key],
    set: (key: string, value: unknown) => {writes++; persisted[key] = structuredClone(value);}
}}));
mock.module("@stores/config", () => ({"default": {isDevelopment: false, isCanary: false}}));
mock.module("@common/i18n", () => ({t: (key: string, values?: Record<string, string>) => `${key} ${Object.values(values ?? {}).join(" ")}`}));
mock.module("@common/logger", () => ({"default": {error() {}}}));
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("lucide-react", () => ({PaletteIcon: class {}, PlugIcon: class {}}));

const {default: Settings} = await import("@stores/settings");
const {default: Events} = await import("@modules/emitter");
const {default: Notifications} = await import("@stores/notifications");
const Net = await import("@modules/net");
const {initializeProviderTokenLifecycle} = await import("@modules/provider-token-lifecycle");
function assert(condition: unknown, message: string): void {if (!condition) throw new Error(message);}
const token = "dummy-lifecycle-token-1234";
const set = (provider: string, value: string) => Settings.set("settings", "accessTokens", provider, value);
const get = (provider: string) => Settings.get("settings", "accessTokens", provider);
const probeCalls = () => calls.filter(call => call.url !== release && call.url !== slowbro);
const resetObservations = () => {
    calls.length = 0;
    for (const notice of Notifications.notifications) Notifications.hide(notice);
    updateStatus = 401; probeStatus = 401; updateFinalUrl = undefined;
    delayProbe = undefined; delayUpdate = undefined;
};
async function waitForProbe() {
    for (let attempt = 0; attempt < 20 && probeCalls().length === 0; attempt++) await Bun.sleep(0);
    assert(probeCalls().length > 0, "Expected bounded validation did not start");
}
async function discard(result: Response) {await result.body?.cancel();}
Settings.initialize();
initializeProviderTokenLifecycle();
initializeProviderTokenLifecycle();
const cleared: string[] = [];
Events.on("provider-token-cleared", (provider: string) => cleared.push(provider));
set("github", token);
const diagnostics: ProviderTokenDiagnostic[] = [];
setProviderTokenUseReporter(event => diagnostics.push(event));
const beforePublicWrites = writes;
await discard(await Net.fetch(release));
assert(calls.length === 1 && !calls[0].providerAuthorization && !calls[0].providerTokenUsage, "Public 401 acquired managed credentials or an observer");
assert(probeCalls().length === 0 && get("github") === token && writes === beforePublicWrites, "Public 401 validated or cleared a saved token");
assert(Notifications.notifications.length === 0 && cleared.length === 0 && diagnostics.length === 0, "Public 401 produced a token notice or diagnostic");
resetObservations();
const beforeWrites = writes;
const gate = Promise.withResolvers<DriedResponse>();
delayProbe = gate.promise;
const first = Net.fetchAddonUpdate(release);
const second = Net.fetchAddonUpdate(release);
await waitForProbe();
assert(probeCalls().length === 1, "Concurrent failures should share one credential validation");
gate.resolve(response("https://api.github.com/rate_limit", 401));
await Promise.all([first, second].map(async request => discard(await request)));
assert(get("github") === "" && persisted.settings.accessTokens.github === "", "Confirmed invalid credentials must clear and persist through Settings");
assert(writes === beforeWrites + 1 && cleared.join() === "github", "Coalesced removal should write and notify once");
assert(diagnostics.length === 2 && diagnostics[0].kind === "validation-start" && diagnostics[1].kind === "validation-result", "Coalesced revalidation should report one start/result sequence");
assert(diagnostics.every(event => event.kind !== "update-success" && event.trigger === "revalidation"), "A rejected update was logged as a successful token use");
assert(Notifications.notifications.length === 1, "Clearing should produce one warning");
const warning = Notifications.notifications[0];
assert(warning.type === "warning" && warning.duration === Infinity && warning.actions?.[0].label.startsWith("ProviderTokens.dismiss"), "Clearing must produce a persistent manually dismissible warning");
assert(!JSON.stringify(warning).includes(token), "Warnings must not include credentials");

for (const status of [200, 403, 429, 500]) {
    resetObservations(); set("github", token); probeStatus = status;
    await discard(await Net.fetchAddonUpdate(release));
    assert(get("github") === token && Notifications.notifications.length === 0, "Valid, unavailable or permission responses must retain the saved token silently");
}

for (const scenario of ["caller", "anonymous", "redirect", "403", "429"] as const) {
    resetObservations(); set("github", scenario === "anonymous" ? "" : token);
    if (scenario === "redirect") updateFinalUrl = "https://cdn.example.test/Test.plugin.js";
    if (scenario === "403" || scenario === "429") updateStatus = Number(scenario);
    await discard(await Net.fetchAddonUpdate(release, scenario === "caller" ? {headers: {Authorization: "Bearer addon-owned"}} : undefined));
    assert(probeCalls().length === 0 && Notifications.notifications.length === 0, "Non-BD/final-hop-ineligible/non-401 responses must not validate or clear");
    assert(get("github") === (scenario === "anonymous" ? "" : token), "A caller credential failure must not clear BD configuration");
}

for (const replacement of ["replacement-dummy-token", "", token]) {
    resetObservations(); set("github", token);
    const oldProbe = Promise.withResolvers<DriedResponse>(); delayProbe = oldProbe.promise;
    const oldRequest = Net.fetchAddonUpdate(release);
    await waitForProbe();
    if (replacement === token) set("github", "intermediate-dummy-token");
    set("github", replacement);
    oldProbe.resolve(response("https://api.github.com/rate_limit", 401));
    await discard(await oldRequest);
    assert(get("github") === replacement && Notifications.notifications.length === 0, "Old probes must not clear replacements, manual removal or A-to-B-to-A rotations");
}

resetObservations(); set("github", token);
const oldUpdate = Promise.withResolvers<DriedResponse>(); delayUpdate = oldUpdate.promise;
const oldGenerationRequest = Net.fetchAddonUpdate(release);
set("github", "new-dispatch-generation"); set("github", token);
oldUpdate.resolve(response(release, 401));
await discard(await oldGenerationRequest);
assert(probeCalls().length === 0 && get("github") === token, "Generation must be captured before network dispatch rather than on response");

resetObservations(); set("slowbro", "dummy-lifecycle-forgejo-9876"); probeStatus = 200;
await discard(await Net.fetchAddonUpdate(slowbro));
assert(probeCalls().length === 1 && probeCalls()[0].url === "https://git.slowb.ro/api/v1/user", "Reactive Forgejo validation must skip setup-only repository permissions");
assert(get("slowbro") === "dummy-lifecycle-forgejo-9876", "Valid Forgejo credentials must remain configured");

resetObservations(); set("github", token); probeStatus = 200;
const oldSession: ProviderTokenDiagnostic[] = [];
const newSession: ProviderTokenDiagnostic[] = [];
setProviderTokenUseReporter(event => oldSession.push(event));
const held401 = Promise.withResolvers<DriedResponse>(); delayUpdate = held401.promise;
const oldCaptureRequest = Net.fetchAddonUpdate(release);
setProviderTokenUseReporter(event => newSession.push(event));
held401.resolve(response(release, 401));
await discard(await oldCaptureRequest);
assert(oldSession.length === 2 && newSession.length === 0, "Reactive validation switched to a new logging session instead of retaining its original callback");
setProviderTokenUseReporter();

resetObservations(); set("github", token);
Net.setProviderTokenFailureHandler(async () => {throw new Error("maintenance unavailable");});
const unchanged = await Net.fetchAddonUpdate(release);
assert(unchanged.status === 401, "Lifecycle errors must not replace the original response");
await discard(unchanged);
process.stdout.write("provider-token-lifecycle: ok\n");
