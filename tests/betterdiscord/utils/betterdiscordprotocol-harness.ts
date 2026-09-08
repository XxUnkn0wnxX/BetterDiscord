import {mock} from "bun:test";

const protocolList = process.env.BD_PROTOCOL_TEST_MODE === "missing" ? undefined : ["discord:", "mailto:"];
let lookups = 0;
let lookupSources: ReadonlyArray<string | RegExp> | undefined;
let lookupOptions: Record<string, unknown> | undefined;

const webpackModule = {
    getBySource: (sources: ReadonlyArray<string | RegExp>, options: Record<string, unknown>) => {
        lookups++;
        lookupSources = sources;
        lookupOptions = options;
        return protocolList;
    }
};
const webpackPath = import.meta.resolve("../../../src/betterdiscord/webpack");
mock.module("@webpack", () => webpackModule);
mock.module(webpackPath, () => webpackModule);

const {retainBetterDiscordProtocol} = await import("../../../src/betterdiscord/utils/betterdiscordprotocol");

const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
};

if (!protocolList) {
    const release = retainBetterDiscordProtocol();
    release();
    release();
    assert(lookups === 1, "Missing protocol lists should be cached after one lookup.");
    assert(JSON.stringify(lookupSources) === JSON.stringify(["discord:", "mailto:"])
        && lookupOptions?.searchDefault === false && typeof lookupOptions?.declarationFilter === "function",
    "Protocol lookup did not use the Discord allowlist contract.");
    process.stdout.write("betterdiscord-protocol: missing ok\n");
}
else {
    const firstRelease = retainBetterDiscordProtocol();
    assert(protocolList.join(",") === "discord:,mailto:,betterdiscord:", "First owner did not add the protocol.");

    const secondRelease = retainBetterDiscordProtocol();
    firstRelease();
    firstRelease();
    assert(protocolList.includes("betterdiscord:"), "Releasing one of two owners removed the protocol.");
    secondRelease();
    assert(!protocolList.includes("betterdiscord:"), "Final release did not remove the owned protocol.");

    const reverseFirstRelease = retainBetterDiscordProtocol();
    const reverseSecondRelease = retainBetterDiscordProtocol();
    reverseSecondRelease();
    assert(protocolList.includes("betterdiscord:"), "Releasing the second owner first removed the protocol.");
    reverseFirstRelease();
    assert(!protocolList.includes("betterdiscord:"), "Reverse final release did not remove the owned protocol.");

    protocolList.push("betterdiscord:");
    const preexistingRelease = retainBetterDiscordProtocol();
    preexistingRelease();
    assert(protocolList.filter(value => value === "betterdiscord:").length === 1, "Pre-existing protocol was removed.");
    assert(lookups === 1, "Protocol list lookup was not cached.");
    assert(JSON.stringify(lookupSources) === JSON.stringify(["discord:", "mailto:"])
        && lookupOptions?.searchDefault === false && typeof lookupOptions?.declarationFilter === "function",
    "Protocol lookup did not use the Discord allowlist contract.");

    process.stdout.write("betterdiscord-protocol: ok\n");
}
