import fs from "fs";
import path from "path";
import bun from "bun";

import {comparator} from "../src/common/semver";
import {inspectInjection, unwrapInjection, type InjectionChannel} from "./helpers/injection";

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const prepare = rawArgs.includes("--prepare");
const args = rawArgs.filter(argument => argument !== "--dry-run" && argument !== "--prepare");
if (args.length > 2) throw new Error("Usage: bun scripts/uninject.ts [stable|ptb|canary] [auto|release|dev] [--prepare|--dry-run]");

const requestedChannel = (args[0] ?? "stable").toLowerCase();
if (requestedChannel !== "stable" && requestedChannel !== "ptb" && requestedChannel !== "canary" && requestedChannel !== "discord") {
    throw new Error("Channel must be stable, ptb, or canary");
}
const channel: InjectionChannel = requestedChannel === "discord" ? "stable" : requestedChannel;
const requestedMode = (args[1] ?? "auto").toLowerCase();
if (requestedMode !== "auto" && requestedMode !== "release" && requestedMode !== "dev") throw new Error("Mode must be auto, release, or dev");

const release = channel === "canary" ? "Discord Canary" : channel === "ptb" ? "Discord PTB" : "Discord";
const releaseDirectory = channel === "canary" ? "discordcanary" : channel === "ptb" ? "discordptb" : "discord";

function latestVersionDirectory(basedir: string): string {
    const versions = fs.readdirSync(basedir)
        .filter(item => item.startsWith("app-") && fs.statSync(path.join(basedir, item)).isDirectory())
        .map(item => item.slice(4));
    if (!versions.length) throw new Error(`No app-* directory exists in ${basedir}`);
    return versions.reduce((current, candidate) => comparator(current, candidate) === 1 ? candidate : current);
}

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
    return path.join(basedir, `app-${latestVersionDirectory(basedir)}`, "resources");
})();

const bootstrapDirectory = process.platform === "darwin"
    ? path.join(process.env.HOME!, "Library", "Application Support", releaseDirectory, "betterdiscord-bootstrap")
    : "";
const recoveryDisabled = bootstrapDirectory ? path.join(bootstrapDirectory, "recovery-disabled") : "";
let recoveryDisabledByThisRun = false;

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
    for (const state of ["update-pending.json", "wrapper-ready.json"]) {
        fs.rmSync(path.join(bootstrapDirectory, state), {force: true});
    }
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

if (prepare) {
    if (process.platform !== "darwin") {
        process.exit(0);
    }
    if (dryRun) {
        console.log(`[dry-run] Would disable BetterDiscord update recovery for ${release}`);
    }
    else {
        disableMacRecovery();
    }
    process.exit(0);
}

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
