import https from "https";
import http from "http";
import {hydrateReadableStream, dryReadableStream, type DriedRequest, type DriedResponse} from "@common/native-fetch";
import {isWebhookUrl} from "./webhook";

const DEFAULT_TIMEOUT = 8_000;

const redirectCodes = new Set([301, 302, 307, 308]);
const bodylessStatusCodes = new Set([101, 204, 205, 304]);

export function nativeFetch({url, signal: dryAbortSignal, body: dryBody, ...init}: DriedRequest) {
    const {promise, resolve, reject} = Promise.withResolvers<DriedResponse>();

    const maxRedirects = init.maxRedirects ?? 20;

    const body = dryBody ? hydrateReadableStream(dryBody) : null;

    let redirectCount = 0;

    function out(uri: string, res: http.IncomingMessage): DriedResponse {
        const status = res.statusCode ?? 0;

        let stream: ReadableStream | null = null;

        if (!bodylessStatusCodes.has(status)) {
            let settled = false;
            stream = new ReadableStream({
                start(controller) {
                    let receivedBytes = 0;

                    const fail = (error: Error) => {
                        if (settled) return;
                        settled = true;
                        controller.error(error);
                        res.destroy(error);
                    };

                    // Register before the Content-Length fast-fail so destroying the response
                    // cannot emit an unhandled error on older Bun/Node compatibility layers.
                    res.on("error", (error) => {
                        if (settled) return;
                        settled = true;
                        controller.error(error);
                    });

                    const contentLength = Number(res.headers["content-length"]);
                    if (init.maxResponseBytes && Number.isFinite(contentLength) && contentLength > init.maxResponseBytes) {
                        const error = new Error(`Response exceeded the ${init.maxResponseBytes}-byte limit.`);
                        error.name = "ResponseSizeError";
                        fail(error);
                        return;
                    }

                    res.on("data", (data: Buffer | string) => {
                        if (settled) return;
                        const chunk = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
                        receivedBytes += chunk.byteLength;
                        if (init.maxResponseBytes && receivedBytes > init.maxResponseBytes) {
                            const error = new Error(`Response exceeded the ${init.maxResponseBytes}-byte limit.`);
                            error.name = "ResponseSizeError";
                            fail(error);
                            return;
                        }
                        controller.enqueue(chunk);
                    });
                    res.once("end", () => {
                        if (settled) return;
                        settled = true;
                        controller.close();
                    });
                },
                cancel() {
                    if (settled) return;
                    settled = true;

                    // Cancelling the renderer-side body must stop the native response too. The
                    // data handler checks `settled`, so a final buffered chunk cannot enqueue into
                    // a ReadableStream that has already been closed by cancellation.
                    res.destroy();
                },
                type: "bytes"
            });
        }

        return {
            body: stream ? dryReadableStream(stream) : null,
            url: uri,
            headers: res.headers as Record<string, string>,
            status: status,
            statusText: res.statusMessage || "",
            redirected: redirectCount !== 0
        };
    }

    // If null or infinite no timeout | undefined or finite then timeout
    const timeout = ((t) => init.timeout === null || !isFinite(t) ? undefined : t)(init.timeout ?? DEFAULT_TIMEOUT);

    async function execute(uri: string) {
        let parsedUri: URL;
        try {
            parsedUri = new URL(uri);
        }
        catch (error) {
            reject(error);
            return;
        }

        // Fork review: addon update URLs may redirect through third-party hosts. Their opt-in
        // transport mode must never downgrade to plaintext or accept embedded credentials.
        if (init.httpsOnly && (parsedUri.protocol !== "https:" || parsedUri.username || parsedUri.password)) {
            const error = new Error("HTTPS-only request rejected an unsafe URL or redirect.");
            error.name = "UnsafeRedirectError";
            reject(error);
            return;
        }

        // Mirror the renderer's former webhook block for BdApi.Net.fetch, which runs here over
        // Node's https and does not inherit the origin/referrer of Discord.com which Discord
        // uses to block requests to webhooks by default. Checked per hop so a redirect into a
        // webhook URL is caught too.
        if (isWebhookUrl(uri)) {
            reject(new Error("Failed to fetch"));
            return;
        }

        const httpModule = parsedUri.protocol === "http:" ? http : parsedUri.protocol === "https:" ? https : null;
        if (!httpModule) {
            reject(new Error(`Unsupported protocol: ${uri.slice(0, uri.indexOf(":"))}:`));
            return;
        }

        const request = httpModule.request(uri, {
            headers: init.headers,
            method: init.method,
            timeout,
            rejectUnauthorized: init.rejectUnauthorized
        }, (res) => {
            if (redirectCodes.has(res.statusCode!)) {
                if (init.redirect === "error") {
                    res.destroy();
                    request.destroy(new Error("Failed to fetch"));
                    return;
                }
                if (init.redirect === "manual") {
                    resolve(out(uri, res));
                    return;
                }
                if (redirectCount >= maxRedirects) {
                    res.destroy();
                    reject(new Error(`Maximum amount of redirects reached (${maxRedirects})`));
                    return;
                }

                if (res.headers.location) {
                    let final;
                    try {
                        // Fork review: upstream 44e21745 omits the base URL, so ordinary
                        // relative Location values throw instead of following the redirect.
                        final = new URL(res.headers.location, uri);
                    }
                    catch (error) {
                        res.destroy();
                        reject(error);
                        return;
                    }

                    const current = new URL(uri);
                    // Upstream preserves the current query across redirects. In the updater's
                    // HTTPS-only mode, never copy a token-bearing query onto another origin.
                    if (!init.httpsOnly || current.origin === final.origin) {
                        for (const [key, value] of current.searchParams) {
                            final.searchParams.set(key, value);
                        }
                    }

                    redirectCount++;
                    // A redirect body is irrelevant and may itself be unbounded. Close this hop
                    // after reading Location instead of draining bytes outside maxResponseBytes.
                    res.destroy();

                    return execute(final.href);
                }
            }

            resolve(out(uri, res));
        });

        request.shouldKeepAlive = init.keepalive;

        if (dryAbortSignal) {
            const undo = dryAbortSignal.addListener(() => {
                request.destroy(dryAbortSignal.reason() || new Error("Request was aborted"));
            });

            request.once("close", () => undo());
        }

        request.once("timeout", () => request.destroy(new Error("Request timed out")));

        request.once("error", (err) => reject(err));

        if (body) {
            try {
                for await (const value of body) {
                    request.write(value);
                }

                request.end();
            }
            catch (error) {
                request.destroy(error as Error);
            }
        }
        else {request.end();}
    }

    execute(url);

    return promise;
}
