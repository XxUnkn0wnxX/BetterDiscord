import {afterEach, beforeEach, expect, mock, spyOn, test} from "bun:test";
import React, {act, type PropsWithChildren, type RefObject} from "react";
import {createRoot, type Root} from "react-dom/client";
import {transformSync} from "esbuild";
import type {Webpack} from "@typed/discord";

// Load package source at runtime so its separate TS compiler conventions do
// not become part of the repository's typecheck.
const {default: RealFocusRingScope}: {default: typeof import("react-focus-rings").FocusRingScope} = await import(
    new URL("../../../node_modules/react-focus-rings/src/FocusRingScope.tsx", import.meta.url).href
);
const {default: FocusRingContext}: {default: React.Context<{container: Element | null; invalidate: () => void}>} = await import(
    new URL("../../../node_modules/react-focus-rings/src/FocusRingContext.tsx", import.meta.url).href
);

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

const moduleCache: Record<string, Webpack.Module> = {};
const sources: Record<string, Webpack.RawModule> = {};
const cachedIds = new Map<string, string>();
const roots: Root[] = [];
const lookups: string[] = [];
const refs: Array<RefObject<Element | null>> = [];
const managers: Array<React.ContextType<typeof FocusRingContext>> = [];
const legacyProps: Array<Record<string, unknown>> = [];
const renderErrors: unknown[][] = [];
const springConfigs: any[] = [];
let legacyReads = 0;
const accessibilityContext = React.createContext({reducedMotion: {enabled: false}});
const childContext = React.createContext("default");

mock.module(import.meta.resolve("../../../src/betterdiscord/webpack/require"), () => ({webpackRequire: {c: moduleCache, m: sources}, lazyListeners: new Set()}));
mock.module(import.meta.resolve("../../../src/betterdiscord/webpack/cache"), () => ({"default": {
    get: (id: string) => {lookups.push(id); return cachedIds.get(id);},
    set: (id: string, moduleId: string) => cachedIds.set(id, moduleId),
    getIdFromStack: () => undefined
}}));
mock.module("@common/logger", () => ({"default": {warn: () => {}}}));

// Keep production factory filtering, module search and export mapping.
const searching = await import("../../../src/betterdiscord/webpack/searching");
const webpack = await import("../../../src/betterdiscord/webpack/webpack");
const Filters = await import("../../../src/betterdiscord/webpack/filter");
mock.module("@webpack", () => ({...searching, ...webpack, Filters}));

const AnimatedDiv = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>((props, ref) => <div {...props} ref={ref}/>);
mock.module("@modules/discordmodules", () => ({"default": {
    AccessibilityContext: accessibilityContext,
    ReactSpring: {
        animated: {div: AnimatedDiv},
        useSpring: (config: any) => {springConfigs.push(config); return {opacity: config.opacity, transform: config.transform};}
    }
}}));

function add(id: string, exports: any, source = "fixture") {
    moduleCache[id] = {id, exports, declarations: {}, loaded: true};
    sources[id] = Object.assign(() => undefined, {toString: () => source});
}

const easing = {inOut: (value: unknown) => value, back: () => "back", quad: "quad"};
add("615300", {Easing: easing});
const {default: ModalRoot} = await import("../../../src/betterdiscord/ui/modals/root.tsx");

// Execute the package's actual scope implementation; only its factory text is
// formatted like Discord's minified bundle for the production export mapper.
const scopeSource = transformSync(`export default (${String(RealFocusRingScope)})`, {
    minifyWhitespace: true,
    minifySyntax: true
}).code;
function Scope(props: React.ComponentProps<typeof RealFocusRingScope>) {
    refs.push(props.containerRef);
    return RealFocusRingScope(props);
}
Object.defineProperty(Scope, "toString", {value: () => scopeSource});

const legacyRender = (_props: PropsWithChildren<{disableTrack?: boolean}>, _ref: React.ForwardedRef<unknown>) => {
    legacyProps.push(_props);
    return <>{_props.children}</>;
};
const LegacyFocusLock = React.forwardRef(legacyRender);
Object.defineProperty(legacyRender, "toString", {
    value: () => {legacyReads++; return "function(){impressionProperties;return x.Provider;}";}
});

function addScope() {
    add("42", {scope: Scope}, "function(){return 'focus-rings-ring';}");
}

function Input({onMount}: {onMount?: () => void}) {
    const context = React.useContext(childContext);
    const manager = React.useContext(FocusRingContext);
    managers.push(manager);
    const [value, setValue] = React.useState("");
    React.useEffect(() => {onMount?.();}, [onMount]);
    return <>
        <input aria-label="Modal input" value={value} onInput={event => setValue(event.currentTarget.value)}/>
        <span data-context>{context}</span>
    </>;
}

function render(element: React.ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(element));
    return {container, root};
}

beforeEach(() => {
    for (const id of Object.keys(moduleCache)) delete moduleCache[id];
    for (const id of Object.keys(sources)) delete sources[id];
    cachedIds.clear();
    lookups.length = 0;
    refs.length = 0;
    managers.length = 0;
    legacyProps.length = 0;
    renderErrors.length = 0;
    springConfigs.length = 0;
    legacyReads = 0;
    document.documentElement.classList.remove("reduce-motion");
    spyOn(console, "error").mockImplementation((...args: unknown[]) => {renderErrors.push(args);});
});

