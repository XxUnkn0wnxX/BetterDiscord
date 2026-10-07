import {describe, expect, test} from "bun:test";
import {spawnSync} from "child_process";
import path from "path";

function run(scenario: Record<string, unknown>) {
    const result = spawnSync(process.execPath, [path.join(import.meta.dir, "nativewindow-harness.ts"), JSON.stringify(scenario)], {
        cwd: path.resolve(import.meta.dir, "../.."),
        encoding: "utf8",
        env: {...process.env, BETTERDISCORD_IN_APP_TRAFFIC_LIGHTS: undefined},
    });
    expect(result.status, result.stderr).toBe(0);
}

describe("native window registered IPC", () => {
    test("applies macOS vibrancy before transparency with upstream animation options", () => {
        run({mode: "ipc", request: "vibrancy", value: "sidebar", applies: true});
    });
    test("supports both upstream none and null vibrancy resets", () => {
        for (const value of ["none", null]) run({mode: "ipc", request: "vibrancy", value, applies: true});
    });
    test("does not change the background after a thrown vibrancy call", () => {
        run({"mode": "ipc", "request": "vibrancy", "value": "sidebar", "throws": true});
    });
    test("skips vibrancy on a missing method and other platforms", () => {
        run({mode: "ipc", request: "vibrancy", value: "sidebar", missing: "vibrancy"});
        for (const platform of ["win32", "linux"]) run({mode: "ipc", request: "vibrancy", value: "sidebar", platform});
    });
    test("supports Windows 11 22H2 and newer materials, including none reset", () => {
        for (const release of ["10.0.22621", "10.0.22621.1", "10.0.26100", "11.0.1"]) {
            for (const value of ["mica", "none"]) run({mode: "ipc", platform: "win32", request: "material", release, value, applies: true});
        }
    });
    test("fails closed below the OS floor and on unparseable OS releases", () => {
        for (const release of ["10.0.22620", "10.0.19045", "6.3.9600", "unknown", "10.0.22621-beta", "10.0", "99999999999999999999.0.0"]) {
            run({mode: "ipc", platform: "win32", request: "material", release, value: "mica"});
        }
    });
    test("skips material on missing methods and non-Windows platforms without reading OS release", () => {
        run({mode: "ipc", platform: "win32", request: "material", value: "mica", missing: "material"});
        for (const platform of ["darwin", "linux"]) run({mode: "ipc", platform, request: "material", value: "mica"});
    });
    test("does not change the background after a thrown material call", () => {
        run({"mode": "ipc", "platform": "win32", "request": "material", "value": "mica", "throws": true});
    });
    test("ignores missing and destroyed native effect windows", () => {
        for (const target of ["null", "destroyed"]) {
            run({mode: "ipc", request: "vibrancy", value: "sidebar", target});
            run({mode: "ipc", platform: "win32", request: "material", value: "mica", target});
        }
    });
    test("bypasses the instance minimum-size override and applies the macOS floor", () => {
        run({mode: "ipc", request: "minimum"});
        run({mode: "ipc", request: "minimum", dimensions: [800, 500]});
        run({mode: "ipc", platform: "win32", request: "minimum"});
    });
    test("ignores missing and destroyed minimum-size windows", () => {
        for (const target of ["null", "destroyed"]) run({mode: "ipc", request: "minimum", target});
    });
    test("preserves safe web preferences and strips renderer-supplied preload", () => run({mode: "security"}));
});

describe("native constructor and preload paths", () => {
    test("applies macOS native options and preserves original-preload locking", () => {
        run({mode: "constructor", effect: "vibrancy", settings: {vibrancy: "sidebar", acceptFirstMouse: true, roundedCorners: false}});
        run({mode: "constructor", effect: "vibrancy", settings: {vibrancy: "sidebar", visualEffectState: "active"}});
    });
    test("sets the upstream native title bar and deletes custom traffic-light positions", () => {
        run({mode: "constructor", nativeFrame: true, settings: {frame: true, removeMinimumSize: true}});
    });
    test("passes supported Windows background material through constructor options", () => {
        for (const backgroundMaterial of ["mica", "none"]) {
            run({mode: "constructor", platform: "win32", effect: "material", settings: {backgroundMaterial, roundedCorners: false, acceptFirstMouse: true}});
        }
    });
    test("keeps ordinary constructor backgrounds when effects are unsupported", () => {
        run({mode: "constructor", missing: "vibrancy", settings: {vibrancy: "sidebar"}});
        run({mode: "constructor", settings: {vibrancy: "none"}});
        for (const release of ["10.0.22620", "unknown"]) {
            run({mode: "constructor", platform: "win32", release, settings: {backgroundMaterial: "mica"}});
        }
        run({mode: "constructor", platform: "win32", missing: "material", settings: {backgroundMaterial: "mica"}});
        run({mode: "constructor", platform: "linux", settings: {vibrancy: "sidebar", backgroundMaterial: "mica", acceptFirstMouse: true, roundedCorners: false}});
    });
    test("retains explicit transparency independently of native effect support", () => {
        run({mode: "constructor", missing: "vibrancy", transparency: true, settings: {transparency: true, vibrancy: "sidebar"}});
        run({mode: "constructor", platform: "win32", release: "10.0.19045", transparency: true, settings: {transparency: true, backgroundMaterial: "mica"}});
        run({mode: "constructor", settings: {transparency: "true"}});
    });
    test("preserves Discord's traffic-light flag and DevTools callback ownership", () => {
        for (const platform of ["darwin", "win32"]) run({mode: "preload", platform});
    });
    test("uses upstream 800x500 application minimum and preserves removal", () => {
        run({mode: "appSettings"});
        run({mode: "appSettings", settings: {removeMinimumSize: true}});
    });
});
