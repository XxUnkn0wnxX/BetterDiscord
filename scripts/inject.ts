const args = process.argv;
import fs from "fs";
import path from "path";
import bun from "bun";

import doSanityChecks from "./helpers/validate";
import buildPackage from "./helpers/package";
import copyFiles from "./helpers/copy";

const useBdRelease = args[2] && args[2].toLowerCase() === "release";
const releaseInput = useBdRelease ? args[3] && args[3].toLowerCase() : args[2] && args[2].toLowerCase();
const release = releaseInput === "canary" ? "Discord Canary" : releaseInput === "ptb" ? "Discord PTB" : "Discord";
const bdPath = useBdRelease ? path.resolve(__dirname, "..", "dist", "betterdiscord.asar") : path.resolve(__dirname, "..", "dist");

function compareVersions(left: string, right: string) {
    const leftParts = left.split(".").map(part => Number.parseInt(part, 10) || 0);
    const rightParts = right.split(".").map(part => Number.parseInt(part, 10) || 0);
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index++) {
        const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (diff !== 0) return diff;
    }

    return 0;
}

function getPreferredVersionDirectory(basedir: string) {
    return fs.readdirSync(basedir)
        .filter(entry => {
            const entryPath = path.join(basedir, entry);
            return fs.lstatSync(entryPath).isDirectory() && entry.split(".").length > 1;
        })
        .sort((left, right) => {
            const leftVersion = left.startsWith("app-") ? left.slice(4) : left;
            const rightVersion = right.startsWith("app-") ? right.slice(4) : right;
            const versionCompare = compareVersions(rightVersion, leftVersion);
            if (versionCompare !== 0) return versionCompare;

            if (left.startsWith("app-") !== right.startsWith("app-")) {
                return left.startsWith("app-") ? -1 : 1;
            }

            return right.localeCompare(left);
        })[0];
}

function resolveDesktopCore(modulesPath: string) {
    if (!fs.existsSync(modulesPath)) return "";

    const wrappedCore = fs.readdirSync(modulesPath)
        .filter(entry => entry.indexOf("discord_desktop_core-") === 0)
        .sort()
        .reverse()[0];

    const candidates = [
        wrappedCore && path.join(modulesPath, wrappedCore, "discord_desktop_core"),
        path.join(modulesPath, "discord_desktop_core")
    ].filter(Boolean) as string[];

    return candidates.find(candidate => fs.existsSync(candidate)) ?? "";
}

const discordPath = await (async function () {
    let resourcePath = "";
    if (process.platform === "win32") {
        const basedir = path.join(process.env.LOCALAPPDATA!, release.replace(/ /g, ""));
        if (!fs.existsSync(basedir)) throw new Error(`Cannot find directory for ${release}`);
        const version = getPreferredVersionDirectory(basedir);
        resourcePath = resolveDesktopCore(path.join(basedir, version, "modules"));
    }
    else if (process.env.WSL_DISTRO_NAME) {
        const appdata = (await bun.$`wslpath "$(cmd.exe /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r')"`.text()).trim();
        const basedir = path.join(appdata, release.replace(/ /g, ""));
        if (!fs.existsSync(basedir)) throw new Error(`Cannot find directory for ${release}`);
        const version = getPreferredVersionDirectory(basedir);
        resourcePath = resolveDesktopCore(path.join(basedir, version, "modules"));
    }
    else {
        let userData = process.env.XDG_CONFIG_HOME ? process.env.XDG_CONFIG_HOME : path.join(process.env.HOME!, ".config");
        if (process.platform === "darwin") userData = path.join(process.env.HOME!, "Library", "Application Support");
        const basedir = path.join(userData, release.toLowerCase().replace(" ", ""));
        if (!fs.existsSync(basedir)) return "";
        const version = getPreferredVersionDirectory(basedir);
        if (!version) return "";
        resourcePath = resolveDesktopCore(path.join(basedir, version, "modules"));
    }

    if (fs.existsSync(resourcePath)) return resourcePath;
    return "";
})();

doSanityChecks(bdPath);
buildPackage(bdPath);
console.log("");

console.log(`Injecting into ${release}`);
if (!fs.existsSync(discordPath)) throw new Error(`Cannot find directory for ${release}`);
console.log(`    ✅ Found ${release} in ${discordPath}`);

const indexJs = path.join(discordPath, "index.js");
if (fs.existsSync(indexJs)) fs.unlinkSync(indexJs);
if (process.env.WSL_DISTRO_NAME) {
    copyFiles(bdPath, path.join(discordPath, "betterdiscord"));
    fs.writeFileSync(indexJs, `require("./betterdiscord");\nmodule.exports = require("./core.asar");`);
}
else {
    fs.writeFileSync(indexJs, `require("${bdPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}");\nmodule.exports = require("./core.asar");`);
}

console.log("    ✅ Wrote index.js");
console.log("");

console.log(`Injection successful, please restart ${release}.`);
