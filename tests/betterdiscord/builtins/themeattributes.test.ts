import {describe, expect, test} from "bun:test";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");

describe("ThemeAttributes", () => {
    function runHarness(harness: string) {
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", harness],
            cwd,
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
    }

    test("passes the isolated ThemeAttributes harness", () => {
        runHarness("./tests/betterdiscord/builtins/themeattributes-harness.tsx");
    });

    test("keeps retained owners valid through the isolated patch lifecycle harness", () => {
        runHarness("./tests/betterdiscord/builtins/themeattributes-lifecycle-harness.tsx");
    });
});
