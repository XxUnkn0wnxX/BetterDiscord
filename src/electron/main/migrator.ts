import {app} from "electron";
import fs from "fs";
import path from "path";
import {spawn} from "child_process";

import {comparator} from "@common/semver";

const markerFilename = ".betterdiscord-inject.json";
const loaderMarker = "__betterdiscord_inject_meta__";
const wrappedAsarFilename = "betterdiscord.app.asar";
const helperFilename = "betterdiscord-update-helper.js";
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
    const resources = hostResourcesPath;
    const appDirectory = path.join(resources, "app");
    const marker = readJson(path.join(appDirectory, markerFilename));
    if (!isMarker(marker)) return null;
    if (!fs.existsSync(path.join(resources, wrappedAsarFilename))) return null;
    const indexPath = path.join(appDirectory, "index.js");
    if (!fs.existsSync(indexPath)) return null;
    const index = fs.readFileSync(indexPath, "utf8");
    if (!index.includes(loaderMarker) || !index.includes(marker.payload)) return null;
    return marker;
}

function appendLog(logPath: string, message: string) {
    try {
        fs.mkdirSync(path.dirname(logPath), {recursive: true});
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
    }
    catch {/* Logging must never break Discord startup. */}
}

function atomicJson(target: string, value: unknown) {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 4)}\n`);
    fs.renameSync(temporary, target);
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
    try {
        const currentBase = path.dirname(process.execPath);
        const currentVersionName = path.basename(currentBase);
        if (!currentVersionName.startsWith("app-")) return appendLog(logPath, `Skipping migration: ${currentVersionName} is not an app-* directory`);

        const discordPath = path.dirname(currentBase);
        const versions = fs.readdirSync(discordPath)
            .filter(item => item.startsWith("app-") && fs.statSync(path.join(discordPath, item)).isDirectory())
            .map(item => item.slice(4));
        if (!versions.length) return appendLog(logPath, "Skipping migration: no app-* directories exist");

        const latestVersion = versions.reduce((current, candidate) => comparator(current, candidate) === 1 ? candidate : current);
        const currentVersion = currentVersionName.slice(4);
        appendLog(logPath, `Current version is ${currentVersion}; latest is ${latestVersion}`);
        if (latestVersion === currentVersion) return;

        const resources = path.join(discordPath, `app-${latestVersion}`, "resources");
        const existing = readJson(path.join(resources, "app", markerFilename));
        if (isMarker(existing) && existing.installationId === marker.installationId && fs.existsSync(path.join(resources, wrappedAsarFilename))) {
            return appendLog(logPath, "Target version already has the matching BetterDiscord wrapper");
        }

        writeWrapper(resources, marker);
        appendLog(logPath, `Wrapped app-${latestVersion} successfully`);
    }
    catch (error) {
        appendLog(logPath, `Migration failed: ${String(error)}`);
    }
}

function macHelperSource(): string {
    return String.raw`"use strict";
const fs = require("fs");
const path = require("path");
const {spawn, execFileSync} = require("child_process");

const statePath = process.argv[2];
const readJson = (target) => { try { return JSON.parse(fs.readFileSync(target, "utf8")); } catch { return null; } };
const state = readJson(statePath);
if (!state || state.schema !== 1 || state.pending !== true || state.owner !== "betterdiscord") process.exit(0);

