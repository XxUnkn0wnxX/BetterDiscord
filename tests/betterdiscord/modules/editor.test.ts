import {describe, expect, test} from "bun:test";
import path from "node:path";


describe("Monaco editor selection focus guard", () => {
    test("keeps focus for textarea and restores focus behavior after callback", () => {
        const harness = path.join(import.meta.dir, "editor-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();

        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe("monaco-selection-focus-guard: ok");
    });
});
