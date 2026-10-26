import Button from "@ui/base/button";
import React from "react";
import Logger from "@common/logger";
import DiscordModules from "@modules/discordmodules";
import {t} from "@common/i18n";
import Builtin from "@structs/builtin";
import Toasts from "@stores/toasts";
import pluginmanager from "@modules/pluginmanager";
import IPC from "@modules/ipc";
import Modals from "@ui/modals";
import {Filters, getByPrototypes, getBySource, getProxy} from "@webpack";
import Patcher from "@modules/patcher";
import Notifications from "@stores/notifications";
import config from "@stores/config";
import {Logo} from "@ui/logo";
import type {ErrorBoundary, TransitionTo} from "@typed/discord/modules";
import SimpleMarkdownExt from "@structs/markdown";
import Flex from "@ui/base/flex";
import {Check, ChevronDown, ChevronRightIcon, Copy, GithubIcon, MessageCircleWarningIcon, Server} from "lucide-react";
import ForgejoIcon from "@ui/forgejoicon";
import GitLabIcon from "@ui/gitlabicon";
import {getRecoveryReportSource, type RecoveryReportSource} from "@utils/recoveryreport";
import getDebugInfo from "@utils/debug";

const TEST_PLUGIN_REGEX = /betterdiscord:\/\/(?:betterdiscord\/)?plugins\/([^/\r\n]+?\.plugin\.js)(?=[:)\s]|$)/;
const transitionTo = getProxy<TransitionTo>(Filters.byStrings("transitionTo - Transitioning to"), {searchExports: true, firstId: 976860, cacheId: "core-recovery-transitionTo"});

interface PluginInfo {
    name: string;
    reportSource: RecoveryReportSource | null;
    invite: string | null;
    version: string;
}

interface CapturedTypes {
    parentType: unknown;
    ownType: unknown;
}

type RecoveryBoundary = React.PureComponent<undefined, ErrorBoundary["state"] & {
    pluginInfo?: PluginInfo | null;
    attributedError?: unknown;
}>;

const clearedRecoveryState = {info: null, error: null, pluginInfo: null, attributedError: null};

function getStackPluginInfo(error: unknown): PluginInfo | null {
    try {
        const stack = (error as {stack?: unknown;} | null)?.stack;
        const match = typeof stack === "string" ? TEST_PLUGIN_REGEX.exec(stack) : null;
        return match ? getPluginInfo(match[1]) : null;
    }
    catch {return null;}
}

async function attemptRecovery() {
    const recoverySteps = [
        {action: () => DiscordModules.Dispatcher?.dispatch?.({type: "LAYER_POP_ALL"}), errorMessage: "Failed to pop all layers"},
        {action: () => DiscordModules.Dispatcher?.dispatch?.({type: "MODAL_POP_ALL"}), errorMessage: "Failed to pop all modals"},
        {action: () => DiscordModules.Dispatcher?.dispatch({type: "CONTEXT_MENU_CLOSE"}), errorMessage: "Failed to close context menus"},
        {action: () => Modals.ModalActions?.closeAllModals?.(), errorMessage: "Failed to close all modals"},
        {action: () => transitionTo?.("/channels/@me"), errorMessage: "Failed to route to main channel"}
    ];

    let allActionsCompleted = true;
    for (const {action, errorMessage} of recoverySteps) {
        try {
            await action();
        }
        catch (error) {
            Logger.error("Recovery", `${errorMessage}:, ${error}`);
            allActionsCompleted = false;
        }
    }

    return allActionsCompleted;
}

function getPluginInfo(pluginName: string): PluginInfo | null {
    try {
        const plugin = pluginmanager.resolveAddon(pluginName);
        if (!plugin) return null;
        return {
            name: plugin.name ?? pluginName,
            reportSource: getRecoveryReportSource(plugin.source),
            invite: plugin.invite ?? null,
            version: plugin.version ?? "0.0.0"
        };
    }
    catch (error) {
        Logger.error("Recovery", `Failed to get plugin info: ${error}`);
        return null;
    }
}

function getRecoveryClientInfo() {
    try {
        return getDebugInfo({collapsible: true});
    }
    catch {
        Logger.error("Recovery", "Failed to generate debug information");
        return "Debug information unavailable.";
    }
}

function createRecoveryCopyText(instance: ErrorBoundary, pluginInfo: PluginInfo | null) {
    const {error, info} = (instance.state ?? {}) as any;
    const componentStack = info?.componentStack?.replace(/^(?:[\t ]*\r?\n)+/, "");
    return [
        pluginInfo && `Suspected addon: **${pluginInfo.name} v${pluginInfo.version}**`,
        `<details>\n<summary>Error Details</summary>\n\n\`\`\`js\n${error?.stack ?? String(error ?? "No stack available")}\n\`\`\`\n\n</details>`,
        componentStack && `<details>\n<summary>Component Stack</summary>\n\n\`\`\`js\n${componentStack}\n\`\`\`\n\n</details>`
    ].filter(Boolean).join("\n\n");
}

