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
        onChange={(value) => setQuery(value)}
        placeholder="Search all plugins..."
    />;
}

async function enterQuery(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
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
            await act(async () => root.render(<Search key={key} onChange={(value) => changes.push(value)} />));
            return container.querySelector<HTMLInputElement>("input")!;
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

    test("tracks an uncontrolled default only until the first edit", async () => {
        const changes: string[] = [];

        await act(async () => root.render(<Search defaultValue="initial" onChange={(value) => changes.push(value)} />));
        const input = container.querySelector<HTMLInputElement>("input")!;
        expect(input.value).toBe("initial");

        await act(async () => root.render(<Search defaultValue="replacement" onChange={(value) => changes.push(value)} />));
        expect(input.value).toBe("initial");

        await enterQuery(input, "typed");
        expect(input.value).toBe("typed");
        expect(changes).toEqual(["typed"]);
    });

    test("supports an omitted value as an empty uncontrolled search", async () => {
        const changes: string[] = [];

        await act(async () => root.render(<Search onChange={(value) => changes.push(value)} />));
        const input = container.querySelector<HTMLInputElement>("input")!;
        expect(input.value).toBe("");

        await enterQuery(input, "query");
        expect(changes).toEqual(["query"]);
    });

    test("clears a controlled query with one scalar callback", async () => {
        const changes: string[] = [];

        function ControlledSearch() {
            const [query, setQuery] = useState("query");
            return <Search value={query} onChange={(value) => {
                changes.push(value);
                setQuery(value);
            }} />;
        }

        await act(async () => root.render(<ControlledSearch />));
        expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("query");

        await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
        expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("");
        expect(changes).toEqual([""]);
    });

    test("blocks input, clear, and focus while disabled", async () => {
        const changes: string[] = [];

        await act(async () => root.render(<Search defaultValue="query" disabled onChange={(value) => changes.push(value)} />));
        const input = container.querySelector<HTMLInputElement>("input")!;
        expect(input.disabled).toBe(true);
        expect(container.querySelector(".bd-search-disabled")).not.toBeNull();
        expect(document.activeElement).not.toBe(input);

        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "blocked");
            input.dispatchEvent(new Event("input", {bubbles: true}));
            (container.querySelector("button") as HTMLButtonElement).click();
        });

        expect(input.value).toBe("query");
        expect(changes).toEqual([]);
    });

    test("uses the requested max length and defaults to fifty", async () => {
        await act(async () => root.render(<Search defaultValue="" max={7} />));
        expect(container.querySelector<HTMLInputElement>("input")?.maxLength).toBe(7);

        await act(async () => root.render(<Search defaultValue="" />));
        expect(container.querySelector<HTMLInputElement>("input")?.maxLength).toBe(50);
    });
});
