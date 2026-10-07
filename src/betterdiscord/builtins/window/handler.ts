import Builtin from "@structs/builtin";

import IPC from "@modules/ipc";
import settings from "@stores/settings";
import type {BrowserWindow} from "electron";
import Modals from "@ui/modals";
import {t} from "@common/i18n";

export default new class ExtraWindowHandlers extends Builtin {
    private handlersInitialized = false;

    get name() {return "ExtraWindowHandlers";}
    get category() {return "window";}

    async initialize() {
        if (this.handlersInitialized) return;
        this.handlersInitialized = true;

        const on = <T>(key: string, callback: (value: T) => void) => settings.on<T>(this.collection, this.category, key, callback);

        on<Parameters<BrowserWindow["setVibrancy"]>[0] | "none">("vibrancy", (value) => {
            void IPC.setVibrancy(value).catch(error => this.stacktrace("Failed to set window vibrancy", error as Error));
        });
        on<Parameters<BrowserWindow["setBackgroundMaterial"]>[0]>("backgroundMaterial", (value) => {
            void IPC.setBackgroundMaterial(value).catch(error => this.stacktrace("Failed to set window background material", error as Error));
        });
        on("visualEffectState", () => this.showModal());
        on("acceptFirstMouse", () => this.showModal());
        on("roundedCorners", () => this.showModal());

        await super.initialize();
    }

    showModal() {
        Modals.showConfirmationModal(t("Modals.additionalInfo"), t("Modals.restartPrompt"), {
            confirmText: t("Modals.restartNow"),
            cancelText: t("Modals.restartLater"),
            danger: true,
            onConfirm: () => IPC.relaunch()
        });
    }
};
