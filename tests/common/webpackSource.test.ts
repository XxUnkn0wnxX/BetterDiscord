import {describe, expect, test} from "bun:test";

import {parseWebpackSourceLink} from "../../src/common/webpackSource";

const source = "betterdiscord://betterdiscord/webpack-modules/patched/0/192.js";

describe("Webpack source links", () => {
    test("keeps upstream defaults, query coordinates and hash precedence", () => {
        expect(parseWebpackSourceLink(source)).toEqual({url: source, line: 0, column: 0});
        expect(parseWebpackSourceLink(`${source}?line=2&column=20`)).toEqual({url: source, line: 2, column: 20});
        expect(parseWebpackSourceLink(`${source}?line=2&column=20#5:6`)).toEqual({url: source, line: 5, column: 6});
        expect(parseWebpackSourceLink(`${source}?line=2&column=20#ignored`)).toEqual({url: source, line: 2, column: 20});
    });

    test("normalizes invalid positions without changing ordinary parseInt behavior", () => {
        expect(parseWebpackSourceLink(`${source}?line=-2&column=invalid`)).toEqual({url: source, line: 0, column: 0});
        expect(parseWebpackSourceLink(`${source}#3px:4.5`)).toEqual({url: source, line: 3, column: 4});
        expect(parseWebpackSourceLink(`${source}?line=${"9".repeat(400)}&column=9007199254740992`)).toEqual({url: source, line: 0, column: 0});
        expect(parseWebpackSourceLink(`${source}#:`)).toEqual({url: source, line: 0, column: 0});
    });

    test("ignores unrelated routes and URLs normalized outside the source namespace", () => {
        for (const value of [null, undefined, 42, {}, "", "https://example.com/", "betterdiscord://store/192",
            "betterdiscord://editor/plugin/192", "betterdiscord://plugin/192",
            "betterdiscord://betterdiscord/webpack-modules/patched/",
            "betterdiscord://betterdiscord/webpack-modules/patched/../original/192.js",
            "betterdiscord://betterdiscord/webpack-modules/patched/%2e%2e/original/192.js"]) {
            expect(parseWebpackSourceLink(value)).toBeNull();
        }
    });
});
