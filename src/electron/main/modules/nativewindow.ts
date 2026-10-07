import type {BrowserWindow} from "electron";
import {release} from "os";

export function supportsVibrancy(window: Pick<BrowserWindow, "setVibrancy">) {
    return process.platform === "darwin" && typeof window.setVibrancy === "function";
}

export function supportsBackgroundMaterial(window: Pick<BrowserWindow, "setBackgroundMaterial">) {
    if (process.platform !== "win32" || typeof window.setBackgroundMaterial !== "function") return false;

    // Electron requires Windows 11 22H2 (10.0.22621) or newer for this effect.
    try {
        const version = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(release());
        if (!version) return false;
        const [major, minor, build] = version.slice(1, 4).map(Number);
        if (![major, minor, build].every(Number.isSafeInteger)) return false;
        return major > 10 || (major === 10 && (minor > 0 || (minor === 0 && build >= 22621)));
    }
    catch {
        return false;
    }
}
