import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import type ContextMenu from "@api/contextmenu";


type ItemSetup = Parameters<ContextMenu["buildItem"]>[0];
type ItemElement = React.ReactElement<Record<string, any>>;

const MenuSeparator = () => <hr />;
const MenuCheckboxItem = (props: Record<string, any>) => <button
    data-checked={props.checked}
    onClick={props.action}
>{props.label}</button>;
const MenuRadioItem = () => null;
const MenuControlItem = () => null;
const MenuGroup = ({children}: React.PropsWithChildren) => <div>{children}</div>;
const MenuItem = () => null;
const Menu = ({children}: React.PropsWithChildren) => <div>{children}</div>;

mock.module("@webpack", () => ({
    Filters: {bySource: () => () => true, byStrings: () => () => true},
    getByKeys: () => ({MenuSeparator, MenuCheckboxItem, MenuRadioItem, MenuControlItem, MenuGroup, MenuItem, Menu}),
    getLazyByKeys: async () => ({colorDefault: "default", colorDanger: "danger", focused: "focused", checkboxContainer: "checkbox"}),
    getMangled: () => ({closeContextMenu: () => {}, openContextMenu: () => {}}),
    getModule: () => undefined,
    webpackRequire: {m: {}, c: {}}
}));
mock.module("@common/logger", () => ({"default": {error: () => {}, warn: () => {}, stacktrace: () => {}}}));
mock.module("@modules/discordmodules", () => ({"default": {Dispatcher: {addInterceptor: () => {}}}}));
mock.module("@modules/dommanager", () => ({"default": {injectStyle: () => {}}}));
mock.module("@modules/nodepatcher", () => ({"default": class {patch() {}}}));

const {default: ContextMenuClass} = await import("@api/contextmenu");
const contextMenu = new ContextMenuClass();

// These assignments also verify the retained plugin forms against the public types.
const renderedChildren = <span>Rendered child</span>;
const legacySubmenu = {
    type: "submenu",
    id: "legacy-submenu",
    label: "Legacy submenu",
    children: renderedChildren,
    onClick: () => {}
} satisfies ItemSetup;
const legacyRadio = {
    type: "radio",
    id: "radio",
    label: "Radio",
    group: "choices",
    checked: false,
    active: true,
    onClick: () => {}
} satisfies ItemSetup;
const legacyToggle = {
    type: "toggle",
    id: "toggle",
    label: "Toggle",
    checked: false,
    onClick: () => {}
} satisfies ItemSetup;

function buildItem(props: ItemSetup): ItemElement {
    return contextMenu.buildItem(props) as ItemElement;
}

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

