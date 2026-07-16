import {app, autoUpdater} from "electron";
import fs from "fs";
import path from "path";
import {randomUUID} from "crypto";
import {execFileSync, spawn} from "child_process";

import {findLatestDiscordResources, parseDiscordVersionDirectory} from "@common/discordResources";
import {findMatchingOpenAsarHandoff, findPendingOpenAsarHandoff} from "./macoshandoff";
import {getMacOSRecoveryEnvironment, macOSRecoveryHelperSource} from "./macosrecovery";


const markerFilename = ".betterdiscord-inject.json";
const loaderMarker = "__betterdiscord_inject_meta__";
const wrappedAsarFilename = "betterdiscord.app.asar";
const helperFilename = "betterdiscord-update-helper.zsh";
// OpenAsar adjusts process.resourcesPath during its own bootstrap. Preserve the
// real Electron host Resources directory before any wrapped payload can do so.
const hostResourcesPath = process.resourcesPath;

interface InjectionMarker {
    schema: 1;
    owner: "betterdiscord";
    style: "app-wrapper";
    channel: "stable" | "ptb" | "canary";
    mode: "release" | "dev";
    loader: "index.js";
    payload: "../betterdiscord.app.asar";
    bdPath: string;
    helperRuntime?: string;
    installationId: string;
}

interface MacRecoveryState {
    schema: 1;
    pending: true;
    owner: "betterdiscord";
    style: "app-wrapper";
    installationId: string;
    targetAppPath: string;
    resourcesPath: string;
    nestedTarget: string;
    armedAt: string;
    marker: InjectionMarker;
    readyPath: string;
    disabledPath: string;
    logPath: string;
    openAsarPendingPath: string;
    openAsarHelperPath: string;
    openAsarHelperPidPath: string;
    snapshotPath: string;
    readyTemplatePath: string;
    shipItRequestPath: string;
    helperPidPath: string;
    activeRunPath: string;
    runId: string;
    sourceProcessPid: number;
    openAsarHandoffId: string;
    openAsarSourceProcessPid: number;
    restartRequested: boolean;
    stoppedHelperPids: number[];
}

function readJson(target: string): unknown {
    try {return JSON.parse(fs.readFileSync(target, "utf8"));}
    catch {return null;}
}

function isMarker(value: unknown): value is InjectionMarker {
    if (!value || typeof value !== "object") return false;
    const marker = value as Partial<InjectionMarker>;
    return marker.schema === 1
        && marker.owner === "betterdiscord"
        && marker.style === "app-wrapper"
        && (marker.channel === "stable" || marker.channel === "ptb" || marker.channel === "canary")
        && (marker.mode === "release" || marker.mode === "dev")
        && marker.loader === "index.js"
        && marker.payload === "../betterdiscord.app.asar"
        && typeof marker.bdPath === "string"
        && marker.bdPath.length > 0
        && (marker.helperRuntime === undefined || typeof marker.helperRuntime === "string")
        && typeof marker.installationId === "string"
        && marker.installationId.length > 0;
}

function readCurrentMarker(): InjectionMarker | null {
    const appDirectory = path.join(hostResourcesPath, "app");
    const marker = readJson(path.join(appDirectory, markerFilename));
    if (!isMarker(marker)) return null;
    if (!fs.existsSync(path.join(hostResourcesPath, wrappedAsarFilename))) return null;
    const indexPath = path.join(appDirectory, "index.js");
    if (!fs.existsSync(indexPath)) return null;
    const index = fs.readFileSync(indexPath, "utf8");
    if (!index.includes(loaderMarker) || !index.includes(marker.payload)) return null;

    // Old fork markers recorded Bun here. Continue accepting those markers, but
    // never execute or preserve the developer runtime in installed recovery.
    const normalized = {...marker};
    delete normalized.helperRuntime;
    return normalized;
}

function appendLog(logPath: string, message: string) {
    try {
        fs.mkdirSync(path.dirname(logPath), {recursive: true});
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
    }
    catch {/* Logging must never break Discord startup. */}
}

function replaceLog(logPath: string, message: string) {
    try {
        fs.mkdirSync(path.dirname(logPath), {recursive: true});
        fs.writeFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
    }
    catch {/* Logging must never break Discord startup. */}
}

