import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";

test("renderer recovery initializes once and executes without DevTools or its legacy setting", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, "test", "--timeout", "15000", path.join(import.meta.dir, "recovery-harness.tsx")],
        cwd: path.join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe"
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    const cases = readFileSync(path.join(import.meta.dir, "recovery-harness.tsx"), "utf8").match(/^test\(/gm)?.length;
    expect(cases).toBeGreaterThan(0);
    expect(output).toContain(`${cases} pass`);
});

test("recovery labels live outside the retired switch in every locale", () => {
    const directory = path.join(import.meta.dir, "../../../assets/locales");
    for (const filename of readdirSync(directory).filter(file => file.endsWith(".json"))) {
        const current = JSON.parse(readFileSync(path.join(directory, filename), "utf8"));
        expect(current.Collections?.settings?.developer?.recovery, filename).toBeUndefined();
        if (filename === "en-us.json") {
            expect(current.Recovery).toEqual({
                button: "Attempt Recovery",
                suspect: "Suspected Addon",
                report: "Report on GitHub",
                reportForgejo: "Report on git.slowb.ro",
                reportGitlab: "Report on GitLab",
                manualReport: "Manual report",
                manualReportCopied: "Report copied to clipboard.",
                manualReportCopyFailed: "Could not copy report.",
                safeMode: "Relaunch in Safe Mode",
                joinSupport: "Join Support Server!"
            });
        }
    }
});
