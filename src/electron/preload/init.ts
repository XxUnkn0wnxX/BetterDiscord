import fs from "fs";
import path from "path";
import Module from "module";
import {ipcRenderer as IPC} from "electron";
import * as IPCEvents from "@common/constants/ipcevents";

type NodeModuleResolver = typeof Module & {
    _resolveFilename: (request: string, parent?: NodeJS.Module, isMain?: boolean, options?: unknown) => string;
};

let hasPatchedDiscordModuleResolution = false;

function patchDiscordModuleResolution(preload: string) {
    if (hasPatchedDiscordModuleResolution || process.platform !== "darwin") return;

    const userData = process.env.DISCORD_USER_DATA;
    if (!userData) return;

    const relativePreload = path.relative(userData, preload);
    if (!relativePreload || relativePreload.startsWith("..") || path.isAbsolute(relativePreload)) return;

    const [versionDirectory] = relativePreload.split(path.sep);
    if (!versionDirectory?.startsWith("app-")) return;

    const activeModulesPath = path.join(userData, versionDirectory, "modules");
    const legacyModulesPath = path.join(userData, versionDirectory.slice(4), "modules");
    if (!fs.existsSync(legacyModulesPath)) return;

    const nodeModule = Module as NodeModuleResolver;
    const originalResolveFilename = nodeModule._resolveFilename.bind(nodeModule);

    nodeModule._resolveFilename = function (request, parent, isMain, options) {
        try {
            return originalResolveFilename(request, parent, isMain, options);
        }
        catch (error) {
            if (!request.startsWith("discord_")) throw error;
            if (request.startsWith("./") || request.startsWith("../") || path.isAbsolute(request) || request.includes("/")) throw error;

            const activeModulePath = path.join(activeModulesPath, request);
            const legacyModulePath = path.join(legacyModulesPath, request);
            if (fs.existsSync(activeModulePath) || !fs.existsSync(legacyModulePath)) throw error;

            return originalResolveFilename(legacyModulePath, parent, isMain, options);
        }
    };

    hasPatchedDiscordModuleResolution = true;
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
