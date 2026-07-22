import path from "path";

import Logger from "@common/logger";

import Config from "@stores/config";

import {comparator as semverComparator} from "@common/semver";

import Events from "./emitter";
import IPC from "./ipc";
import {t} from "@common/i18n";
import JsonStore from "@stores/json";
import React from "./react";
import SettingsStore from "@stores/settings";
import Notifications from "@ui/notifications";
import Modals from "@ui/modals";
import UpdaterPanel from "@ui/updater";
import type {Release} from "@typed/github";
import {Logo} from "@ui/logo";
import {RefreshCcwIcon} from "lucide-react";
import {fetch} from "./net";
import {AddonUpdateCoordinator, PluginUpdater, ThemeUpdater} from "./addonupdater";

export {AddonUpdater, PluginUpdater, ThemeUpdater} from "./addonupdater";

export default class Updater {
    static initialize() {
        // TODO: get rid of element creation
        SettingsStore.registerPanel("updates", t("Panels.updates"), {
            order: 1,
            icon: RefreshCcwIcon,
            element: () => {
                return React.createElement(UpdaterPanel, {
                    coreUpdater: CoreUpdater,
                    pluginUpdater: PluginUpdater,
                    themeUpdater: ThemeUpdater
                });
            }
        });

        AddonUpdateCoordinator.initialize();
        CoreUpdater.initialize();
        PluginUpdater.initialize();
        ThemeUpdater.initialize();

        Events.on("setting-updated", (collection, category, id) => {
            if (collection !== "settings" || category !== "addons") return;
            if (id !== "updateInterval" && id !== "checkForUpdates") return;
            this.startUpdateInterval();
        });

        // This function will already check the setting
        this.startUpdateInterval();
    }

    static startUpdateInterval() {
        // Fork behavior: the dynamic one-shot scheduler handles only plugin/theme checks. BetterDiscord
        // core startup, scheduled, and manual checks stay disabled; the dormant calls remain commented.
        // CoreUpdater.checkForUpdate();
        AddonUpdateCoordinator.configureSchedule();
    }
}
export class CoreUpdater {

    static hasUpdate = false;
    static apiData: Release;
    static remoteVersion = "";

    static async initialize() {
        // Fork behavior: BetterDiscord core checks stay disabled at startup, on the scheduler,
        // and from the Updates-panel refresh. Preserve the implementation for future review.
        // if (!SettingsStore.get("addons", "checkForUpdates")) return;
        // this.checkForUpdate();
    }

    static async checkForStable(ignoreVersion = false) {
        const resp = await fetch(`https://api.github.com/repos/BetterDiscord/BetterDiscord/releases/latest`, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "BetterDiscord Updater"
            }
        });

        const data: Release = await resp.json();
        const remoteVersion = data.tag_name.startsWith("v") ? data.tag_name.slice(1) : data.tag_name;
        this.hasUpdate = ignoreVersion || semverComparator(Config.get("version"), remoteVersion) > 0;
        this.remoteVersion = remoteVersion;
        this.apiData = data;
    }

    static async checkForCanary(ignoreVersion = false) {
        const resp = await fetch(`https://api.github.com/repos/BetterDiscord/BetterDiscord/releases`, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "BetterDiscord Updater"
            }
        });

        const releases: Release[] = await resp.json();
        const data = releases.find(r => r.prerelease && r.tag_name === "canary");
        const asset = data?.assets.find(a => a.name === "betterdiscord.asar");
        if (!data || !asset) {
            this.hasUpdate = false;
            this.remoteVersion = "";
            return;
        }

        let canaryUpdated: string | Date = JsonStore.get("misc", "canaryUpdated") as string;
        let remoteVersion = asset.updated_at;
        try {
            if (canaryUpdated) canaryUpdated = new Date(canaryUpdated);
            else canaryUpdated = new Date(0);
            remoteVersion = new Date(remoteVersion);
        }
        catch {
            return;
        }
        this.hasUpdate = ignoreVersion || (remoteVersion > canaryUpdated);
        this.remoteVersion = remoteVersion.toISOString();
        this.apiData = data;
    }

    static async checkForUpdate(showNotice = true) {
        if (Config.isDevelopment) return; // Don't run updater on development build
        const isOnCanary = Config.isCanary;
        const isCanaryEnabled = SettingsStore.get("developer", "canary");

        /*
         * If canary is enabled, then check for canary update.
         * But if the user is not already on canary, then pass
         * a flag to ignore the remote version.
         *
         * Otherwise canary is disabled, check for stable update.
         * But if the user is already on canary, then pass a
         * flag to ignore remove version.
         */
        if (isCanaryEnabled) await this.checkForCanary(!isOnCanary);
        else await this.checkForStable(isOnCanary);

        if (!this.hasUpdate || !showNotice) return;

        Notifications.show({
            id: "BD-core-update",
            title: t("Updater.updateAvailable", {version: this.remoteVersion}),
            type: "warning",
            icon: () => React.createElement(Logo, {size: 16, accent: true}),
            duration: Infinity,
            actions: [
                {
                    label: t("Updater.updateButton"),
                    onClick: () => this.update()
                }
            ]
        });
    }

    static async update() {
        try {
            const asar = this.apiData.assets.find(a => a.name === "betterdiscord.asar");
            if (!asar) return;

            const response = await fetch(asar.url, {
                headers: {
                    "Content-Type": "application/octet-stream",
                    "User-Agent": "BetterDiscord Updater",
                    "Accept": "application/octet-stream"
                },
                timeout: 30000
            });

            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            const buff = new Uint8Array(await response.arrayBuffer());

            const asarPath = path.join(Config.get("dataPath"), "betterdiscord.asar");
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fs = require("original-fs");
            fs.writeFileSync(asarPath, buff);

            this.hasUpdate = false;

            // For canary, save the last updated data. For stable, overwrite the current version to prevent further updates
            if (SettingsStore.get("developer", "canary")) JsonStore.set("misc", "canaryUpdated", this.remoteVersion);
            else Config.set("version", this.remoteVersion);

            Modals.showConfirmationModal(t("Updater.updateSuccessful"), t("Modals.restartPrompt"), {
                confirmText: t("Modals.restartNow"),
                cancelText: t("Modals.restartLater"),
                danger: true,
                onConfirm: () => IPC.relaunch()
            });
        }
        catch (err) {
            Logger.stacktrace("Updater", "Failed to update", err as Error);
            Modals.showConfirmationModal(t("Updater.updateFailed"), t("Updater.updateFailedMessage"), {
                cancelText: null
            });
        }
    }
}
