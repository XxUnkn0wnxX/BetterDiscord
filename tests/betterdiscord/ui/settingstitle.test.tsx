import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act, useState} from "react";
import {createRoot, type Root} from "react-dom/client";

import Search from "@ui/settings/components/search";
import SettingsTitle, {createSettingsTitleStore, SettingsTitlePublisher, type SettingsTitleStore} from "@ui/settings/title";


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

let contentContainer: HTMLDivElement;
let contentRoot: Root;
let headerContainer: HTMLDivElement;
let headerRoot: Root;
let secondaryHeaderContainer: HTMLDivElement;
let secondaryHeaderRoot: Root;

beforeEach(() => {
    contentContainer = document.createElement("div");
    headerContainer = document.createElement("div");
    secondaryHeaderContainer = document.createElement("div");
    document.body.append(contentContainer, headerContainer, secondaryHeaderContainer);
    contentRoot = createRoot(contentContainer);
    headerRoot = createRoot(headerContainer);
    secondaryHeaderRoot = createRoot(secondaryHeaderContainer);
});

afterEach(async () => {
    await act(async () => {
        contentRoot.unmount();
        headerRoot.unmount();
        secondaryHeaderRoot.unmount();
    });
    contentContainer.remove();
    headerContainer.remove();
    secondaryHeaderContainer.remove();
});

function RetainedHeader({store, renderId}: {store: SettingsTitleStore; renderId: string;}) {
    const title = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    return <div data-render-id={renderId}>
        <div className="title">{title.text}</div>
        <div className="children">{title.children}</div>
    </div>;
}

function RetainedHeaderOwner({initialQuery, store, onQuery}: {initialQuery: string; store: SettingsTitleStore; onQuery?(value: string): void;}) {
    const [query, setQuery] = useState(initialQuery);
    const title = (
        <SettingsTitle text={<span>{query ? "Plugins - 2 Results" : "Plugins"}</span>}>
            <Search value={query} onChange={(event) => {
                onQuery?.(event.target.value);
                setQuery(event.target.value);
            }} />
        </SettingsTitle>
    );

    return <SettingsTitlePublisher publish={store.publish} title={title} />;
}

async function enterQuery(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
}

describe("SettingsTitlePublisher", () => {
    test("updates both retained headers after either header renders last", async () => {
        const store = createSettingsTitleStore();

        await act(async () => {
            headerRoot.render(<RetainedHeader store={store} renderId="hidden-before-modal" />);
            secondaryHeaderRoot.render(<RetainedHeader store={store} renderId="visible" />);
            contentRoot.render(<RetainedHeaderOwner initialQuery="log" store={store} />);
        });

        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("log");
        expect(secondaryHeaderContainer.querySelector<HTMLInputElement>("input")?.value).toBe("log");

        // Opening or closing an addon modal can independently rerender the
        // hidden Discord title root after the visible title root.
        await act(async () => headerRoot.render(<RetainedHeader store={store} renderId="hidden-after-modal" />));

        const visibleInput = secondaryHeaderContainer.querySelector<HTMLInputElement>("input")!;
        await enterQuery(visibleInput, "");

        expect(headerContainer.querySelector(".title")?.textContent).toBe("Plugins");
        expect(secondaryHeaderContainer.querySelector(".title")?.textContent).toBe("Plugins");
        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("");
        expect(secondaryHeaderContainer.querySelector<HTMLInputElement>("input")?.value).toBe("");

        await enterQuery(visibleInput, "fresh");
        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("fresh");
        expect(secondaryHeaderContainer.querySelector<HTMLInputElement>("input")?.value).toBe("fresh");
    });

    test("replaces both retained searches after the content owner remounts", async () => {
        const store = createSettingsTitleStore();
        const oldQueries: string[] = [];
        const currentQueries: string[] = [];

        await act(async () => {
            headerRoot.render(<RetainedHeader store={store} renderId="first" />);
            secondaryHeaderRoot.render(<RetainedHeader store={store} renderId="second" />);
            contentRoot.render(<RetainedHeaderOwner key="before-modal" initialQuery="log" store={store} onQuery={(value) => oldQueries.push(value)} />);
        });

        await act(async () => contentRoot.render(<RetainedHeaderOwner key="after-modal" initialQuery="" store={store} onQuery={(value) => currentQueries.push(value)} />));

        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("");
        expect(secondaryHeaderContainer.querySelector<HTMLInputElement>("input")?.value).toBe("");

        await enterQuery(secondaryHeaderContainer.querySelector<HTMLInputElement>("input")!, "fresh");
        expect(oldQueries).toEqual([]);
        expect(currentQueries).toEqual(["fresh"]);
        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("fresh");
        expect(secondaryHeaderContainer.querySelector<HTMLInputElement>("input")?.value).toBe("fresh");
    });

    test("stops notifying a retained header after it unmounts", async () => {
        const store = createSettingsTitleStore();

        await act(async () => {
            headerRoot.render(<RetainedHeader store={store} renderId="remaining" />);
            secondaryHeaderRoot.render(<RetainedHeader store={store} renderId="removed" />);
            contentRoot.render(<RetainedHeaderOwner key="before-removal" initialQuery="log" store={store} />);
        });

        await act(async () => secondaryHeaderRoot.render(null));
        await act(async () => contentRoot.render(<RetainedHeaderOwner key="after-removal" initialQuery="fresh" store={store} />));

        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("fresh");
        expect(secondaryHeaderContainer.childElementCount).toBe(0);
    });

    test("keeps provider snapshots isolated and readable before subscription", async () => {
        const pluginStore = createSettingsTitleStore();
        const themeStore = createSettingsTitleStore();
        const emptySnapshot = pluginStore.getSnapshot();

        pluginStore.publish(<SettingsTitle text="Plugins">plugin controls</SettingsTitle>);
        themeStore.publish(<SettingsTitle text="Themes">theme controls</SettingsTitle>);

        expect(pluginStore.getSnapshot()).not.toBe(emptySnapshot);
        expect(pluginStore.getSnapshot()).toBe(pluginStore.getSnapshot());

        await act(async () => {
            headerRoot.render(<RetainedHeader store={pluginStore} renderId="plugins" />);
            secondaryHeaderRoot.render(<RetainedHeader store={themeStore} renderId="themes" />);
        });

        expect(headerContainer.querySelector(".title")?.textContent).toBe("Plugins");
        expect(secondaryHeaderContainer.querySelector(".title")?.textContent).toBe("Themes");

        await act(async () => pluginStore.publish(<SettingsTitle text="Updated Plugins">updated controls</SettingsTitle>));

        expect(headerContainer.querySelector(".title")?.textContent).toBe("Updated Plugins");
        expect(secondaryHeaderContainer.querySelector(".title")?.textContent).toBe("Themes");
    });
});
