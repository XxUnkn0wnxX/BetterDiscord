import React from "react";
import {EyeIcon, EyeOffIcon} from "lucide-react";

import {getProviderTokenGeneration, normalizeProviderToken, type TokenProvider} from "@common/provider-auth";
import {t} from "@common/i18n";
import Events from "@modules/emitter";
import {validateProviderToken, type ProviderTokenValidationResult} from "@modules/provider-token-validation";
import {showProviderTokenPermissionWarning} from "@modules/provider-token-notices";
import SettingsStore from "@stores/settings";
import Button from "@ui/base/button";
import {getByStrings} from "@webpack";

import {useItemProps, type BaseSettingProps} from "./utils";

interface NativeTextInputProps {
    id: string;
    value: string;
    type: "password" | "text";
    error?: string;
    disabled?: boolean;
    maxLength: number;
    autoComplete: string;
    spellCheck: boolean;
    inputRef: React.Ref<HTMLInputElement>;
    onChange(value: string, name?: string): void;
}

type NativeTextInputComponent = (props: NativeTextInputProps) => React.ReactNode;
type ProviderTokenProps = BaseSettingProps<string> & {
    id: TokenProvider;
};

type DraftStatus =
    | {kind: "idle"}
    | {kind: "pending"}
    | {kind: "invalid"}
    | {kind: "unavailable"; reason: Extract<ProviderTokenValidationResult, {status: "unavailable"}>["reason"]};

function getStatusMessage(status: DraftStatus) {
    if (status.kind === "pending") return t("ProviderTokens.checking");
    if (status.kind === "invalid") return t("ProviderTokens.invalid");
    if (status.kind !== "unavailable") return undefined;
    return t(`ProviderTokens.unavailable.${status.reason}`);
}

