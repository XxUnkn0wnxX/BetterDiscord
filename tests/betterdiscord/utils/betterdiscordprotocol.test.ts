import {describe, expect, test} from "bun:test";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");

describe("BetterDiscord protocol ownership", () => {
    test("retains shared owners and preserves pre-existing entries", () => {
        const harness = path.join(import.meta.dir, "betterdiscordprotocol-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", harness, "present"],
            cwd,
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toContain("betterdiscord-protocol: ok");
    });

    test("does nothing when Discord's protocol list is unavailable", () => {
        const harness = path.join(import.meta.dir, "betterdiscordprotocol-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", harness],
            cwd,
            env: {...process.env, BD_PROTOCOL_TEST_MODE: "missing"},
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toContain("betterdiscord-protocol: missing ok");
    });
});
