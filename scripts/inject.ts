import fs from "fs";
import path from "path";
import bun from "bun";

import doSanityChecks from "./helpers/validate";
import buildPackage from "./helpers/package";
import copyFiles from "./helpers/copy";
import {comparator} from "../src/common/semver";
import {wrapInjection, type InjectionChannel, type InjectionMode} from "./helpers/injection";

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const args = rawArgs.filter(argument => argument !== "--dry-run");
const useBdRelease = args[0]?.toLowerCase() === "release";
if (useBdRelease) args.shift();
if (args.length > 1) throw new Error("Usage: bun scripts/inject.ts [release] [stable|ptb|canary] [--dry-run]");

const requestedChannel = (args[0] ?? "stable").toLowerCase();
if (requestedChannel !== "stable" && requestedChannel !== "ptb" && requestedChannel !== "canary" && requestedChannel !== "discord") {
    throw new Error("Channel must be stable, ptb, or canary");
}

const channel: InjectionChannel = requestedChannel === "discord" ? "stable" : requestedChannel;
const mode: InjectionMode = useBdRelease ? "release" : "dev";
const release = channel === "canary" ? "Discord Canary" : channel === "ptb" ? "Discord PTB" : "Discord";
const releaseDirectory = channel === "canary" ? "discordcanary" : channel === "ptb" ? "discordptb" : "discord";
const distPath = path.resolve(__dirname, "..", "dist");
const bundlePath = path.join(distPath, "betterdiscord.asar");

function latestVersionDirectory(basedir: string): string {
    const versions = fs.readdirSync(basedir)
        .filter(item => item.startsWith("app-") && fs.statSync(path.join(basedir, item)).isDirectory())
        .map(item => item.slice(4));
    if (!versions.length) throw new Error(`Discord requires the new updater; no app-* directory exists in ${basedir}`);
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

doSanityChecks(distPath);
if (!dryRun) buildPackage(distPath);
if (useBdRelease && !fs.existsSync(bundlePath)) {
    throw new Error("    ❌ File missing: betterdiscord.asar. Run `./local-build.zsh dist` before using release injection.");
}

let bdPath = useBdRelease ? bundlePath : distPath;
if (process.env.WSL_DISTRO_NAME) {
    const target = path.join(resources, "..", "..", "betterdiscord");
    bdPath = useBdRelease ? "../../../betterdiscord/betterdiscord.asar" : "../../../betterdiscord";
    if (dryRun) {
        console.log(`    [dry-run] Would copy BetterDiscord ${mode} files to ${target}`);
    }
    else if (useBdRelease) {
        fs.mkdirSync(target, {recursive: true});
        fs.copyFileSync(bundlePath, path.join(target, "betterdiscord.asar"));
    }
    else {
        copyFiles(distPath, target);
    }
}

console.log("");
console.log(`${dryRun ? "Dry-run for" : "Injecting into"} ${release}`);
console.log(`    ✅ Found resources in ${resources}`);

const marker = wrapInjection({
    resources,
    channel,
    mode,
    bdPath,
    helperRuntime: process.execPath,
    dryRun,
    log: message => console.log(`    ${dryRun ? "[dry-run] " : ""}${message}`),
});

if (!dryRun && process.platform === "darwin") {
    const recoveryDisabled = path.join(process.env.HOME!, "Library", "Application Support", releaseDirectory, "betterdiscord-bootstrap", "recovery-disabled");
    fs.rmSync(recoveryDisabled, {force: true});
}

console.log(`    ${dryRun ? "[dry-run] Would write" : "✅ Wrote"} ${path.join(resources, "app", ".betterdiscord-inject.json")}`);
console.log(`    Installation ID: ${marker.installationId}`);
console.log("");
console.log(dryRun ? `Dry-run complete; ${release} was not modified.` : `Injection successful, please restart ${release}.`);
