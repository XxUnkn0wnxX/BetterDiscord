import fs from "fs";
import path from "path";

import {comparator, regex as semverRegex} from "./semver";


export interface DiscordResourcesCandidate {
    directoryName: string;
    directoryPath: string;
    resourcesPath: string;
    version: string;
    prefixed: boolean;
}

export function parseDiscordVersionDirectory(directoryName: string): {version: string; prefixed: boolean} | null {
    const prefixed = directoryName.startsWith("app-");
    const version = prefixed ? directoryName.slice(4) : directoryName;
    if (!semverRegex.test(version)) return null;
    return {version, prefixed};
}

function isDirectory(target: string): boolean {
    try {return fs.statSync(target).isDirectory();}
    catch {return false;}
}

function isFile(target: string): boolean {
    try {return fs.statSync(target).isFile();}
    catch {return false;}
}

function hasModernApplicationPayload(resourcesPath: string): boolean {
    if (!isDirectory(resourcesPath)) return false;
    return isFile(path.join(resourcesPath, "app.asar"))
        || isDirectory(path.join(resourcesPath, "app"))
        || isFile(path.join(resourcesPath, "betterdiscord.app.asar"))
        || isDirectory(path.join(resourcesPath, "betterdiscord.app"));
}

export function findLatestDiscordResources(baseDirectory: string): DiscordResourcesCandidate | null {
    let selected: DiscordResourcesCandidate | null = null;

    for (const directoryName of fs.readdirSync(baseDirectory)) {
        const parsed = parseDiscordVersionDirectory(directoryName);
        if (!parsed) continue;

        const directoryPath = path.join(baseDirectory, directoryName);
        if (!isDirectory(directoryPath)) continue;
        const resourcesPath = path.join(directoryPath, "resources");
        if (!hasModernApplicationPayload(resourcesPath)) continue;

        const candidate: DiscordResourcesCandidate = {
            directoryName,
            directoryPath,
            resourcesPath,
            version: parsed.version,
            prefixed: parsed.prefixed,
        };
        if (!selected) {
            selected = candidate;
            continue;
        }

        const comparison = comparator(selected.version, candidate.version);
        if (comparison === 1 || (comparison === 0 && candidate.prefixed && !selected.prefixed)) selected = candidate;
    }

    return selected;
}
