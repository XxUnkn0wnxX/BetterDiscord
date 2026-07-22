import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act, useState} from "react";
import {createRoot, type Root} from "react-dom/client";

import Search from "@ui/settings/components/search";


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

function SearchHarness({searchKey}: {searchKey: string;}) {
    const [query, setQuery] = useState("partial match");

    return <Search
        key={searchKey}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search all plugins..."
    />;
}

describe("Search", () => {
    test("restores a controlled query when the search input remounts", async () => {
        await act(async () => root.render(<SearchHarness searchKey="before-reload" />));
        expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("partial match");

        await act(async () => root.render(<SearchHarness searchKey="after-reload" />));
        expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("partial match");
    });

    test("clears an old query when the search page mode changes", async () => {
        const changes: string[] = [];
        const renderSearch = async (key: string) => {
            await act(async () => root.render(<Search key={key} onChange={(event) => changes.push(event.target.value)} />));
            return container.querySelector<HTMLInputElement>("input")!;
        };
        const enterQuery = async (input: HTMLInputElement, value: string) => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
                input.dispatchEvent(new Event("input", {bubbles: true}));
            });
        };

        const installedSearch = await renderSearch("plugin-installed-search");
        await enterQuery(installedSearch, "partial match");
        expect(installedSearch.value).toBe("partial match");
        expect(changes.at(-1)).toBe("partial match");

        const storeSearch = await renderSearch("plugin-store-search");
        expect(storeSearch.value).toBe("");
        await enterQuery(storeSearch, "store query");
        expect(storeSearch.value).toBe("store query");
        expect(changes.at(-1)).toBe("store query");

        const returnedSearch = await renderSearch("plugin-installed-search");
        expect(returnedSearch.value).toBe("");
    });
});
