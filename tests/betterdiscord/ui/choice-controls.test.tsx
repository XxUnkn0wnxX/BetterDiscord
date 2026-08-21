import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {SettingsContext} from "@ui/contexts";
import Dropdown from "@ui/settings/components/dropdown";
import Keybind from "@ui/settings/components/keybind";
import Slider from "@ui/settings/components/slider";


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

let container: HTMLDivElement;
let root: Root;
let intersectionObserverDescriptor: PropertyDescriptor | undefined;
let togglePopoverDescriptor: PropertyDescriptor | undefined;
const togglePopoverCalls: Array<boolean | undefined> = [];

beforeEach(() => {
    intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
    togglePopoverDescriptor = Object.getOwnPropertyDescriptor(HTMLUListElement.prototype, "togglePopover");
    togglePopoverCalls.length = 0;

    class StubIntersectionObserver {
        constructor(_callback: unknown) {}
        observe() {}
        unobserve() {}
    }

    Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        writable: true,
        value: StubIntersectionObserver
    });
    Object.defineProperty(HTMLUListElement.prototype, "togglePopover", {
        configurable: true,
        writable: true,
        value(force?: boolean) {
            togglePopoverCalls.push(force);
        }
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();

    if (intersectionObserverDescriptor) Object.defineProperty(globalThis, "IntersectionObserver", intersectionObserverDescriptor);
    else delete (globalThis as {IntersectionObserver?: unknown;}).IntersectionObserver;

    if (togglePopoverDescriptor) Object.defineProperty(HTMLUListElement.prototype, "togglePopover", togglePopoverDescriptor);
    else delete (HTMLUListElement.prototype as {togglePopover?: unknown;}).togglePopover;
});

async function render(children: React.ReactNode) {
    await act(async () => root.render(children));
}

async function changeRange(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
}

async function pressKey(type: "keydown" | "keyup", key: string) {
    await act(async () => {
        window.dispatchEvent(new KeyboardEvent(type, {bubbles: true, cancelable: true, key}));
    });
}

