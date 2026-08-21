import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {FlexChild} from "@ui/base/flex";


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

describe("FlexChild", () => {
    test("does not mutate frozen props while composing its class", async () => {
        const props = Object.freeze({className: "custom", id: "child"});

        await render(FlexChild(props));

        const element = container.firstElementChild!;
        expect(props.className).toBe("custom");
        expect(element.id).toBe("child");
        expect(element.classList.contains("bd-flex")).toBe(true);
        expect(element.classList.contains("custom")).toBe(true);
        expect(element.classList.contains("bd-flex-child")).toBe(true);
    });

    test("adds the child class when no className is supplied", async () => {
        await render(FlexChild({}));

        const element = container.firstElementChild!;
        expect(element.classList.contains("bd-flex")).toBe(true);
        expect(element.classList.contains("bd-flex-child")).toBe(true);
    });
});