export default function ProviderToken(props: ProviderTokenProps) {
    const {id} = props;
    const {state, setState, disabled} = useItemProps<string>(props);
    const committed = typeof state === "string" ? state : "";
    const [draft, setDraft] = React.useState(committed);
    const [status, setStatus] = React.useState<DraftStatus>({kind: "idle"});
    const [revealed, setRevealed] = React.useState(false);
    const [retryVersion, setRetryVersion] = React.useState(0);
    const draftRef = React.useRef(draft);
    const revision = React.useRef(0);
    const mounted = React.useRef(false);
    const disabledRef = React.useRef(disabled);
    const providerRef = React.useRef(id);
    const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const activeController = React.useRef<AbortController | undefined>(undefined);
    const retryRevision = React.useRef<number | undefined>(undefined);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const nativeInput = React.useRef<NativeTextInputComponent | undefined>(undefined);

    // Native form modules may load after these settings components are imported.
    // Resolve when rendered and retain only a successful lookup.
    if (typeof nativeInput.current !== "function") {
        let component = getByStrings<NativeTextInputComponent>(["inputClassName", "prefixElement", "defaultDirty"], {
            searchExports: true,
            cacheId: "provider-token-native-input"
        });
        if (typeof component !== "function") {
            component = getByStrings<NativeTextInputComponent>(["data-mana-component", "text-input", "showCharacterCount", "clearable"], {
                searchExports: true,
                cacheId: "provider-token-modern-input"
            });
        }
        if (typeof component === "function") nativeInput.current = component;
    }
    const NativeTextInput = nativeInput.current;

    disabledRef.current = disabled;
    providerRef.current = id;

    const cancelValidation = React.useCallback(() => {
        if (debounceTimer.current !== undefined) clearTimeout(debounceTimer.current);
        debounceTimer.current = undefined;
        activeController.current?.abort();
        activeController.current = undefined;
    }, []);
    const invalidateRevision = React.useCallback(() => {revision.current++;}, []);

    const clearDraft = React.useCallback((value: string) => {
        revision.current++;
        cancelValidation();
        retryRevision.current = undefined;
        draftRef.current = value;
        setDraft(value);
        setStatus({kind: "idle"});
        if (committed !== "") setState("");
    }, [cancelValidation, committed, setState]);

    const handleChange = React.useCallback((value: string) => {
        revision.current++;
        cancelValidation();
        retryRevision.current = undefined;

        if (value.trim() === "") {
            clearDraft("");
            return;
        }

        draftRef.current = value;
        setDraft(value);
        if (value.length > 1024 || !normalizeProviderToken(value)) {
            setStatus({kind: "invalid"});
            return;
        }
        setStatus({kind: "pending"});
    }, [cancelValidation, clearDraft]);

    React.useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            invalidateRevision();
            cancelValidation();
        };
    }, [cancelValidation, invalidateRevision]);

    React.useEffect(() => {
        if (!disabled) return;
        revision.current++;
        cancelValidation();
        retryRevision.current = undefined;
        draftRef.current = committed;
        setDraft(committed);
        setStatus({kind: "idle"});
    }, [cancelValidation, committed, disabled]);

    React.useEffect(() => {
        const synchronizeDraft = () => {
            revision.current++;
            cancelValidation();
            retryRevision.current = undefined;
            const value = SettingsStore.get<string>("settings", "accessTokens", id) || "";
            draftRef.current = value;
            setDraft(value);
            setStatus({kind: "idle"});
            setRevealed(false);
        };
        const onCleared = (provider: TokenProvider) => {
            if (provider === id) synchronizeDraft();
        };
        Events.on("provider-tokens-reset", synchronizeDraft);
        Events.on("provider-token-cleared", onCleared);
        return () => {
            Events.off("provider-tokens-reset", synchronizeDraft);
            Events.off("provider-token-cleared", onCleared);
        };
    }, [cancelValidation, id]);

    React.useEffect(() => {
        if (status.kind !== "pending" || disabled) return;
        const requestRevision = revision.current;
        const requestProvider = id;
        const requestGeneration = getProviderTokenGeneration(id);
        const requestDraft = draft;
        const candidate = normalizeProviderToken(requestDraft);
        if (!candidate) return;

        const controller = new AbortController();
        activeController.current = controller;
        const delay = retryRevision.current === requestRevision ? 0 : 750;
        debounceTimer.current = setTimeout(async () => {
            debounceTimer.current = undefined;
            const result = await validateProviderToken(id, candidate, controller.signal);
            if (activeController.current === controller) activeController.current = undefined;
            if (!mounted.current || disabledRef.current || controller.signal.aborted
                || revision.current !== requestRevision || providerRef.current !== requestProvider
                || getProviderTokenGeneration(id) !== requestGeneration
                || draftRef.current !== requestDraft || normalizeProviderToken(draftRef.current) !== candidate) return;

            if (result.status === "valid") {
                draftRef.current = candidate;
                setDraft(candidate);
                setStatus({kind: "idle"});
                setState(candidate);
                return;
            }
            if (result.status === "invalid") {
                setStatus({kind: "invalid"});
                return;
            }
            setStatus({kind: "unavailable", reason: result.reason});
            if (result.reason === "permission" && result.missingPermission) {
                showProviderTokenPermissionWarning(id, result.missingPermission);
            }
        }, delay);

        return () => {
            if (debounceTimer.current !== undefined) clearTimeout(debounceTimer.current);
            debounceTimer.current = undefined;
            controller.abort();
            if (activeController.current === controller) activeController.current = undefined;
        };
    }, [draft, disabled, id, retryVersion, setState, status.kind]);

    const label = t(`ProviderTokens.${revealed ? "hide" : "show"}`);
    const Icon = revealed ? EyeOffIcon : EyeIcon;
    const toggleProps = {"aria-label": label, "aria-pressed": revealed};
    const message = getStatusMessage(status);
    const retry = () => {
        retryRevision.current = revision.current;
        setStatus({kind: "pending"});
        setRetryVersion(value => value + 1);
    };

    if (typeof NativeTextInput !== "function") {
        return <div className="bd-provider-token-control">
            <span className="bd-provider-token-unavailable">{t("ProviderTokens.inputUnavailable")}</span>
        </div>;
    }

    return <div className="bd-provider-token-control">
        <NativeTextInput
            id={id}
            value={draft}
            type={revealed ? "text" : "password"}
            error={message}
            disabled={disabled}
            maxLength={1024}
            autoComplete="off"
            spellCheck={false}
            inputRef={inputRef}
            onChange={handleChange}
        />
        <div className="bd-provider-token-actions">
            <Button {...(toggleProps as any)} className="bd-provider-token-toggle" size={Button.Sizes.ICON} grow={false} disabled={disabled} onClick={() => setRevealed(value => !value)}>
                <Icon size="16px" aria-hidden="true" />
            </Button>
            {status.kind === "unavailable" && <Button className="bd-provider-token-retry" size={Button.Sizes.SMALL} grow={false} disabled={disabled} onClick={retry}>{t("ProviderTokens.retry")}</Button>}
        </div>
    </div>;
}
