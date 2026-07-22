import {describe, expect, test} from "bun:test";
import path from "node:path";
import {hydrateReadableStream, type DryReadableStream} from "@common/native-fetch";


describe("native fetch response guards", () => {
    test("propagates hydrated stream cancellation to the native reader", async () => {
        let finishRead: ((result: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>) => void) | undefined;
        let readCount = 0;
        let cancelCount = 0;
        const dried: DryReadableStream = {
            read: async () => {
                if (readCount++ === 0) return {done: false, value: new Uint8Array([1])};
                return new Promise(resolve => {finishRead = resolve;});
            },
            cancel: async () => {
                cancelCount++;
                finishRead?.({done: true, value: undefined});
            }
        };

        const reader = hydrateReadableStream(dried).getReader();
        expect((await reader.read()).value).toEqual(new Uint8Array([1]));
        await reader.cancel();
        expect(cancelCount).toBe(1);
    });

    test("enforces byte and HTTPS limits in an unmodified Bun process", () => {
        // The normal suite preloads Happy DOM, which replaces Response and cannot back Bun.serve.
        // Run this small transport harness in a child Bun process so it exercises native streams.
        const harness = path.join(import.meta.dir, "nativefetch-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, harness],
            cwd: path.join(import.meta.dir, "../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe("native-fetch-guards: ok");
    });
});
