import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import path from "node:path";

const cwd = path.join(import.meta.dir, "../../..");
const buttonCss = readFileSync(
    path.join(import.meta.dir, "../../../src/betterdiscord/styles/buttons.css"),
    "utf8"
);
const modalCss = readFileSync(
    path.join(import.meta.dir, "../../../src/betterdiscord/styles/ui/modal.css"),
    "utf8"
);

describe("upstream modal and button components", () => {
    test("passes the isolated component harness", () => {
        const harness = path.join(import.meta.dir, "modal-components-harness.tsx");
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

function declarationsFor(selector: string, css: string): Record<string, string> {
    const normalizedSelector = selector.replace(/\s+/g, " ").trim();
    const rules = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = rules.exec(css)) !== null) {
        const selectors = match[1].split(",").map(value => value.replace(/\s+/g, " ").trim());
        if (selectors.includes(normalizedSelector)) {
            return Object.fromEntries(match[2].split(";").flatMap(declaration => {
                const separator = declaration.indexOf(":");
                if (separator < 0) return [];
                return [[declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim()]];
            }));
        }
    }

    throw new Error(`Did not find CSS rule for selector ${selector}`);
}

test("keeps connected green token fallbacks for old and current Discord themes", () => {
    const expectedFallbacks = [
        "--control-connected-background-default|--control-connect-background-default",
        "--control-connected-background-hover|--control-connect-background-hover",
        "--control-connected-background-active|--control-connect-background-active",
        "--control-connected-border-default|--control-connect-border-default",
        "--control-connected-border-hover|--control-connect-border-hover",
        "--control-connected-border-active|--control-connect-border-active"
    ];
    const fallbackPairs = [...buttonCss.matchAll(/var\((--control-connected-[\w-]+),\s*var\((--control-connect-[\w-]+)\)\)/g)]
        .map(([, preferred, fallback]) => `${preferred}|${fallback}`);

    expect(fallbackPairs).toEqual([
        expectedFallbacks[0], expectedFallbacks[1], expectedFallbacks[2], expectedFallbacks[3],
        expectedFallbacks[1], expectedFallbacks[4], expectedFallbacks[2], expectedFallbacks[5]
    ]);

    for (const expected of expectedFallbacks) expect(fallbackPairs).toContain(expected);
});

test("prefers connected green tokens and resolves legacy connect fallbacks", () => {
    const buttonStyles = document.createElement("style");
    buttonStyles.textContent = buttonCss;
    const themeStyles = document.createElement("style");
    themeStyles.textContent = `:root {
        --white-500: rgb(255, 255, 255);
        --control-connected-background-default: rgb(1, 2, 3);
        --control-connected-background-hover: rgb(2, 3, 4);
        --control-connected-background-active: rgb(3, 4, 5);
        --control-connected-border-default: rgb(4, 5, 6);
        --control-connected-border-hover: rgb(5, 6, 7);
        --control-connected-border-active: rgb(6, 7, 8);
        --control-connect-background-default: rgb(11, 12, 13);
        --control-connect-background-hover: rgb(12, 13, 14);
        --control-connect-background-active: rgb(13, 14, 15);
        --control-connect-border-default: rgb(14, 15, 16);
        --control-connect-border-hover: rgb(15, 16, 17);
        --control-connect-border-active: rgb(16, 17, 18);
    }`;
    document.head.append(buttonStyles, themeStyles);

    const filled = document.createElement("button");
    filled.className = "bd-button bd-button-filled bd-button-color-green";
    const outlined = document.createElement("button");
    outlined.className = "bd-button bd-button-outlined bd-button-color-green";
    document.body.append(filled, outlined);

    try {
        expect(getComputedStyle(filled).backgroundColor).toBe("rgb(1, 2, 3)");
        expect(getComputedStyle(outlined).borderTopColor).toBe("rgb(4, 5, 6)");

        themeStyles.textContent = `:root {
            --white-500: rgb(255, 255, 255);
            --control-connect-background-default: rgb(11, 12, 13);
            --control-connect-border-default: rgb(14, 15, 16);
        }`;
        expect(getComputedStyle(filled).backgroundColor).toBe("rgb(11, 12, 13)");
        expect(getComputedStyle(outlined).borderTopColor).toBe("rgb(14, 15, 16)");
    }
    finally {
        filled.remove();
        outlined.remove();
        buttonStyles.remove();
        themeStyles.remove();
    }
});

test("retains the shared modal root padding and removes invalid duplicate layout declarations", () => {
    expect(declarationsFor(".bd-modal-root", modalCss).padding).toBe("10px");
    expect(modalCss).not.toMatch(/display:\s*(?:box|flexbox)\s*;/);

    const transforms = [...modalCss.matchAll(/transform:\s*translateZ\(0\)\s*;/g)];
    expect(transforms).toHaveLength(1);
});