function atomicJson(target: string, value: unknown) {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 4)}\n`);
    fs.renameSync(temporary, target);
}

function atomicText(target: string, value: string) {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, value);
    fs.renameSync(temporary, target);
}

interface MacHelperProcess {
    pid: number;
    pgid: number;
    command: string;
}

function listMacHelperProcesses(): MacHelperProcess[] {
    let processes = "";
    try {processes = execFileSync("/bin/ps", ["-axo", "pid=,pgid=,command="], {encoding: "utf8"});}
    catch {return [];}

    const parsed: MacHelperProcess[] = [];
    for (const line of processes.split("\n")) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) continue;
        parsed.push({pid: Number(match[1]), pgid: Number(match[2]), command: match[3]});
    }
    return parsed;
}

function isOwnedMacHelper(candidate: MacHelperProcess, bootstrap: string): boolean {
    const helperPath = path.join(bootstrap, helperFilename);
    const commandPrefixes = [
        `zsh -f ${helperPath} `,
        `/bin/zsh -f ${helperPath} `,
        `/usr/bin/zsh -f ${helperPath} `,
        `/usr/bin/env zsh -f ${helperPath} `,
    ];
    return candidate.pid > 0
        && candidate.pid !== process.pid
        && candidate.pgid === candidate.pid
        && commandPrefixes.some(prefix => candidate.command.startsWith(prefix));
}

function macHelperIsRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {return false;}
}

function waitForMacHelperExit(pid: number): boolean {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (!macHelperIsRunning(pid)) return true;
        execFileSync("/bin/sleep", ["0.1"]);
    }
    return !macHelperIsRunning(pid);
}

function stopExistingMacHelpers(bootstrap: string, helperPidPath: string): number[] {
    const stopped: number[] = [];
    let recordedPid = 0;
    try {
        if (fs.lstatSync(helperPidPath).isSymbolicLink()) return stopped;
        const rawPid = fs.readFileSync(helperPidPath, "utf8").trim();
        if (/^\d+$/.test(rawPid)) recordedPid = Number(rawPid);
    }
    catch {return stopped;}
    if (!Number.isInteger(recordedPid) || recordedPid <= 0) return stopped;

    const helper = listMacHelperProcesses().find(candidate => candidate.pid === recordedPid);
    if (!helper || !isOwnedMacHelper(helper, bootstrap)) return stopped;
    try {
        // The detached helper is its process-group leader. Signal the whole
        // PID-file-correlated group so foreground commands cannot outlive it.
        process.kill(-helper.pid, "SIGTERM");
        stopped.push(helper.pid);
    }
    catch {return stopped;}

    if (waitForMacHelperExit(helper.pid)) return stopped;
    const current = listMacHelperProcesses().find(candidate => candidate.pid === helper.pid);
    if (!current || !isOwnedMacHelper(current, bootstrap)) return stopped;
    try {
        process.kill(-helper.pid, "SIGKILL");
        waitForMacHelperExit(helper.pid);
    }
    catch {/* The validated process group can finish before the fallback. */}

    return stopped;
}

function writeWrapper(resources: string, marker: InjectionMarker) {
    const appAsar = path.join(resources, "app.asar");
    const wrappedAsar = path.join(resources, wrappedAsarFilename);
    const appDirectory = path.join(resources, "app");
    if (!fs.existsSync(appAsar)) throw new Error("fresh app.asar is missing");
    if (fs.existsSync(appDirectory) || fs.existsSync(wrappedAsar)) throw new Error("target resources layout is not fresh");

    const staged = path.join(resources, `.betterdiscord-app-${process.pid}-${Date.now()}`);
    let moved = false;
    try {
        fs.renameSync(appAsar, wrappedAsar);
        moved = true;
        fs.mkdirSync(staged);
        fs.writeFileSync(path.join(staged, "index.js"), `// ${loaderMarker}\nrequire(${JSON.stringify(marker.bdPath)});\nmodule.exports = require(${JSON.stringify(marker.payload)});\n`);
        fs.writeFileSync(path.join(staged, "package.json"), `${JSON.stringify({name: "discord", main: "./index.js"}, null, 4)}\n`);
        fs.writeFileSync(path.join(staged, markerFilename), `${JSON.stringify(marker, null, 4)}\n`);
        fs.renameSync(staged, appDirectory);
    }
    catch (error) {
        fs.rmSync(staged, {recursive: true, force: true});
        if (moved && !fs.existsSync(appAsar) && fs.existsSync(wrappedAsar)) fs.renameSync(wrappedAsar, appAsar);
        throw error;
    }
}

