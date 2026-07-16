import fs from "fs";
import path from "path";
import bun from "bun";
import {execFileSync} from "child_process";

import {findLatestDiscordResources} from "../src/common/discordResources";
import {inspectInjection, unwrapInjection, type InjectionChannel} from "./helpers/injection";

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const prepare = rawArgs.includes("--prepare");
const check = rawArgs.includes("--check");
const args = rawArgs.filter(argument => argument !== "--dry-run" && argument !== "--prepare" && argument !== "--check");
if (args.length > 2) throw new Error("Usage: bun scripts/uninject.ts [stable|ptb|canary] [auto|release|dev] [--prepare|--check|--dry-run]");

const requestedChannel = (args[0] ?? "stable").toLowerCase();
if (requestedChannel !== "stable" && requestedChannel !== "ptb" && requestedChannel !== "canary" && requestedChannel !== "discord") {
    throw new Error("Channel must be stable, ptb, or canary");
}
const channel: InjectionChannel = requestedChannel === "discord" ? "stable" : requestedChannel;
const requestedMode = (args[1] ?? "auto").toLowerCase();
if (requestedMode !== "auto" && requestedMode !== "release" && requestedMode !== "dev") throw new Error("Mode must be auto, release, or dev");

const release = channel === "canary" ? "Discord Canary" : channel === "ptb" ? "Discord PTB" : "Discord";
const releaseDirectory = channel === "canary" ? "discordcanary" : channel === "ptb" ? "discordptb" : "discord";

const resources = await (async function resolveResources() {
    if (process.platform === "darwin") return path.join(path.sep, "Applications", `${release}.app`, "Contents", "Resources");

    let basedir: string;
    if (process.platform === "win32") {
        basedir = path.join(process.env.LOCALAPPDATA!, release.replace(/ /g, ""));
    }
    else if (process.env.WSL_DISTRO_NAME) {
        const appdata = (await bun.$`wslpath "$(cmd.exe /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r')"`.text()).trim();
        basedir = path.join(appdata, release.replace(/ /g, ""));
    }
    else {
        const config = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME!, ".config");
        basedir = path.join(config, releaseDirectory);
    }

    if (!fs.existsSync(basedir)) throw new Error(`No ${release} install at ${basedir}`);
    const candidate = findLatestDiscordResources(basedir);
    if (!candidate) throw new Error(`No app-* or version directory with a modern Discord application payload exists in ${basedir}`);
    return candidate.resourcesPath;
})();

const bootstrapDirectory = process.platform === "darwin"
    ? path.join(process.env.HOME!, "Library", "Application Support", releaseDirectory, "betterdiscord-bootstrap")
    : "";
const recoveryDisabled = bootstrapDirectory ? path.join(bootstrapDirectory, "recovery-disabled") : "";
let recoveryDisabledByThisRun = false;

if (check) {
    const layout = inspectInjection(resources);
    if (layout.kind === "plain-asar" || layout.kind === "plain-directory" || layout.kind === "missing") {
        console.log(`${release} does not have a BetterDiscord app wrapper.`);
        process.exit(3);
    }
    if (layout.kind === "unsafe") throw new Error(`Refusing to uninject ${release}: ${layout.reason}`);
    if (requestedMode !== "auto" && layout.marker.mode !== requestedMode) {
        throw new Error(`Refusing to uninject ${release} as ${requestedMode}; marker says ${layout.marker.mode}`);
    }
    process.exit(0);
}

function readMacHelperProcess(pid: number): {pgid: number; command: string} | null {
    try {
        const output = execFileSync("/bin/ps", ["-p", String(pid), "-o", "pgid=,command="], {encoding: "utf8"}).trim();
        const match = output.match(/^(\d+)\s+(.+)$/);
        if (!match) return null;
        return {pgid: Number(match[1]), command: match[2]};
    }
    catch {return null;}
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
    return false;
}

