import {expect, test} from "bun:test";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "../../..");

async function runChild(cmd: string[], timeoutMs: number) {
    const child = Bun.spawn({
        cmd,
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe"
    });
    let timedOut = false;
    const watchdog = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
    }, timeoutMs);

    try {
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited
        ]);
        return {stdout, stderr, exitCode, timedOut};
    }
    finally {
        clearTimeout(watchdog);
    }
}

test("loadEntry preserves upstream contracts in an isolated process", async () => {
    const result = await runChild([
        process.execPath,
        "test",
        path.join(import.meta.dir, "loadentry-harness.ts")
    ], 10_000);
    const output = [result.stdout, result.stderr].map(value => value.trim()).filter(Boolean).join("\n");
    expect(result.timedOut, output || "loadEntry harness exceeded its 10 second limit").toBeFalse();
    expect(result.exitCode, output).toBe(0);
}, 15_000);

test("the isolated test watchdog kills and reaps a stalled child", async () => {
    const result = await runChild([
        process.execPath,
        "-e",
        "setTimeout(() => process.exit(0), 1500)"
    ], 100);
    expect(result.timedOut).toBeTrue();
    expect(result.exitCode).not.toBe(0);
}, 15_000);
