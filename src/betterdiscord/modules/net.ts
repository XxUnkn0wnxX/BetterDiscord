import {dryReadableStream, hydrateReadableStream, type DriedAbortSignal, type DriedResponse, type NativeRequestInit, type NativeRequestMethod} from "@common/native-fetch";
import Remote from "../polyfill/remote";
import {captureProviderTokenReporter, getProviderTokenGeneration, providerAddonFromStack, providerHeadersForHop, providerTokenUseForHop, sanitizeProviderAddonLabel, sanitizeProviderError, selectProviderAuthorization, type ProviderAuthorization, type ProviderAuthorizationPurpose, type ProviderTokenOperation} from "@common/provider-auth";

const MAX_DEFAULT_REDIRECTS = 20;

export interface ProviderTokenFailure {
    authorization: ProviderAuthorization;
    generation: number;
    operation: ProviderTokenOperation;
}

let tokenFailureHandler: ((failure: ProviderTokenFailure) => Promise<void>) | undefined;

/** Private renderer lifecycle hook; deliberately absent from BdApi.Net. */
export function setProviderTokenFailureHandler(handler: (failure: ProviderTokenFailure) => Promise<void>): void {
    tokenFailureHandler = handler;
}

const methods = new Set(["GET", "PUT", "POST", "DELETE", "PATCH", "OPTIONS", "HEAD", "CONNECT", "TRACE"]);

function dryAbortSignal(signal: AbortSignal): DriedAbortSignal {
    return {
        aborted: () => signal.aborted,
        reason: () => signal.reason,
        addListener: (onAbort) => {
            if (signal.aborted) {
                try {
                    onAbort();
                }
                finally {
                    // eslint-disable-next-line no-unsafe-finally
                    return () => {};
                }
            }

            const listener = () => onAbort();
            signal.addEventListener("abort", listener, {once: true});
            return () => void signal.removeEventListener("abort", listener);
        }
    };
}

class HydratingResponse extends Response {
    #dried;

    constructor(dried: DriedResponse) {
        super(dried.body ? hydrateReadableStream(dried.body) : null, {
            headers: dried.headers,
            status: dried.status,
            statusText: dried.statusText
        });

        this.#dried = dried;
    }

    override get url() {
        return this.#dried.url;
    }
    override get redirected() {
        return this.#dried.redirected;
    }
}

export async function fetch(input: string | URL | Request, init?: NativeRequestInit) {
    return fetchWithPurpose(input, init, "recognized-self-update");
}

/** Internal managed updater lane; this is deliberately absent from BdApi.Net. */
export async function fetchAddonUpdate(input: string | URL | Request, init?: NativeRequestInit, addon?: string) {
    return fetchWithPurpose(input, init, "managed-addon-update", addon);
}

async function fetchWithPurpose(input: string | URL | Request, init: NativeRequestInit | undefined, purpose: ProviderAuthorizationPurpose, addon?: string) {
    let request: Request;
    if (input instanceof URL) {
        request = new Request(input.href, init);
    }
    else {
        request = new Request(input, init);
    }

    let headers = request.headers;
    if (init?.headers) {
        headers = new Headers(init.headers);
    }

    const requestHeaders = Object.fromEntries(headers);
    const policy = {
        method: request.method,
        headers: requestHeaders,
        rejectUnauthorized: init?.rejectUnauthorized
    };
    const providerAuthorization = selectProviderAuthorization(request.url, policy, purpose);
    const providerGeneration = providerAuthorization ? getProviderTokenGeneration(providerAuthorization.provider) : undefined;
    const callerToken = providerTokenUseForHop(request.url, request.url, policy, purpose)?.token;
    const capturedTokens = providerAuthorization ? [providerAuthorization.token] : callerToken ? [callerToken] : [];
    const report = captureProviderTokenReporter();
    const operation: ProviderTokenOperation = {
        report,
        addon: sanitizeProviderAddonLabel(addon ?? (report && capturedTokens.length ? providerAddonFromStack(new Error().stack, capturedTokens) : undefined), capturedTokens)
    };
    const driedResponse = await Remote.nativeFetch({
        url: request.url,

        body: request.body ? dryReadableStream(request.body) : null,

        headers: requestHeaders,

        keepalive: request.keepalive,
        method: methods.has(request.method) ? request.method as NativeRequestMethod : "GET",
        redirect: request.redirect,
        signal: request.signal ? dryAbortSignal(request.signal) : null,

        timeout: init?.timeout,
        maxRedirects: init?.maxRedirects ?? MAX_DEFAULT_REDIRECTS,
        maxResponseBytes: init?.maxResponseBytes,
        httpsOnly: init?.httpsOnly,
        rejectUnauthorized: init?.rejectUnauthorized ?? true,
        providerAuthorization,
        providerTokenUsage: report ? {purpose, addon: operation.addon, report} : undefined
    }).catch(error => {throw sanitizeProviderError(error, capturedTokens);});

    if (driedResponse.status === 401 && providerAuthorization && providerGeneration !== undefined && tokenFailureHandler) {
        const finalHeaders = providerHeadersForHop(request.url, driedResponse.url, policy, providerAuthorization);
        const usage = providerTokenUseForHop(request.url, driedResponse.url, {...policy, headers: finalHeaders}, purpose, providerAuthorization);
        if (usage?.event.source === "betterdiscord") {
            try {await tokenFailureHandler({authorization: providerAuthorization, generation: providerGeneration, operation});}
            catch {/* Credential maintenance must not replace the original response. */}
        }
    }

    return new HydratingResponse(driedResponse);
}

export type {HydratingResponse};
