import Events from "@modules/emitter";

import type {Addon, AddonType} from "@typed/addon";

export interface AddonSettingsModalIdentity {
    id: string;
    type: AddonType;
}

export function watchAddonSettingsUnload(identity: AddonSettingsModalIdentity, onClose: () => void) {
    const eventName = `${identity.type}-unloaded`;
    let active = true;

    // Settings panels belong to the addon instance that created them. A reload
    // close bypasses the normal Done/confirm path so BetterDiscord does not save.
    const listener = (addon?: Pick<Addon, "id">) => {
        if (!active || addon?.id !== identity.id) return;
        active = false;
        Events.off(eventName, listener);
        onClose();
    };

    Events.on(eventName, listener);
    return () => {
        active = false;
        Events.off(eventName, listener);
    };
}
