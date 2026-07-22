import Config from "@stores/config";
import Toasts from "@stores/toasts";

import React, {type MouseEvent, type ReactNode} from "react";
import {t} from "@common/i18n";
import Events from "@modules/emitter";
import DiscordModules from "@modules/discordmodules";

import Button from "@ui/base/button";
import Drawer from "@ui/settings/drawer";
import SettingItem from "@ui/settings/components/item";
import SettingsTitle from "@ui/settings/title";

import {ArrowDownToLineIcon, CheckIcon, RefreshCwIcon, RotateCwIcon} from "lucide-react";
import type {CoreUpdater, ThemeUpdater, PluginUpdater, AddonUpdater} from "@modules/updater";
import {AddonUpdateCoordinator} from "@modules/addonupdater";
import {SettingsTitleContext} from "./settings";


const {useState, useCallback, useEffect} = React;

interface ButtonOptions {
    size?: typeof Button.Sizes[keyof typeof Button.Sizes];
    look?: typeof Button.Looks[keyof typeof Button.Looks];
    color?: typeof Button.Colors[keyof typeof Button.Colors];
    className?: string;
    stopAnimation?: boolean;
}
function makeButton(tooltip: string, children: ReactNode, action: () => Promise<void>, options: ButtonOptions = {}) {
    const {size = Button.Sizes.ICON, look = Button.Looks.BLANK, color = Button.Colors.TRANSPARENT, className = "", stopAnimation = false} = options;

    const onClick = async (event: MouseEvent) => {
        const button = event.currentTarget.closest("button")!;
        button.classList.add("animate");
        try {
            await action();
        }
        finally {
            // Fork review: failed updates remain visible, so always release their spinner. The
            // manual refresh keeps the upstream minimum cycle before its spinner is removed.
            if (stopAnimation) await new Promise(r => setTimeout(r, 500));
            button?.classList?.remove("animate"); // Stop animation if it hasn't been removed from the DOM
        }
    };

    return <DiscordModules.Tooltip color="primary" position="top" text={tooltip}>
        {(props) => <Button {...props} aria-label={tooltip} className={`bd-update-button ${className}`} size={size} look={look} color={color} onClick={onClick}>{children}</Button>}
    </DiscordModules.Tooltip>;
}

function CoreUpdaterPanel({hasUpdate, remoteVersion, update}: {hasUpdate: boolean; remoteVersion: string; update: () => Promise<void>;}) {
    return <Drawer name="BetterDiscord" collapsible={true}>
        <SettingItem name={`Core v${Config.get("version")}`} note={hasUpdate ? t("Updater.versionAvailable", {version: remoteVersion}) : t("Updater.noUpdatesAvailable")} inline={true} id={"core-updater"}>
            {!hasUpdate && <div className="bd-filled-checkmark"><CheckIcon size="18px" /></div>}
            {hasUpdate && makeButton(t("Updater.updateButton"), <ArrowDownToLineIcon />, update, {className: "no-animation"})}
        </SettingItem>
    </Drawer>;
}

function NoUpdates({type}: {type: "plugins" | "themes";}) {
    return <div className="bd-empty-updates">
        <CheckIcon size="48px" />
        {t("Updater.upToDateBlankslate", {context: type.slice(0, -1)})}
    </div>;
}

function AddonUpdaterPanel({pending: filenames, type, updater, update, updateAll}: {pending: string[]; type: "plugins" | "themes"; updater: AddonUpdater; update: (at: "plugins" | "themes", f: string) => Promise<void>; updateAll: (at: "plugins" | "themes") => Promise<void>;}) {
    return <Drawer
        name={t(`Panels.${type}`)}
        collapsible={true}
        titleChildren={filenames.length > 1 ? makeButton(t("Updater.updateAll"), <RotateCwIcon size="20px" />, () => updateAll(type)) : null}>
        {!filenames.length && <NoUpdates type={type} />}
        {filenames.map(filename => {
            const info = updater.getUpdateCandidate(filename);
            const addon = updater.manager.addonList.find(a => a.filename === filename);

            if (!info || !addon) return null;

            return <SettingItem key={addon.filename} name={`${addon.name} v${addon.version}`} note={t("Updater.versionAvailable", {version: info.version})} inline={true} id={addon.name}>
                {makeButton(t("Updater.updateButton"), <RotateCwIcon />, () => update(type, filename))}
                {/* <Button size={Button.Sizes.SMALL} onClick={() => update(type, filename)}>{t("Updater.updateButton")}</Button> */}
            </SettingItem>;
        })}
    </Drawer>;
}

