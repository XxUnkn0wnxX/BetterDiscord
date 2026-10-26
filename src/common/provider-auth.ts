/** Private provider policy shared by the renderer and native transport. No store or runtime imports. */
export const tokenProviders = ["github", "gitlab", "slowbro"] as const;
export type TokenProvider = typeof tokenProviders[number];
export const providerNames: Record<TokenProvider, string> = {github: "GitHub", gitlab: "GitLab", slowbro: "git.slowb.ro"};
export const providerHosts: Record<TokenProvider, string> = {github: "github.com", gitlab: "gitlab.com", slowbro: "git.slowb.ro"};
export type ProviderAuthorizationPurpose = "managed-addon-update" | "recognized-self-update";
export interface ProviderAuthorization {
    provider: TokenProvider;
    token: string;
    purpose: ProviderAuthorizationPurpose;
}
export interface ProviderRequestPolicy {
    method?: string;
    headers?: Readonly<Record<string, string>>;
    rejectUnauthorized?: boolean;
}
export interface ProviderTokenUse {
    provider: TokenProvider;
    source: "betterdiscord" | "caller";
    maskedToken: string;
}

export interface ProviderTokenSuccess extends ProviderTokenUse {
    kind: "update-success";
    addon: string;
    status: number;
}
export type ProviderValidationReason = "valid" | "invalid" | "missing-permissions" | "permission-denied" | "rate-limit" | "network" | "response";
export type ProviderTokenDiagnostic = ProviderTokenSuccess | {
    kind: "validation-start" | "validation-result";
    provider: TokenProvider;
    trigger: "setup" | "revalidation";
    maskedToken: string;
    addon?: string;
    result?: ProviderValidationReason;
};
export type ProviderTokenReporter = (event: ProviderTokenDiagnostic) => void;
export interface ProviderTokenOperation {
    report?: ProviderTokenReporter;
    addon: string;
}

let tokenUseReporter: ProviderTokenReporter | undefined;

export function setProviderTokenUseReporter(reporter?: ProviderTokenReporter): void {
    tokenUseReporter = reporter;
}

export function hasProviderTokenUseReporter(): boolean {
    return tokenUseReporter !== undefined;
}

/** Retain this operation's capture session, even if logging is disabled and re-enabled. */
export function captureProviderTokenReporter(): ProviderTokenReporter | undefined {
    const reporter = tokenUseReporter;
    if (!reporter) return;
    return event => {
        try {reporter(event);}
        catch {/* Reporting must never change a network request's outcome. */}
    };
}

export function sanitizeProviderAddonLabel(value: unknown, capturedTokens: readonly string[] = []): string {
    if (typeof value !== "string") return "unknown addon";
    const redacted = redactProviderTokens(value, capturedTokens);
    // Labels are names, never paths, URLs or stack fragments.
    if (/[\\/:\r\n]/.test(redacted)) return "unknown addon";
    // eslint-disable-next-line no-control-regex -- Remove controls and directional overrides from names.
    return redacted.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 120) || "unknown addon";
}

/** The first actual plugin source frame identifies a library when it owns the call. */
export function providerAddonFromStack(stack: unknown, capturedTokens: readonly string[] = []): string {
    if (typeof stack !== "string") return "unknown addon";
    const match = /betterdiscord:\/\/(?:betterdiscord\/)?plugins\/([^/\r\n]+?\.plugin\.js)(?=[:)\s]|$)/.exec(stack);
    return match ? sanitizeProviderAddonLabel(match[1], capturedTokens) : "unknown addon";
}

const tokens: Record<TokenProvider, string> = {github: "", gitlab: "", slowbro: ""};
const generations: Record<TokenProvider, number> = {github: 0, gitlab: 0, slowbro: 0};
const recentTokens: string[] = [];
const credentialHeaders = new Set(["authorization", "proxy-authorization", "private-token", "job-token", "x-gitlab-token", "x-api-key"]);
const credentialQuery = new Set(["access_token", "private_token", "job_token", "token", "auth", "authorization", "api_key", "apikey", "oauth_token"]);

export function normalizeProviderToken(value: unknown): string {
    if (typeof value !== "string") return "";
    const token = value.trim();
    // Node rejects controls/non-ASCII headers; never attempt to send such a value.
    return /^[\x21-\x7e]+$/.test(token) ? token : "";
}

/** Replace the complete configuration; an omitted provider is disabled. */
export function configureProviderTokens(values: Partial<Record<TokenProvider, unknown>>) {
    const changedProviders: TokenProvider[] = [];
    for (const provider of tokenProviders) {
        const value = values[provider];
        if (typeof value === "string" && value.trim()) {
            const index = recentTokens.indexOf(value.trim());
            if (index !== -1) recentTokens.splice(index, 1);
            recentTokens.push(value.trim());
            if (recentTokens.length > 16) recentTokens.shift();
        }
        const token = normalizeProviderToken(value);
        if (token === tokens[provider]) continue;
        tokens[provider] = token;
        generations[provider]++;
        changedProviders.push(provider);
    }
    return {changedProviders, generations: {...generations}};
}

