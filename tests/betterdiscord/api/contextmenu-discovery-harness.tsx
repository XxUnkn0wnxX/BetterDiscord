import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import React from "react";
import type ContextMenu from "@api/contextmenu";


type MenuProps = Parameters<Parameters<ContextMenu["patch"]>[1]>[1];
type Callback = Parameters<ContextMenu["patch"]>[1];
type Element = React.ReactElement<any>;
type Component = React.ComponentType<MenuProps>;
type MenuEvent = {type: string; contextMenu: {render?: Component; renderLazy?: () => Promise<Component>;};};

const Menu = () => null;
const Provider = () => null;
const errors = mock((_scope: string, ..._details: unknown[]) => {});
const interceptors: Array<(event: MenuEvent) => void> = [];

mock.module("@webpack", () => ({
    Filters: {bySource: () => () => true, byStrings: () => () => true},
    getByKeys: () => ({
        MenuSeparator: Menu,
        MenuCheckboxItem: Menu,
        MenuRadioItem: Menu,
        MenuControlItem: Menu,
        MenuGroup: Menu,
        MenuItem: Menu,
        Menu
    }),
    getLazyByKeys: async () => ({colorDefault: "default", colorDanger: "danger", focused: "focused", checkboxContainer: "checkbox"}),
    getMangled: () => ({closeContextMenu: () => {}, openContextMenu: () => {}}),
    getModule: () => undefined,
    webpackRequire: {m: {}, c: {}}
}));
mock.module("@common/logger", () => ({"default": {error: errors, warn: () => {}, stacktrace: () => {}}}));
mock.module("@modules/discordmodules", () => ({"default": {Dispatcher: {
    addInterceptor: (interceptor: (event: MenuEvent) => void) => interceptors.push(interceptor)
}}}));
mock.module("@modules/dommanager", () => ({"default": {injectStyle: () => {}}}));

// NodePatcher and its getType utility remain real in this process.
const {default: ContextMenuClass} = await import("@api/contextmenu");
const contextMenu = new ContextMenuClass();
const unpatches: Array<() => void> = [];
const props: MenuProps = {
    config: {context: "APP"},
    context: "APP",
    onHeightUpdate: () => {},
    position: "right",
    target: document.body,
    theme: "dark"
};

function element(type: React.ElementType, elementProps?: Record<string, any>): Element {
    return React.createElement(type, elementProps);
}

function patch(id: string | RegExp, callback: Callback) {
    const unpatch = contextMenu.patch(id, callback);
    unpatches.push(unpatch);
    return unpatch;
}

function dispatch(component: Component): Component {
    const event: MenuEvent = {type: "CONTEXT_MENU_OPEN", contextMenu: {render: component}};
    for (const interceptor of interceptors) interceptor(event);
    return event.contextMenu.render!;
}

function render(component: Component, renderProps = props): Element {
    return (component as React.FunctionComponent<MenuProps>)(renderProps) as Element;
}

function renderNode(node: Element): Element {
    return render(node.type as Component, node.props);
}

function renderProp(children: (...args: any[]) => React.ReactNode) {
    const Layer = () => element(Provider, {children});
    const Root = () => element(Layer, props);
    return renderNode(render(dispatch(Root)));
}

beforeEach(() => errors.mockClear());
afterEach(() => {
    for (const unpatch of unpatches.splice(0)) unpatch();
});