const log = (message) => {
    try { fs.appendFileSync(state.logPath, "[" + new Date().toISOString() + "] " + message + "\n"); } catch {}
};
const finish = (code) => { clearInterval(timer); process.exit(code); };
const atomicJson = (target, value) => {
    const temporary = target + "." + process.pid + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(value, null, 4) + "\n");
    fs.renameSync(temporary, target);
};
const openAsarHelperIsLive = (pending) => {
    const helperPid = Number(pending.helperPid);
    if (!Number.isInteger(helperPid) || helperPid <= 0) return false;
    if (path.resolve(pending.helperPath || "") !== path.resolve(state.openAsarHelperPath)) return false;
    if (path.resolve(pending.helperPidPath || "") !== path.resolve(state.openAsarHelperPidPath)) return false;

    let recordedPid;
    try { recordedPid = Number(fs.readFileSync(state.openAsarHelperPidPath, "utf8").trim()); }
    catch { return false; }
    if (recordedPid !== helperPid) return false;

    try {
        process.kill(helperPid, 0);
        const command = execFileSync("/bin/ps", ["-p", String(helperPid), "-o", "command="], {encoding: "utf8"}).trim();
        return command.includes(state.openAsarHelperPath) && command.includes(state.openAsarHelperPidPath);
    }
    catch { return false; }
};
const matchingOpenAsarPending = () => {
    const pending = readJson(state.openAsarPendingPath);
    if (!pending || pending.pending !== true || pending.betterDiscordExpected !== true) return false;
    const expectedId = pending.expectedInstallationId || pending.installationId;
    const expectedApp = pending.appPath || pending.targetAppPath || pending.expectedTargetAppPath;
    const pendingArmedAt = Date.parse(pending.armedAt || pending.createdAt || "");
    const now = Date.now();
    return pending.schema === 1
        && pending.owner === "betterdiscord"
        && pending.style === "app-wrapper"
        && pending.channel === state.marker.channel
        && expectedId === state.installationId
        && path.resolve(expectedApp || "") === path.resolve(state.targetAppPath)
        && path.resolve(pending.nestedTarget || "") === path.resolve(state.nestedTarget)
        && Number.isFinite(pendingArmedAt)
        && pendingArmedAt <= now + 10000
        && now - pendingArmedAt <= 300000
        && openAsarHelperIsLive(pending);
};
const relaunch = () => {
    log("No matching OpenAsar handoff; BetterDiscord owns relaunch");
    const child = spawn("/usr/bin/open", [state.targetAppPath], {detached: true, stdio: "ignore"});
    child.unref();
};

