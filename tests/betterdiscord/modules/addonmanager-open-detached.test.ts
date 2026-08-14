import {describe, expect, test} from "bun:test";
import path from "node:path";

describe("AddonManager detached editor behavior", () => {
    test("opens detached editor before closing settings and keeps non-detached modes from closing settings", () => {
        const harness = path.join(import.meta.dir, "addonmanager-open-detached-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();

        expect(result.exitCode, stderr).toBe(0);
        expect(stdout.startsWith("addonmanager-open-detached: ok")).toBe(true);
        expect(stdout).toContain("\"primaryOrder\":[\"floating-open\",\"settings-close\"]");
        expect(stdout).toContain("\"duplicateCallsBlocked\":true");
    });
});
