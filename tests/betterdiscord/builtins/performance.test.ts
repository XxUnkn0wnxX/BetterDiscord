import {expect, test} from "bun:test";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");
const harness = path.join(import.meta.dir, "performance-harness.ts");

test("removes only the targeted CSS rule and stops observing after a match", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, "test", "--timeout", "15000", harness],
        cwd,
        stdout: "pipe",
        stderr: "pipe"
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("performance-cssom: ok");
});
