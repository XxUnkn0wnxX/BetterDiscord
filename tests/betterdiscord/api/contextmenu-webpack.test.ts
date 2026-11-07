import {expect, test} from "bun:test";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");

for (const scenario of ["legacy", "rspack", "missing"]) {
    test(`ContextMenu fallback discovery handles ${scenario} webpack modules`, () => {
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", "--timeout", "15000", path.join(import.meta.dir, "contextmenu-webpack-harness.ts")],
            cwd,
            env: {...process.env, CONTEXTMENU_WEBPACK_SCENARIO: scenario},
            stdout: "pipe",
            stderr: "pipe"
        });
        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, `${scenario}\n${[stdout, stderr].filter(Boolean).join("\n")}`).toBe(0);
    });
}