afterEach(() => {
    act(() => {for (const root of roots) root.unmount();});
    roots.length = 0;
    document.body.replaceChildren();
    document.documentElement.classList.remove("reduce-motion");
    expect(renderErrors).toEqual([]);
    mock.restore();
});

test("uses the actual upstream scope, its container ref and child context without looking up legacy wrapping", () => {
    expect(Filters.byStrings(".current),", ".Provider,{value:", ".current.setThemeOptions")(Scope)).toBe(true);
    addScope();
    add("305866", {legacy: LegacyFocusLock});
    const {container, root} = render(<childContext.Provider value="Settings owner">
        <ModalRoot transitionState={1} size={ModalRoot.Sizes.SMALL} style={ModalRoot.Styles.STANDARD} className="custom-modal">
            <Input/>
        </ModalRoot>
    </childContext.Provider>);

    const modal = container.querySelector<HTMLDivElement>(".bd-modal-root")!;
    expect(modal.className).toBe("bd-modal-root bd-modal-small custom-modal bd-modal-standard");
    expect(refs[0].current).toBe(modal);
    expect(container.querySelector("[data-context]")?.textContent).toBe("Settings owner");
    expect(legacyProps).toHaveLength(0);
    expect(legacyReads).toBe(0);
    expect(lookups).not.toContain("core-modalroot-focuslock");

    const manager = managers[0];
    expect(manager.container).toBe(modal);
    const invalidate = manager.invalidate;
    const heldRef = refs[0];
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(heldRef.current).toBeNull();
    expect(modal.isConnected).toBe(false);
    expect(manager.invalidate).not.toBe(invalidate);
});

test("preserves input state, focus and identity when capabilities change during an open modal", () => {
    let mounts = 0;
    const onMount = () => {mounts++;};
    const element = (state: number) => <ModalRoot transitionState={state}><Input onMount={onMount}/></ModalRoot>;
    const {container, root} = render(element(1));
    const input = container.querySelector<HTMLInputElement>("input")!;
    input.focus();
    act(() => {
        input.value = "typed text";
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
    addScope();
    act(() => root.render(element(2)));
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("typed text");
    expect(document.activeElement).toBe(input);
    expect(mounts).toBe(1);
    expect(refs).toHaveLength(0);

    render(element(1));
    expect(refs).toHaveLength(1);
    expect(refs[0].current?.classList.contains("bd-modal-root")).toBe(true);
});

test("keeps the selected scope identity if mapped exports are replaced during rerender", () => {
    addScope();
    const {container, root} = render(<ModalRoot transitionState={1}><Input/></ModalRoot>);
    const input = container.querySelector<HTMLInputElement>("input")!;
    input.focus();
    act(() => {
        input.value = "scope input";
        input.dispatchEvent(new Event("input", {bubbles: true}));
    });
    const firstRef = refs[0];
    expect(firstRef.current).toBe(container.querySelector(".bd-modal-root"));
    moduleCache["42"].exports.scope = () => <div>replacement</div>;
    act(() => root.render(<ModalRoot transitionState={2}><Input/></ModalRoot>));
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("scope input");
    expect(document.activeElement).toBe(input);
    expect(refs[refs.length - 1]).toBe(firstRef);
    expect(container.textContent).not.toContain("replacement");
});

test("uses the existing legacy wrapper for missing factory or missing mapped scope, and Fragment when neither exists", () => {
    for (const missing of ["factory", "scope"]) {
        if (missing === "scope") add("42", {manager: {}}, "focus-rings-ring");
        add("305866", {legacy: LegacyFocusLock});
        const {container} = render(<ModalRoot transitionState={1}><input defaultValue={missing}/></ModalRoot>);
        expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(missing);
        expect(legacyProps[legacyProps.length - 1].disableTrack).toBe(true);
        expect(legacyProps[legacyProps.length - 1]).not.toHaveProperty("containerRef");
    }
    delete moduleCache["305866"];
    const {container} = render(<ModalRoot transitionState={1}><input defaultValue="Fragment"/></ModalRoot>);
    expect(container.children).toHaveLength(1);
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("Fragment");
    expect(refs).toHaveLength(0);
});

test("retains transition durations, scaling, reduced motion and mapped modal constants", () => {
    const {container, root} = render(<ModalRoot transitionState={2}/>);
    expect(springConfigs[0]).toMatchObject({opacity: 0, transform: "scale(0.7)", config: {duration: 100, clamp: true}});
    expect(container.querySelector<HTMLDivElement>(".bd-modal-root")?.style.transform).toBe("scale(0.7)");
    act(() => root.render(<ModalRoot transitionState={0}/>));
    expect(springConfigs[springConfigs.length - 1]).toMatchObject({opacity: 1, transform: "scale(1)", config: {duration: 300, clamp: true}});
    document.documentElement.classList.add("reduce-motion");
    act(() => root.render(<accessibilityContext.Provider value={undefined as any}><ModalRoot transitionState={2}/></accessibilityContext.Provider>));
    expect(springConfigs[springConfigs.length - 1].transform).toBe("scale(1)");
    expect(ModalRoot.Sizes.DYNAMIC).toBe("");
    expect(ModalRoot.Styles.CUSTOM).toBe("");
});
