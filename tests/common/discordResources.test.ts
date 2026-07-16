import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import {findLatestDiscordResources, parseDiscordVersionDirectory} from "@common/discordResources";


describe("Discord application resources", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "betterdiscord-resources-"));
    });

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true});
    });

    function addVersion(name: string, artifact: "app.asar" | "app" | "wrapped" | "desktop-core" = "app.asar") {
        const version = path.join(root, name);
        const resources = path.join(version, "resources");
        fs.mkdirSync(resources, {recursive: true});
        if (artifact === "app.asar") {
            fs.writeFileSync(path.join(resources, "app.asar"), "payload");
        }
        else if (artifact === "app") {
            fs.mkdirSync(path.join(resources, "app"));
        }
        else if (artifact === "wrapped") {
            fs.mkdirSync(path.join(resources, "app"));
            fs.writeFileSync(path.join(resources, "betterdiscord.app.asar"), "payload");
        }
        else {
            fs.mkdirSync(path.join(version, "modules", "discord_desktop_core"), {recursive: true});
        }
        return resources;
    }

    test("parses prefixed and plain semantic version directories", () => {
        expect(parseDiscordVersionDirectory("app-0.0.401")).toEqual({version: "0.0.401", prefixed: true});
        expect(parseDiscordVersionDirectory("0.0.401")).toEqual({version: "0.0.401", prefixed: false});
        expect(parseDiscordVersionDirectory("app-current")).toBeNull();
    });

    test("selects the newest usable directory across both naming styles", () => {
        addVersion("app-0.0.399");
        const expected = addVersion("0.0.401");
        addVersion("app-0.0.400");

        expect(findLatestDiscordResources(root)?.resourcesPath).toBe(expected);
    });

    test("prefers app-* when both names have the same version", () => {
        addVersion("0.0.401");
        const expected = addVersion("app-0.0.401");

        expect(findLatestDiscordResources(root)?.resourcesPath).toBe(expected);
    });

    test("ignores newer desktop-core-only layouts", () => {
        const expected = addVersion("app-0.0.400", "wrapped");
        addVersion("0.0.401", "desktop-core");

        expect(findLatestDiscordResources(root)?.resourcesPath).toBe(expected);
    });

    test("accepts unpacked applications and returns null without a modern payload", () => {
        const expected = addVersion("0.0.400", "app");
        expect(findLatestDiscordResources(root)?.resourcesPath).toBe(expected);

        fs.rmSync(root, {recursive: true, force: true});
        fs.mkdirSync(root);
        addVersion("0.0.401", "desktop-core");
        expect(findLatestDiscordResources(root)).toBeNull();
    });
});
