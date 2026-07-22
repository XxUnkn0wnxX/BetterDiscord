import {hydrateReadableStream, type DriedRequest} from "@common/native-fetch";
import {nativeFetch} from "../../src/electron/preload/api/fetch";
import http from "http";


const streamTimers = new Set<ReturnType<typeof setInterval>>();
const originalDestroy = http.IncomingMessage.prototype.destroy;
let responseDestroyCalls = 0;
http.IncomingMessage.prototype.destroy = function(...args: Parameters<typeof originalDestroy>) {
    responseDestroyCalls++;
    return originalDestroy.apply(this, args);
};

const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/declared-large") {
            return new Response("x".repeat(64), {headers: {"Content-Length": "64"}});
        }
        if (pathname === "/streamed-large") {
            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode("x".repeat(12)));
                    controller.enqueue(new TextEncoder().encode("y".repeat(12)));
                    controller.close();
                }
            }));
        }
        if (pathname === "/cancel-stream") {
            let timer: ReturnType<typeof setInterval> | undefined;
            let chunk = 0;
            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode("first"));
                    timer = setInterval(() => controller.enqueue(new TextEncoder().encode(`chunk-${++chunk}`)), 5);
                    streamTimers.add(timer);
                },
                cancel() {
                    if (timer) {
                        clearInterval(timer);
                        streamTimers.delete(timer);
                    }
                }
            }));
        }
        return new Response("safe");
    }
});

const origin = `http://${server.hostname}:${server.port}`;

function driedRequest(url: string, maxResponseBytes?: number, httpsOnly = false): DriedRequest {
    return {
        url,
        body: null,
        headers: {},
        keepalive: false,
        method: "GET",
        redirect: "follow",
        signal: null,
        timeout: 2_000,
        maxRedirects: 2,
        maxResponseBytes,
        httpsOnly,
        rejectUnauthorized: true
    };
}

async function readBody(request: DriedRequest) {
    const result = await nativeFetch(request);
    if (!result.body) return "";
    return new Response(hydrateReadableStream(result.body)).text();
}

async function expectRejected(promise: Promise<unknown>, expected: string) {
    try {
        await promise;
    }
    catch (error) {
        if (error instanceof Error && error.message.includes(expected)) return;
        throw error;
    }
    throw new Error(`Expected rejection containing '${expected}'.`);
}

try {
    if (await readBody(driedRequest(`${origin}/safe`)) !== "safe") throw new Error("An unguarded response changed.");
    await expectRejected(readBody(driedRequest(`${origin}/declared-large`, 16)), "16-byte limit");
    await expectRejected(readBody(driedRequest(`${origin}/streamed-large`, 16)), "16-byte limit");
    await expectRejected(nativeFetch(driedRequest(`${origin}/safe`, undefined, true)), "HTTPS-only");

    responseDestroyCalls = 0;
    const cancellable = await nativeFetch(driedRequest(`${origin}/cancel-stream`));
    if (!cancellable.body) throw new Error("The cancellable response did not include a body.");
    const firstChunk = await cancellable.body.read();
    if (firstChunk.done || !firstChunk.value.byteLength) throw new Error("The cancellable response did not start streaming.");
    await cancellable.body.cancel();
    await Bun.sleep(25);

    const hydratedResult = await nativeFetch(driedRequest(`${origin}/cancel-stream`));
    if (!hydratedResult.body) throw new Error("The hydrated cancellable response did not include a body.");
    const hydratedReader = hydrateReadableStream(hydratedResult.body).getReader();
    const hydratedChunk = await hydratedReader.read();
    if (hydratedChunk.done || !hydratedChunk.value.byteLength) throw new Error("The hydrated response did not start streaming.");
    await hydratedReader.cancel();
    await Bun.sleep(25);
    if (responseDestroyCalls < 2) throw new Error("Renderer stream cancellation did not destroy both native responses.");

    process.stdout.write("native-fetch-guards: ok\n");
}
finally {
    for (const timer of streamTimers) clearInterval(timer);
    http.IncomingMessage.prototype.destroy = originalDestroy;
    server.stop(true);
}