export default function UpdaterPanel({coreUpdater, pluginUpdater, themeUpdater}: {coreUpdater: typeof CoreUpdater; pluginUpdater: typeof PluginUpdater; themeUpdater: typeof ThemeUpdater;}) {
    const [hasCoreUpdate, setCoreUpdate] = useState(coreUpdater.hasUpdate);
    const [updates, setUpdates] = useState({plugins: pluginUpdater.pending.slice(0), themes: themeUpdater.pending.slice(0)});

    const refreshState = useCallback(() => {
        setUpdates({
            plugins: pluginUpdater.pending.slice(0),
            themes: themeUpdater.pending.slice(0)
        });
    }, [pluginUpdater, themeUpdater]);

    useEffect(() => {
        // Fork review: addon lifecycle events update this panel only. The coordinator owns its
        // targeted debounce so mounting the UI cannot create duplicate full network batches.
        Events.on("addon-updates-changed", refreshState);
        return () => {
            Events.off("addon-updates-changed", refreshState);
        };
    }, [refreshState]);

    // Fork behavior: retain the dormant manual core helper for future review, but keep it
    // commented alongside its invocation below so addon refreshes cannot contact upstream.
    // const checkCoreUpdate = useCallback(async () => {
    //     await coreUpdater.checkForUpdate(false);
    //     setCoreUpdate(coreUpdater.hasUpdate);
    // }, [coreUpdater]);

    const checkForUpdates = useCallback(async () => {
        Toasts.info(t("Updater.checking"));
        // Fork behavior: the literal button checks plugins/themes only. Keep the core call beside
        // the manual path for future review, but disabled just like startup and scheduled checks.
        await AddonUpdateCoordinator.checkManually();
        // await checkCoreUpdate();
        refreshState();
        Toasts.info(t("Updater.finishedChecking"));
    }, [refreshState]);

    const updateCore = useCallback(async () => {
        await coreUpdater.update();
        setCoreUpdate(false);
    }, [coreUpdater]);

    const updateAddon = useCallback(async (type: "plugins" | "themes", filename: string) => {
        const updater = type === "plugins" ? pluginUpdater : themeUpdater;
        const succeeded = await updater.updateAddon(filename);
        if (!succeeded) return;

        // Fork review: only a confirmed download+write may remove the row. Return a new object and
        // list so React rerenders, and never let index -1 remove an unrelated final update.
        setUpdates(previous => {
            if (!previous[type].includes(filename)) return previous;
            return {...previous, [type]: previous[type].filter(pending => pending !== filename)};
        });
    }, [pluginUpdater, themeUpdater]);

    const updateAllAddons = useCallback(async (type: "plugins" | "themes") => {
        const toUpdate = updates[type].slice(0);
        const updater = type === "plugins" ? pluginUpdater : themeUpdater;
        await updater.updateAll(toUpdate);
        refreshState();
    }, [pluginUpdater, refreshState, themeUpdater, updates]);

    const set = React.useContext(SettingsTitleContext);

    return [
        set(
            <SettingsTitle text={t("Panels.updates")}>
                {makeButton(t("Updater.checkForUpdates"), <RefreshCwIcon />, checkForUpdates, {className: "bd-update-check", stopAnimation: true})}
            </SettingsTitle>
        ),
        <CoreUpdaterPanel remoteVersion={coreUpdater.remoteVersion} hasUpdate={hasCoreUpdate} update={updateCore} />,
        <AddonUpdaterPanel type="plugins" pending={updates.plugins} update={updateAddon} updateAll={updateAllAddons} updater={pluginUpdater} />,
        <AddonUpdaterPanel type="themes" pending={updates.themes} update={updateAddon} updateAll={updateAllAddons} updater={themeUpdater} />,
    ];
}
