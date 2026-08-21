import {describe, expect, test} from "bun:test";
import path from "node:path";


describe("InstallModal close ownership", () => {
    test("passes the isolated InstallModal close harness", () => {
        const harness = path.join(import.meta.dir, "installmodal-close-harness.tsx");
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
    });
});
