import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import {inspectInjection, loaderMarker, markerFilename, unwrapInjection, wrapInjection} from "../../scripts/helpers/injection";

describe("app wrapper injection", () => {
    let resources: string;

    beforeEach(() => {
        resources = fs.mkdtempSync(path.join(os.tmpdir(), "betterdiscord-injection-"));
    });

    afterEach(() => {
        fs.rmSync(resources, {recursive: true, force: true});
    });

    test("wraps and restores an ASAR without changing its bytes", () => {
        const payload = Buffer.from("openasar fixture");
        fs.writeFileSync(path.join(resources, "app.asar"), payload);

        const marker = wrapInjection({resources, channel: "stable", mode: "release", bdPath: "/fixture/betterdiscord.asar"});

        expect(marker.helperRuntime).toBeUndefined();
        expect(fs.existsSync(path.join(resources, "app.asar"))).toBe(false);
        expect(fs.readFileSync(path.join(resources, "betterdiscord.app.asar"))).toEqual(payload);
        expect(fs.readFileSync(path.join(resources, "app", "index.js"), "utf8")).toContain(loaderMarker);
        expect(JSON.parse(fs.readFileSync(path.join(resources, "app", markerFilename), "utf8"))).toEqual(marker);

        unwrapInjection(resources);
        expect(fs.readFileSync(path.join(resources, "app.asar"))).toEqual(payload);
        expect(fs.existsSync(path.join(resources, "app"))).toBe(false);
        expect(fs.existsSync(path.join(resources, "betterdiscord.app.asar"))).toBe(false);
    });

    test("reinjection is idempotent and retains its installation ID", () => {
        fs.writeFileSync(path.join(resources, "app.asar"), "payload");
        const first = wrapInjection({resources, channel: "ptb", mode: "dev", bdPath: "/fixture/dist"});
        const second = wrapInjection({resources, channel: "ptb", mode: "release", bdPath: "/fixture/betterdiscord.asar"});

        expect(second.installationId).toBe(first.installationId);
        expect(second.mode).toBe("release");
        expect(fs.readFileSync(path.join(resources, "app", "index.js"), "utf8")).toContain("/fixture/betterdiscord.asar");
        expect(inspectInjection(resources).kind).toBe("wrapped");
    });

    test("accepts a legacy Bun runtime marker but removes it on reinjection", () => {
        fs.writeFileSync(path.join(resources, "app.asar"), "payload");
        const marker = wrapInjection({resources, channel: "stable", mode: "release", bdPath: "/fixture/betterdiscord.asar"});
        const markerPath = path.join(resources, "app", markerFilename);
        fs.writeFileSync(markerPath, `${JSON.stringify({...marker, helperRuntime: "/old/bun"}, null, 4)}\n`);

        expect(inspectInjection(resources).kind).toBe("wrapped");
        const updated = wrapInjection({resources, channel: "stable", mode: "release", bdPath: "/fixture/betterdiscord.asar"});
        expect(updated.helperRuntime).toBeUndefined();
        expect(JSON.parse(fs.readFileSync(markerPath, "utf8")).helperRuntime).toBeUndefined();
    });

    test("dry-run performs no writes", () => {
        fs.writeFileSync(path.join(resources, "app.asar"), "payload");
        wrapInjection({resources, channel: "canary", mode: "release", bdPath: "/fixture/betterdiscord.asar", dryRun: true});

        expect(fs.readFileSync(path.join(resources, "app.asar"), "utf8")).toBe("payload");
        expect(fs.existsSync(path.join(resources, "app"))).toBe(false);
        expect(fs.existsSync(path.join(resources, "betterdiscord.app.asar"))).toBe(false);
    });

    test("refuses dual and foreign layouts", () => {
        fs.writeFileSync(path.join(resources, "app.asar"), "payload");
        fs.mkdirSync(path.join(resources, "app"));
        expect(() => wrapInjection({resources, channel: "stable", mode: "release", bdPath: "/fixture/betterdiscord.asar"})).toThrow("both Resources/app.asar and Resources/app exist");

        fs.rmSync(path.join(resources, "app.asar"));
        fs.writeFileSync(path.join(resources, "betterdiscord.app.asar"), "payload");
        expect(() => unwrapInjection(resources)).toThrow("wrapped payload exists without BetterDiscord metadata");
    });
});
