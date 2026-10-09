import {expect, test} from "bun:test";
import path from "node:path";

test("passes the isolated Addon Store navigation harness", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, "test", "--timeout", "15000", path.join(import.meta.dir, "addon-store-navigation-harness.tsx")],
        cwd: path.join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe"
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("6 pass");
});
