import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import CheckBox, {type CheckboxProps} from "@ui/settings/components/checkbox";
import Position from "@ui/settings/components/position";
import Radio, {type RadioOption} from "@ui/settings/components/radio";
import Switch, {type SwitchProps} from "@ui/settings/components/switch";
import Textbox from "@ui/settings/components/textbox";


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

async function enterText(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
}

describe("basic setting controls", () => {
    test("Switch accepts controlled and default props", () => {
        const controlled: SwitchProps = {value: false};
        const uncontrolled: SwitchProps = {defaultValue: false};

        expect(controlled.value).toBe(false);
        expect(uncontrolled.defaultValue).toBe(false);
    });

    test("Switch follows controlled rerenders and updates uncontrolled state once", async () => {
        await render(<Switch value={false} />);
        const input = container.querySelector<HTMLInputElement>("input")!;
        expect(input.checked).toBe(false);

        await render(<Switch value={true} />);
        expect(input.checked).toBe(true);

        const changes: boolean[] = [];
        await render(<Switch key="uncontrolled" defaultValue={false} onChange={value => changes.push(value)} />);
        const uncontrolledInput = container.querySelector<HTMLInputElement>("input")!;
        await act(async () => uncontrolledInput.click());

        expect(uncontrolledInput.checked).toBe(true);
        expect(changes).toEqual([true]);
    });

    test("Switch disabled state blocks callbacks and is rendered disabled", async () => {
        const changes: boolean[] = [];
        await render(<Switch defaultValue={false} disabled onChange={value => changes.push(value)} />);
        const input = container.querySelector<HTMLInputElement>("input")!;

        await act(async () => input.click());

        expect(changes).toEqual([]);
        expect(input.disabled).toBe(true);
        expect(container.firstElementChild?.classList.contains("bd-switch-disabled")).toBe(true);
    });

    test("Textbox follows controlled rerenders and updates an uncontrolled value once", async () => {
        await render(<Textbox value="first" />);
        const input = container.querySelector<HTMLInputElement>("input")!;
        expect(input.value).toBe("first");

        await render(<Textbox value="second" />);
        expect(input.value).toBe("second");

        const changes: string[] = [];
        await render(<Textbox key="uncontrolled" defaultValue="first" onChange={value => changes.push(value)} />);
        const uncontrolledInput = container.querySelector<HTMLInputElement>("input")!;
        await enterText(uncontrolledInput, "changed");

        expect(uncontrolledInput.value).toBe("changed");
        expect(changes).toEqual(["changed"]);
    });

    test("Textbox disabled state blocks input callbacks and is rendered disabled", async () => {
        const changes: string[] = [];
        await render(<Textbox defaultValue="fixed" disabled onChange={value => changes.push(value)} />);
        const input = container.querySelector<HTMLInputElement>("input")!;

        await enterText(input, "ignored");

        expect(input.value).toBe("fixed");
        expect(changes).toEqual([]);
        expect(input.disabled).toBe(true);
    });

    test("Checkbox supports uncontrolled toggles and preserves disabled classes", async () => {
        const props: CheckboxProps = {defaultValue: false};
        const changes: boolean[] = [];
        await render(<CheckBox {...props} onChange={value => changes.push(value)} label="Enable" />);
        const input = container.querySelector<HTMLInputElement>("input")!;

        await act(async () => input.click());
        expect(input.checked).toBe(true);
        expect(changes).toEqual([true]);

        await render(<CheckBox defaultValue={false} disabled onChange={value => changes.push(value)} />);
        const disabledInput = container.querySelector<HTMLInputElement>("input")!;
        await act(async () => disabledInput.click());

        expect(changes).toEqual([true]);
        expect(disabledInput.disabled).toBe(true);
        expect(container.firstElementChild?.classList.contains("bd-checkbox-disabled")).toBe(true);
    });

    test("Position updates its selected box once and blocks disabled actions", async () => {
        const changes: string[] = [];
        await render(<Position defaultValue="top-left" onChange={value => changes.push(value)} />);
        const right = container.querySelector<HTMLButtonElement>("button.bottom-right")!;

        await act(async () => right.click());
        expect(right.classList.contains("selected")).toBe(true);
        expect(changes).toEqual(["bottom-right"]);

        await render(<Position defaultValue="top-left" disabled onChange={value => changes.push(value)} />);
        const disabledRight = container.querySelector<HTMLButtonElement>("button.bottom-right")!;
        await act(async () => disabledRight.click());

        expect(changes).toEqual(["bottom-right"]);
        expect(disabledRight.disabled).toBe(true);
        expect(container.querySelector(".bd-container-disabled")).not.toBeNull();
    });

    test("Radio follows controlled rerenders, supports desc fallback, and calls once", async () => {
        const options: RadioOption[] = [
            {name: "First", value: "first", desc: "legacy description"},
            {name: "Second", value: "second", description: "current description"}
        ];
        await render(<Radio value="first" options={options} />);
        expect(container.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
        expect(container.querySelector(".bd-radio-description")?.textContent).toBe("legacy description");

        await render(<Radio value="second" options={options} />);
        expect(container.querySelectorAll<HTMLInputElement>("input")[1].checked).toBe(true);

        const changes: string[] = [];
        await render(<Radio key="uncontrolled" defaultValue="first" options={options} onChange={value => changes.push(value)} />);
        const second = container.querySelectorAll<HTMLInputElement>("input")[1];
        await act(async () => second.click());

        expect(second.checked).toBe(true);
        expect(changes).toEqual(["second"]);
    });

    test("Radio disabled state blocks callbacks and is rendered disabled", async () => {
        const changes: string[] = [];
        await render(
            <Radio
                defaultValue="first"
                options={[{name: "First", value: "first"}, {name: "Second", value: "second"}]}
                disabled
                onChange={value => changes.push(value)}
            />
        );
        const second = container.querySelectorAll<HTMLInputElement>("input")[1];

        await act(async () => second.click());

        expect(changes).toEqual([]);
        expect(second.disabled).toBe(true);
        expect(container.firstElementChild?.classList.contains("bd-radio-disabled")).toBe(true);
    });
});