function createReportPayload(instance: ErrorBoundary, pluginInfo: PluginInfo | null, manual = false) {
    const name = pluginInfo?.name ?? "Unknown Plugin";
    const version = pluginInfo?.version ?? "unknown";
    const error = instance.state?.error;
    const details = manual ? createRecoveryCopyText(instance, pluginInfo) : `### Error Details\n\`\`\`js\n${error?.stack ?? error ?? "Failed to get stack"}\n\`\`\``;
    return {
        title: `[Bug Report] Plugin Crash - ${name} v${version}`,
        body: `${details}${manual ? "\n\n" : "\n"} - Generated by BD Recovery Builtin.\n\n${getRecoveryClientInfo()}\n\n### Steps to Reproduce\n1.\n2.\n3.\n\n### Additional Context\n`
    };
}

function isReactComponentType(value: unknown, allowProvider = false): boolean {
    if (typeof value === "function") return true;
    if (!value || typeof value !== "object") return false;
    const component = value as {$$typeof?: symbol; render?: unknown; type?: unknown;};
    if (component.$$typeof === Symbol.for("react.forward_ref")) return typeof component.render === "function";
    if (component.$$typeof === Symbol.for("react.memo")) return isReactComponentType(component.type);
    return allowProvider && (component.$$typeof === Symbol.for("react.provider") || component.$$typeof === Symbol.for("react.context"));
}

function getNativeRecoveryComponents() {
    const layers = DiscordModules.LayerProvider;
    const accessibilityProvider = DiscordModules.AccessibilityContext?.Provider;
    const valid = isReactComponentType(layers?.AppLayerProvider)
        && isReactComponentType(layers?.AppLayerContainer)
        && isReactComponentType(accessibilityProvider, true);

    return valid ? {AppLayerProvider: layers.AppLayerProvider, AppLayerContainer: layers.AppLayerContainer, AccessibilityProvider: accessibilityProvider} : null;
}

function ErrorButtons({instance}: {instance: RecoveryBoundary;}) {
    const recover = React.useCallback(async () => {
        if (await attemptRecovery()) instance.setState(clearedRecoveryState);
        else Toasts.show(t("Toasts.recoveryFailed"));
    }, [instance]);

    const safeMode = React.useCallback(async () => {
        pluginmanager.disableAllAddons();
        await IPC.relaunch();
    }, []);

    return <Flex align={Flex.Align.CENTER} style={{gap: "8px"}}>
        <Button onClick={() => window.location.reload()} color="bd-button-color-brand">{t("Addons.reload")}</Button>
        <Button onClick={recover} color="bd-button-color-green">{t("Recovery.button")}</Button>
        <Button onClick={safeMode} color="bd-button-color-red">{t("Recovery.safeMode")}</Button>
    </Flex>;
}

