import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

mock.module("@modules/discordmodules", () => ({
    "default": {
        Tooltip: ({children}: {children: (props: Record<string, never>) => React.ReactNode;}) => children({})
    }
}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));

const {default: ColorPicker} = await import("@ui/settings/components/color");


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

async function render(children: React.ReactNode) {
    await act(async () => root.render(children));
}

async function chooseColor(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
}

function resetButton() {
    return container.querySelector<HTMLDivElement>(".bd-color-picker-default")!;
}

describe("Color setting control", () => {
    test("keeps the controlled value separate from the deprecated legacy reset alias", async () => {
        const changes: Array<string | number> = [];
        await render(
            <ColorPicker
                value="#ff0000"
                defaultValue="#00ff00"
                colors={[]}
                onChange={value => changes.push(value)}
            />
        );
        const input = container.querySelector<HTMLInputElement>("input.bd-color-picker")!;

        expect(input.value).toBe("#ff0000");
        expect(resetButton()).not.toBeNull();

        await act(async () => resetButton().click());

        expect(changes).toEqual(["#00ff00"]);
        expect(input.value).toBe("#ff0000");
    });

    test("prefers explicit defaultColor over the deprecated alias", async () => {
        const changes: Array<string | number> = [];
        await render(
            <ColorPicker
                value="#ff0000"
                defaultValue="#00ff00"
                defaultColor="#0000ff"
                colors={[]}
                onChange={value => changes.push(value)}
            />
        );

        await act(async () => resetButton().click());

        expect(changes).toEqual(["#0000ff"]);
    });

    test("uses uncontrolled defaultValue only for initial state and keeps reset separate", async () => {
        const changes: Array<string | number> = [];
        await render(
            <ColorPicker
                defaultValue="#112233"
                defaultColor="#445566"
                colors={[]}
                onChange={value => changes.push(value)}
            />
        );
        const input = container.querySelector<HTMLInputElement>("input.bd-color-picker")!;

        expect(input.value).toBe("#112233");
        await act(async () => resetButton().click());

        expect(input.value).toBe("#445566");
        expect(changes).toEqual(["#445566"]);
    });

    test("recognizes numeric zero as a reset color", async () => {
        const changes: Array<string | number> = [];
        await render(
            <ColorPicker
                value="#010101"
                defaultColor={0}
                colors={[]}
                onChange={value => changes.push(value)}
            />
        );

        expect(resetButton()).not.toBeNull();
        await act(async () => resetButton().click());

        expect(changes).toEqual(["#0"]);
    });

    test("follows controlled rerenders and calls back once for a swatch action", async () => {
        const changes: Array<string | number> = [];
        await render(
            <ColorPicker
                value="#111111"
                colors={["#222222"]}
                onChange={value => changes.push(value)}
            />
        );
        const input = container.querySelector<HTMLInputElement>("input.bd-color-picker")!;
        expect(input.value).toBe("#111111");

        await render(
            <ColorPicker
                value="#333333"
                colors={["#222222"]}
                onChange={value => changes.push(value)}
            />
        );
        expect(input.value).toBe("#333333");

        await act(async () => container.querySelector<HTMLDivElement>(".bd-color-picker-swatch-item")!.click());

        expect(changes).toEqual(["#222222"]);
        expect(input.value).toBe("#333333");
    });

    test("calls back once for an uncontrolled custom color change", async () => {
        const changes: Array<string | number> = [];
        await render(<ColorPicker defaultValue="#111111" colors={[]} onChange={value => changes.push(value)} />);
        const input = container.querySelector<HTMLInputElement>("input.bd-color-picker")!;

        await chooseColor(input, "#abcdef");

        expect(input.value).toBe("#abcdef");
        expect(changes).toEqual(["#abcdef"]);
    });

    test("disabled controls block reset, swatch, and custom color callbacks", async () => {
        const changes: Array<string | number> = [];
        await render(
            <ColorPicker
                defaultValue="#111111"
                defaultColor={0}
                colors={["#222222"]}
                disabled
                onChange={value => changes.push(value)}
            />
        );
        const input = container.querySelector<HTMLInputElement>("input.bd-color-picker")!;

        expect(input.disabled).toBe(true);
        await act(async () => {
            resetButton().click();
            container.querySelector<HTMLDivElement>(".bd-color-picker-swatch-item")!.click();
        });
        await chooseColor(input, "#abcdef");

        expect(changes).toEqual([]);
        expect(input.value).toBe("#111111");
        expect(container.firstElementChild?.classList.contains("bd-color-picker-disabled")).toBe(true);
    });
});
