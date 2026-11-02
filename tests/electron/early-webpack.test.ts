import {expect, test} from "bun:test";
import path from "node:path";

test("early and renderer loaders share Discord's runtime queue and preserve exports", () => {
    for (const scenario of ["empty", "webpack", "rspack", "shared", "distinct"]) {
        const result = Bun.spawnSync({cmd: [process.execPath, "test", path.join(import.meta.dir, "early-webpack-harness.ts")], env: {...process.env, BD_QUEUE_SCENARIO: scenario}, stdout: "pipe", stderr: "pipe"});
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(result.exitCode, `${scenario}: ${output}`).toBe(0);
    }
});