function ErrorDetails({instance, pluginInfo, stack}: {instance: RecoveryBoundary; pluginInfo: PluginInfo | null; stack: React.ReactNode | null;}) {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const timeout = React.useRef<number>(0);
    const reportSource = pluginInfo?.reportSource ?? null;

    React.useEffect(() => () => window.clearTimeout(timeout.current), []);

    const openReport = React.useCallback(() => {
        if (!reportSource) return;
        const report = createReportPayload(instance, pluginInfo);
        const isGitLab = reportSource.provider === "gitlab";
        const issueUrl = isGitLab ? `${reportSource.repoUrl}/-/work_items/new?issue[title]=${encodeURIComponent(report.title)}&issue[description]=${encodeURIComponent(report.body)}`
            : `${reportSource.repoUrl}/issues/new?title=${encodeURIComponent(report.title)}&body=${encodeURIComponent(report.body)}`;
        window.open(issueUrl, "_blank", "noopener,noreferrer");
    }, [reportSource, pluginInfo, instance]);

    const copyManualReport = React.useCallback(async () => {
        const report = createReportPayload(instance, pluginInfo, true);
        const text = `# ${report.title}\n\n${report.body}`;
        try {
            const nativeCopy = (window as any).DiscordNative?.clipboard?.copy;
            if (nativeCopy) await nativeCopy(text);
            else await navigator.clipboard.writeText(text);
            Toasts.success(t("Recovery.manualReportCopied"));
        }
        catch (copyError) {
            Logger.error("Recovery", `Failed to copy manual report: ${copyError}`);
            Toasts.error(t("Recovery.manualReportCopyFailed"));
        }
    }, [instance, pluginInfo]);

    const recover = React.useCallback(async () => {
        if (await attemptRecovery()) {
            instance.setState(clearedRecoveryState);
            return true;
        }
        Toasts.show(t("Toasts.recoveryFailed"));
        return false;
    }, [instance]);

    const openSupport = React.useCallback(async () => {
        if (pluginInfo?.invite && await recover()) await Modals.showGuildJoinModal(pluginInfo.invite);
    }, [pluginInfo?.invite, recover]);

    const copy = React.useCallback(async () => {
        const text = createRecoveryCopyText(instance, pluginInfo);

        try {
            const nativeCopy = (window as any).DiscordNative?.clipboard?.copy;
            if (nativeCopy) await nativeCopy(text);
            else await navigator.clipboard.writeText(text);

            setCopied(true);
            window.clearTimeout(timeout.current);
            timeout.current = window.setTimeout(() => setCopied(false), 2000);
        }
        catch (copyError) {
            Logger.error("Recovery", `Failed to copy error details: ${copyError}`);
        }
    }, [instance, pluginInfo]);

    const native = getNativeRecoveryComponents();
    const TooltipComponent = native && isReactComponentType(DiscordModules.Tooltip) ? DiscordModules.Tooltip : null;
    const reportLabel = reportSource?.provider === "forgejo" ? t("Recovery.reportForgejo") : reportSource?.provider === "gitlab" ? t("Recovery.reportGitlab") : reportSource ? t("Recovery.report") : t("Recovery.manualReport");
    const reportIcon = reportSource?.provider === "forgejo" ? <ForgejoIcon size={24}/> : reportSource?.provider === "gitlab" ? <GitLabIcon size={24}/> : reportSource ? <GithubIcon size={24}/> : null;
    const links = (
        <div className="bd-recovery-links">
            {TooltipComponent && reportSource
                ? <TooltipComponent text={reportLabel}>{props => <button {...props} type="button" className="bd-recovery-link bd-recovery-report" aria-label={reportLabel} onClick={openReport}>{reportIcon}</button>}</TooltipComponent>
                : reportSource
                    ? <button type="button" className="bd-recovery-link bd-recovery-report bd-recovery-link-fallback" title={reportLabel} aria-label={reportLabel} onClick={openReport}>{reportIcon}</button>
                    : <button type="button" className="bd-recovery-report bd-recovery-report-manual" title={reportLabel} aria-label={reportLabel} onClick={copyManualReport}>{reportLabel}</button>}
            {!!pluginInfo?.invite && (TooltipComponent
                ? <TooltipComponent text={t("Recovery.joinSupport")}>{props => <button {...props} type="button" className="bd-recovery-link bd-recovery-support" aria-label={t("Recovery.joinSupport")} onClick={openSupport}><Server size={24}/></button>}</TooltipComponent>
                : <button type="button" className="bd-recovery-link bd-recovery-support bd-recovery-link-fallback" title={t("Recovery.joinSupport")} aria-label={t("Recovery.joinSupport")} onClick={openSupport}><Server size={24}/></button>)}
        </div>
    );

    const content = (
        <div className="bd-recovery-container">
            <div className="bd-recovery-header">
                <button type="button" className="bd-recovery-toggle" aria-expanded={isExpanded} onClick={() => setIsExpanded(value => !value)}>
                    <span>{isExpanded ? "Hide Error Details" : "Show Error Details"}</span>
                    {isExpanded ? <ChevronDown size={16}/> : <ChevronRightIcon size={16}/>}
                </button>
                <Button color="bd-button-color-white" onClick={copy}>
                    <Flex align={Flex.Align.CENTER} style={{gap: "6px"}}>
                        {copied ? <Check size={16}/> : <Copy size={16}/>}
                        <span>{copied ? "Copied" : "Copy"}</span>
                    </Flex>
                </Button>
            </div>
            {!!pluginInfo && (
                <div className="bd-recovery-suspect">
                    <span className="bd-suspected-label">{t("Recovery.suspect")}</span>
                    <span className="bd-suspected-plugin">
                        <MessageCircleWarningIcon size={14}/>
                        {pluginInfo.name}
                        <span className="bd-suspected-version">v{pluginInfo.version}</span>
                    </span>
                    {links}
                </div>
            )}
            {isExpanded && <div className="bd-recovery-details"><div className="bd-recovery-stack bd-scroller-thin">{stack}</div></div>}
        </div>
    );

    if (!native) return content;
    const {AccessibilityProvider, AppLayerProvider, AppLayerContainer} = native;
    return <AccessibilityProvider value={{reducedMotion: {enabled: true}}}><AppLayerProvider>{content}<AppLayerContainer/></AppLayerProvider></AccessibilityProvider>;
}

