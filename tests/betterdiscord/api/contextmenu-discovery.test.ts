import {describe, expect, test} from "bun:test";
import path from "node:path";


describe("BdApi ContextMenu discovery", () => {
    test("passes the isolated real-NodePatcher dispatcher harness", () => {
        const harness = path.join(import.meta.dir, "contextmenu-discovery-harness.tsx");
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", "--timeout", "15000", harness],
            cwd: path.join(import.meta.dir, "../../.."),
            // Discord's production React elements allow NodePatcher to replace their type.
            env: {...process.env, NODE_ENV: "production"},
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
    });
});