function migrateVersionDirectory() {
    const marker = readCurrentMarker();
    if (!marker) return;

    const logPath = path.join(app.getPath("userData"), "betterdiscord-bootstrap", "updater.log");
    replaceLog(logPath, "Version-directory recovery started");
    try {
        const currentBase = path.dirname(process.execPath);
        const currentVersionName = path.basename(currentBase);
        const currentVersion = parseDiscordVersionDirectory(currentVersionName);
        if (!currentVersion) return appendLog(logPath, `Skipping migration: ${currentVersionName} is not an app-* or version directory`);

        const discordPath = path.dirname(currentBase);
        const latest = findLatestDiscordResources(discordPath);
        if (!latest) return appendLog(logPath, "Skipping migration: no app-* or version directory has a modern Discord application payload");

        appendLog(logPath, `Current directory is ${currentVersionName}; latest usable directory is ${latest.directoryName}`);
        if (path.resolve(latest.directoryPath) === path.resolve(currentBase)) return;

        const resources = latest.resourcesPath;
        const existing = readJson(path.join(resources, "app", markerFilename));
        if (isMarker(existing) && existing.installationId === marker.installationId && fs.existsSync(path.join(resources, wrappedAsarFilename))) {
            return appendLog(logPath, "Target version already has the matching BetterDiscord wrapper");
        }

        writeWrapper(resources, marker);
        appendLog(logPath, `Wrapped ${latest.directoryName} successfully`);
    }
    catch (error) {
        appendLog(logPath, `Migration failed: ${String(error)}`);
    }
}

let macHelperArmed = false;
let macUpdateRestartRequestedAt = 0;
const restartIntentWindowMs = 5000;

if (process.platform === "darwin") {
    try {
        autoUpdater.on("before-quit-for-update", () => {
            macUpdateRestartRequestedAt = Date.now();
        });
    }
    catch {/* Discord builds without the native updater retain quiet recovery. */}
}

function initializeMacBootstrap() {
    if (process.platform !== "darwin") return;
    const bootstrap = path.join(app.getPath("userData"), "betterdiscord-bootstrap");
    const logPath = path.join(bootstrap, "betterdiscord-bootstrap.log");
    try {
        fs.mkdirSync(bootstrap, {recursive: true});
        const helperPath = path.join(bootstrap, helperFilename);
        fs.rmSync(path.join(bootstrap, "betterdiscord-update-helper.js"), {force: true});
        fs.writeFileSync(helperPath, macOSRecoveryHelperSource());
        fs.chmodSync(helperPath, 0o700);
    }
    catch (error) {
        replaceLog(logPath, `Bootstrap initialization failed: ${String(error)}`);
    }
}

