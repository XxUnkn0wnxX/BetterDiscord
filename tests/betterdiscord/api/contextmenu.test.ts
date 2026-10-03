import {describe, expect, test} from "bun:test";
import path from "node:path";


describe("BdApi ContextMenu compatibility", () => {
    test("passes the isolated ContextMenu contract harness", () => {
        const harness = path.join(import.meta.dir, "contextmenu-harness.tsx");
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", "--timeout", "15000", harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
    });
});
