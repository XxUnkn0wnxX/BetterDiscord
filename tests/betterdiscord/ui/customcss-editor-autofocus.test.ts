import {describe, expect, test} from "bun:test";
import path from "node:path";


const cwd = path.join(import.meta.dir, "../../..");

describe("in-client editor auto focus", () => {
    for (const harnessName of ["customcss-editor-autofocus-harness.tsx", "customcss-editor-autofocus-props-harness.tsx"]) {
        test(`passes isolated ${harnessName}`, () => {
            const harness = path.join(import.meta.dir, harnessName);
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
    }
});
