import {describe, expect, test} from "bun:test";

import {isDiscordsaysFrame, wrapContentWindow} from "../../src/betterdiscord/secure";


describe("secure iframe hardening", () => {
    test("allows raw contentWindow for discordsays.com frames", () => {
        expect(isDiscordsaysFrame("https://activity.discordsays.com/widget", "https://betterdiscord.app")).toBe(true);

        const original = {
            localStorage: {token: "forbidden"},
            marker: 123,
        } as unknown as Window;

        const wrapped = wrapContentWindow(original, "https://activity.discordsays.com/widget");
        expect(wrapped).toBe(original);
        expect((wrapped as Window).localStorage).toBe((original as Window).localStorage);
    });

    test("preserves proxy behavior for unrelated and lookalike hosts", () => {
        expect(isDiscordsaysFrame("https://discordsays.com/widget", "https://betterdiscord.app")).toBe(false);
        expect(isDiscordsaysFrame("https://evil-discordsays.com/widget", "https://betterdiscord.app")).toBe(false);
        expect(isDiscordsaysFrame("https://activity.discordsays.com.evil.invalid/widget", "https://betterdiscord.app")).toBe(false);

        const original = {
            localStorage: {token: "forbidden"},
            getValue: function () {
                return this === original;
            },
        } as unknown as Window;

        const wrapped = wrapContentWindow(original, "https://activity.discordsays.co");
        expect(wrapped).not.toBe(original);
        expect((wrapped as any).localStorage).toBe(null);
        expect(Object.getOwnPropertyDescriptor(wrapped as object, "localStorage")).toBeUndefined();
        expect((wrapped as any).getValue()).toBe(true);
    });
});
