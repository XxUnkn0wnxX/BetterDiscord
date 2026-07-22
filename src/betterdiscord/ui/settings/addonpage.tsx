import React from "react";
import AddonStorePage from "./addonstore";
import AddonList from "./addonlist";
import Settings from "@stores/settings";
import {addonContext} from "./addonshared";
import type AddonManager from "@modules/addonmanager";

const {useState, useCallback, useEffect} = React;

export default function AddonPage(props: {title: string; store: AddonManager;}) {
    // If 0 addons installed open the store automatically
    const [showStore, setShowStore] = useState(() => Settings.get<boolean>("settings", "store", "bdAddonStore") && !props.store.addonList.length);

    const toggleStore = useCallback(() => setShowStore((v: boolean) => !v), []);

    useEffect(() => {
        if (!showStore) return;

        // Fork review: Discord does not remount an already-selected settings page.
        // Treat reselecting Plugins/Themes as the Store breadcrumb's back action.
        const sidebarItem = `settings-sidebar___betterdiscord_${props.store.prefix}s_panel`;
        const exitStore = (event: MouseEvent) => {
            if (!(event.target instanceof Element)) return;
            if (!event.target.closest(`[data-list-item-id="${sidebarItem}"]`)) return;

            setShowStore(false);
        };

        document.addEventListener("click", exitStore, true);
        return () => document.removeEventListener("click", exitStore, true);
    }, [props.store.prefix, showStore]);

    return (
        <addonContext.Provider value={{toggleStore, showingStore: showStore, ...props}}>
            {showStore ? (
                <AddonStorePage {...props} type={props.store.prefix} />
            ) : (
                <AddonList {...props} />
            )}
        </addonContext.Provider>
    );
}
