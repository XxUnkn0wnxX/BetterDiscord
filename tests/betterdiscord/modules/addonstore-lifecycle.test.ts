import {describe, expect, test} from "bun:test";
import path from "node:path";

describe("permanent addon store catalogue lifecycle", () => {
    for (const mode of ["online", "offline"]) {
        test(`${mode} startup keeps cache, timers, shared requests and reconnect independent of automatic updates`, () => {
            const result = Bun.spawnSync({
                cmd: [process.execPath, path.join(import.meta.dir, "addonstore-lifecycle-harness.ts")],
                cwd: path.join(import.meta.dir, "../../.."),
                env: {...process.env, BD_STORE_LIFECYCLE_MODE: mode},
                stdout: "pipe",
                stderr: "pipe"
            });
            expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
            expect(new TextDecoder().decode(result.stdout).trim()).toBe(`addon-store-lifecycle: ${mode} ok`);
        });
    }
});
