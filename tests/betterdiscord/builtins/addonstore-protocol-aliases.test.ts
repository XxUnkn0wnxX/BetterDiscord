import {expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";

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

test("permanent Store initializes real builtin patches, launch protocols and shared ownership despite old false", () => {
    const result = Bun.spawnSync({
        cmd: [process.execPath, path.join(import.meta.dir, "addonstore-lifecycle-harness.ts")],
        cwd: path.join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe"
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("addon-store-builtin-lifecycle: ok");
});

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
