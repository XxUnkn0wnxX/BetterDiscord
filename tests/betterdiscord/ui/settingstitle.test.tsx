import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act, type ReactElement, type ReactNode, useState} from "react";
import {createRoot, type Root} from "react-dom/client";

import Search from "@ui/settings/components/search";
import SettingsTitle, {SettingsTitlePublisher, type SettingsTitleProps} from "@ui/settings/title";


Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

let contentContainer: HTMLDivElement;
let contentRoot: Root;
let headerContainer: HTMLDivElement;
let headerRoot: Root;

beforeEach(() => {
    contentContainer = document.createElement("div");
    headerContainer = document.createElement("div");
    document.body.append(contentContainer, headerContainer);
    contentRoot = createRoot(contentContainer);
    headerRoot = createRoot(headerContainer);
});

afterEach(async () => {
    await act(async () => {
        contentRoot.unmount();
        headerRoot.unmount();
    });
    contentContainer.remove();
    headerContainer.remove();
});

function RetainedHeaderOwner({initialQuery, publish}: {initialQuery: string; publish(value: ReactNode): void;}) {
    const [query, setQuery] = useState(initialQuery);
    const title = (
        <SettingsTitle text={<span>{query ? "Plugins - 2 Results" : "Plugins"}</span>}>
            <Search value={query} onChange={(event) => setQuery(event.target.value)} />
        </SettingsTitle>
    );

    return <SettingsTitlePublisher publish={publish} title={title} />;
}

async function enterQuery(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
}

describe("SettingsTitlePublisher", () => {
    test("replaces retained search state and callbacks after the owner remounts", async () => {
        const publish = (value: ReactNode) => {
            const title = value as ReactElement<SettingsTitleProps>;
            headerRoot.render(<>
                <div className="title">{title.props.text}</div>
                <div className="children">{title.props.children}</div>
            </>);
        };

        await act(async () => contentRoot.render(<RetainedHeaderOwner key="before-modal" initialQuery="log" publish={publish} />));
        expect(headerContainer.querySelector(".title")?.textContent).toBe("Plugins - 2 Results");
        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("log");

        await act(async () => contentRoot.render(<RetainedHeaderOwner key="after-modal" initialQuery="" publish={publish} />));
        expect(headerContainer.querySelector(".title")?.textContent).toBe("Plugins");

        const currentInput = headerContainer.querySelector<HTMLInputElement>("input")!;
        expect(currentInput.value).toBe("");
        await enterQuery(currentInput, "fresh");
        expect(headerContainer.querySelector<HTMLInputElement>("input")?.value).toBe("fresh");
    });
});
