import {expect, test} from "bun:test";
import path from "node:path";

test("provider credentials cross real renderer/native construction paths in isolated processes", () => {
    for (const [file, expected] of [
        ["electron/provider-auth-harness.ts", "provider-auth-native: ok"],
        ["betterdiscord/modules/provider-auth-net-harness.ts", "provider-auth-net: ok"]
    ]) {
        const result = Bun.spawnSync({
            cmd: [process.execPath, path.join(import.meta.dir, "..", file)],
            cwd: path.join(import.meta.dir, "../.."),
stdout: "pipe",
stderr: "pipe"
        });
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
        expect(new TextDecoder().decode(result.stdout).trim()).toBe(expected);
    }
});
