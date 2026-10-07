import React from "react";
import AddonStorePage from "./addonstore";
import AddonList from "./addonlist";
import {addonContext} from "./addonshared";
import type AddonManager from "@modules/addonmanager";

const {useState, useCallback} = React;

export default function AddonPage(props: {title: string; store: AddonManager; onDetachedOpen?: () => void;}) {
    // If 0 addons installed open the store automatically
    const [showStore, setShowStore] = useState(() => !props.store.addonList.length);

    const toggleStore = useCallback(() => setShowStore((v: boolean) => !v), []);

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