export function getProviderTokenGeneration(provider: TokenProvider): number {
    return generations[provider];
}

export function maskProviderToken(token: string): string {
    return token.length > 8 ? `****${token.slice(-4)}` : "****";
}

/** Only authorization headers interpret schemes; raw credentials need only be nonempty. */
function meaningfulCredential(value: string, headerName?: string): boolean {
    const trimmed = value.trim();
    if (headerName === "authorization" || headerName === "proxy-authorization") {
        return !/^(?:bearer|token|basic)?$/i.test(trimmed);
    }
    return trimmed.length > 0;
}

function hasCallerCredentials(url: URL, headers: Readonly<Record<string, string>>): boolean {
    if (url.username || url.password) return true;
    for (const [key, value] of url.searchParams) {
        if (credentialQuery.has(key.toLowerCase().replace(/-/g, "_")) && meaningfulCredential(value)) return true;
    }
    return Object.entries(headers).some(([key, value]) => credentialHeaders.has(key.toLowerCase()) && meaningfulCredential(value, key.toLowerCase()));
}

function eligibleProvider(input: string, purpose: ProviderAuthorizationPurpose, policy: ProviderRequestPolicy, ignoreCallerCredentials = false): TokenProvider | null {
    let url: URL;
    try {url = new URL(input);}
    catch {return null;}
    if (url.protocol !== "https:" || url.port || url.username || url.password || policy.rejectUnauthorized === false
        || !/^(GET|HEAD)$/i.test(policy.method ?? "GET") || (!ignoreCallerCredentials && hasCallerCredentials(url, policy.headers ?? {}))) return null;

    const path = url.pathname;
    const addonFile = /\.(?:plugin\.js|theme\.css)$/i;
    if (url.origin === "https://api.github.com") {
        if (/^\/repos\/[^/]+\/[^/]+\/releases(?:\/(?:latest|\d+|tags\/[^/]+|assets\/\d+|\d+\/assets))?\/?$/.test(path)) return "github";
        if (/^\/repos\/[^/]+\/[^/]+\/contents\/.+/.test(path) && addonFile.test(path)) return "github";
        if (purpose === "managed-addon-update" && /^\/gists\/[a-f\d]+$/i.test(path)) return "github";
    }
    if (url.origin === "https://gitlab.com") {
        if (/^\/api\/v4\/projects\/[^/]+\/releases(?:\/permalink\/latest|\/[^/]+(?:\/assets\/links(?:\/\d+)?)?)?\/?$/.test(path)) return "gitlab";
        if (/^\/api\/v4\/projects\/[^/]+\/repository\/files\/[^/]+(?:\/raw)?$/.test(path)) {
            let file: string;
            try {file = decodeURIComponent(path.replace(/\/raw\/?$/, ""));}
            catch {return null;}
            if (addonFile.test(file)) return "gitlab";
        }
        if (purpose === "managed-addon-update" && /^\/api\/v4\/(?:projects\/[^/]+\/)?snippets\/\d+$/.test(path)) return "gitlab";
    }
    if (url.origin === "https://git.slowb.ro") {
        if (/^\/api\/v1\/repos\/[^/]+\/[^/]+\/releases(?:\/(?:latest|tags\/[^/]+|\d+(?:\/assets(?:\/\d+)?)?))?\/?$/.test(path)) return "slowbro";
        if (/^\/api\/v1\/repos\/[^/]+\/[^/]+\/(?:contents|raw)\/.+/.test(path) && addonFile.test(path)) return "slowbro";
        if (/^\/[^/]+\/[^/]+\/raw\/(?:branch|tag|commit)\/.+\/.+/.test(path) && addonFile.test(path)) return "slowbro";
    }
    return null;
}

/** Classify an eligible request even when the matching provider token is disabled. */
export function getProviderForUpdateRequest(input: string, policy: ProviderRequestPolicy = {}, purpose: ProviderAuthorizationPurpose = "recognized-self-update"): TokenProvider | null {
    return eligibleProvider(input, purpose, policy);
}

/** Capture once, before crossing the renderer/native boundary or changing settings. */
export function selectProviderAuthorization(url: string, policy: ProviderRequestPolicy = {}, purpose: ProviderAuthorizationPurpose = "recognized-self-update"): ProviderAuthorization | undefined {
    const provider = eligibleProvider(url, purpose, policy);
    if (!provider || !tokens[provider]) return undefined;
    return {provider, token: tokens[provider], purpose};
}

