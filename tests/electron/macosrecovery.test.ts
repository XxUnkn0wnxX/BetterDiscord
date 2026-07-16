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

    test("retries LaunchServices and preserves a direct executable fallback", () => {
        const helper = macOSRecoveryHelperSource();

        expect(helper).toContain("wait_for_app_bundle_ready");
        expect(helper).toContain("lsregister\" -f \"$target_app_path");
        expect(helper).toContain("for attempt in 1 2 3");
        expect(helper).toContain("open_output=\"$(/usr/bin/open \"$target_app_path\" 2>&1)\"");
        expect(helper).toContain("betterdiscord_owns_relaunch || return 0");
        expect(helper).toContain("Falling back to direct Discord executable launch");
        expect(helper).toContain("Wrapper recovery committed, but Discord relaunch did not start");
    });

    function runRecovery(openAsar: boolean, disabled = false, activeRunId = "test-run", runId = "test-run", ambiguous = false, missingReadyTemplate = false, relaunchMode: "missing" | "retry" | "fallback" | "timeout" | "term-before-publish" | "term-after-publish" = "missing", restartRequested = false, openAsarGeneration: "match" | "late-match" | "handoff-mismatch" | "source-mismatch" = "match") {
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
        const resultPath = path.join(bootstrap, "wrapper-result.json");
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
        const sourceProcessPid = 24680;
        const openAsarHandoffId = openAsar ? "test-handoff" : "";
        const openAsarSourceProcessPid = openAsar ? sourceProcessPid : 0;
        const capturedOpenAsarHandoffId = openAsarGeneration === "late-match" ? "" : openAsarHandoffId;
        const capturedOpenAsarSourceProcessPid = openAsarGeneration === "late-match" ? 0 : openAsarSourceProcessPid;
        const openAttemptsPath = path.join(root, "open-attempts");
        const registrationAttemptsPath = path.join(root, "registration-attempts");
        const directLaunchPath = path.join(root, "direct-launch");
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
        fs.writeFileSync(path.join(snapshot, "index.js"), "// __betterdiscord_inject_meta__\n");
        fs.writeFileSync(path.join(snapshot, "package.json"), `${JSON.stringify({name: "discord", main: "./index.js"})}\n`);
        fs.writeFileSync(path.join(snapshot, ".betterdiscord-inject.json"), `${JSON.stringify(marker)}\n`);
        if (relaunchMode === "timeout") {
            const appDirectory = path.join(resources, "app");
            fs.mkdirSync(appDirectory);
            for (const wrapperFile of ["index.js", "package.json", ".betterdiscord-inject.json"]) {
                fs.copyFileSync(path.join(snapshot, wrapperFile), path.join(appDirectory, wrapperFile));
            }
            fs.writeFileSync(nestedTarget, "existing Discord payload");
        }
        else {
            fs.writeFileSync(path.join(resources, "app.asar"), "fresh Discord payload");
            if (ambiguous) fs.mkdirSync(path.join(resources, "app"));
        }
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
                recoveryRunId: runId,
                sourceProcessPid,
                openAsarHandoffId: capturedOpenAsarHandoffId,
                openAsarSourceProcessPid: capturedOpenAsarSourceProcessPid,
                restartRequested,
                readyAt: "",
            }, null, 4)}\n`);
        }
        let helperSource = macOSRecoveryHelperSource();
        if (relaunchMode === "timeout") {
            helperSource = helperSource.replace(`deadline="$((SECONDS + 90))"`, `deadline="$((SECONDS + 1))"`);
        }
        if (relaunchMode === "term-before-publish") {
            helperSource = helperSource.replace(
                `if ! /bin/mv "$app_asar" "$nested_target"; then\n    fail_recovery "could not move fresh app.asar"\nfi`,
                () => `if ! /bin/mv "$app_asar" "$nested_target"; then\n    fail_recovery "could not move fresh app.asar"\nfi\n/bin/kill -TERM "$$"\n/bin/sleep 1`,
            );
        }
        if (relaunchMode === "term-after-publish") {
            helperSource = helperSource.replace(
                `log "Wrapper ready for installation $installation_id"`,
                () => `log "Wrapper ready for installation $installation_id"\n/bin/kill -TERM "$$"\n/bin/sleep 1`,
            );
        }
        if (relaunchMode === "retry" || relaunchMode === "fallback") {
            const contents = path.join(targetAppPath, "Contents");
            const executableDirectory = path.join(contents, "MacOS");
            const executablePath = path.join(executableDirectory, "Discord");
            const openStubPath = path.join(root, "open-stub.zsh");
            const registrationStubPath = path.join(root, "lsregister-stub.zsh");
            const forceFailurePath = path.join(root, "force-open-failure");
            fs.mkdirSync(executableDirectory, {recursive: true});
            fs.writeFileSync(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Discord</string></dict></plist>
`);
            fs.writeFileSync(executablePath, `#!/usr/bin/env zsh
root="\${0:A:h:h:h:h}"
print -r -- launched > "$root/direct-launch"
`);
            fs.writeFileSync(openStubPath, `#!/usr/bin/env zsh
root="\${1:h}"
count="$(/bin/cat "$root/open-attempts" 2>/dev/null || print 0)"
count="$((count + 1))"
print -r -- "$count" > "$root/open-attempts"
if [[ -e "$root/force-open-failure" || "$count" -lt 3 ]]; then
    print -u2 -- "kLSNoExecutableErr registration error -10814"
    exit 1
fi
`);
            fs.writeFileSync(registrationStubPath, `#!/usr/bin/env zsh
root="\${2:h}"
count="$(/bin/cat "$root/registration-attempts" 2>/dev/null || print 0)"
print -r -- "$((count + 1))" > "$root/registration-attempts"
`);
            for (const executable of [executablePath, openStubPath, registrationStubPath]) fs.chmodSync(executable, 0o700);
            if (relaunchMode === "fallback") fs.writeFileSync(forceFailurePath, "fail\n");

            helperSource = helperSource
                .replace(`/usr/bin/open "$target_app_path"`, `${JSON.stringify(openStubPath)} "$target_app_path"`)
                .replace(
                    `local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"`,
                    `local lsregister=${JSON.stringify(registrationStubPath)}`,
                );
        }
        fs.writeFileSync(helperPath, helperSource);
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
                handoffId: openAsarGeneration === "handoff-mismatch" ? "newer-handoff" : openAsarHandoffId,
                sourceProcessPid: openAsarGeneration === "source-mismatch" ? sourceProcessPid + 1 : sourceProcessPid,
                betterDiscordRecoveryRunId: openAsarGeneration === "late-match" ? runId : undefined,
                restartRequested,
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
            String(sourceProcessPid),
            capturedOpenAsarHandoffId || "none",
            String(capturedOpenAsarSourceProcessPid),
            restartRequested ? "1" : "0",
        ], {
            env: getMacOSRecoveryEnvironment(),
            encoding: "utf8",
            timeout: 10000,
        });
        return {result, resources, runPath, statePath, readyPath, resultPath, logPath, consoleLogPath, shipItRequestPath, helperPidPath, activeRunPath, openAttemptsPath, registrationAttemptsPath, directLaunchPath};
    }

    test("recovers without OpenAsar and replaces both logs", () => {
        const run = runRecovery(false);
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.readFileSync(path.join(run.resources, "betterdiscord.app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "app", ".betterdiscord-inject.json"))).toBe(true);
        expect(JSON.parse(fs.readFileSync(run.readyPath, "utf8"))).toMatchObject({
            recoveryRunId: "test-run",
            sourceProcessPid: 24680,
            openAsarHandoffId: "",
            openAsarSourceProcessPid: 0,
            restartRequested: false,
            readyAt: expect.stringMatching(/Z$/),
        });
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("restart was not requested; leaving Discord closed");
        expect(fs.readFileSync(run.logPath, "utf8")).not.toContain("BetterDiscord owns relaunch");
        expect(fs.readFileSync(run.logPath, "utf8")).not.toContain("old human log");
        expect(fs.readFileSync(run.consoleLogPath, "utf8")).not.toContain("old console log");
        expect(JSON.parse(fs.readFileSync(run.shipItRequestPath, "utf8")).launchAfterInstallation).toBe(false);
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
        expect(fs.existsSync(run.activeRunPath)).toBe(false);
    });

    test("leaves an existing wrapper untouched when no Discord update appears", () => {
        const run = runRecovery(false, false, "test-run", "test-run", false, false, "timeout");
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.existsSync(path.join(run.resources, "app", ".betterdiscord-inject.json"))).toBe(true);
        expect(fs.readFileSync(path.join(run.resources, "betterdiscord.app.asar"), "utf8")).toBe("existing Discord payload");
        expect(fs.existsSync(path.join(run.resources, "app.asar"))).toBe(false);
        const log = fs.readFileSync(run.logPath, "utf8");
        expect(log).toContain("leaving the existing BetterDiscord wrapper unchanged");
        expect(log).not.toContain("BetterDiscord owns relaunch");
        expect(log).not.toContain("Rolled back the incomplete BetterDiscord wrapper");
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
        expect(fs.existsSync(run.activeRunPath)).toBe(false);
        expect(fs.existsSync(run.statePath)).toBe(false);
        expect(fs.existsSync(run.runPath)).toBe(false);
        expect(fs.existsSync(run.resultPath)).toBe(false);
    });

    test("notifies a matching OpenAsar helper when no Discord update appears", () => {
        const run = runRecovery(true, false, "test-run", "test-run", false, false, "timeout", false, "late-match");
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.existsSync(run.readyPath)).toBe(false);
        expect(JSON.parse(fs.readFileSync(run.resultPath, "utf8"))).toMatchObject({
            schema: 1,
            owner: "betterdiscord",
            style: "app-wrapper",
            channel: "stable",
            installationId: "test-installation",
            recoveryRunId: "test-run",
            sourceProcessPid: 24680,
            openAsarHandoffId: "test-handoff",
            openAsarSourceProcessPid: 24680,
            outcome: "no-update",
        });
        expect(fs.readFileSync(path.join(run.resources, "betterdiscord.app.asar"), "utf8")).toBe("existing Discord payload");
        const log = fs.readFileSync(run.logPath, "utf8");
        expect(log).toContain("Adopted same-process OpenAsar handoff");
        expect(log).toContain("Published no-update result for matching OpenAsar handoff");
        expect(log).not.toContain("BetterDiscord owns relaunch");
    });

    test("stamps a same-process OpenAsar handoff published after BetterDiscord arms", () => {
        const run = runRecovery(true, false, "test-run", "test-run", false, false, "missing", false, "late-match");
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(JSON.parse(fs.readFileSync(run.readyPath, "utf8"))).toMatchObject({
            recoveryRunId: "test-run",
            openAsarHandoffId: "test-handoff",
            openAsarSourceProcessPid: 24680,
        });
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("Adopted same-process OpenAsar handoff");
    });

    test("does not publish a no-update result to a newer OpenAsar generation", () => {
        const run = runRecovery(true, false, "test-run", "test-run", false, false, "timeout", false, "source-mismatch");
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.existsSync(run.resultPath)).toBe(false);
        expect(fs.readFileSync(run.logPath, "utf8")).not.toContain("Published no-update result");
    });

    test("refreshes LaunchServices and retries a transient registration failure", () => {
        const run = runRecovery(false, false, "test-run", "test-run", false, false, "retry", true);
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.readFileSync(run.openAttemptsPath, "utf8").trim()).toBe("3");
        expect(fs.readFileSync(run.registrationAttemptsPath, "utf8").trim()).toBe("3");
        const log = fs.readFileSync(run.logPath, "utf8");
        expect(log).toContain("Discord open attempt 1 failed");
        expect(log).toContain("registration error -10814");
        expect(log).toContain("Relaunched Discord");
        expect(fs.existsSync(run.directLaunchPath)).toBe(false);
    });

    test("falls back to the resolved Discord executable after bounded open failures", () => {
        const run = runRecovery(false, false, "test-run", "test-run", false, false, "fallback", true);
        if (!run) return;

        expect(run.result.status).toBe(0);
        for (let attempt = 0; attempt < 20 && !fs.existsSync(run.directLaunchPath); attempt++) {
            spawnSync("/bin/sleep", ["0.05"]);
        }
        expect(fs.readFileSync(run.openAttemptsPath, "utf8").trim()).toBe("3");
        expect(fs.existsSync(run.directLaunchPath)).toBe(true);
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("Falling back to direct Discord executable launch");
    });

    test("hands nested restore and relaunch to a matching live OpenAsar helper", () => {
        const run = runRecovery(true);
        if (!run) return;

        expect(run.result.status).toBe(0);
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("OpenAsar owns nested restore and optional relaunch");
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
        expect(fs.existsSync(run.runPath)).toBe(false);
        expect(fs.readFileSync(run.activeRunPath, "utf8")).toBe("newer-run\n");
        expect(JSON.parse(fs.readFileSync(run.statePath, "utf8"))).toEqual({pending: true});
    });

    test("TERM before wrapper publication rolls back the fresh app layout", () => {
        const run = runRecovery(false, false, "test-run", "test-run", false, false, "term-before-publish");
        if (!run) return;

        expect(run.result.status).toBe(143);
        expect(fs.readFileSync(path.join(run.resources, "app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "betterdiscord.app.asar"))).toBe(false);
        expect(fs.existsSync(path.join(run.resources, "app"))).toBe(false);
        expect(fs.existsSync(run.readyPath)).toBe(false);
        expect(fs.existsSync(run.runPath)).toBe(false);
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
        expect(fs.existsSync(run.activeRunPath)).toBe(false);
        expect(fs.existsSync(run.statePath)).toBe(false);
    });

    test("TERM after wrapper publication preserves the wrapper and clears recovery ownership", () => {
        const run = runRecovery(false, false, "test-run", "test-run", false, false, "term-after-publish");
        if (!run) return;

        expect(run.result.status).toBe(143);
        expect(fs.readFileSync(path.join(run.resources, "betterdiscord.app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "app", ".betterdiscord-inject.json"))).toBe(true);
        expect(fs.existsSync(run.readyPath)).toBe(true);
        expect(fs.existsSync(run.runPath)).toBe(false);
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
        expect(fs.existsSync(run.activeRunPath)).toBe(false);
        expect(fs.existsSync(run.statePath)).toBe(false);
    });

    test("a recovery failure keeps the stock payload and owns relaunch after disabling ShipIt", () => {
        const run = runRecovery(false, false, "test-run", "test-run", true, false, "missing", true);
        if (!run) return;

        expect(run.result.status).toBe(1);
        expect(fs.readFileSync(path.join(run.resources, "app.asar"), "utf8")).toBe("fresh Discord payload");
        expect(fs.existsSync(path.join(run.resources, "betterdiscord.app.asar"))).toBe(false);
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("fresh resources layout is ambiguous");
        expect(fs.readFileSync(run.logPath, "utf8")).toContain("BetterDiscord owns relaunch");
        expect(fs.existsSync(run.helperPidPath)).toBe(false);
    });

    test("rolls back the wrapper before relaunch when ready publication fails", () => {
        const run = runRecovery(false, false, "test-run", "test-run", false, true, "missing", true);
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
