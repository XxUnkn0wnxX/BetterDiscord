import {afterEach, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import path from "node:path";

const styles = path.join(import.meta.dir, "../../../src/betterdiscord/styles");
const index = readFileSync(path.join(styles, "index.css"), "utf8");
const css = Array.from(index.matchAll(/@import "([^"]+)";/g), ([, file]) =>
    readFileSync(path.join(styles, file), "utf8")
).join("\n");

afterEach(() => document.body.replaceChildren());

test("paginator dimensions survive the complete stylesheet's later button defaults", () => {
    const style = document.createElement("style");
    style.textContent = css;
    const paginator = document.createElement("div");
    paginator.className = "bd-paginator";
    document.body.append(style, paginator);

    for (const direction of ["back", "next"]) {
        const button = document.createElement("button");
        button.className = `bd-button bd-button-medium bd-button-grow bd-button-blank bd-button-color-transparent bd-paginator-${direction}`;
        paginator.append(button);
        const computed = getComputedStyle(button);
        expect(computed.height).toBe("28px");
        expect(computed.minHeight).toBe("28px");
        expect(computed.width).toBe("min-content");
        expect(computed.minWidth).toBe("28px");
        expect(computed.padding).toBe("6px");
        expect(computed.margin).toBe("4px");
        expect(computed.fontWeight).toBe("600");

        button.disabled = true;
        expect(getComputedStyle(button).cursor).toBe("not-allowed");
        expect(getComputedStyle(button).opacity).toBe("0.5");
    }
});
