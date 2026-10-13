import {expect, test} from "bun:test";
import path from "node:path";

test("ModalRoot prefers upstream focus scope and preserves older-client degradation", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, "test", path.join(import.meta.dir, "modal-root-harness.tsx")],
        cwd: path.join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe"
    });
    const output = [result.stdout, result.stderr].map(value => new TextDecoder().decode(value).trim()).filter(Boolean).join("\n");
    expect(result.exitCode, output).toBe(0);
});
