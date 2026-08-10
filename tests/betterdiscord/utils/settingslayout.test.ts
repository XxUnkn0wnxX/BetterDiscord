import {describe, expect, test} from "bun:test";

import {getBetterDiscordSectionIndex} from "../../../src/betterdiscord/utils/settingslayout";

const makeSection = (key?: string, children: Array<{key?: string}> = []) => {
    return {
        key,
        buildLayout() {
            return children;
        }
    };
};

describe("getBetterDiscordSectionIndex", () => {
    test("prioritizes footer child anchors over direct section anchors", () => {
        for (const footerKey of ["developer_panel", "logout_sidebar_item"]) {
            const index = getBetterDiscordSectionIndex([
                makeSection("games_and_apps_section"),
                makeSection("activity_section"),
                makeSection(),
                makeSection(undefined, [{key: footerKey}])
            ]);

            expect(index).toBe(3);
        }
    });

    test("falls back to games_and_apps_section with +1 insertion offset", () => {
        const index = getBetterDiscordSectionIndex([
            makeSection(),
            makeSection("games_and_apps_section"),
            makeSection("activity_section")
        ]);

        expect(index).toBe(2);
    });

    test("falls back to activity_section with +1 insertion offset", () => {
        const index = getBetterDiscordSectionIndex([
            makeSection(),
            makeSection("activity_section"),
            makeSection()
        ]);

        expect(index).toBe(2);
    });

    test("falls back to known child panels with +1 insertion offset", () => {
        for (const childKey of ["activity_privacy_panel", "registered_games_panel", "language_and_time_panel"]) {
            const index = getBetterDiscordSectionIndex([
                makeSection(),
                makeSection(undefined, [{key: childKey}]),
                makeSection()
            ]);

            expect(index).toBe(2);
        }
    });

    test("skips throwing buildLayout sections and continues matching later anchors", () => {
        const index = getBetterDiscordSectionIndex([
            {buildLayout: () => {
                throw new Error("broken");
            }},
            makeSection(undefined, [{key: "activity_privacy_panel"}])
        ]);

        expect(index).toBe(2);
    });

    test("returns layouts.length when no anchors are found", () => {
        const index = getBetterDiscordSectionIndex([
            makeSection(),
            makeSection()
        ]);

        expect(index).toBe(2);
        expect(index).not.toBe(0);
    });
});