describe("ContextMenu item creation", () => {
    test("builds direct groups and recursively nested groups", () => {
        const setup: ItemSetup = {
            type: "group",
            items: [
                {id: "first", label: "First"},
                {type: "group", items: [{id: "nested", label: "Nested"}]}
            ]
        };
        const direct = buildItem(setup);
        const [recursive] = contextMenu.buildMenuChildren([setup]) as ItemElement[];

        for (const group of [direct, recursive]) {
            expect(group.type).toBe(MenuGroup);
            const children = group.props.children as ItemElement[];
            expect(children[0].type).toBe(MenuItem);
            expect(children[0].props.id).toBe("first");
            expect(children[1].type).toBe(MenuGroup);
            expect(children[1].props.children[0].props.id).toBe("nested");
        }
        expect(buildItem({type: "group", items: []}).props.children).toEqual([]);
    });

    test("keeps string ID generation and explicit IDs with rendered labels", () => {
        const generated = buildItem({label: "123! Menu Label / action"} as ItemSetup);
        expect(generated.props.id).toBe("-Menu-Label-action");

        const label = <strong>Rendered label</strong>;
        const explicit = buildItem({id: "plugin-id", label});
        expect(explicit.props.id).toBe("plugin-id");
        expect(explicit.props.label).toBe(label);
        expect(buildItem({label} as ItemSetup).props.id).toBe("");
    });

    test("passes render-function labels and expanded Discord props through unchanged", () => {
        const label = ({isFocused}: {isFocused: boolean;}) => isFocused ? "Focused" : "Idle";
        const accessory = {type: "image" as const, src: "https://example.com/icon.png"};
        const indicator = {icon: () => null, color: "red"};
        const item = buildItem({
            id: "renderable",
            label,
            leadingAccessory: accessory,
            trailingIndicator: indicator,
            badge: {type: "new", variant: "success"},
            shortcut: "Ctrl+K",
            subtext: "Detail",
            disabled: true,
            dontCloseOnAction: true,
            className: "plugin-item"
        });
        expect(item.props.label).toBe(label);
        expect(item.props.leadingAccessory).toBe(accessory);
        expect(item.props.trailingIndicator).toBe(indicator);
        expect(item.props.badge).toEqual({type: "new", variant: "success"});
        expect(item.props.shortcut).toBe("Ctrl+K");
        expect(item.props.subtext).toBe("Detail");
        expect(item.props.disabled).toBe(true);
        expect(item.props.dontCloseOnAction).toBe(true);
        expect(item.props.className).toBe("plugin-item");
        expect(buildItem({label} as ItemSetup).props.id).toBe("");
    });

    test("converts submenu items and legacy render setup but preserves rendered children", () => {
        for (const childrenProp of ["items", "render"] as const) {
            const item = buildItem({
                type: "submenu",
                id: "parent",
                label: "Parent",
                [childrenProp]: [{id: "child", label: "Child"}]
            });
            expect(item.type).toBe(MenuItem);
            expect(item.props.children[0].type).toBe(MenuItem);
            expect(item.props.children[0].props.id).toBe("child");
        }

        const rendered = buildItem({...legacySubmenu, items: [{id: "unused", label: "Unused"}]});
        expect(rendered.props.children).toBe(renderedChildren);
        expect(rendered.props.action).toBe(legacySubmenu.onClick);
    });

    test("retains onClick alias, action precedence, danger and extended flags", () => {
        const onClick = mock(() => {});
        const action = mock(() => {});
        const legacy = buildItem({id: "legacy", label: "Legacy", onClick, danger: true});
        expect(legacy.props.action).toBe(onClick);
        expect(legacy.props.color).toBe("danger");
        expect(legacy.props.extended).toBe(true);

        const modern = buildItem({id: "modern", label: "Modern", onClick, action});
        expect(modern.props.action).toBe(action);
        expect(onClick).not.toHaveBeenCalled();
        expect(action).not.toHaveBeenCalled();
    });

    test("keeps radio group, active alias and action identity", () => {
        const item = buildItem({...legacyRadio});
        expect(item.type).toBe(MenuRadioItem);
        expect(item.props.group).toBe("choices");
        expect(item.props.checked).toBe(true);
        expect(item.props.action).toBe(legacyRadio.onClick);
        expect(item.props.extended).toBe(true);
    });

    test("preserves control callbacks without applying regular-item wrappers", () => {
        const control = () => <input />;
        const item = buildItem({type: "control", id: "control", control});
        expect(item.type).toBe(MenuControlItem);
        expect(item.props.control).toBe(control);
        expect(item.props.extended).toBeUndefined();
        expect(buildItem({type: "separator"}).type).toBe(MenuSeparator);
    });
});

describe("ContextMenu toggle lifecycle", () => {
    test("passes the actual event to legacy onClick and toggles across renders", async () => {
        const actions = mock((event: React.MouseEvent) => {
            expect(event.type).toBe("click");
            expect(event.currentTarget).toBe(container.querySelector("button")!);
        });
        function Toggle() {
            return buildItem({...legacyToggle, onClick: actions});
        }
        await act(async () => root.render(<Toggle />));
        const button = container.querySelector("button")!;
        expect(button.dataset.checked).toBe("false");
        await act(async () => button.click());
        expect(button.dataset.checked).toBe("true");
        await act(async () => button.click());
        expect(button.dataset.checked).toBe("false");
        expect(actions).toHaveBeenCalledTimes(2);
    });

    test("respects preventDefault and action precedence while starting from active", async () => {
        const onClick = mock(() => {});
        const action = mock((event: React.MouseEvent) => event.preventDefault());
        function Toggle() {
            return buildItem({...legacyToggle, active: true, onClick, action});
        }
        await act(async () => root.render(<Toggle />));
        const button = container.querySelector("button")!;
        expect(button.dataset.checked).toBe("true");
        await act(async () => button.click());
        expect(button.dataset.checked).toBe("true");
        expect(action).toHaveBeenCalledTimes(1);
        expect(onClick).not.toHaveBeenCalled();
    });
});
