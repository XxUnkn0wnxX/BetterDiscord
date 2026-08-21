import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import NumberInput from "@ui/settings/components/number";


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

async function enterNumber(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
}

function button(className: string) {
    return container.querySelector<HTMLButtonElement>(`button.${className}`)!;
}

describe("Number setting control", () => {
    test("follows controlled rerenders and updates uncontrolled state with numeric callbacks", async () => {
        await render(<NumberInput value={2} min={0} max={10} />);
        const controlledInput = container.querySelector<HTMLInputElement>("input")!;
        expect(controlledInput.value).toBe("2");

        await render(<NumberInput value={7} min={0} max={10} />);
        expect(controlledInput.value).toBe("7");

        const changes: number[] = [];
        await render(<NumberInput key="uncontrolled" defaultValue={2} onChange={value => changes.push(value)} />);
        const uncontrolledInput = container.querySelector<HTMLInputElement>("input")!;
        await act(async () => button("bd-number-input-increment").click());

        expect(uncontrolledInput.value).toBe("3");
        expect(changes).toEqual([3]);
        expect(changes.every(value => typeof value === "number" && globalThis.Number.isFinite(value))).toBe(true);
    });

    test("decrement honors min, including max-only and min-only ranges", async () => {
        const changes: number[] = [];

        await render(<NumberInput key="max-only" defaultValue={10} max={10} onChange={value => changes.push(value)} />);
        await act(async () => button("bd-number-input-decrement").click());
        expect(changes).toEqual([9]);

        await render(<NumberInput key="mid" defaultValue={5} min={0} max={10} onChange={value => changes.push(value)} />);
        await act(async () => button("bd-number-input-decrement").click());
        expect(changes).toEqual([9, 4]);

        await render(<NumberInput key="min-only" defaultValue={0} min={0} onChange={value => changes.push(value)} />);
        await act(async () => button("bd-number-input-decrement").click());
        expect(changes).toEqual([9, 4]);

        await render(<NumberInput key="unbounded" defaultValue={5} onChange={value => changes.push(value)} />);
        await act(async () => button("bd-number-input-decrement").click());
        expect(changes).toEqual([9, 4, 4]);
    });

    test("increment stops at max", async () => {
        const changes: number[] = [];
        await render(<NumberInput defaultValue={10} max={10} onChange={value => changes.push(value)} />);

        await act(async () => button("bd-number-input-increment").click());

        expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("10");
        expect(changes).toEqual([]);
    });

    test("coerces legacy numeric string state for +/- and ignores non-finite state", async () => {
        const changes: number[] = [];
        const legacyNumericProps = {
            value: "5",
            onChange: (value: number) => changes.push(value)
        } as unknown as React.ComponentProps<typeof NumberInput>;

        await render(<NumberInput {...legacyNumericProps} />);
        await act(async () => button("bd-number-input-increment").click());
        await act(async () => button("bd-number-input-decrement").click());

        expect(changes).toEqual([6, 4]);

        const nonFiniteLegacyProps = {
            value: "not-a-number",
            onChange: (value: number) => changes.push(value)
        } as unknown as React.ComponentProps<typeof NumberInput>;
        await render(<NumberInput {...nonFiniteLegacyProps} />);
        await act(async () => {
            button("bd-number-input-increment").click();
            button("bd-number-input-decrement").click();
        });

        expect(changes).toEqual([6, 4]);
    });

    test("rejects empty, invalid, and non-finite input without NaN or losing the last valid value", async () => {
        const changes: number[] = [];
        await render(<NumberInput defaultValue={5} onChange={value => changes.push(value)} />);
        const input = container.querySelector<HTMLInputElement>("input")!;

        await enterNumber(input, "");
        await enterNumber(input, "not-a-number");
        await enterNumber(input, "Infinity");

        expect(input.value).toBe("5");
        expect(changes).toEqual([]);
    });

    test("disabled controls block every callback and interaction", async () => {
        const changes: number[] = [];
        await render(<NumberInput defaultValue={5} disabled onChange={value => changes.push(value)} />);
        const input = container.querySelector<HTMLInputElement>("input")!;

        expect(input.disabled).toBe(true);
        expect(button("bd-number-input-decrement").disabled).toBe(true);
        expect(button("bd-number-input-increment").disabled).toBe(true);

        await act(async () => {
            button("bd-number-input-decrement").click();
            button("bd-number-input-increment").click();
        });
        await enterNumber(input, "6");

        expect(input.value).toBe("5");
        expect(changes).toEqual([]);
    });
});
