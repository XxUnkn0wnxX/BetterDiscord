import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import {findMatchingOpenAsarHandoff, type OpenAsarHandoffOptions} from "../../src/electron/main/macoshandoff";


describe("macOS OpenAsar handoff preservation", () => {
    const now = Date.parse("2026-07-16T09:41:49.000Z");
    const helperPid = 17847;
    let root: string;
    let options: OpenAsarHandoffOptions;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "betterdiscord-handoff-"));
        const targetAppPath = path.join(root, "Discord.app");
        const nestedTarget = path.join(targetAppPath, "Contents", "Resources", "betterdiscord.app.asar");
        const bootstrap = path.join(root, "betterdiscord-bootstrap");
        const openAsarBootstrap = path.join(root, "openasar-bootstrap");
        const readyPath = path.join(bootstrap, "wrapper-ready.json");
        const pendingPath = path.join(openAsarBootstrap, "post-shipit-update-pending.json");
        const helperPath = path.join(openAsarBootstrap, "post-shipit-helper.zsh");
        const helperPidPath = path.join(openAsarBootstrap, "post-shipit-helper.pid");
        const marker = {channel: "stable" as const, installationId: "test-installation"};
        const armedAt = "2026-07-16T09:41:35.547Z";

        fs.mkdirSync(bootstrap, {recursive: true});
        fs.mkdirSync(openAsarBootstrap, {recursive: true});
        fs.writeFileSync(helperPath, "#!/usr/bin/env -S zsh -f\n");
        fs.writeFileSync(helperPidPath, `${helperPid}\n`);
        fs.writeFileSync(pendingPath, `${JSON.stringify({
            pending: true,
            betterDiscordExpected: true,
            schema: 1,
            owner: "betterdiscord",
            style: "app-wrapper",
            channel: marker.channel,
            installationId: marker.installationId,
            appPath: targetAppPath,
            nestedTarget,
            armedAt,
            helperPid,
            helperPath,
            helperPidPath,
        }, null, 4)}\n`);
        fs.writeFileSync(readyPath, `${JSON.stringify({
            schema: 1,
            owner: "betterdiscord",
            style: "app-wrapper",
            channel: marker.channel,
            installationId: marker.installationId,
            appPath: targetAppPath,
            targetAppPath,
            nestedTarget,
            armedAt: "2026-07-16T09:41:46.000Z",
            readyAt: "2026-07-16T09:41:47.000Z",
        }, null, 4)}\n`);

        options = {
            marker,
            targetAppPath,
            nestedTarget,
            readyPath,
            pendingPath,
            helperPath,
            helperPidPath,
            now,
            processes: [{
                pid: helperPid,
                pgid: helperPid,
                command: `zsh -f ${helperPath} payload request staged target log console ${helperPidPath} legacy`,
            }],
            helperIsRunning: pid => pid === helperPid,
        };
    });

    afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

    test("preserves the validated ready handoff seen before OpenAsar terminates early Discord", () => {
        const readyBefore = fs.readFileSync(options.readyPath, "utf8");
        expect(findMatchingOpenAsarHandoff(options)).toEqual({
            helperPid,
            armedAt: "2026-07-16T09:41:35.547Z",
            readyAt: "2026-07-16T09:41:47.000Z",
        });
        expect(fs.readFileSync(options.readyPath, "utf8")).toBe(readyBefore);
    });

    test("rejects mismatched, stale, or unowned handoffs", () => {
        const pending = JSON.parse(fs.readFileSync(options.pendingPath, "utf8"));
        pending.installationId = "other-installation";
        fs.writeFileSync(options.pendingPath, JSON.stringify(pending));
        expect(findMatchingOpenAsarHandoff(options)).toBeNull();

        pending.installationId = options.marker.installationId;
        pending.armedAt = "2026-07-16T09:30:00.000Z";
        fs.writeFileSync(options.pendingPath, JSON.stringify(pending));
        expect(findMatchingOpenAsarHandoff(options)).toBeNull();

        pending.armedAt = "2026-07-16T09:41:35.547Z";
        fs.writeFileSync(options.pendingPath, JSON.stringify(pending));
        fs.writeFileSync(options.helperPidPath, "99999\n");
        expect(findMatchingOpenAsarHandoff(options)).toBeNull();

        fs.writeFileSync(options.helperPidPath, `${helperPid}\n`);
        options.processes = [{
            pid: helperPid,
            pgid: helperPid + 1,
            command: `zsh -f ${options.helperPath} payload ${options.helperPidPath}`,
        }];
        expect(findMatchingOpenAsarHandoff(options)).toBeNull();
    });
});
