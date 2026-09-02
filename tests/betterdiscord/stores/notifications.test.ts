import {describe, expect, test} from "bun:test";
import path from "node:path";


const cwd = path.join(import.meta.dir, "../../..");

describe("notification store", () => {
    test("passes the isolated notification store harness", () => {
        const harness = path.join(import.meta.dir, "notifications-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", harness],
            cwd,
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
    });
});
