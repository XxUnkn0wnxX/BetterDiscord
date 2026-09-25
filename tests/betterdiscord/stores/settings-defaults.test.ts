import {describe, expect, test} from "bun:test";
import path from "node:path";


const cwd = path.join(import.meta.dir, "../../..");
const scenarios = ["missing", "missing-setting", "saved-false", "saved-true", "reset"] as const;

describe("settings defaults", () => {
    test("keeps the Addon Store always-enable default and persisted values", () => {
        for (const scenario of scenarios) {
            const harness = path.join(import.meta.dir, "settings-defaults-harness.ts");
            const result = Bun.spawnSync({
                cmd: [process.execPath, "test", harness],
                cwd,
                env: {...process.env, SETTINGS_DEFAULTS_SCENARIO: scenario},
                stdout: "pipe",
                stderr: "pipe"
            });

            const stdout = new TextDecoder().decode(result.stdout).trim();
            const stderr = new TextDecoder().decode(result.stderr).trim();
            expect(result.exitCode, `${scenario}\n${[stdout, stderr].filter(Boolean).join("\n")}`).toBe(0);
        }
    });
});