let lastSize = -1;
let stablePolls = 0;
const deadline = Date.now() + 90000;
const timer = setInterval(() => {
    if (fs.existsSync(state.disabledPath)) {
        log("Recovery disabled by deliberate uninject; exiting");
        return finish(0);
    }
    if (Date.now() > deadline) {
        log("Timed out waiting for a fresh Discord app.asar");
        return finish(0);
    }

    const appAsar = path.join(state.resourcesPath, "app.asar");
    let size;
    try { size = fs.statSync(appAsar).size; } catch { stablePolls = 0; lastSize = -1; return; }
    if (size <= 0 || size !== lastSize) { lastSize = size; stablePolls = 0; return; }
    if (++stablePolls < 3) return;

    const wrappedAsar = state.nestedTarget;
    const appDirectory = path.join(state.resourcesPath, "app");
    const staged = path.join(state.resourcesPath, ".betterdiscord-app-helper-" + process.pid);
    let moved = false;
    try {
        if (fs.existsSync(appDirectory) || fs.existsSync(wrappedAsar)) throw new Error("fresh resources layout is ambiguous");
        fs.renameSync(appAsar, wrappedAsar);
        moved = true;
        fs.mkdirSync(staged);
        fs.writeFileSync(path.join(staged, "index.js"), "// __betterdiscord_inject_meta__\nrequire(" + JSON.stringify(state.marker.bdPath) + ");\nmodule.exports = require(" + JSON.stringify(state.marker.payload) + ");\n");
        fs.writeFileSync(path.join(staged, "package.json"), JSON.stringify({name: "discord", main: "./index.js"}, null, 4) + "\n");
        fs.writeFileSync(path.join(staged, ".betterdiscord-inject.json"), JSON.stringify(state.marker, null, 4) + "\n");
        fs.renameSync(staged, appDirectory);

        const readyAt = new Date().toISOString();
        atomicJson(state.readyPath, {
            schema: 1,
            owner: "betterdiscord",
            style: "app-wrapper",
            channel: state.marker.channel,
            installationId: state.installationId,
            appPath: state.targetAppPath,
            targetAppPath: state.targetAppPath,
            nestedTarget: state.nestedTarget,
            armedAt: state.armedAt,
            readyAt
        });
        fs.rmSync(statePath, {force: true});
        log("Wrapper ready for installation " + state.installationId);
        if (matchingOpenAsarPending()) log("Matching OpenAsar handoff detected; OpenAsar owns relaunch");
        else relaunch();
        finish(0);
    }
    catch (error) {
        fs.rmSync(staged, {recursive: true, force: true});
        if (moved && !fs.existsSync(appAsar) && fs.existsSync(wrappedAsar)) {
            try { fs.renameSync(wrappedAsar, appAsar); } catch {}
        }
        log("Wrapper recovery failed: " + String(error));
        finish(1);
    }
}, 250);
`;
}

let macHelperArmed = false;

function initializeMacBootstrap() {
    if (process.platform !== "darwin") return;
    const bootstrap = path.join(app.getPath("userData"), "betterdiscord-bootstrap");
    const logPath = path.join(bootstrap, "betterdiscord-bootstrap.log");
    try {
        fs.mkdirSync(bootstrap, {recursive: true});
        fs.writeFileSync(path.join(bootstrap, helperFilename), macHelperSource());
        appendLog(logPath, "Bootstrap helper refreshed");
    }
    catch (error) {
        appendLog(logPath, `Bootstrap initialization failed: ${String(error)}`);
    }
}

function armMacRecovery() {
    if (process.platform !== "darwin" || macHelperArmed) return;
    macHelperArmed = true;

    const marker = readCurrentMarker();
    if (!marker) return;

    const bootstrap = path.join(app.getPath("userData"), "betterdiscord-bootstrap");
    const disabledPath = path.join(bootstrap, "recovery-disabled");
    const logPath = path.join(bootstrap, "betterdiscord-bootstrap.log");
    if (fs.existsSync(disabledPath)) return appendLog(logPath, "Recovery is disabled; helper not armed");

    try {
        fs.mkdirSync(bootstrap, {recursive: true});
        const targetAppPath = path.resolve(hostResourcesPath, "..", "..");
        const statePath = path.join(bootstrap, "update-pending.json");
        const readyPath = path.join(bootstrap, "wrapper-ready.json");
        const state: MacRecoveryState = {
            schema: 1,
            pending: true,
            owner: "betterdiscord",
            style: "app-wrapper",
            installationId: marker.installationId,
            targetAppPath,
            resourcesPath: hostResourcesPath,
            nestedTarget: path.join(hostResourcesPath, wrappedAsarFilename),
            armedAt: new Date().toISOString(),
            marker,
            readyPath,
            disabledPath,
            logPath,
            openAsarPendingPath: path.join(app.getPath("userData"), "openasar-bootstrap", "post-shipit-update-pending.json"),
            openAsarHelperPath: path.join(app.getPath("userData"), "openasar-bootstrap", "post-shipit-helper.zsh"),
            openAsarHelperPidPath: path.join(app.getPath("userData"), "openasar-bootstrap", "post-shipit-helper.pid"),
        };

        fs.rmSync(readyPath, {force: true});
        atomicJson(statePath, state);
        fs.writeFileSync(path.join(bootstrap, helperFilename), macHelperSource());
        const helperRuntime = marker.helperRuntime && fs.existsSync(marker.helperRuntime) ? marker.helperRuntime : process.execPath;
        const child = spawn(helperRuntime, [path.join(bootstrap, helperFilename), statePath], {
            detached: true,
            stdio: "ignore",
            env: helperRuntime === process.execPath ? {...process.env, ELECTRON_RUN_AS_NODE: "1"} : process.env,
        });
        child.unref();
        appendLog(logPath, `Recovery armed for installation ${marker.installationId}`);
    }
    catch (error) {
        appendLog(logPath, `Failed to arm recovery: ${String(error)}`);
    }
}

initializeMacBootstrap();
app.on("before-quit", () => {
    if (process.platform === "darwin") armMacRecovery();
    else if (process.platform === "win32" || process.platform === "linux") migrateVersionDirectory();
});
