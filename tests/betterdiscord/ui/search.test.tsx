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
});
