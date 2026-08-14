import {describe, expect, test} from "bun:test";
import path from "node:path";

const runCustomCSSLifecycleHarness = (initialEnabled: boolean): string => {
    const harness = path.join(import.meta.dir, "customcss-harness.ts");
    const result = Bun.spawnSync({
        cmd: [process.execPath, harness],
        cwd: path.join(import.meta.dir, "../../.."),
        env: {...process.env, CUSTOMCSS_INITIAL_ENABLED: initialEnabled ? "1" : "0"},
        stdout: "pipe",
        stderr: "pipe"
    });

    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();
    expect(result.exitCode, stderr).toBe(0);
    expect(stdout.startsWith("customcss-lifecycle: ok")).toBe(true);
    expect(stdout).toContain("\"panelCalls\":{\"register\":");
    return stdout;
};

describe("Custom CSS lifecycle", () => {
    test("uses built-in initialize wiring and preserves lifecycle semantics when initially disabled", () => {
        const output = runCustomCSSLifecycleHarness(false);
        expect(output).toContain("\"initial\":\"disabled\"");
    });

    test("uses built-in initialize wiring and preserves lifecycle semantics when initially enabled", () => {
        const output = runCustomCSSLifecycleHarness(true);
        expect(output).toContain("\"initial\":\"enabled\"");
    });
});
