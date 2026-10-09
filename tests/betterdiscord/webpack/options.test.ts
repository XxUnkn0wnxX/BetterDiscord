import {expect, test} from "bun:test";
import path from "node:path";

test("Webpack options preserve upstream contracts in an isolated process", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, "test", path.join(import.meta.dir, "options-harness.ts")],
        cwd: path.join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe"
    });
    const output = [result.stdout, result.stderr].map(value => new TextDecoder().decode(value).trim()).filter(Boolean).join("\n");
    expect(result.exitCode, output).toBe(0);
});
