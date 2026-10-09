import {expect, test} from "bun:test";
import path from "node:path";

test("Settings menu and AddonCard retain panel receiver, identity and unload closure", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, "test", path.join(import.meta.dir, "addonsettings-callers-harness.tsx")],
        cwd: path.join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe"
    });
    const output = [result.stdout, result.stderr].map(value => new TextDecoder().decode(value).trim()).filter(Boolean).join("\n");
    expect(result.exitCode, output).toBe(0);
});
