import {describe, expect, test} from "bun:test";
import path from "node:path";


describe("addon updater integration", () => {
    test("keeps every BetterDiscord core-check entry point commented out", async () => {
        const moduleSource = await Bun.file(path.join(import.meta.dir, "../../../src/betterdiscord/modules/updater.ts")).text();
        const panelSource = await Bun.file(path.join(import.meta.dir, "../../../src/betterdiscord/ui/updater.tsx")).text();
        const activeLines = (source: string) => source
            .split("\n")
            .filter(line => !line.trimStart().startsWith("//"))
            .join("\n");

        expect(moduleSource).toContain("// CoreUpdater.checkForUpdate();");
        expect(moduleSource).toContain("// this.checkForUpdate();");
        expect(panelSource).toContain("//     await coreUpdater.checkForUpdate(false);");
        expect(panelSource).toContain("// await checkCoreUpdate();");
        expect(activeLines(moduleSource)).not.toContain("CoreUpdater.checkForUpdate();");
        expect(activeLines(moduleSource)).not.toContain("this.checkForUpdate();");
        expect(activeLines(panelSource)).not.toContain("coreUpdater.checkForUpdate(");
        expect(activeLines(panelSource)).not.toContain("await checkCoreUpdate();");
        expect(activeLines(panelSource)).toContain("await AddonUpdateCoordinator.checkManually();");
    });

    test("protects identity, request cadence, cached bytes and failure reporting", () => {
        const harness = path.join(import.meta.dir, "addonupdater-harness.ts");
        const result = Bun.spawnSync({
            cmd: [process.execPath, harness],
            cwd: path.join(import.meta.dir, "../../.."),
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe("addon-updater-integration: ok");
    });
});
