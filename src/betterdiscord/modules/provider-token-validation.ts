import {normalizeProviderToken, type TokenProvider} from "@common/provider-auth";
import {fetch} from "./net";

const VALIDATION_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type ProviderTokenValidationResult =
    | {status: "valid"}
    | {status: "invalid"}
    | {status: "unavailable"; reason: "permission" | "rate-limit" | "network" | "response"};

const unavailable = (reason: Extract<ProviderTokenValidationResult, {status: "unavailable"}>["reason"]): ProviderTokenValidationResult => ({status: "unavailable", reason});

function hasValidGitHubQuota(value: any): boolean {
    const core = value?.resources?.core;
    return Number.isFinite(core?.limit) && core.limit >= 0
        && Number.isFinite(core?.remaining) && core.remaining >= 0 && core.remaining <= core.limit
        && Number.isFinite(core?.reset) && core.reset >= 0;
}

function hasValidGitLabIdentity(value: any): boolean {
    return Number.isSafeInteger(value?.id) && value.id > 0
        && typeof value?.username === "string" && value.username.trim().length > 0;
}

/** Validate a token draft with one bounded, read-only request. Response data is discarded. */
export async function validateProviderToken(provider: TokenProvider, candidate: string, signal: AbortSignal): Promise<ProviderTokenValidationResult> {
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

    const url = provider === "github"
        ? "https://api.github.com/rate_limit"
        : "https://gitlab.com/api/v4/user";
    const headers: Record<string, string> = {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "BetterDiscord"
    };
    if (provider === "github") headers.Authorization = `Bearer ${token}`;
    else headers["PRIVATE-TOKEN"] = token;

    const request = async (): Promise<ProviderTokenValidationResult> => {
        try {
            const response = await fetch(url, {
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
            if (response.status === 403) return unavailable("permission");
            if (response.status === 429) return unavailable("rate-limit");
            if (response.status !== 200) return unavailable("response");

            const body = await response.text();
            if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) return unavailable("response");
            let data: unknown;
            try {data = JSON.parse(body);}
            catch {return unavailable("response");}

            const valid = provider === "github" ? hasValidGitHubQuota(data) : hasValidGitLabIdentity(data);
            return valid ? {status: "valid"} : unavailable("response");
        }
        catch {
            return unavailable("network");
        }
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
