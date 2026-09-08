import {expect, test} from "bun:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../../src/betterdiscord/builtins/store/addonstore.ts", import.meta.url), "utf8");

const extractRegex = (name: string) => {
    const literal = source.match(new RegExp(`const ${name} = (\\/[^\\n]+);`))?.[1];
    if (!literal) throw new Error(`Could not find ${name} in AddonStore builtin.`);

    const end = literal.lastIndexOf("/");
    return new RegExp(literal.slice(1, end), literal.slice(end + 1));
};

const protocolRegex = extractRegex("PROTOCOL_REGEX");
const appProtocolRegex = extractRegex("APP_PROTOCOL_REGEX");
const addonKinds = ["theme", "themes", "plugin", "plugins", "addon", "addons", "store"];

test("Addon Store keeps all addon protocol aliases while excluding source and editor routes", () => {
    for (const kind of addonKinds) {
        const url = `betterdiscord://${kind}/example`;
        expect(appProtocolRegex.test(url), url).toBe(true);
        expect(protocolRegex.test(`<${url}>`), `<${url}>`).toBe(true);
        expect(protocolRegex.test(`<${url}/>`), `<${url}/>`).toBe(true);
    }

    for (const url of [
        "betterdiscord://betterdiscord/webpack-modules/patched/0/192.js",
        "betterdiscord://editor/plugin/192",
        "betterdiscord://editor/theme/192"
    ]) {
        expect(appProtocolRegex.test(url), url).toBe(false);
        expect(protocolRegex.test(`<${url}>`), `<${url}>`).toBe(false);
    }
});
