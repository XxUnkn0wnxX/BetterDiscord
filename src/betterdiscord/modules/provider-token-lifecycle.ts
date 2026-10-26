import {getProviderTokenGeneration, normalizeProviderToken, type TokenProvider} from "@common/provider-auth";
import Settings from "@stores/settings";
import Events from "./emitter";
import {setProviderTokenFailureHandler, type ProviderTokenFailure} from "./net";
import {showProviderTokenCleared} from "./provider-token-notices";
import {validateProviderToken} from "./provider-token-validation";

interface ActiveValidation {
    token: string;
    generation: number;
    controller: AbortController;
    promise: Promise<void>;
}

const active = new Map<TokenProvider, ActiveValidation>();
let initialized = false;

function stillCurrent({authorization, generation}: ProviderTokenFailure): boolean {
    return generation === getProviderTokenGeneration(authorization.provider)
        && normalizeProviderToken(Settings.get("settings", "accessTokens", authorization.provider)) === authorization.token;
}

async function handleFailure(failure: ProviderTokenFailure): Promise<void> {
    if (!stillCurrent(failure)) return;
    const {provider, token} = failure.authorization;
    const previous = active.get(provider);
    if (previous?.token === token && previous.generation === failure.generation) return previous.promise;
    previous?.controller.abort();

    const controller = new AbortController();
    const validation: ActiveValidation = {
        token,
        generation: failure.generation,
        controller,
        promise: Promise.resolve()
    };
    validation.promise = Promise.resolve().then(async () => {
        if (controller.signal.aborted || !stillCurrent(failure)) return;
        const result = await validateProviderToken(provider, token, controller.signal, "validity");
        if (controller.signal.aborted || result.status !== "invalid" || !stillCurrent(failure)) return;
        Settings.set("settings", "accessTokens", provider, "");
        // A synchronous settings subscriber may already have supplied a replacement.
        if (normalizeProviderToken(Settings.get("settings", "accessTokens", provider))) return;
        Events.dispatch("provider-token-cleared", provider);
        showProviderTokenCleared(provider);
    }).finally(() => {
        if (active.get(provider) === validation) active.delete(provider);
    });
    active.set(provider, validation);
    return validation.promise;
}

export function initializeProviderTokenLifecycle(): void {
    if (initialized) return;
    initialized = true;
    setProviderTokenFailureHandler(handleFailure);
    Events.on("setting-updated", (collection: string, category: string, id: TokenProvider) => {
        if (collection !== "settings" || category !== "accessTokens") return;
        const validation = active.get(id);
        if (!validation || validation.generation === getProviderTokenGeneration(id)) return;
        validation.controller.abort();
        if (active.get(id) === validation) active.delete(id);
    });
}
