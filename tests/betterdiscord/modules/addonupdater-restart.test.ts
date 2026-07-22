import {describe, expect, test} from "bun:test";
import path from "node:path";


describe("addon updater restart hydration", () => {
    test("restores installed updates and prunes missing inventory without a network check", () => {
        const harness = path.join(import.meta.dir, "addonupdater-restart-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe("addon-updater-restart-hydration: ok");
    });
});