/** Always copy caller headers. Generated credentials exist only on an eligible native hop. */
export function providerHeadersForHop(originalUrl: string, currentUrl: string, policy: ProviderRequestPolicy, authorization?: ProviderAuthorization): Record<string, string> {
    const headers = {...policy.headers};
    if (!authorization || !normalizeProviderToken(authorization.token) || normalizeProviderToken(authorization.token) !== authorization.token) return headers;
    const {provider, purpose, token} = authorization;
    if (eligibleProvider(originalUrl, purpose, policy) !== provider || eligibleProvider(currentUrl, purpose, policy) !== provider) return headers;
    if (new URL(originalUrl).origin !== new URL(currentUrl).origin) return headers;
    for (const [key, value] of Object.entries(headers)) {
        if (credentialHeaders.has(key.toLowerCase()) && !meaningfulCredential(value, key.toLowerCase())) delete headers[key];
    }
    if (provider === "github") {
        headers.Authorization = `Bearer ${token}`;
        if (!Object.entries(headers).some(([key, value]) => key.toLowerCase() === "user-agent" && value.trim())) {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === "user-agent") delete headers[key];
            }
            headers["User-Agent"] = "BetterDiscord";
        }
    }
    else if (provider === "slowbro") {headers.Authorization = `token ${token}`;}
    else {headers["PRIVATE-TOKEN"] = token;}
    return headers;
}

/** Inspect only understood credentials on the actual native hop; the raw value stays local. */
export function providerTokenUseForHop(originalUrl: string, currentUrl: string, policy: ProviderRequestPolicy, purpose: ProviderAuthorizationPurpose, authorization?: ProviderAuthorization): {event: ProviderTokenUse; token: string;} | undefined {
    const provider = eligibleProvider(originalUrl, purpose, policy, true);
    if (!provider || eligibleProvider(currentUrl, purpose, policy, true) !== provider) return;
    const original = new URL(originalUrl);
    const current = new URL(currentUrl);
    if (original.origin !== current.origin) return;
    const headers = new Map(Object.entries(policy.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const suppliedAuthorization = headers.get("authorization")?.trim() ?? "";
    let token: string | undefined;
    if (provider === "github" || provider === "slowbro") {
        token = /^(?:Bearer|token)\s+(.+)$/i.exec(suppliedAuthorization)?.[1];
    }
    else {
        token = headers.get("private-token")?.trim() || headers.get("job-token")?.trim()
            || /^Bearer\s+(.+)$/i.exec(suppliedAuthorization)?.[1];
        if (!token) {
            for (const key of ["private_token", "access_token", "job_token"]) {
                token = current.searchParams.get(key)?.trim();
                if (token) break;
            }
        }
    }
    if (!token) return;
    return {
        token,
        event: {
            provider,
            source: authorization?.provider === provider && authorization.token === token ? "betterdiscord" : "caller",
            // Odd caller query values must not inject controls or new lines into the report.
            maskedToken: normalizeProviderToken(token) ? maskProviderToken(token) : "****"
        }
    };
}

/** Redact configured/recent values plus a request's captured value, even after rotation. */
export function redactProviderTokens(text: string, capturedTokens: readonly string[] = []): string {
    const replacements = new Map<string, string>();
    for (const token of [...Object.values(tokens), ...recentTokens, ...capturedTokens]) {
        if (!token) continue;
        const variants = [token, JSON.stringify(token).slice(1, -1)];
        try {variants.push(encodeURI(token), encodeURIComponent(token), new URLSearchParams({t: token}).toString().slice(2));}
        catch {/* Invalid Unicode cannot be sent, but its literal/JSON form still needs redaction. */}
        for (const variant of variants) {
            replacements.set(variant, maskProviderToken(token));
            replacements.set(variant.replace(/%[\dA-F]{2}/g, part => part.toLowerCase()), maskProviderToken(token));
        }
    }
    if (!replacements.size) return text;
    const pattern = [...replacements.keys()].sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    return text.replace(new RegExp(pattern, "g"), match => replacements.get(match)!);
}

/** Preserve error identity/properties unless its message/stack actually needs censorship. */
export function sanitizeProviderError<T>(error: T, capturedTokens: readonly string[] = []): T {
    if (typeof error === "string") return redactProviderTokens(error, capturedTokens) as T;
    if (!(error instanceof Error)) return error;
    const message = redactProviderTokens(error.message, capturedTokens);
    const stack = typeof error.stack === "string" ? redactProviderTokens(error.stack, capturedTokens) : error.stack;
    if (message === error.message && stack === error.stack) return error;
    const copy = Object.create(Object.getPrototypeOf(error), Object.getOwnPropertyDescriptors(error));
    Object.defineProperty(copy, "message", {value: message, configurable: true, writable: true});
    Object.defineProperty(copy, "stack", {value: stack, configurable: true, writable: true});
    return copy;
}