function armMacRecovery() {
    if (process.platform !== "darwin" || macHelperArmed) return;
    macHelperArmed = true;

    const marker = readCurrentMarker();
    if (!marker) return;

    const userData = app.getPath("userData");
    const bootstrap = path.join(userData, "betterdiscord-bootstrap");
    const disabledPath = path.join(bootstrap, "recovery-disabled");
    const logPath = path.join(bootstrap, "betterdiscord-bootstrap.log");
    const consoleLogPath = path.join(bootstrap, "betterdiscord-bootstrap-console.log");
    if (fs.existsSync(disabledPath)) {
        try {fs.writeFileSync(consoleLogPath, "");}
        catch {/* Logging must never break Discord shutdown. */}
        return replaceLog(logPath, "Recovery is disabled; helper not armed");
    }

    const targetAppPath = path.resolve(hostResourcesPath, "..", "..");
    const nestedTarget = path.join(hostResourcesPath, wrappedAsarFilename);
    const openAsarBootstrap = path.join(userData, "openasar-bootstrap");
    const handoff = findMatchingOpenAsarHandoff({
        marker,
        targetAppPath,
        nestedTarget,
        readyPath: path.join(bootstrap, "wrapper-ready.json"),
        pendingPath: path.join(openAsarBootstrap, "post-shipit-update-pending.json"),
        helperPath: path.join(openAsarBootstrap, "post-shipit-helper.zsh"),
        helperPidPath: path.join(openAsarBootstrap, "post-shipit-helper.pid"),
    });
    if (handoff) {
        return appendLog(logPath, `Preserved OpenAsar wrapper-ready handoff helperPid=${handoff.helperPid} installationId=${marker.installationId}`);
    }

    const pendingHandoffCandidate = findPendingOpenAsarHandoff({
        marker,
        targetAppPath,
        nestedTarget,
        readyPath: path.join(bootstrap, "wrapper-ready.json"),
        pendingPath: path.join(openAsarBootstrap, "post-shipit-update-pending.json"),
        helperPath: path.join(openAsarBootstrap, "post-shipit-helper.zsh"),
        helperPidPath: path.join(openAsarBootstrap, "post-shipit-helper.pid"),
    });
    const pendingHandoff = pendingHandoffCandidate?.sourceProcessPid === process.pid ? pendingHandoffCandidate : null;

    try {
        fs.mkdirSync(bootstrap, {recursive: true});
        fs.writeFileSync(logPath, "");
        fs.writeFileSync(consoleLogPath, "");
        const statePath = path.join(bootstrap, "update-pending.json");
        const readyPath = path.join(bootstrap, "wrapper-ready.json");
        const resultPath = path.join(bootstrap, "wrapper-result.json");
        const helperPath = path.join(bootstrap, helperFilename);
        const helperPidPath = path.join(bootstrap, "betterdiscord-update-helper.pid");
        const activeRunPath = path.join(bootstrap, "active-run");
        const runId = randomUUID();
        const runPath = path.join(bootstrap, "recovery-runs", runId);
        const snapshotPath = path.join(runPath, "wrapper");
        const readyTemplatePath = path.join(runPath, "wrapper-ready-template.json");
        const armedAt = new Date().toISOString();
        const restartRequested = macUpdateRestartRequestedAt > 0
            && Date.now() - macUpdateRestartRequestedAt <= restartIntentWindowMs;
        const stoppedHelperPids = stopExistingMacHelpers(bootstrap, helperPidPath);
        const state: MacRecoveryState = {
            schema: 1,
            pending: true,
            owner: "betterdiscord",
            style: "app-wrapper",
            installationId: marker.installationId,
            targetAppPath,
            resourcesPath: hostResourcesPath,
            nestedTarget,
            armedAt,
            marker,
            readyPath,
            disabledPath,
            logPath,
            openAsarPendingPath: path.join(openAsarBootstrap, "post-shipit-update-pending.json"),
            openAsarHelperPath: path.join(openAsarBootstrap, "post-shipit-helper.zsh"),
            openAsarHelperPidPath: path.join(openAsarBootstrap, "post-shipit-helper.pid"),
            snapshotPath,
            readyTemplatePath,
            shipItRequestPath: path.join(userData, "ShipIt_request.json"),
            helperPidPath,
            activeRunPath,
            runId,
            sourceProcessPid: process.pid,
            openAsarHandoffId: pendingHandoff?.handoffId ?? "",
            openAsarSourceProcessPid: pendingHandoff?.sourceProcessPid ?? 0,
            restartRequested,
            stoppedHelperPids,
        };

        fs.rmSync(readyPath, {force: true});
        fs.rmSync(resultPath, {force: true});
        fs.mkdirSync(snapshotPath, {recursive: true});
        fs.writeFileSync(path.join(snapshotPath, "index.js"), `// ${loaderMarker}\nrequire(${JSON.stringify(marker.bdPath)});\nmodule.exports = require(${JSON.stringify(marker.payload)});\n`);
        fs.writeFileSync(path.join(snapshotPath, "package.json"), `${JSON.stringify({name: "discord", main: "./index.js"}, null, 4)}\n`);
        fs.writeFileSync(path.join(snapshotPath, markerFilename), `${JSON.stringify(marker, null, 4)}\n`);
        atomicJson(readyTemplatePath, {
            schema: 1,
            owner: "betterdiscord",
            style: "app-wrapper",
            channel: marker.channel,
            installationId: marker.installationId,
            appPath: targetAppPath,
            targetAppPath,
            nestedTarget: state.nestedTarget,
            armedAt,
            recoveryRunId: runId,
            sourceProcessPid: state.sourceProcessPid,
            openAsarHandoffId: state.openAsarHandoffId,
            openAsarSourceProcessPid: state.openAsarSourceProcessPid,
            restartRequested: state.restartRequested,
            readyAt: "",
        });
        atomicJson(statePath, state);
        fs.writeFileSync(helperPath, macOSRecoveryHelperSource());
        fs.chmodSync(helperPath, 0o700);
        atomicText(activeRunPath, `${runId}\n`);

        const child = spawn("/usr/bin/env", [
            "zsh",
            "-f",
            helperPath,
            statePath,
            state.resourcesPath,
            state.nestedTarget,
            state.targetAppPath,
            state.snapshotPath,
            state.readyTemplatePath,
            state.readyPath,
            state.disabledPath,
            state.logPath,
            state.openAsarPendingPath,
            state.openAsarHelperPath,
            state.openAsarHelperPidPath,
            state.installationId,
            marker.channel,
            state.armedAt,
            state.shipItRequestPath,
            state.helperPidPath,
            state.activeRunPath,
            state.runId,
            state.stoppedHelperPids.length > 0 ? state.stoppedHelperPids.join(",") : "none",
            String(state.sourceProcessPid),
            state.openAsarHandoffId || "none",
            String(state.openAsarSourceProcessPid),
            state.restartRequested ? "1" : "0",
        ], {
            detached: true,
            stdio: "ignore",
            env: getMacOSRecoveryEnvironment(),
        });
        child.once("error", error => appendLog(logPath, `Recovery helper failed to start: ${String(error)}`));
        child.unref();
    }
    catch (error) {
        replaceLog(logPath, `Failed to arm recovery: ${String(error)}`);
    }
}

initializeMacBootstrap();
app.on("before-quit", () => {
    if (process.platform === "darwin") armMacRecovery();
    else if (process.platform === "win32" || process.platform === "linux") migrateVersionDirectory();
});