describe("ContextMenu dispatcher discovery with real NodePatcher", () => {
    test("accepts and preserves IDs on the public Group component", () => {
        const group = React.createElement(contextMenu.Group!, {id: "plugin-group"}, "items");
        expect(group.props.id).toBe("plugin-group");
        expect(group.props.children).toBe("items");
    });

    test("patches direct render trees with original props and unchanged return identity", () => {
        const tree = element(Menu, {navId: "direct", children: "items"});
        const callback = mock((_tree: Element, _props: MenuProps, _instance?: React.Component<MenuProps>) => {});
        patch("direct", callback);
        const Root = mock((_props: MenuProps) => tree);
        const wrapped = dispatch(Root);
        expect(wrapped).not.toBe(Root);
        expect(render(wrapped)).toBe(tree);
        expect(Root).toHaveBeenCalledWith(props);
        expect(callback).toHaveBeenCalledWith(tree, props, undefined);
        expect(callback.mock.calls[0]![1]).toBe(props);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    test("patches lazy dispatcher renders after resolution and ignores other events", async () => {
        const tree = element(Menu, {navId: "lazy"});
        const callback = mock(() => {});
        patch("lazy", callback);
        const Root = () => tree;
        const ignored: MenuEvent = {type: "OTHER_EVENT", contextMenu: {render: Root}};
        for (const interceptor of interceptors) interceptor(ignored);
        expect(ignored.contextMenu.render).toBe(Root);

        const renderLazy = mock(async () => Root);
        const event: MenuEvent = {type: "CONTEXT_MENU_OPEN", contextMenu: {renderLazy}};
        for (const interceptor of interceptors) interceptor(event);
        expect(renderLazy).not.toHaveBeenCalled();
        const wrapped = await event.contextMenu.renderLazy!();
        expect(renderLazy).toHaveBeenCalledTimes(1);
        expect(render(wrapped)).toBe(tree);
        expect(callback).toHaveBeenCalledWith(tree, props, undefined);
    });

    test("forwards every render-prop argument, provider props and the class instance", () => {
        const tree = element(Menu, {navId: "render-prop"});
        const children = mock((..._args: any[]) => tree);
        const provider = element(Provider, {children, marker: "retained"});
        class Layer extends React.Component<MenuProps> {
            render() {
                return provider;
            }
        }
        const Root = () => element(Layer, props);
        const callback = mock((_tree: Element, _props: MenuProps, _instance?: React.Component<MenuProps>) => {});
        patch("render-prop", callback);
        const layer = render(dispatch(Root));
        const instance = new (layer.type as React.ComponentClass<MenuProps>)(layer.props);
        const wrapped = instance.render() as Element;
        expect(wrapped).not.toBe(provider);
        expect(wrapped.type).toBe(provider.type);
        expect(wrapped.props.marker).toBe("retained");
        expect(provider.props.children).toBe(children);
        const args = [{isFocused: true}, "second", null, 42];
        expect(wrapped.props.children(...args)).toBe(tree);
        expect(children).toHaveBeenCalledWith(...args);
        expect(callback).toHaveBeenCalledWith(tree, props, instance);
        expect(callback.mock.calls[0]![1]).toBe(instance.props);
    });

    test("discovers nested navIds in object children and render-prop returns", () => {
        const tree = element(Provider, {children: element(Menu, {navId: "nested"})});
        const callback = mock(() => {});
        patch("nested", callback);
        const Layer = () => tree;
        const Root = () => element(Layer, props);
        expect(renderNode(render(dispatch(Root)))).toBe(tree);
        expect(callback).toHaveBeenCalledWith(tree, props, undefined);
        const wrapped = renderProp(() => tree);
        expect(wrapped.props.children()).toBe(tree);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    test("continues through returned components with null children in both paths", () => {
        const callback = mock(() => {});
        patch("null-child", callback);
        const tree = element(Menu, {navId: "null-child"});
        const Child = () => tree;

        const returned = element(Child, {...props, children: null});
        const Layer = () => returned;
        const Root = () => element(Layer);
        const nested = renderNode(render(dispatch(Root)));
        expect(nested).toBe(returned);
        expect(renderNode(nested)).toBe(tree);
        expect(callback).toHaveBeenCalledWith(tree, returned.props, undefined);

        const renderPropChild = element(Child, {...props, children: null});
        const wrapped = renderProp(() => renderPropChild);
        expect(wrapped.props.children()).toBe(renderPropChild);
        expect(renderNode(renderPropChild)).toBe(tree);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    test("traverses object children to find a deeper component in both paths", () => {
        const callback = mock(() => {});
        patch("object-child", callback);
        const tree = element(Menu, {navId: "object-child"});
        const Child = () => tree;
        const nestedChild = element(Child, props);
        const returned = element(Provider, {children: nestedChild});
        const Layer = () => returned;
        const Root = () => element(Layer);
        expect(renderNode(render(dispatch(Root)))).toBe(returned);
        expect(renderNode(nestedChild)).toBe(tree);

        const otherChild = element(() => tree, props);
        const renderPropTree = element(Provider, {children: otherChild});
        expect(renderProp(() => renderPropTree).props.children()).toBe(renderPropTree);
        expect(renderNode(otherChild)).toBe(tree);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    test("falls back to returned components with primitive children", () => {
        const callback = mock(() => {});
        patch("primitive-child", callback);
        const tree = element(Menu, {navId: "primitive-child"});
        for (const child of ["label", 42, true]) {
            const Child = () => tree;
            const Layer = () => element(Child, {...props, children: child});
            const Root = () => element(Layer);
            expect(renderNode(renderNode(render(dispatch(Root))))).toBe(tree);
        }
        expect(callback).toHaveBeenCalledTimes(3);
    });

    test("preserves null, primitive and array render-prop returns", () => {
        for (const result of [null, undefined, false, 0, "text", [element(Menu, {navId: "array"})]]) {
            const wrapped = renderProp(() => result);
            expect(wrapped.props.children()).toBe(result);
        }
    });

    test("patches ten recursive layers and stops before the eleventh", () => {
        const callback = mock(() => {});
        patch("depth-limit", callback);
        for (const count of [10, 11]) {
            let next: Component = () => element(Menu, {navId: "depth-limit"});
            for (let index = 1; index < count; index++) {
                const Child: Component = next;
                next = (): Element => element(Child, props);
            }
            const First = next;
            const Root = () => element(First, props);
            let node = render(dispatch(Root));
            for (let index = 0; index < count; index++) node = renderNode(node);
            expect(node.props.navId).toBe("depth-limit");
            expect(callback).toHaveBeenCalledTimes(1);
        }
    });

    test("uses the same depth budget across render-prop discovery", () => {
        const callback = mock(() => {});
        patch("render-prop-depth", callback);
        for (const count of [9, 10]) {
            const Child = () => element(Menu, {navId: "render-prop-depth"});
            let next: Component = () => element(Provider, {children: () => element(Child, {...props, children: null})});
            for (let index = 1; index < count; index++) {
                const Nested: Component = next;
                next = (): Element => element(Nested, props);
            }
            const First = next;
            const Root = () => element(First, props);
            let node = render(dispatch(Root));
            for (let index = 0; index < count; index++) node = renderNode(node);
            const child = node.props.children();
            expect(renderNode(child).props.navId).toBe("render-prop-depth");
            expect(callback).toHaveBeenCalledTimes(1);
        }
    });

    test("contains plugin exceptions and preserves original render-prop exceptions", () => {
        const failure = new Error("plugin failure");
        const callback = mock(() => {});
        patch("exceptions", () => {throw failure;});
        patch("exceptions", callback);
        const tree = element(Menu, {navId: "exceptions"});
        const wrapped = renderProp(() => tree);
        expect(wrapped.props.children()).toBe(tree);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors.mock.calls[0]![3]).toBe(failure);

        const renderFailure = new Error("render failure");
        const throwing = renderProp(() => {throw renderFailure;});
        let caught: unknown;
        try {throwing.props.children();}
        catch (error) {caught = error;}
        expect(caught).toBe(renderFailure);
        expect(errors).toHaveBeenCalledTimes(1);
    });

    test("runs once per render-prop invocation across rerenders and repeated dispatch", () => {
        const tree = element(Menu, {navId: "rerenders"});
        const children = mock(() => tree);
        const Layer = () => element(Provider, {children});
        const Root = () => element(Layer, props);
        const callback = mock(() => {});
        patch("rerenders", callback);
        const first = dispatch(Root);
        const second = dispatch(Root);
        expect(second).toBe(first);
        for (const wrapped of [first, second, first]) {
            const provider = renderNode(render(wrapped));
            expect(provider.props.children()).toBe(tree);
        }
        expect(children).toHaveBeenCalledTimes(3);
        expect(callback).toHaveBeenCalledTimes(3);
    });

    test("unpatches named, wildcard and regex callbacks from captured wrappers", () => {
        const tree = element(Menu, {navId: "captured-menu"});
        const named = mock(() => {});
        const wildcard = mock(() => {});
        const regex = mock(() => {});
        const unpatchNamed = patch("captured-menu", named);
        const unpatchWildcard = patch("captured-*", wildcard);
        patch(/^captured-/, regex);
        const wrapped = renderProp(() => tree);
        const children = wrapped.props.children;
        expect(children()).toBe(tree);
        expect(named).toHaveBeenCalledTimes(1);
        expect(wildcard).toHaveBeenCalledTimes(1);
        expect(regex).toHaveBeenCalledTimes(1);
        unpatchNamed();
        unpatchNamed();
        unpatchWildcard();
        contextMenu.unpatch(/^captured-/, regex);
        expect(children()).toBe(tree);
        expect(named).toHaveBeenCalledTimes(1);
        expect(wildcard).toHaveBeenCalledTimes(1);
        expect(regex).toHaveBeenCalledTimes(1);
    });
});