function stopMacRecoveryHelper(): void {
    if (!bootstrapDirectory) return;
    const pidPath = path.join(bootstrapDirectory, "betterdiscord-update-helper.pid");
    try {
        if (fs.lstatSync(pidPath).isSymbolicLink()) throw new Error(`Refusing to use symlinked recovery PID file for ${release}`);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }

    const rawPid = fs.readFileSync(pidPath, "utf8").trim();
    if (!/^\d+$/.test(rawPid) || Number(rawPid) <= 0) {
        fs.rmSync(pidPath, {force: true});
        console.log(`Removed an invalid BetterDiscord recovery PID file for ${release}`);
        return;
    }

    const helperPid = Number(rawPid);
    let helper = readMacHelperProcess(helperPid);
    if (!helper) {
        fs.rmSync(pidPath, {force: true});
        console.log(`Removed a stale BetterDiscord recovery PID file for ${release}`);
        return;
    }
    const helperPath = path.join(bootstrapDirectory, "betterdiscord-update-helper.zsh");
    const helperPrefixes = [
        `zsh -f ${helperPath} `,
        `/bin/zsh -f ${helperPath} `,
        `/usr/bin/zsh -f ${helperPath} `,
        `/usr/bin/env zsh -f ${helperPath} `,
    ];
    const helperCommandMatches = (command: string) => helperPrefixes.some(prefix => command.startsWith(prefix));
    const helperNameMatches = helperCommandMatches(helper.command);
    if (!helperNameMatches || !helper.command.includes(bootstrapDirectory) || helper.pgid !== helperPid) {
        throw new Error(`Refusing to signal PID ${helperPid}; it is not ${release}'s BetterDiscord recovery process-group owner`);
    }

    console.log(`Stopping BetterDiscord recovery helper for ${release} (PID ${helperPid} and its helper descendants)`);
    try {process.kill(-helperPid, "SIGTERM");}
    catch {/* The helper can finish after validation. */}
    if (!waitForMacHelperExit(helperPid)) {
        helper = readMacHelperProcess(helperPid);
        const stillMatches = helper
            && helper.pgid === helperPid
            && helperCommandMatches(helper.command);
        if (!stillMatches) throw new Error(`Refusing a forced helper stop because PID ${helperPid} no longer matches BetterDiscord recovery`);
        try {process.kill(-helperPid, "SIGKILL");}
        catch {
            if (macHelperIsRunning(helperPid)) throw new Error(`Could not stop ${release}'s BetterDiscord recovery process group`);
        }
        if (!waitForMacHelperExit(helperPid)) throw new Error(`${release}'s BetterDiscord recovery helper did not stop`);
    }
    fs.rmSync(pidPath, {force: true});
}

function assertRecoveryMarkerSafe(): void {
    if (!recoveryDisabled) return;
    try {
        if (fs.lstatSync(recoveryDisabled).isSymbolicLink()) {
            throw new Error(`Refusing to use symlinked recovery marker for ${release}`);
        }
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
}

function disableMacRecovery(): void {
    if (!bootstrapDirectory) return;
    const alreadyDisabled = fs.existsSync(recoveryDisabled);
    fs.mkdirSync(bootstrapDirectory, {recursive: true});
    fs.writeFileSync(recoveryDisabled, `${Date.now()}\n`);
    recoveryDisabledByThisRun = !alreadyDisabled;
    try {
        stopMacRecoveryHelper();
        for (const state of ["update-pending.json", "wrapper-ready.json", "wrapper-result.json", "active-run"]) {
            fs.rmSync(path.join(bootstrapDirectory, state), {force: true});
        }
        fs.rmSync(path.join(bootstrapDirectory, "recovery-runs"), {recursive: true, force: true});
    }
    catch (error) {
        if (recoveryDisabledByThisRun) fs.rmSync(recoveryDisabled, {force: true});
        throw error;
    }
}

if (prepare) {
    if (process.platform !== "darwin") {
        process.exit(0);
    }
    if (dryRun) {
        console.log(`[dry-run] Would disable BetterDiscord update recovery for ${release}`);
    }
    else {
        assertRecoveryMarkerSafe();
        disableMacRecovery();
    }
    process.exit(0);
}

const layout = inspectInjection(resources);
if (layout.kind === "plain-asar" || layout.kind === "plain-directory" || layout.kind === "missing") {
    console.log(`${release} does not have a BetterDiscord app wrapper.`);
    process.exit(0);
}
if (layout.kind === "unsafe") throw new Error(`Refusing to uninject ${release}: ${layout.reason}`);
if (requestedMode !== "auto" && layout.marker.mode !== requestedMode) {
    throw new Error(`Refusing to uninject ${release} as ${requestedMode}; marker says ${layout.marker.mode}`);
}
if (!dryRun) assertRecoveryMarkerSafe();
const copiedWslPayload = process.env.WSL_DISTRO_NAME
    && (layout.marker.bdPath === "../../../betterdiscord" || layout.marker.bdPath === "../../../betterdiscord/betterdiscord.asar")
    ? path.resolve(resources, "..", "..", "betterdiscord")
    : "";

console.log(`${dryRun ? "Dry-run for" : "Uninjecting from"} ${release}`);
if (!dryRun) disableMacRecovery();
try {
    unwrapInjection(resources, dryRun, message => console.log(`    ${dryRun ? "[dry-run] " : ""}${message}`));
    if (copiedWslPayload) {
        if (dryRun) console.log(`    [dry-run] Would remove copied WSL payload ${copiedWslPayload}`);
        else fs.rmSync(copiedWslPayload, {recursive: true, force: true});
    }
}
catch (error) {
    const currentLayout = inspectInjection(resources);
    if (recoveryDisabledByThisRun && currentLayout.kind === "wrapped") {
        fs.rmSync(recoveryDisabled, {force: true});
    }
    throw error;
}
console.log(dryRun ? `Dry-run complete; ${release} was not modified.` : `BetterDiscord uninjected from ${release}.`);
