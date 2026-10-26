import {expect, test} from "bun:test";
import path from "node:path";

test("rejected BD credentials revalidate, clear safely and notify through real renderer stores", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, path.join(import.meta.dir, "provider-token-lifecycle-harness.ts")],
        cwd: path.join(import.meta.dir, "../../.."),
stdout: "pipe",
stderr: "pipe"
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("provider-token-lifecycle: ok");
});
