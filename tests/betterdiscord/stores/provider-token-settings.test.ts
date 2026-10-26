import {expect, test} from "bun:test";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");
test("settings load, synchronize, persist, clear, and reset provider tokens", () => {
    for (const scenario of ["defaults", "saved"]) {
        const result = Bun.spawnSync({cmd: [process.execPath, "test", path.join(import.meta.dir, "provider-token-settings-harness.ts")], cwd, env: {...process.env, PROVIDER_TOKEN_SETTINGS_SCENARIO: scenario}, stdout: "pipe", stderr: "pipe"});
        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, `${scenario}\n${[stdout, stderr].filter(Boolean).join("\n")}`).toBe(0);
    }
});
