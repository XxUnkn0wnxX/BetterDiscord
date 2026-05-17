import React, {ReactDOM} from "@modules/react";
import Settings, {type SettingsCollection} from "@stores/settings";
import JsonStore from "@stores/json";
import {Filters, getByKeys, getLazy, getMangled, getModule} from "@webpack";
import Patcher from "@modules/patcher";

import ReactUtils from "@api/reactutils";

import AddonPage from "@ui/settings/addonpage";

import type {SettingsCategory} from "@data/settings";
import VersionInfo from "./misc/versioninfo";
import {findInTree} from "@common/utils";
import {useForceUpdate, useStateFromStores} from "./hooks";
import SettingsPanel from "./settings/panel";
import {CustomCSS} from "@builtins/builtins";
import {lucideToDiscordIcon, type DiscordIcon} from "@utils/icon";
import {Logo} from "./logo";
import DiscordModules from "@modules/discordmodules";
import Button from "./base/button";
import {HistoryIcon} from "lucide-react";
import {t} from "@common/i18n";
import Modals from "./modals";
import changelog from "@data/changelog";
import {type Plugin} from "@modules/pluginmanager";
import DOMManager from "@modules/dommanager";
import type AddonManager from "@modules/addonmanager";
import toasts from "@stores/toasts";
import ContextMenuPatcher from "@api/contextmenu";
import getDebugInfo from "@utils/debug";
import Tooltip from "@ui/tooltip";

