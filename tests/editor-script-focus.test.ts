import {describe, expect, test} from "bun:test";
import path from "node:path";

const harness = path.join(import.meta.dir, "editor-script-focus-harness.ts");
const cwd = path.join(import.meta.dir, "..");

describe("editor external script", () => {
    for (const editorType of ["theme", "custom-css", "plugin"]) {
        test(`focuses Monaco editor once for ${editorType} on initial layout`, () => {
            const result = Bun.spawnSync({
                cmd: [process.execPath, harness],
                cwd,
                stdout: "pipe",
                stderr: "pipe",
                env: {
                    ...process.env,
                    EDITOR_SCRIPT_TYPE: editorType
                }
            });

            const stdout = new TextDecoder().decode(result.stdout).trim();
            const stderr = new TextDecoder().decode(result.stderr).trim();
            expect(result.exitCode, stderr).toBe(0);
            expect(stdout).toBe(`editor-script-autofocus: ok ${editorType} 1`);
        });
    }
});
