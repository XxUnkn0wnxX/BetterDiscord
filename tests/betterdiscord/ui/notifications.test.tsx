import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");
const notificationsCss = readFileSync(
    path.join(import.meta.dir, "../../../src/betterdiscord/styles/ui/notifications.css"),
    "utf8"
);

function findRule(css: string, selector: string): string {
    const normalizedSelector = selector.replace(/\s+/g, " ").trim();
    const rules = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = rules.exec(css)) !== null) {
        const selectors = match[1].split(",").map(value => value.replace(/\s+/g, " ").trim());
        if (selectors.includes(normalizedSelector)) return match[2];
    }

    throw new Error(`Did not find CSS rule for selector ${selector}`);
}

function parseDeclarations(block: string): Record<string, string> {
    const declarations: Record<string, string> = {};
    for (const declaration of block.split(";")) {
        const separator = declaration.indexOf(":");
        if (separator < 0) continue;

        declarations[declaration.slice(0, separator).trim().toLowerCase()] = declaration.slice(separator + 1).trim();
    }
    return declarations;
}

describe("notification store and UI", () => {
    test("passes the isolated notification harness", () => {
        const harness = path.join(import.meta.dir, "notifications-harness.tsx");
        const result = Bun.spawnSync({
            cmd: [process.execPath, "test", harness],
            cwd,
            stdout: "pipe",
            stderr: "pipe"
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();
        expect(result.exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
    });
});

test("keeps notification button layout contract", () => {
    const footerButtonRule = findRule(notificationsCss, ".bd-notification-footer button");
    const footerButton = parseDeclarations(footerButtonRule);
    expect(footerButton.overflow).toBe("hidden");
    expect(footerButton["text-overflow"]).toBe("ellipsis");
    expect(footerButton["white-space"]).toBe("nowrap");

    const actionRule = findRule(notificationsCss, ".bd-notification-action");
    const action = parseDeclarations(actionRule);
    expect(action["white-space"]).toBe("nowrap");
    expect(action.flex).toBe("1 1 auto !important");
    expect(action.width).toBe("auto !important");
    expect(action["min-width"]).toBe("0 !important");
    expect(action["max-width"]).toBe("none !important");
    expect(actionRule).not.toMatch(/calc\(\s*100%\s*\/\s*3\s*-\s*8px\s*\)/);
});
