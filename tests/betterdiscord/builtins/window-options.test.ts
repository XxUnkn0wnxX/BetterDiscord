import {expect, test} from "bun:test";
import path from "node:path";


const cwd = path.join(import.meta.dir, "../../..");
const harness = path.join(import.meta.dir, "window-options-harness.ts");

function run(mode: string, platform: string, startupEnabled = false) {
    const result = Bun.spawnSync({
        cmd: [process.execPath, "test", "--timeout", "15000", harness],
        cwd,
        env: {
            ...process.env,
            WINDOW_TEST_MODE: mode,
            WINDOW_PLATFORM: platform,
            WINDOW_START_MINIMUM_SIZE: String(startupEnabled)
        },
        stdout: "pipe",
        stderr: "pipe"
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain(`window-options: ${mode} ${platform} ok`);
}

test("window settings defaults expose upstream options and platform visibility", () => {
    for (const platform of ["darwin", "win32", "linux"]) run("defaults", platform);
});

test("window builtins follow live settings, retain one listener set, and handle rejected effects", () => {
    run("live", "darwin");
});

test("minimum-size builtin applies enabled and disabled states at startup", () => {
    run("startup", "darwin", false);
    run("startup", "darwin", true);
});
