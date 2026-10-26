import {expect, test} from "bun:test";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");
test("DebugLogs captures safe dispatched token use and guards its reporter lifecycle", () => {
    const result = Bun.spawnSync({cmd: [process.execPath, "test", path.join(import.meta.dir, "debuglogs-provider-redaction-harness.ts")], cwd, stdout: "pipe", stderr: "pipe"});
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();
    expect(result.exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
});
