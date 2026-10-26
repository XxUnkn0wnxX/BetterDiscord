import {providerNames, type TokenProvider} from "@common/provider-auth";
import {t} from "@common/i18n";
import Notifications from "@stores/notifications";
import type {MissingProviderPermission} from "./provider-token-validation";

export function showProviderTokenCleared(provider: TokenProvider): void {
    Notifications.show({
        id: `provider-token-cleared-${provider}`,
        title: t("ProviderTokens.clearedTitle"),
        content: t("ProviderTokens.cleared", {provider: providerNames[provider]}),
        type: "warning",
        duration: Infinity,
        actions: [{label: t("ProviderTokens.dismiss")}]
    });
}

export function showProviderTokenPermissionWarning(provider: TokenProvider, permission: MissingProviderPermission): void {
    if (provider !== "gitlab" && provider !== "slowbro") return;
    const access = permission === "user-read" ? "User → Read" : permission;
    Notifications.show({
        id: `provider-token-permissions-${provider}`,
        title: t("ProviderTokens.permissionsTitle"),
        content: t(`ProviderTokens.permissions.${provider}`, {permission: access}),
        type: "warning",
        duration: Infinity,
        actions: [{label: t("ProviderTokens.dismiss")}]
    });
}
