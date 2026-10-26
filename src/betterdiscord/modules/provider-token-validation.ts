import {normalizeProviderToken, type TokenProvider} from "@common/provider-auth";
import {fetch} from "./net";

const VALIDATION_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const FORGEJO_SCOPE_DENIAL = "token does not have at least one of required scope(s):";

export type MissingProviderPermission = "read:user" | "read:repository" | "user-read";
export type ProviderTokenValidationMode = "setup" | "validity";
export type ProviderTokenValidationResult =
    | {status: "valid"}
    | {status: "invalid"}
    | {status: "unavailable"; reason: "permission" | "rate-limit" | "network" | "response"; missingPermission?: MissingProviderPermission};

const unavailable = (reason: Extract<ProviderTokenValidationResult, {status: "unavailable"}>["reason"]): ProviderTokenValidationResult => ({status: "unavailable", reason});

function hasValidGitHubQuota(value: any): boolean {
    const core = value?.resources?.core;
    return Number.isFinite(core?.limit) && core.limit >= 0
        && Number.isFinite(core?.remaining) && core.remaining >= 0 && core.remaining <= core.limit
        && Number.isFinite(core?.reset) && core.reset >= 0;
}

function hasValidIdentity(value: any, field: "username" | "login"): boolean {
    return Number.isSafeInteger(value?.id) && value.id > 0
        && typeof value?.[field] === "string" && value[field].trim().length > 0;
}

async function readJson(response: Response): Promise<any> {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) return;
    try {return JSON.parse(body);}
    catch {return;}
}

/** Bounded provider probes; setup additionally checks permissions where the provider permits it. */
export async function validateProviderToken(provider: TokenProvider, candidate: string, signal: AbortSignal, mode: ProviderTokenValidationMode = "setup"): Promise<ProviderTokenValidationResult> {
    const token = normalizeProviderToken(candidate);
    if (!token || token.length > 1024) return {status: "invalid"};
    if (signal.aborted) return unavailable("network");

    const controller = new AbortController();
    let resolveAbort!: (result: ProviderTokenValidationResult) => void;
    let resolveTimeout!: (result: ProviderTokenValidationResult) => void;
    const aborted = new Promise<ProviderTokenValidationResult>(resolve => {resolveAbort = resolve;});
    const timedOut = new Promise<ProviderTokenValidationResult>(resolve => {resolveTimeout = resolve;});

    const onAbort = () => {
        controller.abort();
        resolveAbort(unavailable("network"));
    };
    signal.addEventListener("abort", onAbort, {once: true});
    const timer = setTimeout(() => {
        controller.abort();
        resolveTimeout(unavailable("network"));
    }, VALIDATION_TIMEOUT_MS);

    const url = provider === "github" ? "https://api.github.com/rate_limit"
        : provider === "gitlab" ? "https://gitlab.com/api/v4/user"
            : "https://git.slowb.ro/api/v1/user";
    const headers: Record<string, string> = {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "BetterDiscord"
    };
    if (provider === "github") headers.Authorization = `Bearer ${token}`;
    else if (provider === "slowbro") headers.Authorization = `token ${token}`;
    else headers["PRIVATE-TOKEN"] = token;

    const probe = async (input: string, permission?: MissingProviderPermission): Promise<{status: "response"; data: any} | ProviderTokenValidationResult> => {
        if (controller.signal.aborted) return unavailable("network");
        const response = await fetch(input, {
            method: "GET",
            headers,
            signal: controller.signal,
            redirect: "error",
            maxRedirects: 0,
            httpsOnly: true,
            rejectUnauthorized: true,
            timeout: VALIDATION_TIMEOUT_MS,
            maxResponseBytes: MAX_RESPONSE_BYTES
        });
        if (response.status === 401) return {status: "invalid"};
        if (response.status === 403) {
            if (mode === "setup" && provider === "gitlab") {
                if (/\berror\s*=\s*"insufficient_scope"/i.test(response.headers.get("www-authenticate") ?? "")) {
                    return {status: "unavailable", reason: "permission", missingPermission: "user-read"};
                }
                const data = await readJson(response);
                if (data?.error === "insufficient_scope" || data?.error === "insufficient_granular_scope") {
                    return {status: "unavailable", reason: "permission", missingPermission: "user-read"};
                }
            }
            if (mode === "setup" && provider === "slowbro" && permission) {
                const data = await readJson(response);
                if (typeof data?.message === "string" && data.message.startsWith(FORGEJO_SCOPE_DENIAL)) {
                    return {status: "unavailable", reason: "permission", missingPermission: permission};
                }
            }
            return unavailable("permission");
        }
        if (response.status === 429) return unavailable("rate-limit");
        if (response.status !== 200) return unavailable("response");
        return {status: "response", data: await readJson(response)};
    };

    const request = async (): Promise<ProviderTokenValidationResult> => {
        try {
            const identity = await probe(url, "read:user");
            if (identity.status !== "response") return identity;
            const valid = provider === "github" ? hasValidGitHubQuota(identity.data)
                : hasValidIdentity(identity.data, provider === "gitlab" ? "username" : "login");
            if (!valid) return unavailable("response");
            if (provider === "slowbro" && mode === "setup") {
                const repository = await probe("https://git.slowb.ro/api/v1/repos/search?limit=1", "read:repository");
                if (repository.status !== "response") return repository;
                if (repository.data?.ok !== true || !Array.isArray(repository.data?.data)) return unavailable("response");
            }
            return {status: "valid"};
        }
        catch {return unavailable("network");}
    };

    try {
        return await Promise.race([request(), timedOut, aborted]);
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (!controller.signal.aborted) controller.abort();
    }
}
