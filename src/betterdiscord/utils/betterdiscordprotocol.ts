import {getBySource} from "@webpack";

const BETTERDISCORD_PROTOCOL = "betterdiscord:";

let protocolList: string[] | null | undefined;
let ownerCount = 0;
let ownsProtocol = false;

function getProtocolList() {
    if (protocolList !== undefined) return protocolList;

    protocolList = getBySource<string[]>(["discord:", "mailto:"], {
        searchDefault: false,
        declarationFilter: value => Array.isArray(value) && value.includes("discord:")
    }) ?? null;

    return protocolList;
}

/**
 * Retain BetterDiscord's protocol in Discord's protocol allowlist.
 *
 * The returned release function is idempotent. A pre-existing entry remains
 * owned by Discord, while an entry added here is removed after its final owner
 * releases it.
 */
export function retainBetterDiscordProtocol() {
    const list = getProtocolList();
    let released = false;

    if (list) {
        if (!list.includes(BETTERDISCORD_PROTOCOL)) {
            list.push(BETTERDISCORD_PROTOCOL);
            ownsProtocol = true;
        }

        ownerCount++;
    }

    return () => {
        if (released) return;
        released = true;

        if (!list) return;

        ownerCount--;
        if (ownerCount !== 0 || !ownsProtocol) return;

        const index = list.indexOf(BETTERDISCORD_PROTOCOL);
        if (index !== -1) list.splice(index, 1);
        ownsProtocol = false;
    };
}
