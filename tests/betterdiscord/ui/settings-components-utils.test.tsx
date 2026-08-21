import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {SettingsContext} from "@ui/contexts";
import {useItemProps, type BaseSettingProps} from "@ui/settings/components/utils";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

interface ItemResult {
    disabled: boolean | undefined;
    state: number;
    original: number;
    setState(value: number, stateOnly?: boolean): void;
}

let container: HTMLDivElement;
let root: Root;
let current: ItemResult;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

function ItemHarness({props}: {props: BaseSettingProps<number>;}) {
    current = useItemProps(props);
    return <output data-disabled={String(current.disabled)} data-state={String(current.state)} />;
}

async function render(props: BaseSettingProps<number>, wrapper?: (children: React.ReactNode) => React.ReactNode) {
    await act(async () => {
        const item = <ItemHarness props={props} />;
        root.render(wrapper ? wrapper(item) : item);
    });
}

describe("useItemProps", () => {
    test("uses fresh controlled values after rerender", async () => {
        await render({value: 1});
        expect(current.state).toBe(1);

        await render({value: 2});
        expect(current.state).toBe(2);
    });

    test("updates uncontrolled local state", async () => {
        const changes: number[] = [];
        await render({defaultValue: 1, onChange: value => changes.push(value)});

        await act(async () => current.setState(2));

        expect(current.original).toBe(1);
        expect(current.state).toBe(2);
        expect(changes).toEqual([2]);
    });

    test("keeps a stable setter while invoking the latest callback", async () => {
        const firstChanges: number[] = [];
        const secondChanges: number[] = [];
        await render({value: 1, onChange: value => firstChanges.push(value)});
        const stableSetter = current.setState;

        await render({value: 2, onChange: value => secondChanges.push(value)});
        expect(current.setState).toBe(stableSetter);

        await act(async () => stableSetter(3));

        expect(firstChanges).toEqual([]);
        expect(secondChanges).toEqual([3]);
    });

    test("gives a real provider precedence over props", async () => {
        const changes: number[] = [];
        await render({value: 1, onChange: value => changes.push(value)}, children => (
            <SettingsContext.Provider value={{value: 10, disabled: false}}>{children}</SettingsContext.Provider>
        ));

        expect(current.original).toBe(10);
        expect(current.state).toBe(10);

        await act(async () => current.setState(11));
        expect(changes).toEqual([11]);
    });

    test("combines local disabled with an enabled provider", async () => {
        const changes: number[] = [];
        await render({value: 1, disabled: true, onChange: value => changes.push(value)}, children => (
            <SettingsContext.Provider value={{value: 10, disabled: false}}>{children}</SettingsContext.Provider>
        ));

        expect(current.state).toBe(10);
        expect(current.disabled).toBe(true);
        await act(async () => current.setState(11));
        expect(current.state).toBe(10);
        expect(changes).toEqual([]);
    });

    test("honors a disabled provider", async () => {
        const changes: number[] = [];
        await render({value: 1, onChange: value => changes.push(value)}, children => (
            <SettingsContext.Provider value={{value: 10, disabled: true}}>{children}</SettingsContext.Provider>
        ));

        expect(current.disabled).toBe(true);
        await act(async () => current.setState(11));
        expect(current.state).toBe(10);
        expect(changes).toEqual([]);
    });

    test("calls onChange once and skips it for state-only updates", async () => {
        const changes: number[] = [];
        await render({defaultValue: 1, onChange: value => changes.push(value)});

        await act(async () => current.setState(2));
        expect(changes).toEqual([2]);

        await act(async () => current.setState(3, true));
        expect(changes).toEqual([2]);
        expect(current.state).toBe(3);
    });
});
