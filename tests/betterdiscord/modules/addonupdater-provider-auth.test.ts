import {expect, test} from "bun:test";
import path from "node:path";

test("managed updater separates credential buckets and rejects superseded work", () => {
    for (const scenario of ["lifecycle", "restart"]) {
        const result = Bun.spawnSync({
            cmd: [process.execPath, path.join(import.meta.dir, "addonupdater-provider-auth-harness.ts"), scenario],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
        expect(new TextDecoder().decode(result.stdout).trim()).toBe(`addon-updater-provider-auth-${scenario}: ok`);
    }
});
