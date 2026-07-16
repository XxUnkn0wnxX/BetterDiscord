import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {spawn, spawnSync, type ChildProcess} from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import {getMacOSRecoveryEnvironment, macOSRecoveryHelperSource} from "../../src/electron/main/macosrecovery";


describe("macOS update recovery", () => {
    let root: string;
    let openAsarChild: ChildProcess | null;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "betterdiscord-recovery-"));
        openAsarChild = null;
    });

    afterEach(() => {
        openAsarChild?.kill("SIGTERM");
        fs.rmSync(root, {recursive: true, force: true});
    });

    test("uses only the fixed system path and allowed session values", () => {
        const environment = getMacOSRecoveryEnvironment({
            HOME: "/Users/test",
            USER: "test",
            PATH: "/custom/bin",
            ZDOTDIR: "/custom/zsh",
            ZSH_CUSTOM: "/custom/oh-my-zsh",
            BUN_INSTALL: "/custom/bun",
            NODE_OPTIONS: "--require custom.js",
        });

        expect(environment.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
        expect(environment.SHELL).toBeUndefined();
        expect(environment.HOME).toBe("/Users/test");
        expect(environment.ZDOTDIR).toBeUndefined();
        expect(environment.ZSH_CUSTOM).toBeUndefined();
        expect(environment.BUN_INSTALL).toBeUndefined();
        expect(environment.NODE_OPTIONS).toBeUndefined();
    });

    function runRecovery(openAsar: boolean, disabled = false, activeRunId = "test-run", runId = "test-run", ambiguous = false, missingReadyTemplate = false) {
        if (process.platform !== "darwin") return null;

        const bootstrap = path.join(root, "betterdiscord-bootstrap");
        const resources = path.join(root, "resources");
        const runPath = path.join(bootstrap, "recovery-runs", runId);
        const snapshot = path.join(runPath, "wrapper");
        const helperPath = path.join(bootstrap, "betterdiscord-update-helper.zsh");
        const helperPidPath = path.join(bootstrap, "betterdiscord-update-helper.pid");
        const activeRunPath = path.join(bootstrap, "active-run");
        const statePath = path.join(bootstrap, "update-pending.json");
        const readyTemplatePath = path.join(runPath, "wrapper-ready-template.json");
        const readyPath = path.join(bootstrap, "wrapper-ready.json");
        const disabledPath = path.join(bootstrap, "recovery-disabled");
        const logPath = path.join(bootstrap, "betterdiscord-bootstrap.log");
        const consoleLogPath = path.join(bootstrap, "betterdiscord-bootstrap-console.log");
        const nestedTarget = path.join(resources, "betterdiscord.app.asar");
        const targetAppPath = path.join(root, "Discord.app");
        const openAsarBootstrap = path.join(root, "openasar-bootstrap");
        const openAsarPendingPath = path.join(openAsarBootstrap, "post-shipit-update-pending.json");
        const openAsarHelperPath = path.join(openAsarBootstrap, "post-shipit-helper.zsh");
        const openAsarHelperPidPath = path.join(openAsarBootstrap, "post-shipit-helper.pid");
        const shipItRequestPath = path.join(root, "ShipIt_request.json");
        const installationId = "test-installation";
        const channel = "stable";
        const armedAt = new Date().toISOString();
        const marker = {
            schema: 1,
            owner: "betterdiscord",
            style: "app-wrapper",
            channel,
            mode: "release",
            loader: "index.js",
            payload: "../betterdiscord.app.asar",
            bdPath: "/fixture/betterdiscord.asar",
            installationId,
        };

        fs.mkdirSync(resources, {recursive: true});
        fs.mkdirSync(snapshot, {recursive: true});
        fs.writeFileSync(path.join(resources, "app.asar"), "fresh Discord payload");
        if (ambiguous) fs.mkdirSync(path.join(resources, "app"));
        fs.writeFileSync(path.join(snapshot, "index.js"), "// __betterdiscord_inject_meta__\n");
        fs.writeFileSync(path.join(snapshot, "package.json"), `${JSON.stringify({name: "discord", main: "./index.js"})}\n`);
        fs.writeFileSync(path.join(snapshot, ".betterdiscord-inject.json"), `${JSON.stringify(marker)}\n`);
        fs.writeFileSync(statePath, `${JSON.stringify({pending: true})}\n`);
        if (!missingReadyTemplate) {
            fs.writeFileSync(readyTemplatePath, `${JSON.stringify({
                schema: 1,
                owner: "betterdiscord",
                style: "app-wrapper",
                channel,
                installationId,
                appPath: targetAppPath,
                targetAppPath,
                nestedTarget,
                armedAt,
                readyAt: "",
            }, null, 4)}\n`);
        }
        fs.writeFileSync(helperPath, macOSRecoveryHelperSource());
        fs.chmodSync(helperPath, 0o700);
        fs.writeFileSync(activeRunPath, `${activeRunId}\n`);
        fs.writeFileSync(logPath, "old human log\n");
        fs.writeFileSync(consoleLogPath, "old console log\n");
        fs.writeFileSync(shipItRequestPath, `${JSON.stringify({launchAfterInstallation: true})}\n`);
        if (disabled) fs.writeFileSync(disabledPath, "disabled\n");

        if (openAsar) {
            fs.mkdirSync(openAsarBootstrap, {recursive: true});
            fs.writeFileSync(openAsarHelperPath, "#!/usr/bin/env -S zsh -f\n/bin/sleep 10\n");
            fs.chmodSync(openAsarHelperPath, 0o700);
            openAsarChild = spawn("/usr/bin/env", ["zsh", "-f", openAsarHelperPath, openAsarHelperPidPath], {
                stdio: "ignore",
                env: getMacOSRecoveryEnvironment(),
            });
            if (!openAsarChild.pid) throw new Error("OpenAsar test helper did not start");
            fs.writeFileSync(openAsarHelperPidPath, `${openAsarChild.pid}\n`);
            fs.writeFileSync(openAsarPendingPath, `${JSON.stringify({
                pending: true,
                betterDiscordExpected: true,
                schema: 1,
                owner: "betterdiscord",
                style: "app-wrapper",
                channel,
                installationId,
                appPath: targetAppPath,
                nestedTarget,
                armedAt,
                helperPid: openAsarChild.pid,
                helperPath: openAsarHelperPath,
                helperPidPath: openAsarHelperPidPath,
            }, null, 4)}\n`);
        }

        const result = spawnSync("/usr/bin/env", [
            "zsh",
            "-f",
            helperPath,
            statePath,
            resources,
            nestedTarget,
            targetAppPath,
            snapshot,
            readyTemplatePath,
            readyPath,
            disabledPath,
            logPath,
            openAsarPendingPath,
            openAsarHelperPath,
            openAsarHelperPidPath,
            installationId,
            channel,
            armedAt,
            shipItRequestPath,
            helperPidPath,
            activeRunPath,
            runId,
            "none",
        ], {
            env: getMacOSRecoveryEnvironment(),
            encoding: "utf8",
            timeout: 10000,
        });
        return {result, resources, readyPath, logPath, consoleLogPath, shipItRequestPath, helperPidPath, activeRunPath};
    }

    test("recovers without OpenAsar and replaces both logs", () => {
        const run = runRecovery(false);
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.readFileSync(path.join(run.resources, "betterdiscord.app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "app", ".betterdiscord-inject.json"))).toBe(true);
        expect(JSON.parse(fs.readFileSync(run.readyPath, "utf8")).readyAt).toMatch(/Z$/);
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("BetterDiscord owns relaunch");
        expect(fs.readFileSync(run.logPath, "utf8")).not.toContain("old human log");
        expect(fs.readFileSync(run.consoleLogPath, "utf8")).not.toContain("old console log");
        expect(JSON.parse(fs.readFileSync(run.shipItRequestPath, "utf8")).launchAfterInstallation).toBe(false);
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
        expect(fs.existsSync(run.activeRunPath)).toBe(false);
    });

    test("hands nested restore and relaunch to a matching live OpenAsar helper", () => {
        const run = runRecovery(true);
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("OpenAsar owns nested restore and relaunch");
        expect(fs.readFileSync(run.logPath, "utf8")).not.toContain("BetterDiscord owns relaunch");
    });

    test("honors deliberate recovery disable before changing Discord", () => {
        const run = runRecovery(false, true);
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.existsSync(path.join(run.resources, "app.asar"))).toBe(true);
        expect(fs.existsSync(path.join(run.resources, "betterdiscord.app.asar"))).toBe(false);
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("Recovery disabled by deliberate uninject");
        expect(fs.readFileSync(run.logPath, "utf8")).not.toContain("old human log");
    });

    test("a superseded helper exits without truncating logs or touching Discord", () => {
        const run = runRecovery(false, false, "newer-run", "older-run");
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.readFileSync(path.join(run.resources, "app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "betterdiscord.app.asar"))).toBe(false);
        expect(fs.readFileSync(run.logPath, "utf8")).toBe("old human log\n");
        expect(fs.readFileSync(run.consoleLogPath, "utf8")).toBe("old console log\n");
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
    });

    test("a recovery failure keeps the stock payload and owns relaunch after disabling ShipIt", () => {
        const run = runRecovery(false, false, "test-run", "test-run", true);
        if (!run) return;

        expect(run.result.status).toBe(1);
        expect(fs.readFileSync(path.join(run.resources, "app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "betterdiscord.app.asar"))).toBe(false);
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("fresh resources layout is ambiguous");
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("BetterDiscord owns relaunch");
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
    });

    test("rolls back the wrapper before relaunch when ready publication fails", () => {
        const run = runRecovery(false, false, "test-run", "test-run", false, true);
        if (!run) return;

        expect(run.result.status).toBe(1);
        expect(fs.readFileSync(path.join(run.resources, "app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "app"))).toBe(false);
        expect(fs.existsSync(path.join(run.resources, "betterdiscord.app.asar"))).toBe(false);
        const log = fs.readFileSync(run.logPath, "utf8");
        expect(log).toContain("wrapper-ready marker creation failed");
        expect(log.indexOf("Rolled back the incomplete BetterDiscord wrapper")).toBeLessThan(log.indexOf("BetterDiscord owns relaunch"));
    });

});
