import {describe, expect, test} from "bun:test";
import path from "node:path";

describe("BdApi UI settings builder", () => {
    test("maps builder values and preserves dependency/callback behavior", () => {
        const harness = path.join(import.meta.dir, "ui-settings-builder-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe("ui-settings-builder: ok");
    });
});