const SettingsRenderer = new class SettingsRenderer {
    private versionInfoObserver?: MutationObserver;
    private versionInfoRoot?: ReturnType<typeof ReactDOM.createRoot>;
    private versionInfoHost?: HTMLDivElement;
    private versionInfoAnchor?: HTMLElement;
    private versionInfoFeedback?: Tooltip;
    private versionInfoFeedbackAnchor?: HTMLElement;
    private versionInfoFeedbackTimeout?: ReturnType<typeof setTimeout>;
    private versionInfoCopyBound = false;
    private versionInfoFrame = 0;

    initialize() {
        this.patchModalSettings();
        this.patchVersionInformation();
    }

    onDrawerToggle(collection: string, group: string, state: boolean) {
        const drawerStates: Partial<Record<string, Record<string, boolean>>> = JsonStore.get("misc", "drawerStates") || {};
        if (!drawerStates[collection]) drawerStates[collection] = {};
        drawerStates[collection][group] = state;
        JsonStore.set("misc", "drawerStates", drawerStates);
    }

    getDrawerState(collection: string, group: string, defaultValue: boolean) {
        const drawerStates: Partial<Record<string, Record<string, boolean>>> = JsonStore.get("misc", "drawerStates") || {};
        if (!drawerStates[collection]) return defaultValue;
        if (!drawerStates[collection].hasOwnProperty(group)) return defaultValue;
        return drawerStates[collection][group];
    }

    onChange(onChange: (c: string, s: string, v: unknown) => void) {
        return (categoryId: string, settingId: string, value: unknown) => {
            onChange(categoryId, settingId, value);

            // Delay until after switch animation
            // customcss is here to let the tab show/hide
            // since that component is out of our control/scope
            if (settingId === "customcss") {
                setTimeout(this.forceUpdate.bind(this), 250);
            }
        };
    }

    buildSettingsPanel(id: string, title: string, groups: SettingsCategory[], onChange: (c: string, s: string, v: unknown) => void) {
        return React.createElement(SettingsPanel, {id, title, groups, onChange: this.onChange(onChange).bind(this), onDrawerToggle: this.onDrawerToggle.bind(this), getDrawerState: this.getDrawerState.bind(this)});
    }

    getAddonPanel(title: string, options = {}) {
        return (props: any) => {
            return React.createElement(AddonPage, Object.assign({}, {
                title: title,
                ...props
            }, options));
        };
    }

    private layoutBuilder?: LayoutBuilder;
    private getLayoutBuilder() {
        if (this.layoutBuilder) return this.layoutBuilder;

        const layoutModuleRaw = DiscordModules.Layout;

        const out: Partial<LayoutBuilder> = {};
        for (const key in layoutModuleRaw) {
            if (!Object.hasOwn(layoutModuleRaw, key)) continue;

            const match = String(layoutModuleRaw[key]).match(/\..{1,3}\.(.+?),/);

            if (match) {
                // Format FOO -> foo and FOO_BAR -> fooBar
                const outKey = match[1].toLowerCase().replace(/_([a-z])/gi, (_, letter) => letter.toUpperCase());

                Object.defineProperty(out, outKey, {
                    value(id: string, ...args: any) {
                        if (typeof id === "string") {
                            id = `betterdiscord_${id}_${outKey}`;
                        }

                        return layoutModuleRaw[key](id, ...args);
                    }
                });
            }
        }

        return this.layoutBuilder = out as LayoutBuilder;
    }

    async patchModalSettings() {
        // if discords creates another root check buildLayout
        const rootLayout = await getLazy<{
            key: "$Root";
            buildLayout(): SectionLayout[];
        }>(m => m?.key === "$Root", {searchExports: true, searchDefault: false});
        if (!rootLayout) return;

        this.patchSettingsSearch();

        const layoutBuilder = this.getLayoutBuilder();

        const section = layoutBuilder.section("betterdiscord", {
            buildLayout: () => {
                const layouts: SidebarItemLayout[] = [];

                const insert = (key: string, item: LayoutConstructor) => {
                    let layout: [] | [panel: PanelLayout] = [];

                    if ("render" in item) {
                        const custom = layoutBuilder.custom(key, {
                            Component: () => <item.render />
                        });

                        const category = layoutBuilder.category(key, {
                            buildLayout: () => [custom]
                        });

                        const panel = layoutBuilder.panel(key, {
                            buildLayout: () => [category],
                            useTitle: item.header
                        });

                        layout = [panel];
                    }

                    const sidebar = layoutBuilder.sidebarItem(key, {
                        buildLayout: () => layout,
                        useTitle: item.title,
                        icon: item.icon,
                        usePredicate: () => true,
                        useSearchTerms: () => [
                            "betterdiscord", "bd",
                            ...item.useSearchTerms()
                        ]
                    });

                    if (typeof item.predicate === "function") {
                        sidebar.usePredicate = () => !!item.predicate!();
                    }

                    if (typeof item.useMenu === "function") {
                        sidebar.useMenu = () => item.useMenu!();
                    }

                    if ("onClick" in item) {
                        sidebar.onClick = item.onClick;
                    }

                    layouts.push(sidebar);
                };

                const makeSettingsPanelProvider = (children: React.ReactNode) => {
                    const ref: {
                        current: {
                            text?: React.ReactNode;
                            children?: React.ReactNode;
                        };
                    } = {
                        current: {}
                    };

                    let forceUpdate: () => void;
                    function PanelHeader() {
                        const [node, setNode] = React.useState<HTMLElement | undefined>();
                        forceUpdate = useForceUpdate()[1];

                        return (
                            <>
                                <div
                                    className="bd-settings-page-title"
                                    ref={(v) => {
                                        const flex = v?.closest("div[data-wrap][data-full-width] > nav")?.parentElement as HTMLElement;

                                        if (flex) {
                                            flex.classList.add("bd-settings-title-extend");
                                            setNode(flex);
                                        }
                                        else if (v?.parentElement?.parentElement) {
                                            v.parentElement.parentElement.classList.add("bd-settings-title-extend");
                                            setNode(v.parentElement.parentElement);
                                        }
                                        else {
                                            setNode(v!);
                                        }

                                        return () => setNode(undefined);
                                    }}
                                >
                                    {ref.current.text}
                                </div>

                                {node && (
                                    ReactDOM.createPortal(
                                        <div className="bd-settings-page-title-children">{ref.current.children}</div>,
                                        node
                                    )
                                )}
                            </>
                        );
                    }

                    return {
                        header: () => <PanelHeader />,
                        render: () => (
                            <SettingsTitleContext
                                value={(value) => {
                                    ref.current = (value as {props: typeof ref["current"];}).props;
                                    forceUpdate();
                                    return null;
                                }}
                            >
                                {children}
                            </SettingsTitleContext>
                        )
                    };
                };

                for (const collection of Settings.collections) {
                    // if (collection.disabled) continue;
                    const items = collection.settings.map(m => [m.name, m.settings.map(setting => setting.name)]).flat(2) as string[];

                    insert(collection.id, {
                        ...makeSettingsPanelProvider(this.buildSettingsPanel(collection.id, collection.name, collection.settings, Settings.onSettingChange.bind(Settings, collection.id))),
                        icon: Logo.Discord,
                        title: () => collection.name,
                        useMenu: () => useCollectionMenu(collection),
                        useSearchTerms: () => [
                            collection.name,
                            ...items
                        ]
                    });
                }

                for (const panel of Settings.panels.sort((a, b) => a.order > b.order ? 1 : -1)) {
                    // if (panel.clickListener) panel.onClick = () => panel.clickListener?.(thisObject);
                    // if (!panel.className) panel.className = `bd-${panel.id}-tab`;
                    if (panel.type === "addon" && !panel.element) panel.element = this.getAddonPanel(panel.label, {store: panel.manager});

                    const icon = panel.icon ? lucideToDiscordIcon(panel.icon) : () => panel.id;

                    if (panel.id === "customcss") {
                        insert("customcss_tab", {
                            ...makeSettingsPanelProvider(React.createElement(panel.element!)),
                            icon,
                            title: () => panel.label,
                            predicate: useCustomCSSViewable,
                            useSearchTerms: () => [panel.label]
                        });
                        insert("customcss_clickable", {
                            icon,
                            title: () => panel.label,
                            predicate: useCustomCSSClickable,
                            onClick: () => CustomCSS.open(),
                            useSearchTerms: () => [panel.label]
                        });

                        continue;
                    }

                    insert(panel.id, {
                        ...makeSettingsPanelProvider(React.createElement(panel.element!)),
                        icon,
                        title: () => panel.label,
                        useMenu: panel.type === "addon" ? () => useAddonMenu(panel.manager!) : undefined,
                        useSearchTerms: () => [
                            panel.label,
                            typeof panel.searchable === "function" ? panel.searchable().filter(m => typeof m === "string") : []
                        ].flat()
                    });
                }

                return layouts;
            },
            useTitle: () => Object.assign(<LayerSettingTitle />, {toString: () => "BetterDiscord"}),
        });

        Patcher.after("SettingsManager", rootLayout, "buildLayout", (that, args, res) => {
            let index = res.findIndex((layout) => (layout as any).key === "activity_section") + 1;
            if (index === -1) index = res.length;

            res.splice(index, 0, section);
        });
    }

    patchSettingsSearch() {
        const search = getMangled<{
            search(): Record<string, any>;
        }>(".PRIVACY_AND_SAFETY_PERSISTENT_VERIFICATION_CODES]", {
            search: Filters.byStrings(".PRIVACY_AND_SAFETY_PERSISTENT_VERIFICATION_CODES]")
        }, {cacheId: "core-settings-search"});

        Patcher.after("SettingsManager", search, "search", (that, args, res) => {
            res = {...res}; // Discord freezes the object

            function insert(key: string, item: {
                label: string;
                searchableTitles: string[];
            }) {
                res[`BETTERDISCORD_${key}`] = {
                    ...item,
                    ariaLabel: item.label,
                    section: "betterdiscord"
                };
            }

            for (const collection of Settings.collections) {
                const items = collection.settings.map(m => [m.name, m.settings.map(setting => setting.name)]).flat(2) as string[];

                insert(collection.id, {
                    label: collection.name,
                    searchableTitles: [
                        "betterdiscord",
                        collection.name,
                        ...items
                    ]
                });
            }

            for (const panel of Settings.panels.sort((a, b) => a.order > b.order ? 1 : -1)) {
                const content = {
                    label: panel.label,
                    searchableTitles: [
                        "betterdiscord",
                        panel.label,
                        typeof panel.searchable === "function" ? panel.searchable().filter(m => typeof m === "string") : []
                    ].flat()
                };

                if (panel.id === "customcss") {
                    insert("customcss_tab", content);
                    insert("customcss_clickable", content);

                    continue;
                }

                insert(panel.id, content);
            }

            return Object.freeze(res);
        });
    }

    private scheduleVersionInfoRefresh() {
        if (this.versionInfoFrame) return;

        this.versionInfoFrame = requestAnimationFrame(() => {
            this.versionInfoFrame = 0;
            this.renderVersionInformation();
        });
    }

    private teardownVersionInformation() {
        this.versionInfoRoot?.unmount();
        this.versionInfoRoot = undefined;

        if (this.versionInfoHost?.isConnected) {
            this.versionInfoHost.remove();
        }

        this.versionInfoHost = undefined;

        if (this.versionInfoCopyBound) {
            document.removeEventListener("click", this.copyVersionDebugInfo, true);
            this.versionInfoCopyBound = false;
        }

        if (this.versionInfoFeedbackTimeout) {
            clearTimeout(this.versionInfoFeedbackTimeout);
            this.versionInfoFeedbackTimeout = undefined;
        }

        this.versionInfoFeedback?.hide();
        this.versionInfoFeedback = undefined;
        this.versionInfoFeedbackAnchor = undefined;

        if (this.versionInfoAnchor?.isConnected) {
            this.versionInfoAnchor.removeAttribute("data-bd-version-copy");
            this.versionInfoAnchor.removeAttribute("title");
        }

        this.versionInfoAnchor = undefined;
    }

    private isVersionAnchorTarget(target: EventTarget | null) {
        if (!(target instanceof Node) || !this.versionInfoAnchor) return false;
        return this.versionInfoAnchor.contains(target);
    }

    private showVersionCopyFeedback(anchor: HTMLElement) {
        if (this.versionInfoFeedbackAnchor !== anchor || !this.versionInfoFeedback) {
            this.versionInfoFeedback?.hide();
            this.versionInfoFeedback = Tooltip.create(anchor, "Copied", {
                style: "success",
                side: "top",
                disabled: true
            });
            this.versionInfoFeedbackAnchor = anchor;
        }

        if (this.versionInfoFeedbackTimeout) {
            clearTimeout(this.versionInfoFeedbackTimeout);
        }

        this.versionInfoFeedback.hide();
        this.versionInfoFeedback.show();
        this.versionInfoFeedbackTimeout = setTimeout(() => {
            this.versionInfoFeedback?.hide();
            this.versionInfoFeedbackTimeout = undefined;
        }, 1200);
    }

    private copyVersionDebugInfo = (event: MouseEvent) => {
        if (!this.isVersionAnchorTarget(event.target)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();

        DiscordNative?.clipboard?.copy(`\`\`\`md\n${getDebugInfo()}\n\`\`\``);
        if (this.versionInfoAnchor) this.showVersionCopyFeedback(this.versionInfoAnchor);
    };

    private bindVersionAnchor(anchor: HTMLElement) {
        if (this.versionInfoAnchor === anchor) return;

        if (this.versionInfoAnchor?.isConnected) {
            this.versionInfoAnchor.removeAttribute("data-bd-version-copy");
            this.versionInfoAnchor.removeAttribute("title");
        }

        if (!this.versionInfoCopyBound) {
            document.addEventListener("click", this.copyVersionDebugInfo, true);
            this.versionInfoCopyBound = true;
        }

        anchor.setAttribute("data-bd-version-copy", "true");
        anchor.title = "Click to copy BetterDiscord debug info";
        this.versionInfoAnchor = anchor;
    }

    private getVersionAnchor() {
        const discordInfo = getModule<{
            releaseChannel?: string;
            version?: number[];
        }>(m => typeof m?.releaseChannel === "string" && Array.isArray(m?.version), {
            searchExports: true,
            searchDefault: false,
            cacheId: "core-settings-version-anchor-discord-info"
        });

        if (!discordInfo?.releaseChannel || !Array.isArray(discordInfo.version)) return null;

        const versionText = discordInfo.version.join(".");
        const channelText = discordInfo.releaseChannel;

        const candidates = Array.from(document.querySelectorAll<HTMLElement>("[class*=\"compactInfo__\"]"));
        const infoNode = candidates.find((node) => {
            const text = node.textContent?.replace(/\s+/g, " ").trim();
            if (!text) return false;
            return text.includes(channelText) && text.includes(versionText);
        });

        if (!infoNode) return null;

        return infoNode.closest<HTMLElement>("[class*=\"clickable__\"][class*=\"compact__\"]") ?? infoNode.parentElement;
    }

    private renderVersionInformation() {
        const anchor = this.getVersionAnchor();
        if (!anchor?.parentElement) {
            this.teardownVersionInformation();
            return;
        }

        this.bindVersionAnchor(anchor);

        let host = this.versionInfoHost;

        if (!host || !host.isConnected) {
            host = document.createElement("div");
            host.className = "bd-version-info-wrapper";
        }

        if (host.previousElementSibling !== anchor) {
            anchor.insertAdjacentElement("afterend", host);
        }

        if (host !== this.versionInfoHost) {
            this.versionInfoRoot?.unmount();
            this.versionInfoHost = host;
            this.versionInfoRoot = ReactDOM.createRoot(host);
        }

        this.versionInfoRoot?.render(<VersionInfo />);
    }

    patchVersionInformation() {
        this.versionInfoObserver?.disconnect();
        this.scheduleVersionInfoRefresh();

        this.versionInfoObserver = new MutationObserver(() => {
            this.scheduleVersionInfoRefresh();
        });

        this.versionInfoObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    public openSettingsPage(key: string) {
        UserSettings?.openUserSettings?.(`betterdiscord_${key === "customcss" ? "customcss_tab" : key}_panel`, {
            section: key
        });
    }

    forceUpdate() {
        const viewClass = DiscordModules.ViewClasses?.standardSidebarView.split(" ")[0];
        const node = document.querySelector(`.${viewClass}`);
        if (!node) return;
        const stateNode = findInTree(ReactUtils.getInternalInstance(node), (m: {getPredicateSections: any;}) => m && m.getPredicateSections, {walkable: ["return", "stateNode"]});
        if (stateNode) stateNode.forceUpdate();
    }
};

const ContextMenu = new ContextMenuPatcher();

const UserSettings = getByKeys<any>(["openUserSettings"], {firstId: 840065, cacheId: "core-settings-usersettings"});

interface PanelLayout {
    buildLayout(): [category: CategoryLayout];
    useTitle(): React.ReactNode;
}

type Trailing = ({
    // ngl idk
    type: 0,
} | {
    type: 1,
    badgeComponent?: unknown;
} | {
    type: 2,
    useCount(): number;
} | {
    type: 3,
    useDecoration(x: unknown, y: unknown): React.ReactNode;
}) & {
    getDismissibleContentTypes?(): unknown[];
};

interface SidebarItemLayout {
    icon: DiscordIcon;
    useTitle(): React.ReactNode;
    buildLayout(): [] | [panel: PanelLayout];
    useSearchTerms(): string[];

    /**
     * @warning You cannot have page with onClick!
     */
    onClick?(): void;

    /** You can use react hooks here! */
    usePredicate?(): boolean;

    trailing?: Trailing;

    useMenu?(): React.ReactNode;
}

interface SectionLayout {
    useTitle(): React.ReactNode;
    buildLayout(): SidebarItemLayout[];
    usePredicate?(): boolean;
}

interface CustomLayout {
    Component: React.ComponentType;
}

interface CategoryLayout {
    buildLayout(): CustomLayout[];
}

interface LayoutBuilder {
    custom(key: string, custom: CustomLayout): CustomLayout;
    category(key: string, custom: CategoryLayout): CategoryLayout;
    panel(key: string, panel: PanelLayout): PanelLayout;
    sidebarItem(key: string, panel: SidebarItemLayout): SidebarItemLayout;
    section(key: string, panel: SectionLayout): SectionLayout;
}

type LayoutConstructor = {
    title(): React.ReactNode;
    icon: DiscordIcon;

    predicate?(): boolean;
    useMenu?(): React.ReactNode;
    useSearchTerms(): string[];
} & ({
    header(): React.ReactNode;
    render(): React.ReactNode;
} | {
    onClick(): void;
});

/** @description On true clicking open will open not open the page. On false will open the page */
const useCustomCSSClickable = () => {
    const state = useStateFromStores(Settings, () => Settings.get<string>("settings", "customcss", "openAction"));

    return ["detached", "external", "system"].includes(state);
};
const useCustomCSSViewable = () => !useCustomCSSClickable();

function LayerSettingTitle() {
    const [node, setNode] = React.useState<HTMLElement | undefined | null | void>();

    return (
        <>
            <div
                className="bd-sidebar-header"
                ref={(v) => {
                    let nNode = v as HTMLElement;
                    if (v?.parentElement?.parentElement) {
                        // If discord changes the dom layout don't blame me
                        // if context menu
                        if (v.parentElement.parentElement.role === "group") {
                            nNode = v.parentElement as HTMLElement;
                        }
                        // if settings modal layer
                        else {
                            nNode = v.parentElement.parentElement as HTMLElement;
                        }
                    }

                    setNode(nNode);
                    return setNode;
                }}
            >
                BetterDiscord
            </div>
            {node && ReactDOM.createPortal(
                <DiscordModules.Tooltip color="primary" position="top" text={t("Modals.changelog")}>
                    {props =>
                        <Button {...props} className="bd-changelog-button" look={Button.Looks.BLANK} color={Button.Colors.TRANSPARENT} size={Button.Sizes.NONE} onClick={() => Modals.showChangelogModal(changelog)}>
                            <HistoryIcon className="bd-icon" size="16px" />
                        </Button>
                    }
                </DiscordModules.Tooltip>,
                node
            )}
        </>
    );
}

export const SettingsTitleContext = React.createContext((v: React.ReactNode) => v);

function openCategory(id: string) {
    ContextMenu.close();
    SettingsRenderer.openSettingsPage(id);
}

function useCollectionMenu(collection: SettingsCollection) {
    const settings = useStateFromStores(Settings, () => {
        return collection.settings.map(category => ({
            id: category.id,
            name: category.name!,
            settings: category.settings.filter(s => s.type === "switch" && !s.hidden).map(setting => ({
                id: setting.id,
                label: setting.name!,
                disabled: setting.disabled,
                checked: Settings.get(collection.id, category.id, setting.id),
                action: () => Settings.set(collection.id, category.id, setting.id, !Settings.get(collection.id, category.id, setting.id))
            }))
        }));
    }, []);

    return (
        <>
            {settings.map(category => (
                <ContextMenu.Item
                    label={category.name}
                    id={category.id}
                    action={() => openCategory(collection.id)}
                    key={`bd.${collection.id}.${category.id}`}
                >
                    {category.settings.map(setting => (
                        <ContextMenu.CheckboxItem {...setting} key={`bd.${collection.id}.${category.id}.${setting.id}`} />
                    ))}
                </ContextMenu.Item>
            ))}
        </>
    );
}

function useAddonMenu(manager: AddonManager) {
    const addons = useStateFromStores(manager, () => manager.addonList.map(a => a.name || (a as any).getName?.()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((name) => [name as string, manager.resolveAddon(name), manager.isEnabled(name)] as const), [], true);
    const addonStoreIsEnabled = useStateFromStores(Settings, () => Settings.get("settings", "store", "bdAddonStore"), []);

    const toggles = React.useMemo(() => addons.map(([name, addon, enabled]) => (
        <ContextMenu.CheckboxItem
            label={name}
            id={name}
            checked={enabled}
            key={`bd.${manager.prefix}.${name}`}
            disabled={addon?.partial}
            action={(e: MouseEvent) => {
                if (!e.shiftKey) {
                    manager.toggleAddon(name);
                    return;
                }

                if (!manager.isEnabled(name)) {
                    toasts.warning(t("Addons.isDisabled", {name}));
                    return;
                }

                const hasSettings = (addon as Plugin).instance && typeof ((addon as Plugin).instance.getSettingsPanel) === "function";
                const getSettings = (hasSettings && (addon as Plugin).instance.getSettingsPanel!.bind((addon as Plugin).instance)) as () => any;

                if (hasSettings) {
                    Modals.showAddonSettingsModal(name, getSettings());
                }
                else {
                    toasts.warning(t("Addons.noSettings", {name}));
                }
            }}
        />
    )), [addons, manager]);

    return (
        <>
            <ContextMenu.Group key={`bd.${manager.prefix}.installed`}>
                {toggles}
            </ContextMenu.Group>
            {addonStoreIsEnabled && (
                <ContextMenu.Group key={`bd.${manager.prefix}.store`}>
                    <ContextMenu.Item
                        label={t("Addons.openStore", {context: manager.prefix})}
                        id={`${manager.prefix}-store`}
                        action={() => {
                            openCategory(manager.prefix + "s");
                            // If the addon store instantly opens have it just stop basically
                            DOMManager.onAdded(":where(.bd-store-card, .bd-addon-title > :nth-child(3))", (elem) => (elem as HTMLElement)?.click());
                        }}
                    />
                </ContextMenu.Group>
            )}
        </>
    );
}

export default SettingsRenderer;