export default new class Recovery extends Builtin {
    get name() {return "Recovery";}

    async initialize() {
        if (this.initialized) return;
        try {
            this.patchErrorBoundry();
            this.patchReactReconcilerCapturedStacks();
        }
        catch (error) {
            this.unpatchAll();
            throw error;
        }
        return super.initialize();
    }

    private capturedTypes = new WeakMap<object, CapturedTypes>();
    private primitiveCapture: {value: unknown; types: CapturedTypes;} | null = null;

    patchReactReconcilerCapturedStacks() {
        // This lookup is optional on older Discord clients. Required boundary hooks
        // remain installed if discovery or registration is unavailable.
        try {
            const target = getBySource<unknown>([".errorRecoveryDisabledLanes|="], {
                declarationFilter: Filters.byStrings("value:", ".set"),
                withKey: true
            });
            if (!Array.isArray(target) || target.length !== 2) return;
            const [declarations, key] = target;
            if (!declarations || (typeof declarations !== "object" && typeof declarations !== "function")
                || typeof key !== "string" || typeof declarations[key] !== "function") return;

            this.after(declarations, key, (_, __, result: unknown) => {
                try {
                    if (!result || typeof result !== "object" || !("value" in result) || !("source" in result)) return;
                    const {value, source} = result;
                    if (!source || typeof source !== "object") return;
                    const fiber = source as {elementType?: unknown; return?: {elementType?: unknown;} | null;};
                    const types = {parentType: fiber.return?.elementType, ownType: fiber.elementType};
                    if (value !== null && (typeof value === "object" || typeof value === "function")) this.capturedTypes.set(value, types);
                    else this.primitiveCapture = {value, types};
                }
                catch {
                    // Malformed captures must not change React's return value.
                }
            });
        }
        catch {
            // Optional discovery must not roll back the required hooks.
        }
    }

    private consumeCapturedTypes(error: unknown): CapturedTypes | undefined {
        if (error !== null && (typeof error === "object" || typeof error === "function")) {
            const types = this.capturedTypes.get(error);
            this.capturedTypes.delete(error);
            return types;
        }
        if (this.primitiveCapture && Object.is(this.primitiveCapture.value, error)) {
            const {types} = this.primitiveCapture;
            this.primitiveCapture = null;
            return types;
        }
    }

    private getPatchedPluginInfo(type: unknown): PluginInfo | null {
        if (type === undefined || type === null) return null;
        const patch = Patcher.getPatches(type);
        if (!patch) return null;
        // Preserve registration order without requiring newer iterator helpers.
        for (const child of patch.children) {
            const pluginInfo = getPluginInfo(child.pluginSource || child.caller);
            if (pluginInfo) return pluginInfo;
        }
        return null;
    }

    patchErrorBoundry() {
        const mod = getByPrototypes<typeof React.PureComponent>(["_handleSubmitReport"], {firstId: 670735, cacheId: "core-recovery-ErrorBoundary"});

        this.after(mod?.prototype, "componentDidCatch", (instance, [error]) => {
            const types = this.consumeCapturedTypes(error);
            let pluginInfo: PluginInfo | null = null;
            try {
                pluginInfo = getStackPluginInfo(error) ?? this.getPatchedPluginInfo(types?.parentType) ?? this.getPatchedPluginInfo(types?.ownType);
                if (!pluginInfo) return;

                pluginmanager.disableAddon(pluginInfo.name);
                Notifications.show({
                    title: "BetterDiscord Recovery",
                    content: `Suspected plugin causing the crashes: ${pluginInfo.name} v${pluginInfo.version}`,
                    type: "warning",
                    icon: () => <Logo size={16} accent />,
                    duration: Infinity,
                    actions: [
                        ...(config.isCanary ? [{label: "Re-enable", onClick: () => pluginmanager.enableAddon(pluginInfo!.name)}] : [])
                    ]
                });
            }
            finally {
                (instance as RecoveryBoundary).setState({pluginInfo, attributedError: error});
            }
        });

        this.after(mod?.prototype, "render", (instance, _, retValue) => {
            if (!retValue?.props?.action?.props) return;

            const action = retValue.props.action;
            // Discord's error boundary owns its built-in actions; replace only their children.
            action.props.children = [];

            const errorInstance = instance as RecoveryBoundary;
            const errorStack = errorInstance.state;
            const parsedError = errorStack ? SimpleMarkdownExt.parseToReact(`\`\`\`${errorStack.error?.stack}\n\n${errorStack.info?.componentStack}\`\`\``) : null;
            const pluginInfo = errorStack && Object.is(errorStack.attributedError, errorStack.error)
                ? errorStack.pluginInfo ?? null
                : getStackPluginInfo(errorStack?.error);

            action.props.children.push(<ErrorButtons key="bd-recovery-buttons" instance={errorInstance}/>);
            retValue.props.action = [action, <ErrorDetails key="bd-recovery-details" stack={parsedError} pluginInfo={pluginInfo} instance={errorInstance}/>];
        });
    }
};
