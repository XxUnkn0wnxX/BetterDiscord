import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

const capturedProps: Array<{autoFocus: boolean}> = [];
const MockEditor = (props: {autoFocus?: boolean}) => {
    capturedProps.push({autoFocus: !!props.autoFocus});
    return <div data-auto-focus={props.autoFocus ? "1" : "0"} />;
};

mock.module("@common/i18n", () => ({
    t: (key: string) => key
}));
mock.module("@stores/settings", () => ({
    "default": {
        get: () => false
    }
}));
mock.module("@ui/customcss/editor", () => ({"default": MockEditor}));

const {"default": CssEditor} = await import("@ui/customcss/csseditor");
const {"default": AddonEditor} = await import("@ui/misc/addoneditor");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    capturedProps.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

describe("Custom CSS and addon editor props", () => {
    test("CssEditor enables autoFocus for settings and detached variants", async () => {
        await act(async () => {
            root.render(
                <CssEditor
                    css="body {}"
                    openNative={() => {}}
                    update={() => {}}
                    save={() => {}}
                    onChange={() => {}}
                    isSettingsPage
                />
            );
        });
        expect(capturedProps.at(-1)?.autoFocus).toBe(true);

        capturedProps.length = 0;
        await act(async () => {
            root.render(
                <CssEditor
                    css="body {}"
                    openNative={() => {}}
                    update={() => {}}
                    save={() => {}}
                    onChange={() => {}}
                    openDetached={() => {}}
                />
            );
        });
        expect(capturedProps.at(-1)?.autoFocus).toBe(true);
    });

    test("AddonEditor enables autoFocus", async () => {
        await act(async () => {
            root.render(
                <AddonEditor
                    content="body {}"
                    language="css"
                    save={() => {}}
                    openNative={() => {}}
                    ref={null}
                />
            );
        });
        expect(capturedProps.at(-1)?.autoFocus).toBe(true);
    });
});
