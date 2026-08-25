import {describe, expect, test} from "bun:test";
import path from "node:path";
import {readFileSync} from "node:fs";


function normalizeSelector(selector: string): string {
    return selector
        .replace(/\s+/g, " ")
        .trim();
}

function findRule(css: string, exactSelector: string) {
    const normalizedExpected = normalizeSelector(exactSelector);
    const selectorPattern = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = selectorPattern.exec(css)) !== null) {
        const selectors = match[1].split(",").map(normalizeSelector);
        if (selectors.includes(normalizedExpected)) {
            return {
                raw: match[1].trim(),
                declarations: match[2].trim()
            };
        }
    }

    throw new Error(`Did not find CSS rule for selector ${exactSelector}`);
}

function parseDeclarations(block: string): Record<string, string> {
    const declarations: Record<string, string> = {};
    for (const declaration of block.split(";")) {
        const text = declaration.trim();
        if (!text) continue;

        const separator = text.indexOf(":");
        if (separator < 0) continue;

        const property = text.slice(0, separator).trim().toLowerCase();
        const value = text.slice(separator + 1).trim();
        declarations[property] = value;
    }

    return declarations;
}

describe("Addon store thumbnail CSS assertions", () => {
    const addonStoreCss = readFileSync(
        path.join(import.meta.dir, "../../../src/betterdiscord/styles/ui/addonstore.css"),
        "utf8"
    );
    const installModalCss = readFileSync(
        path.join(import.meta.dir, "../../../src/betterdiscord/styles/ui/installmodal.css"),
        "utf8"
    );

    test("only blob preview rules scale and use centered transform origin", () => {
        const blobPreviewRules = [
            ".bd-addon-store-card-preview-img[src^=\"blob:\"]",
            ".bd-install-modal-preview-img[src^=\"blob:\"]"
        ];
        for (const selector of blobPreviewRules) {
            const cssSource = selector.includes("addon-store")
                ? addonStoreCss
                : installModalCss;
            const rule = findRule(cssSource, selector);
            const declarations = parseDeclarations(rule.declarations);

            expect(declarations.transform).toBe("scale(1.01)");
            expect(declarations["transform-origin"]).toBe("center");
            expect(declarations.width).toBeUndefined();
            expect(declarations.height).toBeUndefined();
        }

        const baseSelectors = [
            ".bd-addon-store-card-preview-img",
            ".bd-install-modal-preview-img"
        ];
        for (const selector of baseSelectors) {
            const cssSource = selector.includes("addon-store")
                ? addonStoreCss
                : installModalCss;
            const rule = findRule(cssSource, selector);
            const declarations = parseDeclarations(rule.declarations);

            expect(declarations.transform).toBeUndefined();
        }
    });

    test("splash/card containers keep expected overflow behavior", () => {
        const overflowRules = [
            {source: addonStoreCss, selector: ".bd-addon-store-card", expected: "hidden"},
            {source: installModalCss, selector: ".bd-addon-store-modal", expected: "hidden"},
            {source: addonStoreCss, selector: ".bd-addon-store-card-splash", expected: "visible"},
            {source: installModalCss, selector: ".bd-install-modal-splash", expected: "visible"}
        ];

        for (const {source, selector, expected} of overflowRules) {
            const rule = findRule(source, selector);
            const declarations = parseDeclarations(rule.declarations);
            expect(declarations.overflow).toBe(expected);
        }
    });
});
