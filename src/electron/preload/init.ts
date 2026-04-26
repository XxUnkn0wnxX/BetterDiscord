import fs from "fs";
import path from "path";
import Module from "module";
import {ipcRenderer as IPC} from "electron";
import * as IPCEvents from "@common/constants/ipcevents";

type ResolveFilename = (request: string, parent?: NodeJS.Module, isMain?: boolean, options?: unknown) => string;

type NodeModuleResolver = typeof Module & {
    _resolveFilename: ResolveFilename;
};

let restoreDiscordModuleResolution: (() => void) | undefined;

function isBareDiscordNativeModule(request: string) {
    return request.startsWith("discord_") && !request.startsWith("./") && !request.startsWith("../") && !path.isAbsolute(request) && !request.includes("/");
}

function isFromActiveDiscordVersion(parent: NodeJS.Module | undefined, activeVersionPath: string) {
    const filename = parent?.filename;
    if (!filename) return false;

    const relativeFilename = path.relative(activeVersionPath, filename);
    return relativeFilename !== "" && !relativeFilename.startsWith("..") && !path.isAbsolute(relativeFilename);
}

function patchDiscordModuleResolution(preload: string) {
    if (restoreDiscordModuleResolution || process.platform !== "darwin") return;

    const userData = process.env.DISCORD_USER_DATA;
    if (!userData) return;

    const relativePreload = path.relative(userData, preload);
    if (!relativePreload || relativePreload.startsWith("..") || path.isAbsolute(relativePreload)) return;

    const [versionDirectory] = relativePreload.split(path.sep);
    if (!versionDirectory?.startsWith("app-")) return;

    const activeVersionPath = path.join(userData, versionDirectory);
    const activeModulesPath = path.join(activeVersionPath, "modules");
    const legacyModulesPath = path.join(userData, versionDirectory.slice(4), "modules");
    if (!fs.existsSync(legacyModulesPath)) return;

    const nodeModule = Module as NodeModuleResolver;
    const originalResolveFilename = nodeModule._resolveFilename;

    const patchedResolveFilename: ResolveFilename = function (request, parent, isMain, options) {
        try {
            return originalResolveFilename.call(nodeModule, request, parent, isMain, options);
        }
        catch (error) {
            if (!isBareDiscordNativeModule(request)) throw error;
            if (!isFromActiveDiscordVersion(parent, activeVersionPath)) throw error;

            const activeModulePath = path.join(activeModulesPath, request);
            const legacyModulePath = path.join(legacyModulesPath, request);
            if (fs.existsSync(activeModulePath) || !fs.existsSync(legacyModulePath)) throw error;

            return originalResolveFilename.call(nodeModule, legacyModulePath, parent, isMain, options);
        }
    };

    nodeModule._resolveFilename = patchedResolveFilename;

    restoreDiscordModuleResolution = () => {
        if (nodeModule._resolveFilename === patchedResolveFilename) nodeModule._resolveFilename = originalResolveFilename;
        restoreDiscordModuleResolution = undefined;
    };

    // Keep the fallback for Discord's preload-created native module loader, but restore it when this window unloads.
    globalThis.addEventListener?.("unload", restoreDiscordModuleResolution, {once: true});
}

export default function () {
    // Load Discord's original preload
    const preload = process.env.BD_DISCORD_PRELOAD;
    if (preload) {

        // Restore original preload for future windows
        IPC.send(IPCEvents.REGISTER_PRELOAD, preload);
        // Run original preload
        patchDiscordModuleResolution(preload);
        const originalKill = process.kill;
        try {
            process.kill = function (_: number, __?: string | number | undefined) {return true;};
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require(preload);
        }
        catch (error) {
            // eslint-disable-next-line no-console
            console.error("BetterDiscord failed to load Discord's original preload.", error);
        }
        finally {
            process.kill = originalKill;
        }
    }
}
