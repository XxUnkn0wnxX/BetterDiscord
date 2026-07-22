import {describe, expect, test} from "bun:test";
import path from "node:path";


describe("addon updater integration", () => {
    test("protects identity, request cadence, cached bytes and failure reporting", () => {
        const harness = path.join(import.meta.dir, "addonupdater-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe("addon-updater-integration: ok");
    });
});
