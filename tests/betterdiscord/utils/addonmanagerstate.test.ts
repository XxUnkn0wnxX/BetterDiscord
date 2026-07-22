import {describe, expect, test} from "bun:test";

import {pruneMissingAddonState, sortAddonState} from "../../../src/betterdiscord/utils/addonmanagerstate";


describe("addon manager state inventory", () => {
    test("removes missing addons while retaining enabled, disabled, and broken entries", () => {
        const state: Record<string, boolean> = {
            "Enabled Addon": true,
            "Disabled Addon": false,
            "Broken Addon": false,
            "Deleted Addon": true
        };

        const removed = pruneMissingAddonState(state, ["Enabled Addon", "Disabled Addon", "Broken Addon"]);

        expect(removed).toEqual(["Deleted Addon"]);
        expect(state).toEqual({
            "Enabled Addon": true,
            "Disabled Addon": false,
            "Broken Addon": false
        });
    });

    test("defers unknown-ID pruning while addon-file inventory is incomplete", () => {
        const state: Record<string, boolean> = {"Temporarily Unreadable Addon": true, "Known Addon": false};

        expect(pruneMissingAddonState(state, ["Known Addon"], false)).toEqual([]);
        expect(state).toEqual({"Temporarily Unreadable Addon": true, "Known Addon": false});
    });

    test("sorts serialized state from numeric IDs through A-Z", () => {
        const sorted = sortAddonState({
            "Beta Addon": false,
            "10 Tools": true,
            "_Other": false,
            "Alpha Addon": true,
            "2 Tools": false,
            "1 Tool": true
        });

        expect(Object.keys(sorted)).toEqual([
            "1 Tool",
            "2 Tools",
            "10 Tools",
            "Alpha Addon",
            "Beta Addon",
            "_Other"
        ]);
    });

    test("canonical output contains one key after duplicate JSON input", () => {
        const parsed = JSON.parse("{\"Duplicate Addon\":true,\"Duplicate Addon\":false,\"Alpha\":true}") as Record<string, boolean>;
        const serialized = JSON.stringify(sortAddonState(parsed));

        expect(parsed["Duplicate Addon"]).toBe(false);
        expect(serialized.match(/"Duplicate Addon"/g)?.length).toBe(1);
    });
});