describe("choice setting controls", () => {
    test("Dropdown follows controlled rerenders, stores default values, and emits scalar selections once", async () => {
        const options = [
            {value: "first", label: "First"},
            {value: "second", label: "Second"}
        ];

        await render(<Dropdown value="first" options={options} />);
        expect(container.querySelector(".bd-select-value")?.textContent).toBe("First");

        await render(<Dropdown value="second" options={options} />);
        expect(container.querySelector(".bd-select-value")?.textContent).toBe("Second");

        const changes: unknown[] = [];
        await render(<Dropdown key="uncontrolled" defaultValue="first" options={options} onChange={value => changes.push(value)} />);
        await act(async () => container.querySelectorAll<HTMLLIElement>("li")[1].click());

        expect(container.querySelector(".bd-select-value")?.textContent).toBe("Second");
        expect(changes).toEqual(["second"]);
        expect(togglePopoverCalls).toEqual([false]);
    });

    test("Dropdown combines provider disabled state with local visuals and callback blocking", async () => {
        const changes: string[] = [];
        await render(
            <SettingsContext.Provider value={{value: "first", disabled: true}}>
                <Dropdown defaultValue="second" options={[{value: "first", label: "First"}, {value: "second", label: "Second"}]} onChange={value => changes.push(value)} />
            </SettingsContext.Provider>
        );

        const button = container.querySelector<HTMLButtonElement>("button.bd-select")!;
        await act(async () => container.querySelectorAll<HTMLLIElement>("li")[1].click());

        expect(button.disabled).toBe(true);
        expect(button.classList.contains("bd-select-disabled")).toBe(true);
        expect(changes).toEqual([]);
    });

    test("Slider follows controlled rerenders and emits finite numeric values for every accepted action", async () => {
        await render(<Slider value={1} min={0} max={10} />);
        const controlledInput = container.querySelector<HTMLInputElement>("input")!;
        expect(controlledInput.value).toBe("1");

        await render(<Slider value={7} min={0} max={10} />);
        expect(controlledInput.value).toBe("7");

        const changes: number[] = [];
        await render(<Slider key="uncontrolled" defaultValue={2} min={0} max={10} markers={[8]} onChange={value => changes.push(value)} />);
        const input = container.querySelector<HTMLInputElement>("input")!;
        await changeRange(input, "4");

        const track = container.querySelector<HTMLDivElement>(".bd-slider-track")!;
        Object.defineProperty(track, "getBoundingClientRect", {configurable: true, value: () => ({left: 0, width: 100})});
        await act(async () => track.dispatchEvent(new MouseEvent("click", {bubbles: true, clientX: 50})));
        await act(async () => container.querySelector<HTMLDivElement>(".bd-slider-marker")!.click());

        expect(changes).toEqual([4, 5, 8]);
        expect(changes.every(value => typeof value === "number" && Number.isFinite(value))).toBe(true);
    });

    test("Slider disabled track and marker clicks do not mutate state or invoke callbacks", async () => {
        const changes: number[] = [];
        await render(<Slider defaultValue={2} min={0} max={10} markers={[8]} disabled onChange={value => changes.push(value)} />);

        const input = container.querySelector<HTMLInputElement>("input")!;
        const track = container.querySelector<HTMLDivElement>(".bd-slider-track")!;
        Object.defineProperty(track, "getBoundingClientRect", {configurable: true, value: () => ({left: 0, width: 100})});

        await act(async () => track.dispatchEvent(new MouseEvent("click", {bubbles: true, clientX: 50})));
        await act(async () => container.querySelector<HTMLDivElement>(".bd-slider-marker")!.click());

        expect(input.disabled).toBe(true);
        expect(input.value).toBe("2");
        expect(container.firstElementChild?.classList.contains("bd-slider-disabled")).toBe(true);
        expect(changes).toEqual([]);
    });

    test("Keybind follows controlled display, copies recording arrays, and clears without saving partial keys", async () => {
        await render(<Keybind value={["Control", "H"]} />);
        const controlledInput = container.querySelector<HTMLInputElement>("input")!;
        expect(controlledInput.value).toBe("Ctrl + H");

        await render(<Keybind value={["Alt"]} />);
        expect(controlledInput.value).toBe("Alt");

        const changes: string[][] = [];
        await render(<Keybind key="record" defaultValue={[]} max={2} clearable onChange={value => changes.push(value)} />);
        await act(async () => container.querySelector<HTMLButtonElement>(".bd-keybind-record")!.click());
        await pressKey("keydown", "A");
        await pressKey("keydown", "B");
        await pressKey("keyup", "B");

        expect(changes).toHaveLength(1);
        expect(changes[0]).toEqual(["A", "B"]);

        await act(async () => container.querySelector<HTMLButtonElement>(".bd-keybind-record")!.click());
        await pressKey("keydown", "C");
        await pressKey("keyup", "C");
        expect(changes).toHaveLength(2);
        expect(changes[1]).toEqual(["C"]);
        expect(changes[0]).not.toBe(changes[1]);

        await act(async () => container.querySelector<HTMLButtonElement>(".bd-keybind-record")!.click());
        await pressKey("keydown", "Partial");
        await act(async () => container.querySelector<HTMLButtonElement>(".bd-keybind-clear")!.click());
        await pressKey("keyup", "Partial");

        expect(changes).toEqual([["A", "B"], ["C"], []]);
        expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("");
    });

    test("Keybind disables record, clear, input, and keyboard callbacks together", async () => {
        const changes: string[][] = [];
        await render(<Keybind defaultValue={[]} clearable disabled onChange={value => changes.push(value)} />);

        const record = container.querySelector<HTMLButtonElement>(".bd-keybind-record")!;
        const clear = container.querySelector<HTMLButtonElement>(".bd-keybind-clear")!;
        const input = container.querySelector<HTMLInputElement>("input")!;

        await act(async () => {
            record.click();
            clear.click();
            input.click();
        });
        await pressKey("keydown", "Ignored");

        expect(record.disabled).toBe(true);
        expect(clear.disabled).toBe(true);
        expect(input.disabled).toBe(true);
        expect(container.firstElementChild?.classList.contains("bd-keybind-disabled")).toBe(true);
        expect(changes).toEqual([]);
    });

    test("Keybind cancels recording when effective disabled state changes", async () => {
        const changes: string[][] = [];
        let disabled = false;
        const renderKeybind = () => render(
            <SettingsContext.Provider value={{value: [], disabled}}>
                <Keybind defaultValue={[]} onChange={value => changes.push(value)} />
            </SettingsContext.Provider>
        );

        await renderKeybind();
        await act(async () => container.querySelector<HTMLButtonElement>(".bd-keybind-record")!.click());
        await pressKey("keydown", "Partial");
        expect(container.firstElementChild?.classList.contains("recording")).toBe(true);

        disabled = true;
        await renderKeybind();
        expect(container.firstElementChild?.classList.contains("recording")).toBe(false);

        disabled = false;
        await renderKeybind();
        const keydown = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, key: "Ignored"});
        await act(async () => window.dispatchEvent(keydown));
        const keyup = new KeyboardEvent("keyup", {bubbles: true, cancelable: true, key: "Ignored"});
        await act(async () => window.dispatchEvent(keyup));

        expect(keydown.defaultPrevented).toBe(false);
        expect(keyup.defaultPrevented).toBe(false);
        expect(container.firstElementChild?.classList.contains("recording")).toBe(false);
        expect(changes).toEqual([]);

        await act(async () => container.querySelector<HTMLButtonElement>(".bd-keybind-record")!.click());
        await pressKey("keydown", "Fresh");
        await pressKey("keyup", "Fresh");
        expect(changes).toEqual([["Fresh"]]);
    });
});
