export type SettingsSectionLayout = {
    key?: unknown;
    buildLayout(): unknown[];
};

const getKey = (layout: unknown): string => {
    const key = (layout as {key?: unknown;})?.key;
    return typeof key === "string" ? key : "";
};

/**
 * Returns the insertion index for BetterDiscord in the settings layout.
 */
export const getBetterDiscordSectionIndex = (layouts: SettingsSectionLayout[]): number => {
    const findSectionByChild = (keys: Set<string>) => {
        for (let index = 0; index < layouts.length; index++) {
            try {
                const items = layouts[index].buildLayout();
                if (Array.isArray(items) && items.some((item) => keys.has(getKey(item)))) return index;
            }
            catch {
                // keep searching for a later valid anchor
            }
        }

        return -1;
    };

    const footerIndex = findSectionByChild(new Set(["developer_panel", "logout_sidebar_item"]));
    if (footerIndex !== -1) return footerIndex;

    const gamesAndAppsIndex = layouts.findIndex((layout) => getKey(layout) === "games_and_apps_section");
    if (gamesAndAppsIndex !== -1) return gamesAndAppsIndex + 1;

    const activityIndex = layouts.findIndex((layout) => getKey(layout) === "activity_section");
    if (activityIndex !== -1) return activityIndex + 1;

    const fallbackIndex = findSectionByChild(new Set(["activity_privacy_panel", "registered_games_panel", "language_and_time_panel"]));
    return fallbackIndex === -1 ? layouts.length : fallbackIndex + 1;
};
